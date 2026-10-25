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
 * The most recent measured reading for every Australian city, in one query.
 *
 * One statement rather than 13 because D1 bills row reads and the Worker has
 * 10 ms of CPU: a per-city loop would be both slower and more expensive.
 */
export async function latestMeasured(
  db: D1Database,
  now: Date = new Date(),
): Promise<Map<string, LatestReading>> {
  const { results } = await db
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
  const { results } = await db
    .prepare(
      `SELECT source, kind, valid_at, uvi
       FROM readings
       WHERE location_id = ?1 AND valid_at >= ?2 AND valid_at <= ?3
       ORDER BY valid_at`,
    )
    .bind(locationId, fromUtc, toUtc)
    .all<{ source: string; kind: string; valid_at: string; uvi: number }>();

  const measured: SeriesPoint[] = [];
  const forecast: SeriesPoint[] = [];
  const clearSky: SeriesPoint[] = [];
  for (const row of results) {
    const point = { validAt: row.valid_at, uvi: row.uvi, source: row.source };
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

  const { results } = await db
    .prepare(
      `SELECT location_id, source, kind, valid_at, uvi
       FROM readings
       WHERE valid_at >= ?1 AND valid_at <= ?2
         AND location_id IN (${placeholders})
       ORDER BY valid_at`,
    )
    .bind(fromUtc, toUtc, ...locationIds)
    .all<{ location_id: string; source: string; kind: string; valid_at: string; uvi: number }>();

  const cutoff = now.getTime() - STALE_AFTER_MS;
  const byLocation = new Map<string, { measured: SeriesPoint[]; forecast: SeriesPoint[] }>();
  for (const id of locationIds) byLocation.set(id, { measured: [], forecast: [] });

  for (const row of results) {
    const bucket = byLocation.get(row.location_id);
    if (!bucket) continue;
    const point = { validAt: row.valid_at, uvi: row.uvi, source: row.source };
    if (row.kind === "measured") bucket.measured.push(point);
    else if (row.kind === "forecast") bucket.forecast.push(point);
  }

  const out = new Map<string, CountryRow>();
  for (const [id, bucket] of byLocation) {
    const last = bucket.measured[bucket.measured.length - 1];
    out.set(id, {
      locationId: id,
      latest: last
        ? {
            locationId: id,
            uvi: last.uvi,
            validAt: last.validAt,
            source: last.source,
            stale: Date.parse(last.validAt) < cutoff,
          }
        : null,
      forecast: bucket.forecast,
    });
  }
  return out;
}
