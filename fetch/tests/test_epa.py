"""Tests for the EPA adapter: parsing + timezone handling (live-verified shapes)."""
import unittest
from datetime import datetime, timezone

from ..epa import US_CITIES, parse_daily, parse_hourly


class EpaTests(unittest.TestCase):
    def test_city_set_is_50(self):
        self.assertEqual(len(US_CITIES), 50)

    def test_parse_hourly_local_to_utc(self):
        rows = [
            {"ORDER": 1, "ZIP": "22314", "CITY": "New York", "STATE": "NY",
             "DATE_TIME": "Oct/23/2026 07 AM", "UV_VALUE": 3},
        ]
        recs = parse_hourly(rows, "us-new-york-ny", "America/New_York")
        self.assertEqual(len(recs), 1)
        # October = EDT (UTC-4): 07:00 local -> 11:00 UTC
        self.assertEqual(recs[0].valid_at, datetime(2026, 10, 23, 11, 0, tzinfo=timezone.utc))
        self.assertEqual(recs[0].uvi, 3.0)

    def test_parse_hourly_phoenix_no_dst(self):
        rows = [{"ORDER": 1, "ZIP": "85001", "CITY": "Phoenix", "STATE": "AZ",
                 "DATE_TIME": "Oct/23/2026 07 AM", "UV_VALUE": 6}]
        recs = parse_hourly(rows, "us-phoenix-az", "America/Phoenix")
        # Arizona stays on UTC-7 all year: 07:00 -> 14:00 UTC
        self.assertEqual(recs[0].valid_at, datetime(2026, 10, 23, 14, 0, tzinfo=timezone.utc))

    def test_parse_daily(self):
        rows = [{"CITY": "Raleigh", "STATE": "NC", "UV_INDEX": "5",
                 "UV_ALERT": "0", "DATE": "Oct/23/2026"}]
        recs = parse_daily(rows, "us-raleigh-nc", "America/New_York")
        self.assertEqual(len(recs), 1)
        self.assertEqual(recs[0].uvi, 5.0)
        self.assertEqual(recs[0].extra, {"alert": "0"})
        self.assertEqual(recs[0].valid_at, datetime(2026, 10, 23, 16, 0, tzinfo=timezone.utc))

    def test_bad_rows_skipped(self):
        self.assertEqual(parse_hourly([{"DATE_TIME": "garbage", "UV_VALUE": 3}],
                                      "us-x", "America/New_York"), [])
        self.assertEqual(parse_daily([{"UV_INDEX": "99", "DATE": "Oct/23/2026"}],
                                     "us-x", "America/New_York"), [])


if __name__ == "__main__":
    unittest.main()
