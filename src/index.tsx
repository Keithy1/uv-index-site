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
import { isIndexable } from "./lib/host";
import type { CurvePoint } from "./lib/chart";
import { COUNTRIES, countrySettings, liveCountries, locationsIn } from "./lib/locations";
import type { CountryCode } from "./lib/locations";
import type { Env } from "./lib/store";
import {
  cityData,
  commitResult,
  countryData,
  latestMeasured,
  readHealth,
  STALE_AFTER_MS,
} from "./lib/store";
import { localDateKey, localMinutes } from "./lib/time";
import * as arpansa from "./sources/arpansa";
import { CityPage } from "./views/CityPage";
import type { CityRow } from "./views/CountryPage";
import { CountryPage } from "./views/CountryPage";
import { Preview } from "./views/Preview";

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

app.get("/", async (c) => {
  const now = new Date();
  const latest = await latestMeasured(c.env.DB, now);
  // Cache for the Australian refresh period: the cron writes every 5 minutes,
  // so a page older than that has nothing new to say.
  c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
  return c.html(<Preview latest={latest} generatedAt={now} />);
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

  const byName = new Map(rows.map((row) => [row.source, row]));

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

  const healthy = sources.every((s) => s.healthy);
  c.header("Cache-Control", "no-store");
  return c.json({ healthy, staleAfterSeconds: STALE_AFTER_MS / 1000, sources }, healthy ? 200 : 503);
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

  const now = new Date();
  const cities = locationsIn(country).filter((l) => l.status === "live");
  const { from, to } = dayWindow(now);
  const data = await countryData(c.env.DB, cities.map((l) => l.id), from, to, now);

  const rows: CityRow[] = cities.map((location) => {
    const row = data.get(location.id);
    const today = localDateKey(now.toISOString(), location.tz);
    const peaks = (row?.forecast ?? []).filter(
      (p) => localDateKey(p.validAt, location.tz) === today,
    );
    return {
      location,
      uvi: row?.latest?.uvi ?? null,
      validAt: row?.latest?.validAt ?? null,
      stale: row?.latest?.stale ?? false,
      peak: peaks.length ? Math.max(...peaks.map((p) => p.uvi)) : null,
    };
  });

  // Highest first; cities with no reading sink to the bottom rather than
  // being dropped, because a missing station is information too.
  rows.sort((a, b) => (b.uvi ?? -1) - (a.uvi ?? -1));

  c.header("Cache-Control", `public, max-age=${settings.cacheSeconds}, stale-while-revalidate=600`);
  return c.html(
    <CountryPage
      country={settings}
      rows={rows}
      now={now}
      hasForecast={rows.some((r) => r.peak !== null)}
    />,
  );
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
