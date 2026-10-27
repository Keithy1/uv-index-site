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
  kind         TEXT NOT NULL,              -- "measured" | "forecast" | "forecast_clear"
                                           -- forecast_clear is the clear-sky twin: the
                                           -- same instant with cloud removed. Kept as its
                                           -- own series rather than a column because it is
                                           -- a different forecast, and the sun-protection
                                           -- window is deliberately computed from it.
  valid_at     TEXT NOT NULL,              -- ISO 8601 UTC, the instant described
  uvi          REAL NOT NULL,
  issued_at    TEXT,                       -- when the source issued it (forecasts)
  fetched_at   TEXT NOT NULL,
  PRIMARY KEY (location_id, source, kind, valid_at)
) WITHOUT ROWID;

-- The one index on readings, and why there is only one.
--
-- The primary key above is (location_id, source, kind, valid_at), and because
-- the table is WITHOUT ROWID that key IS the table. Queries filter on
-- location_id and a valid_at range, with nothing said about source -- which
-- sits in between. SQLite seeked to the location and then read every row that
-- location had ever had, from a table nothing prunes. One home-page render read
-- all 63 cities' entire history; the free plan's daily row-read allowance went
-- in an afternoon on 26 October 2026 and every data page answered 500 until
-- midnight UTC.
--
-- `kind` comes BEFORE valid_at, and every query that uses this index names the
-- kinds it wants. With valid_at second, a kind filter removes rows from the
-- result but not from the count: the range is read first and the unwanted rows
-- discarded after. Covering, so SQLite answers from the index alone.
--
-- Two others came and went, and both are worth remembering:
--   * readings_recent (location_id, kind, valid_at DESC) -- nothing used it,
--     because no query then named its kinds; only ever a write per insert.
--   * readings_measured (kind, location_id, valid_at DESC, ...) -- served a
--     "newest reading per station" query that grouped every measured row ever
--     stored. A valid indexed SEARCH, it passed the plan test, and it read more
--     every five minutes forever. Replaced by city_now below, which the cron
--     writes from the reading it already holds.
--
-- Pages no longer read this table in bulk at all -- see city_now. What remains
-- is one city's chart window, bounded by this index, and the forecast rebuild,
-- which runs when a forecast arrives rather than when a page is viewed.
-- test/query-plans.test.ts checks every statement in store.ts against this file.
CREATE INDEX IF NOT EXISTS readings_window
  ON readings (location_id, kind, valid_at, source, uvi, issued_at);

-- What every page that lists cities reads: one row per city, written when the
-- data lands, read by primary key.
--
-- The lesson from Capitol Tracker, applied inside the one constraint it does
-- not have. That site does every read at build time and serves files, so it
-- has no read bill at all; this one promises "measured four minutes ago" and
-- cannot rebuild every five minutes. But the expensive part was never the
-- freshness, it was recomputing at read time what is known at write time. So:
--   * measured_* is written by the five-minute ARPANSA cron, from the reading
--     in memory, at no read cost;
--   * forecast_json is rebuilt when EPA or CAMS deliver, about 26 times a day,
--     as [validAt, uvi] pairs covering 36 hours back to 96 hours ahead.
-- A page's read cost is the number of cities it shows. It does not grow with
-- traffic or with the size of readings.
CREATE TABLE IF NOT EXISTS city_now (
  location_id        TEXT PRIMARY KEY,
  measured_uvi       REAL,
  measured_at        TEXT,                 -- ISO 8601 UTC; staleness is judged at render
  measured_source    TEXT,
  forecast_json      TEXT,                 -- [["2026-10-27T03:00:00Z", 5.2], ...]
  forecast_built_at  TEXT                  -- ISO 8601 UTC
) WITHOUT ROWID;

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
