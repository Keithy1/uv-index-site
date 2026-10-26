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
  latestMeasured: 2_000,
  cityWindow: 5_000,
  countryWindow: 80_000,
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

/**
 * The most recent measured reading for every Australian city, in one query.
 *
 * One statement rather than 13 because D1 bills row reads and the Worker has
 * 10 ms of CPU: a per-city loop would be both slower and more expensive.
 */
export async function latestMeasured(
  db: D1Database,
  now: Date = new Date(),
): Promise<Map<string, LatestReading>> {
  const { results, meta } = await db
    .prepare(
      `SELECT r.location_id, r.uvi, r.valid_at, r.source
       FROM readings r
       JOIN (
         SELECT location_id, MAX(valid_at) AS valid_at
         FROM readings
         WHERE kind = 'measured'
         GROUP BY location_id
       ) latest
         ON latest.location_id = r.location_id AND latest.valid_at = r.valid_at
       WHERE r.kind = 'measured'`,
    )
    .all<{ location_id: string; uvi: number; valid_at: string; source: string }>();
  charge("latestMeasured", meta);

  const cutoff = now.getTime() - STALE_AFTER_MS;
  return new Map(
    results.map((row) => [
      row.location_id,
      {
        locationId: row.location_id,
        uvi: row.uvi,
        validAt: row.valid_at,
        source: row.source,
        stale: Date.parse(row.valid_at) < cutoff,
      },
    ]),
  );
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

export interface CountryRow {
  readonly locationId: string;
  readonly latest: LatestReading | null;
  /** Forecast points in the queried window, for working out today's peak. */
  readonly forecast: readonly SeriesPoint[];
}

/**
 * Every city in one country, in a single query.
 *
 * One statement rather than thirteen: D1 bills row reads and the Worker has
 * 10 ms of CPU, so a per-city loop would be both slower and dearer. Grouping
 * happens in code, where thirteen cities is nothing.
 */
export async function countryData(
  db: D1Database,
  locationIds: readonly string[],
  fromUtc: string,
  toUtc: string,
  now: Date = new Date(),
): Promise<Map<string, CountryRow>> {
  if (locationIds.length === 0) return new Map();
  const placeholders = locationIds.map((_id, i) => `?${i + 3}`).join(",");

  const { results, meta } = await db
    .prepare(
      // Forecast only. This used to ask for the whole window and bucket what
      // came back, which meant reading every ARPANSA measurement of the last 84
      // hours -- twelve an hour, per city -- to use the single newest one, and
      // reading the clear-sky series it then threw away. The newest measured
      // reading now comes from latestMeasured() and its own index.
      `SELECT location_id, source, kind, valid_at, uvi, issued_at
       FROM readings
       WHERE location_id IN (${placeholders})
         AND kind = 'forecast'
         AND valid_at >= ?1 AND valid_at <= ?2
       ORDER BY valid_at`,
    )
    .bind(fromUtc, toUtc, ...locationIds)
    .all<{
      location_id: string;
      source: string;
      kind: string;
      valid_at: string;
      uvi: number;
      issued_at: string | null;
    }>();
  charge("countryWindow", meta);

  const byLocation = new Map<string, { forecast: SeriesPoint[] }>();
  for (const id of locationIds) byLocation.set(id, { forecast: [] });

  for (const row of results) {
    const bucket = byLocation.get(row.location_id);
    if (!bucket) continue;
    const point = {
      validAt: row.valid_at,
      uvi: row.uvi,
      source: row.source,
      issuedAt: row.issued_at,
    };
    if (row.kind === "forecast") bucket.forecast.push(point);
  }

  // One extra query for every city's newest measurement, which reads a few rows
  // through readings_measured instead of a few thousand through the window.
  const latest = await latestMeasured(db, now);

  const out = new Map<string, CountryRow>();
  for (const [id, bucket] of byLocation) {
    const last = latest.get(id);
    out.set(id, {
      locationId: id,
      latest: last
        ? {
            locationId: id,
            uvi: last.uvi,
            validAt: last.validAt,
            source: last.source,
            // latestMeasured has already applied the staleness rule. Applying
            // it again here would be a second definition of "too old", and this
            // file has had enough of those.
            stale: last.stale,
          }
        : null,
      forecast: bucket.forecast,
    });
  }
  return out;
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
