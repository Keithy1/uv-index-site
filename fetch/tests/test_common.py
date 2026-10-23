"""Tests for the shared record and band rules."""
import unittest
from datetime import datetime, timezone

from ..common import Record, check_uvi


def rec(uvi: float) -> Record:
    return Record(source="arpansa", kind="measured", location="au-test",
                  uvi=uvi, valid_at=datetime(2026, 10, 23, 12, 0, tzinfo=timezone.utc))


class BandTests(unittest.TestCase):
    def test_band_edges_use_rounded_value(self):
        cases = {
            0.0: "Low", 2.0: "Low", 2.4: "Low",      # 2.4 rounds to 2 -> Low
            2.5: "Moderate", 3.0: "Moderate", 5.0: "Moderate",
            5.4: "Moderate", 5.5: "High", 6.0: "High", 7.0: "High",
            7.4: "High", 7.5: "Very High", 8.0: "Very High", 10.0: "Very High",
            10.4: "Very High", 10.5: "Extreme", 11.0: "Extreme", 15.9: "Extreme",
        }
        for uvi, expected in cases.items():
            with self.subTest(uvi=uvi):
                self.assertEqual(rec(uvi).band(), expected)

    def test_check_uvi_bounds(self):
        self.assertTrue(check_uvi(0.0))
        self.assertTrue(check_uvi(20.0))
        self.assertTrue(check_uvi(7.4))
        self.assertFalse(check_uvi(-0.1))
        self.assertFalse(check_uvi(20.1))

    def test_to_json_serialises_utc(self):
        r = rec(7.4)
        d = r.to_json()
        self.assertEqual(d["valid_at"], "2026-10-23T12:00:00Z")
        self.assertEqual(d["uvi"], 7.4)
        self.assertEqual(d["band" if "band" in d else "kind"], "measured")


if __name__ == "__main__":
    unittest.main()
