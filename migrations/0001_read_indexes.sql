-- Why: a page render was scanning the whole readings table, per city, and
-- exhausted D1's free-plan daily row-read allowance -- the site answered 500 to
-- every request until the counter reset. See the comment in schema.sql.
--
-- Safe to re-run. Creating these scans the table once, which itself costs
-- reads, so apply it when the daily allowance has room.

CREATE INDEX IF NOT EXISTS readings_window
  ON readings (location_id, valid_at, kind, source, uvi, issued_at);

CREATE INDEX IF NOT EXISTS readings_measured
  ON readings (kind, location_id, valid_at DESC, uvi, source);

-- Nothing can use this one: no query filters on kind together with a location,
-- so it only ever cost us a write on every insert.
DROP INDEX IF EXISTS readings_recent;
