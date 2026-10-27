/**
 * Everything that touches D1.
 *
 * Two rules the rest of the Worker relies on:
 *   * writes are idempotent upserts, so re-fetching the same minute costs one
 *     write, not one row — this is what keeps us inside D1's free allowance;
 *   * a reading is only "current" if it is recent. Staleness is decided here,
 *     once, rather than in each template.
 */
import type { Reading, SourceResult } from "./records";
import { toIsoUtc } from "./records";

export interface Env {
  readonly DB: D1Database;
  /**
   * "true" once the site is finished and may be indexed. Anything else, unset
   * included, means search engines are told to stay away. See lib/host.ts.
   */
  readonly SITE_INDEXABLE?: string;
  /**
   * Fine-grained GitHub token with Actions: write on this repository, so the
   * Worker's reliable cron can trigger the fetch when GitHub's scheduler has
   * dropped it. Absent means the Worker never intervenes.
   */
  readonly GITHUB_DISPATCH_TOKEN?: string;
}

/**
 * A measured reading older than this is never presented as the reading now.
 * The page falls back to this hour's forecast, labelled as a forecast.
 */
export const STALE_AFTER_MS = 20 * 60 * 1000;

/** D1 caps how many statements one batch may carry; stay well under it. */
const BATCH_SIZE = 50;

export async function saveReadings(db: D1Database, readings: readonly Reading[]): Promise<number> {
  if (readings.length === 0) return 0;

  const insert = db.prepare(
    `INSERT INTO readings (location_id, source, kind, valid_at, uvi, issued_at, fetched_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT (location_id, source, kind, valid_at) DO UPDATE SET
       uvi = excluded.uvi,
       issued_at = excluded.issued_at,
       fetched_at = excluded.fetched_at`,
  );

  let written = 0;
  for (let i = 0; i < readings.length; i += BATCH_SIZE) {
    const chunk = readings.slice(i, i + BATCH_SIZE);
    await db.batch(
      chunk.map((r) =>
        insert.bind(r.locationId, r.source, r.kind, r.validAt, r.uvi, r.issuedAt ?? null, r.fetchedAt),
      ),
    );
    written += chunk.length;
  }
  return written;
}

export interface HealthRow {
  readonly source: string;
  readonly last_ok_at: string | null;
  readonly last_attempt_at: string | null;
  readonly last_error: string | null;
  readonly records_last_run: number;
}

/** Record the outcome of a source run, successful or not. */
export async function recordRun(
  db: D1Database,
  source: string,
  outcome: { ok: boolean; records: number; error?: string },
  at: Date = new Date(),
): Promise<void> {
  const now = toIsoUtc(at);
  await db
    .prepare(
      `INSERT INTO source_health (source, last_ok_at, last_attempt_at, last_error, records_last_run)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (source) DO UPDATE SET
         last_ok_at = COALESCE(?2, source_health.last_ok_at),
         last_attempt_at = ?3,
         last_error = ?4,
         records_last_run = ?5`,
    )
    .bind(source, outcome.ok ? now : null, now, outcome.error ?? null, outcome.records)
    .run();
}

/** Store a source's readings and its health in one go, never throwing. */
export async function commitResult(db: D1Database, result: SourceResult): Promise<number> {
  const written = await saveReadings(db, result.readings);
  await recordRun(db, result.source, { ok: written > 0, records: written });
  return written;
}

export async function readHealth(db: D1Database): Promise<HealthRow[]> {
  const { results } = await db
    .prepare(`SELECT source, last_ok_at, last_attempt_at, last_error, records_last_run
              FROM source_health ORDER BY source`)
    .all<HealthRow>();
  return results;
}

export interface LatestReading {
  readonly locationId: string;
  readonly uvi: number;
  readonly validAt: string;
  readonly source: string;
  /** True when the reading is too old to present as the reading now. */
  readonly stale: boolean;
}

/**
 * Row reads a single query may cost before it is worth knowing about.
 *
 * D1's free plan allows a fixed number of row reads a day and counts rows
 * *examined*, not returned. A query whose index stops fitting does not get
 * slower in any way a test would notice -- it gets more expensive, silently,
 * until the allowance runs out mid-afternoon and the whole site answers 503.
 *
 * test/query-plans.test.ts is the real guard and runs in CI, but it reasons
 * about plans, not about how much data is actually in the table. These budgets
 * are the backstop against the case it cannot see: the plan is fine and the
 * table has simply grown past what the plan assumed. They are generous -- about
 * five times a healthy render -- because this is an alarm, not a limit.
 */
const ROW_BUDGET = {
  cityWindow: 5_000,
  cityNow: 300,
  forecastRebuild: 40_000,
} as const;

/**
 * Warn when a query reads more rows than it should need.
 *
 * Logged, never thrown: a page that still has its data should still render. The
 * line shows up in `wrangler tail` and Workers Logs, which is where the original
 * D1_ERROR was found.
 */
function charge(name: keyof typeof ROW_BUDGET, meta: { rows_read?: number } | undefined): void {
  const read = meta?.rows_read ?? 0;
  if (read > ROW_BUDGET[name]) {
    console.warn(
      `d1 row budget: ${name} read ${read} rows, over its budget of ${ROW_BUDGET[name]}. ` +
        `Check the query plan -- see test/query-plans.test.ts.`,
    );
  }
}

/** Delete readings older than the retention window, to keep storage bounded. */
export async function pruneReadings(db: D1Database, keepDays = 400, now: Date = new Date()): Promise<void> {
  const cutoff = toIsoUtc(new Date(now.getTime() - keepDays * 86_400_000));
  await db.prepare(`DELETE FROM readings WHERE valid_at < ?1`).bind(cutoff).run();
}

export interface SeriesPoint {
  readonly validAt: string;
  readonly uvi: number;
  readonly source: string;
  /** When the forecast run was issued. Null for measurements. */
  readonly issuedAt?: string | null;
}

export interface CityData {
  /** Most recent measured reading, whatever its age. */
  readonly latest: LatestReading | null;
  /** Measured readings so far today, in the city's own day. */
  readonly measuredToday: readonly SeriesPoint[];
  /** Hourly forecast for today. Empty until CAMS is wired into D1. */
  readonly forecastToday: readonly SeriesPoint[];
  /** Hourly forecast for tomorrow. */
  readonly forecastTomorrow: readonly SeriesPoint[];
  /** Clear-sky forecast for today, used for the protection window. */
  readonly clearSkyToday: readonly SeriesPoint[];
}

/**
 * Everything one city page needs, in as few queries as the shape allows.
 *
 * The UTC window is deliberately wide (the local day plus a margin either
 * side): a local day is never a UTC day, and Perth and Sydney sit three hours
 * apart. Filtering to the exact local day happens at render time, where the
 * IANA zone is already in hand.
 */
export async function cityData(
  db: D1Database,
  locationId: string,
  fromUtc: string,
  toUtc: string,
  now: Date = new Date(),
): Promise<CityData> {
  const { results, meta } = await db
    .prepare(
      // The kinds are named, rather than taking whatever is in the window,
      // so that readings_window can apply the valid_at range per kind. This
      // page genuinely needs all three: the chart plots the measured points.
      `SELECT source, kind, valid_at, uvi, issued_at
       FROM readings
       WHERE location_id = ?1
         AND kind IN ('measured', 'forecast', 'forecast_clear')
         AND valid_at >= ?2 AND valid_at <= ?3
       ORDER BY valid_at`,
    )
    .bind(locationId, fromUtc, toUtc)
    .all<{ source: string; kind: string; valid_at: string; uvi: number; issued_at: string | null }>();
  charge("cityWindow", meta);

  const measured: SeriesPoint[] = [];
  const forecast: SeriesPoint[] = [];
  const clearSky: SeriesPoint[] = [];
  for (const row of results) {
    const point = {
      validAt: row.valid_at,
      uvi: row.uvi,
      source: row.source,
      issuedAt: row.issued_at,
    };
    if (row.kind === "measured") measured.push(point);
    else if (row.kind === "forecast_clear") clearSky.push(point);
    else forecast.push(point);
  }

  const cutoff = now.getTime() - STALE_AFTER_MS;
  const last = measured[measured.length - 1];
  const latest: LatestReading | null = last
    ? {
        locationId,
        uvi: last.uvi,
        validAt: last.validAt,
        source: last.source,
        stale: Date.parse(last.validAt) < cutoff,
      }
    : null;

  return {
    latest,
    measuredToday: measured,
    forecastToday: forecast,
    forecastTomorrow: [],
    clearSkyToday: clearSky,
  };
}

/** A forecast point as the pages use it: an instant and a level, nothing else. */
export interface ForecastPoint {
  readonly validAt: string;
  readonly uvi: number;
}

export interface CountryRow {
  readonly locationId: string;
  readonly latest: LatestReading | null;
  /** Forecast points around today, for the level now and today's peak. */
  readonly forecast: readonly ForecastPoint[];
}

/**
 * Every city a page lists, one row each, by primary key.
 *
 * Pages used to compute this from raw readings on every render. The home page
 * read about 6,600 rows to display two numbers -- the highest level now in each
 * country -- and did it on every cache miss, so the cost scaled with traffic
 * while the data it came from changes on a schedule. That is exactly the
 * pattern D1's free plan charges for, and how the daily read allowance ran out
 * on 26 October 2026.
 *
 * The values are now computed when the data lands: noteMeasured() from the
 * five-minute ARPANSA cron, rebuildForecasts() when EPA or CAMS deliver. A page
 * reads one row per city it shows, whatever the traffic and however large
 * `readings` grows. test/query-plans.test.ts asserts this never reads
 * `readings`.
 */
export async function countryData(
  db: D1Database,
  locationIds: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, CountryRow>> {
  if (locationIds.length === 0) return new Map();
  const placeholders = locationIds.map((_id, i) => `?${i + 1}`).join(",");

  const { results, meta } = await db
    .prepare(
      `SELECT location_id, measured_uvi, measured_at, measured_source, forecast_json
       FROM city_now
       WHERE location_id IN (${placeholders})`,
    )
    .bind(...locationIds)
    .all<{
      location_id: string;
      measured_uvi: number | null;
      measured_at: string | null;
      measured_source: string | null;
      forecast_json: string | null;
    }>();
  charge("cityNow", meta);

  const cutoff = now.getTime() - STALE_AFTER_MS;
  const byId = new Map(results.map((r) => [r.location_id, r]));
  const out = new Map<string, CountryRow>();
  for (const id of locationIds) {
    const row = byId.get(id);
    const latest =
      row && row.measured_uvi !== null && row.measured_at && row.measured_source
        ? {
            locationId: id,
            uvi: row.measured_uvi,
            validAt: row.measured_at,
            source: row.measured_source,
            // The one staleness rule, applied at render time: a summary written
            // twenty minutes ago is exactly as stale as the reading inside it.
            stale: Date.parse(row.measured_at) < cutoff,
          }
        : null;
    out.set(id, { locationId: id, latest, forecast: parseForecast(row?.forecast_json ?? null) });
  }
  return out;
}

/**
 * The stored series, kept as [validAt, uvi] pairs.
 *
 * Pairs rather than objects because the home page parses all 63 of these on
 * every render, inside a 10 ms CPU limit. A malformed value yields no forecast
 * rather than an exception: a page without a forecast says so; a page that
 * throws says nothing.
 */
function parseForecast(json: string | null): ForecastPoint[] {
  if (!json) return [];
  try {
    const pairs = JSON.parse(json) as unknown;
    if (!Array.isArray(pairs)) return [];
    const out: ForecastPoint[] = [];
    for (const pair of pairs) {
      if (Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "number") {
        out.push({ validAt: pair[0], uvi: pair[1] });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Record the newest measured reading per city, from readings already in hand.
 *
 * Called by the ARPANSA cron straight after it stores them, so it costs no
 * reads at all: the reading is never fetched back. It replaced
 * latestMeasured(), which found the newest reading by grouping every measured
 * row ever stored -- a valid indexed SEARCH that passed the plan test and read
 * 2,366 rows a run on 27 October, growing by thirteen every five minutes.
 *
 * The WHERE on the upsert means a station reporting late can never overwrite a
 * newer reading with an older one.
 */
export async function noteMeasured(db: D1Database, readings: readonly Reading[]): Promise<number> {
  const newest = new Map<string, Reading>();
  for (const r of readings) {
    if (r.kind !== "measured") continue;
    const seen = newest.get(r.locationId);
    if (!seen || r.validAt > seen.validAt) newest.set(r.locationId, r);
  }
  if (newest.size === 0) return 0;

  const upsert = db.prepare(
    `INSERT INTO city_now (location_id, measured_uvi, measured_at, measured_source)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (location_id) DO UPDATE SET
       measured_uvi = excluded.measured_uvi,
       measured_at = excluded.measured_at,
       measured_source = excluded.measured_source
     WHERE city_now.measured_at IS NULL OR excluded.measured_at > city_now.measured_at`,
  );
  await db.batch([...newest.values()].map((r) => upsert.bind(r.locationId, r.uvi, r.validAt, r.source)));
  return newest.size;
}

/** The sources whose arrival means the stored forecast series are out of date. */
const FORECAST_SOURCES = ["epa", "cams"];

/**
 * Whether the stored forecast series are older than the newest forecast.
 *
 * Judged from source_health, which the Python fetchers update on every
 * successful run, so the check reads a few rows rather than the forecasts
 * themselves. Also true when any city has never been built -- a new city or a
 * fresh database -- so the summaries fill themselves in within five minutes.
 */
export async function forecastsStale(
  db: D1Database,
  health: readonly HealthRow[],
  expected: number,
): Promise<boolean> {
  const newest = health
    .filter((h) => FORECAST_SOURCES.includes(h.source) && h.last_ok_at)
    .map((h) => h.last_ok_at!)
    .sort()
    .at(-1);
  const built = await db
    .prepare(
      `SELECT COUNT(*) AS n, MIN(forecast_built_at) AS oldest
       FROM city_now WHERE forecast_built_at IS NOT NULL`,
    )
    .first<{ n: number; oldest: string | null }>();
  if (!built || built.n < expected || !built.oldest) return true;
  return newest !== undefined && newest > built.oldest;
}

/**
 * How far either side of the build time the stored series reaches.
 *
 * Generous on purpose. The series is rebuilt when a forecast arrives -- hourly
 * while EPA is healthy, twice a day if only CAMS is -- and GitHub's scheduler
 * once went sixteen hours without running at all. A day after it was built,
 * the series must still cover all of "today" and "tomorrow" in every city's own
 * zone, or a dropped run empties the tomorrow column again.
 */
const SERIES_BEFORE_MS = 36 * 3600_000;
const SERIES_AFTER_MS = 96 * 3600_000;

/**
 * Recompute every city's stored forecast series from `readings`.
 *
 * The one place forecasts are read in bulk, and it runs when a forecast
 * arrives -- about 26 times a day -- not on every page view. Cities with no
 * forecast in the window are written as an empty series, so they count as
 * built and do not trigger a full rebuild on every cron.
 */
export async function rebuildForecasts(
  db: D1Database,
  locationIds: readonly string[],
  now: Date = new Date(),
): Promise<number> {
  if (locationIds.length === 0) return 0;
  const placeholders = locationIds.map((_id, i) => `?${i + 3}`).join(",");
  const from = toIsoUtc(new Date(now.getTime() - SERIES_BEFORE_MS));
  const to = toIsoUtc(new Date(now.getTime() + SERIES_AFTER_MS));

  const { results, meta } = await db
    .prepare(
      // kind is named so readings_window can bound the time range; without it
      // the range never reaches the index (see schema.sql).
      `SELECT location_id, valid_at, uvi
       FROM readings
       WHERE location_id IN (${placeholders})
         AND kind = 'forecast'
         AND valid_at >= ?1 AND valid_at <= ?2
       ORDER BY valid_at, source`,
    )
    .bind(from, to, ...locationIds)
    .all<{ location_id: string; valid_at: string; uvi: number }>();
  charge("forecastRebuild", meta);

  // Every point is kept, including EPA and CAMS forecasting the same US hour.
  // Collapsing them would quietly change the pages: today's peak is the higher
  // of the two, and the level now is the first at the nearest instant. Keeping
  // both, in a fixed order, means the series is exactly what the pages used to
  // read from `readings`, only stored rather than recomputed.
  const series = new Map<string, [string, number][]>();
  for (const id of locationIds) series.set(id, []);
  for (const r of results) series.get(r.location_id)?.push([r.valid_at, r.uvi]);

  const builtAt = toIsoUtc(now);
  const upsert = db.prepare(
    `INSERT INTO city_now (location_id, forecast_json, forecast_built_at)
     VALUES (?1, ?2, ?3)
     ON CONFLICT (location_id) DO UPDATE SET
       forecast_json = excluded.forecast_json,
       forecast_built_at = excluded.forecast_built_at`,
  );
  const statements = [...series].map(([id, points]) =>
    upsert.bind(id, JSON.stringify(points), builtAt),
  );
  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    await db.batch(statements.slice(i, i + BATCH_SIZE));
  }
  return statements.length;
}


/**
 * Record a dispatch attempt, so the cooldown holds across invocations and
 * /api/health can report a safety net that has stopped working.
 *
 * Lives here rather than in lib/dispatch.ts because it touches D1, and
 * dispatch.ts is imported by tests that must not see the Worker types.
 */
export async function noteDispatch(
  db: D1Database,
  source: string,
  ok: boolean,
  reason: string,
  now: Date,
): Promise<void> {
  await recordRun(
    db,
    source,
    { ok, records: 0, error: ok ? undefined : `refused (${reason})` },
    now,
  );
}
