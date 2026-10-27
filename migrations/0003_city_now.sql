-- Pages stop computing from raw readings. See city_now in schema.sql.
--
-- The table starts empty and fills itself: the next ARPANSA cron writes the
-- measured columns, and forecastsStale() sees cities with no built series and
-- rebuilds them on the same run. Until then a page shows "no current readings"
-- for at most five minutes.

CREATE TABLE IF NOT EXISTS city_now (
  location_id        TEXT PRIMARY KEY,
  measured_uvi       REAL,
  measured_at        TEXT,
  measured_source    TEXT,
  forecast_json      TEXT,
  forecast_built_at  TEXT
) WITHOUT ROWID;

-- Served only the "newest reading per station" query that city_now replaces.
-- It grouped every measured row ever stored, so it read more every five
-- minutes; kept, it would be a write on every insert for nothing.
DROP INDEX IF EXISTS readings_measured;
