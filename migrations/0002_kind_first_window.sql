-- The window index with kind ahead of valid_at, and every query naming its
-- kinds. 0001 stopped page renders reading the whole table; this stops the
-- country page and the home page reading 84 hours of five-minutely measured
-- readings in order to use the newest one. See the comment in schema.sql.
--
-- Safe to re-run. Rebuilding the index scans the table once.

DROP INDEX IF EXISTS readings_window;

CREATE INDEX IF NOT EXISTS readings_window
  ON readings (location_id, kind, valid_at, source, uvi, issued_at);
