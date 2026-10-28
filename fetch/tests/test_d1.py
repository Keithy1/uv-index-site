"""Tests for the SQL that reaches the live database."""
import pathlib
import sqlite3
import unittest
from datetime import datetime, timezone

from ..common import Record
from ..d1 import health_statement, quote, statements


def record(**kw) -> Record:
    base = dict(
        source="cams",
        kind="forecast",
        location="au-syd",
        uvi=8.25,
        valid_at=datetime(2026, 10, 25, 2, 0, tzinfo=timezone.utc),
        issued_at=datetime(2026, 10, 25, 0, 0, tzinfo=timezone.utc),
        fetched_at=datetime(2026, 10, 25, 5, 30, tzinfo=timezone.utc),
    )
    base.update(kw)
    return Record(**base)


# The real schema, not a copy: a copy here fell behind when source_health
# gained newest_run, and the tests would have passed against a table the live
# database no longer matched.
SCHEMA = (pathlib.Path(__file__).resolve().parents[2] / "schema.sql").read_text(encoding="utf8")


class QuotingTests(unittest.TestCase):
    def test_embedded_quote_is_doubled(self):
        self.assertEqual(quote("O'Brien"), "'O''Brien'")

    def test_a_quote_cannot_break_out_of_the_statement(self):
        # Our ids come from our own tables, but the day a feed supplies one is
        # the day this matters, and the failure would be silent corruption.
        sql = statements([record(location="au-syd'); DROP TABLE readings;--")])[0]
        db = sqlite3.connect(":memory:")
        db.executescript(SCHEMA)
        db.executescript(sql)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM readings").fetchone()[0], 1)
        stored = db.execute("SELECT location_id FROM readings").fetchone()[0]
        self.assertEqual(stored, "au-syd'); DROP TABLE readings;--")


class StatementTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.executescript(SCHEMA)

    def apply(self, sql_lines):
        self.db.executescript("\n".join(sql_lines))

    def test_a_record_lands_with_its_values(self):
        self.apply(statements([record()]))
        row = self.db.execute(
            "SELECT location_id, source, kind, valid_at, uvi, issued_at FROM readings"
        ).fetchone()
        self.assertEqual(
            row,
            ("au-syd", "cams", "forecast", "2026-10-25T02:00:00Z", 8.25, "2026-10-25T00:00:00Z"),
        )

    def test_writing_twice_updates_rather_than_duplicates(self):
        # The whole point: a re-fetch must cost one write, not one row. D1's
        # free allowance is 100,000 writes a day.
        self.apply(statements([record()]))
        self.apply(statements([record(uvi=9.5)]))
        rows = self.db.execute("SELECT uvi FROM readings").fetchall()
        self.assertEqual(rows, [(9.5,)])

    def test_an_unchanged_value_is_not_written_again(self):
        # 27 October 2026: rewriting identical values took the account past
        # D1's 100,000 rows written a day.
        self.apply(statements([record()]))
        before = self.db.total_changes
        self.apply(statements([record(issued_at=datetime(2026, 10, 25, 12, tzinfo=timezone.utc))]))
        self.assertEqual(self.db.total_changes, before)

    def test_an_instant_arriving_twice_is_written_once_from_the_newer_run(self):
        older = record(uvi=7.0, issued_at=datetime(2026, 10, 24, tzinfo=timezone.utc))
        newer = record(uvi=8.0, issued_at=datetime(2026, 10, 25, tzinfo=timezone.utc))
        for order in ([older, newer], [newer, older]):
            rows = statements(order)
            self.assertEqual(len(rows), 1)
            self.assertIn("8.0", rows[0])

    def test_clear_sky_is_written_as_its_own_series(self):
        self.apply(statements([record(extra={"clear_sky_uvi": 9.1})]))
        rows = dict(self.db.execute("SELECT kind, uvi FROM readings").fetchall())
        self.assertEqual(rows, {"forecast": 8.25, "forecast_clear": 9.1})

    def test_measured_records_get_no_clear_sky_twin(self):
        rows = statements([record(kind="measured", extra={"clear_sky_uvi": 9.1})])
        self.assertEqual(len(rows), 1)

    def test_a_missing_issued_at_is_null_not_empty_string(self):
        self.apply(statements([record(issued_at=None)]))
        self.assertIsNone(self.db.execute("SELECT issued_at FROM readings").fetchone()[0])

    def test_non_finite_values_are_refused(self):
        for bad in (float("nan"), float("inf")):
            with self.assertRaises(ValueError):
                statements([record(uvi=bad)])


class HealthTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.executescript(SCHEMA)

    def test_a_failure_does_not_erase_the_last_success(self):
        # /api/health needs to say "last good fetch was 3 hours ago", which is
        # only possible if a failure leaves last_ok_at alone.
        now = datetime(2026, 10, 25, 5, 0, tzinfo=timezone.utc)
        later = datetime(2026, 10, 25, 8, 0, tzinfo=timezone.utc)
        self.db.executescript(health_statement("cams", True, 300, None, now))
        self.db.executescript(health_statement("cams", False, 0, "ADS timeout", later))
        row = self.db.execute(
            "SELECT last_ok_at, last_attempt_at, last_error, records_last_run FROM source_health"
        ).fetchone()
        self.assertEqual(row[0], "2026-10-25T05:00:00Z")
        self.assertEqual(row[1], "2026-10-25T08:00:00Z")
        self.assertEqual(row[2], "ADS timeout")
        self.assertEqual(row[3], 0)

    def test_newest_run_survives_a_failed_fetch(self):
        now = datetime(2026, 10, 28, 10, 45, tzinfo=timezone.utc)
        run = datetime(2026, 10, 28, 0, 0, tzinfo=timezone.utc)
        self.db.executescript(health_statement("cams", True, 7623, None, now, run))
        self.db.executescript(health_statement("cams", False, 0, "not yet in the ADS", now))
        row = self.db.execute("SELECT newest_run, last_error FROM source_health").fetchone()
        self.assertEqual(row, ("2026-10-28T00:00:00Z", "not yet in the ADS"))


if __name__ == "__main__":
    unittest.main()


class DailyTests(unittest.TestCase):
    """EPA's daily forecast is the day's PEAK, not the value at local noon.

    Left in `readings` as kind "forecast" it collided with the hourly row at
    the same instant and one silently overwrote the other: 25 records became
    23 rows, and nobody would have noticed until a peak looked wrong.
    """

    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.executescript(SCHEMA)

    def daily(self, **kw):
        extra = {"alert": "0", "local_date": "2026-10-25"}
        extra.update(kw.pop("extra", {}))
        return record(kind="forecast_daily", source="epa", location="us-phoenix-az",
                      extra=extra, **kw)

    def test_a_daily_record_goes_to_the_daily_table(self):
        self.db.executescript("\n".join(statements([self.daily(uvi=9.0)])))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM readings").fetchone()[0], 0)
        row = self.db.execute(
            "SELECT location_id, local_date, peak_uvi, alert FROM daily"
        ).fetchone()
        self.assertEqual(row, ("us-phoenix-az", "2026-10-25", 9.0, 0))

    def test_an_hourly_row_at_the_same_instant_survives(self):
        # The exact collision that lost two rows.
        hourly = record(source="epa", location="us-phoenix-az", uvi=7.0)
        self.db.executescript("\n".join(statements([hourly, self.daily(uvi=9.0)])))
        self.assertEqual(self.db.execute("SELECT uvi FROM readings").fetchone()[0], 7.0)
        self.assertEqual(self.db.execute("SELECT peak_uvi FROM daily").fetchone()[0], 9.0)

    def test_the_alert_flag_becomes_an_integer(self):
        self.db.executescript("\n".join(statements([self.daily(extra={"alert": "1"})])))
        self.assertEqual(self.db.execute("SELECT alert FROM daily").fetchone()[0], 1)

    def test_rewriting_a_day_updates_it(self):
        self.db.executescript("\n".join(statements([self.daily(uvi=9.0)])))
        self.db.executescript("\n".join(statements([self.daily(uvi=10.5)])))
        rows = self.db.execute("SELECT peak_uvi FROM daily").fetchall()
        self.assertEqual(rows, [(10.5,)])

    def test_a_daily_record_without_a_local_date_is_refused(self):
        with self.assertRaises(ValueError):
            statements([record(kind="forecast_daily", extra={"alert": "0"})])
