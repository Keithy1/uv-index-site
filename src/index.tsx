/**
 * The uvatlas Worker: one scheduled handler that fetches ARPANSA, and the HTTP
 * routes that read what it stored.
 *
 * Free-plan budget this file must respect (see wrangler.jsonc):
 *   * 10 ms CPU per invocation. Time spent waiting on fetch or D1 does not
 *     count, so the limit is about parsing and rendering, not I/O.
 *   * 50 subrequests per invocation. ARPANSA is one request; EPA's 100 calls
 *     and CAMS's netCDF processing therefore run in GitHub Actions instead.
 */
import { Hono } from "hono";

import { buildCurve } from "./lib/chart";
import {
  currentLevel,
  nextLocalDay,
  peakOnLocalDay,
  pointsOnLocalDay,
} from "./lib/current";
import { DISPATCH_SOURCE, requestFetch, shouldDispatch } from "./lib/dispatch";
import { isIndexable } from "./lib/host";
import {
  countrySitemap,
  pagesSitemap,
  sitemapCountries,
  sitemapIndex,
} from "./lib/sitemap";
import { canonicalRedirect } from "./lib/urls";
import type { CurvePoint } from "./lib/chart";
import { COUNTRIES, countrySettings, liveCountries, locationsIn } from "./lib/locations";
import type { CountryCode } from "./lib/locations";
import type { Env } from "./lib/store";
import {
  cityData,
  commitResult,
  countryData,
  latestMeasured,
  noteDispatch,
  readHealth,
  STALE_AFTER_MS,
} from "./lib/store";
import { localDateKey, localMinutes } from "./lib/time";
import * as arpansa from "./sources/arpansa";
import { CityPage } from "./views/CityPage";
import type { CityRow } from "./views/CountryPage";
import { CountryPage } from "./views/CountryPage";
import * as mapAu from "./lib/map-au";
import * as mapUs from "./lib/map-us";
import type { CountryMap } from "./views/CountryPage";
import type { CountryHeadline } from "./views/HomePage";
import { HomePage } from "./views/HomePage";
import { About, Privacy, Terms } from "./views/pages/Legal";
import { Guide } from "./views/pages/Guide";
import { Methods } from "./views/pages/Methods";

const app = new Hono<{ Bindings: Env }>();

/**
 * Keep previews out of the search index.
 *
 * A workers.dev deployment is a public URL serving the same pages as
 * production. Left crawlable it would be indexed as a duplicate of
 * uvatlas.com, competing with the site it exists to rehearse — and the damage
 * lands exactly where this project cannot afford it, since the whole plan is
 * to rank a small number of pages.
 *
 * Belt and braces, because either alone has failed for people before: a header
 * on every response, and a robots.txt that disallows everything.
 */
/**
 * One URL per page: redirect anything else before doing any work.
 *
 * First in the chain on purpose. A redirect should not cost a database query
 * or a render, and a 301 that arrives after the page body would be a bug.
 */
app.use("*", async (c, next) => {
  const target = canonicalRedirect(c.req.url);
  if (target) return c.redirect(target, 301);
  await next();
});

app.use("*", async (c, next) => {
  await next();
  if (!isIndexable(new URL(c.req.url).host, c.env.SITE_INDEXABLE)) {
    c.header("X-Robots-Tag", "noindex, nofollow");
  }
});

/**
 * How late a source may be before /api/health calls it unhealthy.
 *
 * The keys are also the list of sources that are SUPPOSED to exist. That
 * matters: health used to report on whatever rows it found, so a source that
 * had never run once was not late, it was absent — and absent read as healthy.
 * A silent ARPANSA, the one feed where minutes matter, would have looked fine.
 */
const HEALTH_LIMITS_MS: Record<string, number> = {
  arpansa: 30 * 60 * 1000,
  epa: 3 * 60 * 60 * 1000,
  cams: 6 * 60 * 60 * 1000,
};

/**
 * The home page.
 *
 * Identical for every visitor and cached, deliberately: Google warns that
 * pages varying by location may not be crawled completely, and Googlebot
 * crawls mostly from US addresses. The location hint is a client-side banner
 * on top of this one cached document.
 */
app.get("/", async (c) => {
  const now = new Date();
  const { from, to } = dayWindow(now);
  const live = liveCountries();

  const headlines: CountryHeadline[] = [];
  for (const country of live) {
    const cities = locationsIn(country.code).filter((l) => l.status === "live");
    // The US publishes no city pages yet, so fall back to every known city
    // rather than showing the country as having no data at all.
    const pool = cities.length > 0 ? cities : locationsIn(country.code);
    const data = await countryData(c.env.DB, pool.map((l) => l.id), from, to, now);

    let best:
      | { uvi: number; location: (typeof pool)[number]; forecast: boolean; peak: number }
      | null = null;
    for (const location of pool) {
      const row = data.get(location.id);
      // The same definition of "now" the country page uses. It used to fall
      // back to today's PEAK here, so the home page said "forecast peak today"
      // for the United States while /us/ said "now" -- one country, two
      // headline figures depending which page you were on.
      const level = currentLevel({
        measured: row?.latest && !row.latest.stale ? row.latest.uvi : null,
        forecast: row?.forecast ?? [],
        now,
      });
      if (level.uvi === null) continue;

      // Tie-break on today's peak, exactly as the country table sorts. After
      // dark every city reads 0.0, and without this the two pages picked
      // different cities as "highest" -- Adelaide here, Alice Springs on /au/,
      // both showing 0.0 and neither wrong, which is worse than either.
      const peak =
        peakOnLocalDay(
          pointsOnLocalDay(
            row?.forecast ?? [],
            location.tz,
            localDateKey(now.toISOString(), location.tz),
          ),
        )?.uvi ?? -1;

      if (!best || level.uvi > best.uvi || (level.uvi === best.uvi && peak > best.peak)) {
        best = { uvi: level.uvi, location, forecast: level.forecast, peak };
      }
    }

    headlines.push({
      country,
      uvi: best?.uvi ?? null,
      cityName: best?.location.name ?? null,
      citySlug: best?.location.slug ?? null,
      forecast: best?.forecast ?? false,
      // New Zealand is borderline tappable at this scale; a marker keeps every
      // served country reachable by thumb.
      marker: best ? { lat: best.location.lat, lon: best.location.lon } : null,
    });
  }

  c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
  return c.html(<HomePage headlines={headlines} now={now} />);
});

/**
 * The visitor's country, for the home page's location hint.
 *
 * The home page itself is identical for everyone and cached, because Google
 * warns that pages varying by location may not be fully crawled and Googlebot
 * crawls mostly from US addresses. This endpoint is what makes that possible,
 * and robots.txt keeps it out of the index.
 */
app.get("/api/where", (c) => {
  const country = (c.req.raw.headers.get("CF-IPCountry") ?? "").toLowerCase();
  const served = liveCountries().some((x) => x.code === country);
  c.header("Cache-Control", "no-store");
  return c.json({ country: country || null, served });
});

/**
 * Per-source freshness, for an external uptime monitor to poll.
 * Returns 503 when any source is overdue so the monitor can alert without
 * parsing the body.
 */
app.get("/api/health", async (c) => {
  const rows = await readHealth(c.env.DB);
  const now = Date.now();

  // The dispatch row is internal bookkeeping, not a data source.
  const byName = new Map(
    rows.filter((row) => row.source !== DISPATCH_SOURCE).map((row) => [row.source, row]),
  );

  // Iterate the EXPECTED sources, not the rows that happen to exist, so a
  // source that has never reported is reported as never having reported.
  const sources = Object.keys(HEALTH_LIMITS_MS)
    .sort()
    .map((source) => {
      const row = byName.get(source);
      const limit = HEALTH_LIMITS_MS[source] ?? Number.POSITIVE_INFINITY;
      const ageMs = row?.last_ok_at ? now - Date.parse(row.last_ok_at) : null;
      return {
        source,
        lastOkAt: row?.last_ok_at ?? null,
        lastAttemptAt: row?.last_attempt_at ?? null,
        lastError: row?.last_error ?? (row ? null : "has never run"),
        recordsLastRun: row?.records_last_run ?? 0,
        ageSeconds: ageMs === null ? null : Math.round(ageMs / 1000),
        healthy: ageMs !== null && ageMs <= limit,
      };
    });

  /**
   * The safety net's own health.
   *
   * The Worker nudges GitHub when a fetch is overdue, using a token that
   * expires in September 2027. When it lapses every attempt returns 401, the
   * nudging stops, and nothing else changes -- the scheduled runs continue and
   * the pages keep working. That is precisely the kind of failure nobody
   * notices, so it is reported here rather than left in the logs.
   */
  const dispatchRow = rows.find((row) => row.source === DISPATCH_SOURCE);
  const dispatch = {
    configured: Boolean(c.env.GITHUB_DISPATCH_TOKEN),
    lastAttemptAt: dispatchRow?.last_attempt_at ?? null,
    lastOkAt: dispatchRow?.last_ok_at ?? null,
    lastError: dispatchRow?.last_error ?? null,
    // Healthy until it has actually failed. Never having needed to ask is the
    // normal state and must not read as a fault.
    healthy: !dispatchRow?.last_error,
  };

  const healthy = sources.every((s) => s.healthy) && dispatch.healthy;
  c.header("Cache-Control", "no-store");
  return c.json(
    { healthy, staleAfterSeconds: STALE_AFTER_MS / 1000, sources, dispatch },
    healthy ? 200 : 503,
  );
});


/**
 * Everything a country page needs that is not in the database.
 *
 * Keyed by country, and its absence is meaningful: a country with no entry has
 * no page, and the route 404s rather than rendering another country's map and
 * title. That is exactly what happened when /us/ first went live — it served
 * "UV Index Australia" over the Australian outline, because the route matched
 * any country while the template only knew one.
 */
const COUNTRY_PAGES: Record<string, {
  map: CountryMap;
  measured: boolean;
  credit: "arpansa" | "epa";
  cityPages: boolean;
}> = {
  au: {
    map: {
      width: mapAu.VIEW_WIDTH,
      height: mapAu.VIEW_HEIGHT,
      outlinePath: mapAu.OUTLINE_PATH,
      project: mapAu.project,
    },
    measured: true,
    credit: "arpansa",
    cityPages: true,
  },
  us: {
    map: {
      width: mapUs.VIEW_WIDTH,
      height: mapUs.VIEW_HEIGHT,
      outlinePath: mapUs.OUTLINE_PATH,
      project: mapUs.project,
    },
    // EPA publishes forecasts only; there is no measured US source, and the
    // page must not imply one.
    measured: false,
    credit: "epa",
    // US city pages are added only where Search Console shows real demand, so
    // there is nothing to link to yet.
    cityPages: false,
  },
};


/**
 * Static pages. Cached for a day: nothing on them changes with the data, and
 * they are the pages most likely to be read start to finish.
 */
const STATIC_PAGES = {
  "/uv-index-explained/": Guide,
  "/methods/": Methods,
  "/about/": About,
  "/privacy/": Privacy,
  "/terms/": Terms,
} as const;

for (const [path, Page] of Object.entries(STATIC_PAGES)) {
  app.get(path, (c) => {
    c.header("Cache-Control", "public, max-age=86400, stale-while-revalidate=86400");
    return c.html(<Page />);
  });
}

/** UTC window generous enough to contain any city's local day. */
function dayWindow(now: Date): { from: string; to: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 19) + "Z";
  return {
    from: iso(new Date(now.getTime() - 36 * 3600_000)),
    to: iso(new Date(now.getTime() + 48 * 3600_000)),
  };
}

/**
 * A country page, e.g. /au/.
 *
 * Registered before the city route so that /au/ is not read as a city slug.
 */
app.get("/:country/", async (c) => {
  const country = c.req.param("country") as CountryCode;
  const settings = countrySettings(country);
  if (!settings || settings.status !== "live") return c.notFound();

  const page = COUNTRY_PAGES[country];
  if (!page) return c.notFound();

  const now = new Date();
  // A country with no published city pages still has cities worth tabulating;
  // fall back to all of them rather than rendering an empty table.
  const live = locationsIn(country).filter((l) => l.status === "live");
  const cities = live.length > 0 ? live : locationsIn(country);
  const { from, to } = dayWindow(now);
  const data = await countryData(c.env.DB, cities.map((l) => l.id), from, to, now);

  const rows: CityRow[] = cities.map((location) => {
    const row = data.get(location.id);
    const today = localDateKey(now.toISOString(), location.tz);
    const peaks = pointsOnLocalDay(row?.forecast ?? [], location.tz, today);
    const todayPeak = peakOnLocalDay(peaks);
    const tomorrowPeak = peakOnLocalDay(
      pointsOnLocalDay(row?.forecast ?? [], location.tz, nextLocalDay(today)),
    );

    // Measured where an instrument exists, the nearest hourly forecast where
    // one does not -- the same shared definition the home page uses.
    const level = currentLevel({
      measured: page.measured ? (row?.latest?.uvi ?? null) : null,
      forecast: page.measured ? [] : (row?.forecast ?? []),
      now,
    });

    return {
      location,
      uvi: level.uvi,
      validAt: page.measured ? (row?.latest?.validAt ?? null) : null,
      stale: page.measured ? (row?.latest?.stale ?? false) : false,
      peak: todayPeak?.uvi ?? null,
      tomorrow: tomorrowPeak?.uvi ?? null,
      tomorrowMinutes: tomorrowPeak?.minutes ?? null,
    };
  });

  // Highest now first, then by today's peak. The tie-break matters at night:
  // every city reads 0 after dark, and without it the order would be
  // arbitrary just when the page is least able to explain itself.
  // Cities with no reading sink to the bottom rather than being dropped,
  // because a missing station is information too.
  rows.sort(
    (a, b) => (b.uvi ?? -1) - (a.uvi ?? -1) || (b.peak ?? -1) - (a.peak ?? -1),
  );

  c.header("Cache-Control", `public, max-age=${settings.cacheSeconds}, stale-while-revalidate=600`);
  return c.html(
    <CountryPage
      country={settings}
      rows={rows}
      now={now}
      hasForecast={rows.some((r) => r.peak !== null)}
      map={page.map}
      measured={page.measured}
      credit={page.credit}
      cityPages={page.cityPages}
    />,
  );
});


/**
 * The tomorrow pages were merged into the country table.
 *
 * A permanent redirect rather than a 404: the URLs were live, and one page
 * carrying today and tomorrow is a shorter route for a reader than three
 * pages linked to each other.
 */
app.get("/:country/tomorrow/", (c) => {
  const country = c.req.param("country") as CountryCode;
  const settings = countrySettings(country);
  if (!settings || settings.status !== "live") return c.notFound();
  return c.redirect(`/${country}/`, 301);
});

/**
 * A city page, e.g. /au/perth/.
 *
 * The D1 window is UTC and deliberately wide; the local day is cut out here,
 * where the location's IANA zone is in hand. A local day is never a UTC day.
 */
app.get("/:country/:slug/", async (c) => {
  const country = c.req.param("country") as CountryCode;
  const settings = countrySettings(country);
  if (!settings || settings.status !== "live") return c.notFound();

  const slug = c.req.param("slug");
  const location = locationsIn(country).find((l) => l.slug === slug && l.status === "live");
  if (!location) return c.notFound();

  const now = new Date();
  const { from, to } = dayWindow(now);
  const data = await cityData(c.env.DB, location.id, from, to, now);

  const today = localDateKey(now.toISOString(), location.tz);
  const onDay = (iso: string) => localDateKey(iso, location.tz) === today;
  const toPoint = (p: { validAt: string; uvi: number }): CurvePoint => ({
    minutes: localMinutes(p.validAt, location.tz),
    uvi: p.uvi,
  });

  const curve = data.forecastToday.filter((p) => onDay(p.validAt)).map(toPoint);
  const measuredPoints = data.measuredToday.filter((p) => onDay(p.validAt)).map(toPoint);
  const latestPoint =
    data.latest && onDay(data.latest.validAt) && !data.latest.stale
      ? { minutes: localMinutes(data.latest.validAt, location.tz), uvi: data.latest.uvi }
      : null;

  // With no forecast yet, the measured readings so far today are still a real
  // curve and worth drawing. Labelled by describeCurve either way.
  const series = curve.length >= 3 ? curve : measuredPoints;

  c.header("Cache-Control", `public, max-age=${settings.cacheSeconds}, stale-while-revalidate=600`);
  return c.html(
    <CityPage
      location={location}
      now={now}
      reading={data.latest}
      curve={series}
      clearSky={data.clearSkyToday.map(toPoint)}
      geometry={buildCurve(series, latestPoint)}
      tomorrow={null}
      hasForecast={curve.length > 0}
    />,
  );
});

/**
 * Sitemaps: an index, one per live country, and one for the text pages.
 *
 * Served regardless of the launch flag — they are harmless unindexed, and
 * robots.txt only advertises them once indexing is on.
 */
const SITEMAP_CACHE = "public, max-age=3600, stale-while-revalidate=86400";

app.get("/sitemap.xml", (c) => {
  c.header("Content-Type", "application/xml; charset=utf-8");
  c.header("Cache-Control", SITEMAP_CACHE);
  return c.body(sitemapIndex());
});

app.get("/sitemap-pages.xml", (c) => {
  c.header("Content-Type", "application/xml; charset=utf-8");
  c.header("Cache-Control", SITEMAP_CACHE);
  return c.body(pagesSitemap());
});

// One explicit route per live country rather than a pattern: a literal
// suffix after a parameter is fragile, and the first attempt silently 404'd
// every country sitemap while the index happily linked to them.
for (const code of sitemapCountries()) {
  app.get(`/sitemap-${code}.xml`, (c) => {
    c.header("Content-Type", "application/xml; charset=utf-8");
    c.header("Cache-Control", SITEMAP_CACHE);
    return c.body(countrySitemap(code));
  });
}


app.get("/robots.txt", (c) => {
  // Disallow everything unless this is the real site AND the launch flag is
  // on; see the noindex middleware above.
  const indexable = isIndexable(new URL(c.req.url).host, c.env.SITE_INDEXABLE);
  const lines = (
    indexable
      ? [
          "User-agent: *",
          "Disallow: /api/",
          "",
          "Sitemap: https://uvatlas.com/sitemap.xml",
          "",
        ]
      : ["# Not for indexing yet: the site is still being built.", "User-agent: *", "Disallow: /", ""]
  ).join("\n");
  c.header("Content-Type", "text/plain; charset=utf-8");
  c.header("Cache-Control", "public, max-age=86400");
  return c.body(lines);
});

app.get("/api/countries", (c) =>
  c.json(COUNTRIES.map(({ code, name, status }) => ({ code, name, status }))),
);

export default {
  fetch: app.fetch,

  /**
   * Cron: every five minutes (the expression is in wrangler.jsonc).
   *
   * On failure the error is recorded and swallowed. Throwing would retry
   * nothing useful, and the site keeps serving the last good reading marked as
   * delayed, which is the documented behaviour.
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const result = await arpansa.run();
          const written = await commitResult(env.DB, result);

          // Three "not published" rejections are the Antarctic stations and are
          // expected; any other rejection means the feed's format may have
          // changed. Notes are stations reporting themselves late, which happens
          // routinely and costs us nothing because the reading is still stored.
          const unexpected = result.rejected.filter((r) => !r.includes("not published"));
          if (unexpected.length > 0) {
            console.warn(`arpansa: ${written} stored, unexpected rejections: ${unexpected.join("; ")}`);
          }
          if (result.notes.length > 0) {
            console.log(`arpansa: ${written} stored, ${result.notes.length} late: ${result.notes.join("; ")}`);
          }

          // GitHub's scheduler drops runs -- sixteen hours with no CAMS fetch
          // emptied tomorrow's column for ten of thirteen Australian cities.
          // This cron is reliable, so it watches the clock on GitHub's behalf.
          const token = env.GITHUB_DISPATCH_TOKEN;
          if (token) {
            const health = await readHealth(env.DB);
            const decision = shouldDispatch(health, new Date());
            if (decision.dispatch) {
              console.log(`asking Actions to fetch: ${decision.reason}`);
              const ok = await requestFetch(token);
              // Clears any previous error on success, so health recovers by
              // itself once the token is replaced.
              await noteDispatch(env.DB, DISPATCH_SOURCE, ok, decision.reason, new Date());
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`arpansa fetch failed: ${message}`);
          const { recordRun } = await import("./lib/store");
          await recordRun(env.DB, arpansa.SOURCE, { ok: false, records: 0, error: message });
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
