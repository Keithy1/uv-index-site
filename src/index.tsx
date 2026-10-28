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

import { FAVICON_BYTES, FAVICON_PATH, TOUCH_ICON_BYTES, TOUCH_ICON_PATH } from "./assets/icons";
import {
  LOGO_BYTES,
  LOGO_PATH,
  MARK_BYTES,
  MARK_PATH,
  OG_IMAGE_BYTES,
  OG_IMAGE_PATH,
} from "./assets/brand";

import { buildCurve } from "./lib/chart";
import {
  adviceLevel,
  currentLevel,
  nextLocalDay,
  peakOnLocalDay,
  pointsOnLocalDay,
} from "./lib/current";
import { camsStale, DISPATCH_SOURCE, requestFetch, shouldDispatch } from "./lib/dispatch";
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
  forecastsStale,
  noteDispatch,
  noteMeasured,
  pruneReadings,
  readHealth,
  rebuildForecasts,
  recordRun,
  RETENTION_DAYS,
  STALE_AFTER_MS,
} from "./lib/store";
import { normalsFor } from "./lib/normals";
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
import { NotFound } from "./views/NotFound";
import { Unavailable } from "./views/Unavailable";

const app = new Hono<{ Bindings: Env }>();

/**
 * A page, not a bare 500, when something throws.
 *
 * D1's free plan allows a fixed number of row reads a day. When that ran out,
 * every page that reads data threw, and Hono answered with its default: the
 * words "Internal Server Error" and no markup at all. The text pages kept
 * working, since they never touch the database, but nothing said so.
 *
 * 503 with Retry-After, not 500: it tells Google the page exists and to come
 * back, where a 500 repeated for a day invites it to drop the page. `no-store`
 * matters as much -- without it the edge would cache the failure under the
 * page's own five-minute TTL and keep serving it after the cause had cleared.
 */
app.onError((err, c) => {
  console.error(`unhandled error on ${new URL(c.req.url).pathname}: ${String(err)}`);
  c.header("Cache-Control", "no-store");
  c.header("Retry-After", "600");
  return c.html(<Unavailable />, 503);
});

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
 * How long after publication a missing CAMS run may go before health says so:
 * long enough for the 13:40 UTC retry and the Worker's dispatch (90 min) to
 * have tried, so the monitor alerts only when the rescue has failed too.
 */
const CAMS_HEALTH_GRACE_MS = 4 * 60 * 60 * 1000;

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
  // CAMS is judged against its publication clock, not by age: see
  // CAMS_HEALTH_GRACE_MS above. Listed here so it is still an expected source.
  cams: Number.POSITIVE_INFINITY,
  // city_now, which every listing page reads. Recorded on every cron whether
  // or not a rebuild was needed, so it measures "the summary is current with
  // its inputs", not "a forecast arrived" -- that is epa's and cams's job.
  // Forecasts can arrive perfectly while the rebuild fails, and every page
  // would quietly serve yesterday's series.
  summary: 30 * 60 * 1000,
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
  const live = liveCountries();

  const headlines: CountryHeadline[] = [];
  for (const country of live) {
    const cities = locationsIn(country.code).filter((l) => l.status === "live");
    // Fall back to every known city where a country publishes no city pages,
    // rather than showing the country as having no data at all. Both live
    // countries publish them now; this keeps the next country working on the
    // day its data lands and before its pages do.
    const pool = cities.length > 0 ? cities : locationsIn(country.code);
    const data = await countryData(c.env.DB, pool.map((l) => l.id), now);

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
        healthy:
          source === "cams"
            ? !camsStale(row?.last_ok_at ?? null, new Date(now), CAMS_HEALTH_GRACE_MS)
            : ageMs !== null && ageMs <= limit,
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
    // Published 26 October 2026. Each page carries an hourly forecast curve,
    // tomorrow's peak and its own protection times, so it is not the thin page
    // the design was guarding against -- it simply has no measured reading,
    // and says so.
    cityPages: true,
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

/**
 * The share image.
 *
 * Immutable: the bytes are compiled in, so a long cache costs nothing and the
 * crawlers that fetch this on every share do not reach the origin twice.
 *
 * It still picks up the pre-launch `X-Robots-Tag: noindex` from the middleware
 * above, which is right -- it keeps the image out of Google Images before
 * launch -- and harmless for sharing, because the social crawlers that render a
 * preview card do not consult that header.
 */
// Every compiled-in file, in one table so a new one cannot be served with the
// wrong type. A plain Response rather than c.body: Hono's body() types do not
// accept a Uint8Array, and casting the buffer to satisfy them would be the less
// honest of the two fixes. Each path must also be in FILE_PATHS (lib/urls.ts),
// or it is given a trailing slash and 301'd into nothing.
for (const [path, bytes, type] of [
  [OG_IMAGE_PATH, OG_IMAGE_BYTES, "image/jpeg"],
  [LOGO_PATH, LOGO_BYTES, "image/jpeg"],
  [MARK_PATH, MARK_BYTES, "image/webp"],
  [FAVICON_PATH, FAVICON_BYTES, "image/x-icon"],
  [TOUCH_ICON_PATH, TOUCH_ICON_BYTES, "image/png"],
] as const) {
  app.get(path, () => new Response(bytes, {
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" },
  }));
}

/**
 * A page for a URL that is not one, with the ways on.
 *
 * Hono's default is the words "404 Not Found" and nothing else. The design
 * asked for a real page: the status stays 404 so nothing is indexed, but a
 * reader who followed a stale link lands somewhere they can leave from.
 * Every c.notFound() in the routes -- an unknown country, a city with no page
 * -- comes through here too.
 */
app.notFound((c) => {
  c.header("Cache-Control", "public, max-age=300");
  return c.html(<NotFound />, 404);
});

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
  const data = await countryData(c.env.DB, cities.map((l) => l.id), now);

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
      alert: (row?.alerts ?? []).includes(today),
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

  const page = COUNTRY_PAGES[country];
  if (!page) return c.notFound();

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

  // Advice follows the highest level still to come, not the current reading:
  // at 12:19 am this page said "no protection needed" beside its own forecast
  // of 12.1 Extreme later the same day.
  const tomorrowPeak = peakOnLocalDay(
    pointsOnLocalDay(data.forecastToday, location.tz, nextLocalDay(today)),
  );
  const nowMinutes = localMinutes(now.toISOString(), location.tz);

  // Where there is no instrument the "reading" is the forecast for this hour,
  // and the page says so rather than calling it a measurement.
  const level = currentLevel({
    measured: page.measured ? (data.latest && !data.latest.stale ? data.latest.uvi : null) : null,
    forecast: page.measured ? [] : data.forecastToday,
    now,
  });
  const nearestForecast = page.measured
    ? null
    : [...data.forecastToday]
        .filter((p) => Math.abs(Date.parse(p.validAt) - now.getTime()) <= 90 * 60 * 1000)
        .sort(
          (a, b) =>
            Math.abs(Date.parse(a.validAt) - now.getTime()) -
            Math.abs(Date.parse(b.validAt) - now.getTime()),
        )[0] ?? null;

  const reading = page.measured
    ? data.latest
    : nearestForecast && level.uvi !== null
      ? { uvi: level.uvi, validAt: nearestForecast.validAt, stale: false }
      : null;

  const advice = adviceLevel({
    now: level.uvi,
    today: curve,
    tomorrowPeak: tomorrowPeak?.uvi ?? null,
    nowMinutes,
    nowIsForecast: !page.measured,
  });

  c.header("Cache-Control", `public, max-age=${settings.cacheSeconds}, stale-while-revalidate=600`);
  return c.html(
    <CityPage
      location={location}
      now={now}
      reading={reading}
      measured={page.measured}
      credit={page.credit}
      curve={series}
      clearSky={data.clearSkyToday.map(toPoint)}
      // The Now line only where nothing measured marks the moment: a US city
      // has no instrument, so its chart had no sign of where the day had got to.
      geometry={buildCurve(series, latestPoint, page.measured ? null : nowMinutes)}
      tomorrow={tomorrowPeak ? { uvi: tomorrowPeak.uvi, minutes: tomorrowPeak.minutes } : null}
      hasForecast={curve.length > 0}
      advice={advice}
      normals={normalsFor(location.id)}
      month={Number(today.slice(5, 7))}
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

/**
 * Rebuild the stored forecast series when a newer forecast has landed.
 *
 * Every city of every live country, not only those with pages: the home page
 * falls back to a country's whole list when it publishes no city pages, and a
 * city missing from city_now is a city that shows no data.
 *
 * Its own try, so a failed rebuild is recorded against `summary` and does not
 * take the dispatch check down with it.
 */
async function refreshSummaries(env: Env, health: Awaited<ReturnType<typeof readHealth>>): Promise<void> {
  const ids = liveCountries().flatMap((c) => locationsIn(c.code).map((l) => l.id));
  try {
    const rebuilt = (await forecastsStale(env.DB, health, ids.length))
      ? await rebuildForecasts(env.DB, ids)
      : 0;
    if (rebuilt > 0) console.log(`summary: rebuilt forecast series for ${rebuilt} cities`);
    await recordRun(env.DB, "summary", { ok: true, records: rebuilt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`summary rebuild failed: ${message}`);
    await recordRun(env.DB, "summary", { ok: false, records: 0, error: message });
  }
}

/**
 * Retention, once a day, in the first run after D1's daily allowances reset.
 *
 * The cron fires every five minutes, so exactly one run lands in 00:30-00:35
 * UTC. Straight after the reset is deliberate: the prune is the one statement
 * that scans readings, and the start of the allowance day is the one moment it
 * can never be the thing that tips the day over. A failed or skipped day costs
 * nothing -- the next day's prune removes both days' rows.
 *
 * Its own try, so a failed prune is logged as itself rather than recorded as an
 * ARPANSA failure by the handler's catch.
 */
async function pruneOncePerDay(env: Env, now: Date): Promise<void> {
  if (now.getUTCHours() !== 0 || now.getUTCMinutes() < 30 || now.getUTCMinutes() >= 35) return;
  try {
    const removed = await pruneReadings(env.DB, now);
    console.log(`retention: removed ${removed} readings older than ${RETENTION_DAYS} days`);
  } catch (error) {
    console.error(`retention failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

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
          // The newest reading per station goes straight into city_now from
          // memory, so no page ever has to find it by reading readings.
          await noteMeasured(env.DB, result.readings);

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
          const health = await readHealth(env.DB);
          await refreshSummaries(env, health);
          await pruneOncePerDay(env, new Date());

          const token = env.GITHUB_DISPATCH_TOKEN;
          if (token) {
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
