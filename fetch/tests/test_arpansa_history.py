"""Tests for the historical-measurement reader.

The timezone rule is the thing worth pinning: ARPANSA's CSVs use each station's
own LOCAL STANDARD time all year, ignoring daylight saving. Getting this wrong
shifts every summer reading by an hour, which is exactly the season the site is
built for.
"""
import unittest
from datetime import timedelta

from ..arpansa_history import PACKAGES, standard_offset
from ..cams import AU_STATIONS


class StandardOffsetTests(unittest.TestCase):
    def test_offsets_ignore_daylight_saving(self):
        # Derived from the zone database, never hard-coded -- but the values it
        # should produce are known, so assert them.
        self.assertEqual(standard_offset("Australia/Sydney"), timedelta(hours=10))
        self.assertEqual(standard_offset("Australia/Melbourne"), timedelta(hours=10))
        self.assertEqual(standard_offset("Australia/Hobart"), timedelta(hours=10))
        self.assertEqual(standard_offset("Australia/Perth"), timedelta(hours=8))
        self.assertEqual(standard_offset("Australia/Darwin"), timedelta(hours=9, minutes=30))
        self.assertEqual(standard_offset("Australia/Adelaide"), timedelta(hours=9, minutes=30))

    def test_daylight_saving_zones_match_their_non_dst_twins(self):
        # Sydney observes daylight saving and Brisbane does not, yet both are
        # +10 standard. If this ever fails, the offset is being taken in the
        # wrong half of the year.
        self.assertEqual(
            standard_offset("Australia/Sydney"),
            standard_offset("Australia/Brisbane"),
        )
        self.assertEqual(
            standard_offset("Australia/Adelaide"),
            standard_offset("Australia/Darwin"),
        )

    def test_offset_is_stable_across_years(self):
        for year in (2015, 2020, 2025, 2026):
            self.assertEqual(
                standard_offset("Australia/Sydney", year), timedelta(hours=10), year
            )


class PackageTests(unittest.TestCase):
    def test_every_station_has_a_dataset(self):
        self.assertEqual(set(PACKAGES), set(AU_STATIONS))

    def test_hobart_uses_the_kingston_dataset(self):
        # The station is at Kingston; the page is Hobart's.
        self.assertEqual(PACKAGES["au-kin"], "ultraviolet-radiation-index-kingston")


if __name__ == "__main__":
    unittest.main()
