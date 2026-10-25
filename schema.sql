-- uvatlas D1 schema. Apply with `npm run db:init:local` / `npm run db:init:remote`.
--
-- Design rules encoded here:
--   * all timestamps are ISO 8601 UTC strings ("2026-10-25T03:34:00Z"); never local
--     offsets, because Queensland/NT/WA have no daylight saving and Sydney/Adelaide/
--     Hobart do. Local time is derived at render time from the registry in src/lib/locations.ts.
--   * readings and daily are keyed so a re-fetch of the same value is an idempotent
--     upsert, not a new row. This keeps us inside D1's free-plan write allowance.

-- There is deliberately no `locations` table. The registry of cities, their
-- coordinates, time zones and station codes lives in src/lib/locations.ts and is
-- the single source of truth: 63 rows that change a few times a year do not
-- need a database, and duplicating them here would create two copies that drift.
-- `location_id` below is therefore a plain text key such as "au-per", not a
-- foreign key.

-- Point-in-time values: one row per (place, source, kind, instant).
CREATE TABLE IF NOT EXISTS readings (
  location_id  TEXT NOT NULL,
  source       TEXT NOT NULL,              -- "arpansa" | "epa" | "cams"
  kind         TEXT NOT NULL,              -- "measured" | "forecast"
  valid_at     TEXT NOT NULL,              -- ISO 8601 UTC, the instant described
  uvi          REAL NOT NULL,
  issued_at    TEXT,                       -- when the source issued it (forecasts)
  fetched_at   TEXT NOT NULL,
  PRIMARY KEY (location_id, source, kind, valid_at)
) WITHOUT ROWID;

-- Serves "the latest measured reading" and "today's curve" without a table scan.
CREATE INDEX IF NOT EXISTS readings_recent
  ON readings (location_id, kind, valid_at DESC);

-- Per-local-day summary: peak, its time, and the sun-protection window.
CREATE TABLE IF NOT EXISTS daily (
  location_id    TEXT NOT NULL,
  local_date     TEXT NOT NULL,            -- "2026-10-25" in the location's own zone
  source         TEXT NOT NULL,
  peak_uvi       REAL NOT NULL,
  peak_at        TEXT,                     -- ISO 8601 UTC
  protect_start  TEXT,                     -- first instant UVI >= 3, ISO 8601 UTC
  protect_end    TEXT,                     -- last instant UVI >= 3
  alert          INTEGER NOT NULL DEFAULT 0,  -- EPA UV_ALERT flag
  issued_at      TEXT,
  fetched_at     TEXT NOT NULL,
  PRIMARY KEY (location_id, local_date, source)
) WITHOUT ROWID;

-- Typical peak for this month in this city ("This time of year"), computed once a
-- year from ARPANSA's historical datasets on data.gov.au (CC BY 2.5 AU).
CREATE TABLE IF NOT EXISTS monthly_normals (
  location_id   TEXT NOT NULL,
  month         INTEGER NOT NULL,          -- 1-12
  mean_peak     REAL NOT NULL,
  years_from    INTEGER NOT NULL,
  years_to      INTEGER NOT NULL,
  computed_at   TEXT NOT NULL,
  PRIMARY KEY (location_id, month)
) WITHOUT ROWID;

-- Drives /api/health and the "Live reading delayed" banner.
CREATE TABLE IF NOT EXISTS source_health (
  source            TEXT PRIMARY KEY,
  last_ok_at        TEXT,
  last_attempt_at   TEXT,
  last_error        TEXT,
  records_last_run  INTEGER NOT NULL DEFAULT 0
);
