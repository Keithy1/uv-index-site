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
