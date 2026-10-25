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

import { COUNTRIES, liveCountries } from "./lib/locations";
import type { Env } from "./lib/store";
import { commitResult, latestMeasured, readHealth, STALE_AFTER_MS } from "./lib/store";
import * as arpansa from "./sources/arpansa";
import { Preview } from "./views/Preview";

const app = new Hono<{ Bindings: Env }>();

/** How late a source may be before /api/health calls it unhealthy. */
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

  const sources = rows.map((row) => {
    const limit = HEALTH_LIMITS_MS[row.source] ?? Number.POSITIVE_INFINITY;
    const ageMs = row.last_ok_at ? now - Date.parse(row.last_ok_at) : null;
    return {
      source: row.source,
      lastOkAt: row.last_ok_at,
      lastAttemptAt: row.last_attempt_at,
      lastError: row.last_error,
      recordsLastRun: row.records_last_run,
      ageSeconds: ageMs === null ? null : Math.round(ageMs / 1000),
      healthy: ageMs !== null && ageMs <= limit,
    };
  });

  // No rows at all means the cron has never run: that is unhealthy, not silence.
  const healthy = sources.length > 0 && sources.every((s) => s.healthy);
  c.header("Cache-Control", "no-store");
  return c.json({ healthy, staleAfterSeconds: STALE_AFTER_MS / 1000, sources }, healthy ? 200 : 503);
});

app.get("/robots.txt", (c) => {
  const lines = [
    "User-agent: *",
    "Disallow: /api/",
    "",
    "Sitemap: https://uvatlas.com/sitemap.xml",
    "",
  ].join("\n");
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
