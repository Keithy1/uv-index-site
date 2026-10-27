"""The monthly normals: the parts that would be quietly wrong rather than broken."""
from __future__ import annotations

import os
import tempfile
import unittest
from datetime import date, timedelta

from fetch import normals

SAMPLE = """
NOAA/EPA ULTRAVIOLET INDEX /UVI/ FORECAST
NWS CLIMATE PREDICTION CENTER CAMP SPRINGS MD
137 PM EDT FRI JUL 10 2015

VALID JUL 11 2015 AT SOLAR NOON /APPROXIMATELY NOON
LOCAL STANDARD TIME OR 100 PM LOCAL DAYLIGHT TIME/

CITY               STATE  UVI       CITY               STATE  UVI
{rows}
"""

# 25 lines of two cities each = 50, the least a bulletin may parse to.
ROWS = "\n".join(
    f"CITY{chr(65 + i // 26)}{chr(65 + i % 26)}           TX    {i % 12:>2}       "
    f"TOWN{chr(65 + i // 26)}{chr(65 + i % 26)}           CA    {(i + 3) % 12:>2}"
    for i in range(25)
)


class BandLevel(unittest.TestCase):
    def test_rounds_half_up_like_the_site(self):
        # Python's round() is half-to-even and would call 2.5 Low.
        self.assertEqual(normals.band_level(2.4), 2)
        self.assertEqual(normals.band_level(2.5), 3)
        self.assertEqual(normals.band_level(10.5), 11)


class MonthlyStats(unittest.TestCase):
    def days(self, month: int, n: int, uvi: float, year: int = 2020) -> dict[date, float]:
        start = date(year, month, 1)
        return {start + timedelta(days=i % 28) + timedelta(days=365 * (i // 28)): uvi for i in range(n)}

    def test_publishes_nothing_on_too_few_days(self):
        stats = normals.monthly_stats(self.days(10, normals.MIN_DAYS - 1, 9))
        self.assertIsNone(stats[9])

    def test_shares_use_the_band_rule(self):
        peaks = {date(2020 + i // 28, 10, 1 + i % 28): v for i, v in
                 enumerate([2.5] * 30 + [7.5] * 30 + [10.5] * 30 + [2.4] * 10)}
        oct_ = normals.monthly_stats(peaks)[9]
        self.assertEqual(oct_["days"], 100)
        self.assertEqual(oct_["protect"], 0.9)    # 2.5 counts, 2.4 does not
        self.assertEqual(oct_["veryHigh"], 0.6)   # 7.5 rounds to 8
        self.assertEqual(oct_["extreme"], 0.3)    # 10.5 rounds to 11

    def test_months_are_january_first(self):
        stats = normals.monthly_stats(self.days(1, 70, 12))
        self.assertIsNotNone(stats[0])
        self.assertTrue(all(s is None for s in stats[1:]))


class DailyPeaksArpansa(unittest.TestCase):
    def write(self, rows: list[str]) -> str:
        fd, path = tempfile.mkstemp(suffix=".csv")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("Date-Time,Lat,Lon,UV_Index\n" + "\n".join(rows) + "\n")
        self.addCleanup(os.remove, path)
        return path

    def full_day(self, day: str, peak_at: int = 12 * 60) -> list[str]:
        rows = []
        for minute in range(6 * 60, 19 * 60):
            uv = max(0.0, 10 - abs(minute - peak_at) / 30)
            rows.append(f"{day} {minute // 60:02d}:{minute % 60:02d}:00,-31.9,115.9,{uv:.2f}")
        return rows

    def test_peak_is_the_highest_five_minute_mean(self):
        peaks = normals.daily_peaks_arpansa(self.write(self.full_day("2020-01-01")))
        self.assertAlmostEqual(peaks[date(2020, 1, 1)], 9.93, places=2)

    def test_a_single_minute_spike_does_not_become_the_peak(self):
        rows = self.full_day("2020-01-01")
        rows[300] = rows[300].rsplit(",", 1)[0] + ",25.0"  # one bad minute
        peak = normals.daily_peaks_arpansa(self.write(rows))[date(2020, 1, 1)]
        self.assertLess(peak, 15)

    def test_a_day_missing_its_middle_is_not_counted(self):
        rows = [r for r in self.full_day("2020-01-01") if not (" 11:" in r or " 12:" in r)]
        self.assertEqual(normals.daily_peaks_arpansa(self.write(rows)), {})

    def test_an_empty_field_is_missing_not_zero(self):
        rows = self.full_day("2020-01-01")
        rows += [f"2020-01-02 {h:02d}:{m:02d}:00,-31.9,115.9," for h in range(10, 14) for m in range(60)]
        self.assertNotIn(date(2020, 1, 2), normals.daily_peaks_arpansa(self.write(rows)))


class ParseBulletin(unittest.TestCase):
    def test_reads_the_valid_day_and_both_columns(self):
        parsed = normals.parse_bulletin(SAMPLE.format(rows=ROWS))
        self.assertIsNotNone(parsed)
        day, values = parsed
        self.assertEqual(day, date(2015, 7, 11))  # VALID, not the issue date
        self.assertEqual(len(values), 50)
        self.assertEqual(values[("CITYAA", "TX")], 0)
        self.assertEqual(values[("TOWNAB", "CA")], 4)

    def test_keeps_multi_word_and_dotted_names(self):
        rows = ROWS + "\nSALT LAKE CITY       UT    11       ST. LOUIS            MO     9"
        _, values = normals.parse_bulletin(SAMPLE.format(rows=rows))
        self.assertEqual(values[("SALT LAKE CITY", "UT")], 11)
        self.assertEqual(values[("ST. LOUIS", "MO")], 9)

    def test_refuses_a_truncated_bulletin(self):
        self.assertIsNone(normals.parse_bulletin(SAMPLE.format(rows=ROWS.splitlines()[0])))

    def test_refuses_a_bulletin_with_no_valid_day(self):
        self.assertIsNone(normals.parse_bulletin(SAMPLE.format(rows=ROWS).replace("VALID", "VOID")))


class UsSources(unittest.TestCase):
    CITIES = {("PHOENIX", "AZ"), ("DALLAS", "TX"), ("LOS ANGELES", "CA"),
              ("NORFOLK", "VA"), ("SAN FRANCISCO", "CA"), ("MIAMI", "FL")}

    def test_a_bulletin_city_uses_itself(self):
        src = normals.us_sources(self.CITIES)
        self.assertEqual(src["us-phoenix-az"], {"key": ("PHOENIX", "AZ"), "via": None})

    def test_a_close_neighbour_borrows_and_says_so(self):
        via = normals.us_sources(self.CITIES)["us-mesa-az"]["via"]
        self.assertEqual((via["name"], via["state"]), ("Phoenix", "AZ"))
        self.assertLessEqual(via["km"], normals.PROXY_MAX_KM)

    def test_uses_the_bulletin_cities_we_do_not_carry(self):
        self.assertEqual(normals.us_sources(self.CITIES)["us-oakland-ca"]["via"]["name"], "San Francisco")
        self.assertEqual(normals.us_sources(self.CITIES)["us-virginia-beach-va"]["via"]["name"], "Norfolk")

    def test_a_distant_city_gets_nothing_rather_than_someone_elses_climate(self):
        # San Diego is ~180 km from Los Angeles.
        self.assertIsNone(normals.us_sources(self.CITIES)["us-san-diego-ca"])


if __name__ == "__main__":
    unittest.main()


class Layouts(unittest.TestCase):
    """The yearly files come in three layouts; all three must read the same."""

    def test_parse_stamp_reads_every_layout(self):
        from fetch.arpansa_history import parse_stamp
        from datetime import datetime
        want = datetime(2024, 1, 2, 9, 5)
        self.assertEqual(parse_stamp({"Date-Time": "2024-01-02 09:05:00"}), want)
        self.assertEqual(parse_stamp({"timestamp": "2024-01-02 09:05:00"}), want)  # 2016
        self.assertEqual(parse_stamp({"Date-Time": "2/01/2024 9:05"}), want)       # Newcastle 2024

    def test_a_spreadsheet_date_is_day_first(self):
        # "2/01/2024" is the second of January in an Australian file, not 1 February.
        from fetch.arpansa_history import parse_stamp
        self.assertEqual(parse_stamp({"Date-Time": "2/01/2024 0:00"}).month, 1)
        self.assertEqual(parse_stamp({"Date-Time": "13/01/2024 0:00"}).day, 13)

    def test_unreadable_time_is_none_not_a_guess(self):
        from fetch.arpansa_history import parse_stamp
        self.assertIsNone(parse_stamp({"Date-Time": "Jan 2 2024"}))
        self.assertIsNone(parse_stamp({}))

    def test_peaks_come_out_the_same_from_every_layout(self):
        base = DailyPeaksArpansa.full_day(None, "2020-01-01")
        as_2016 = [r for r in base]
        as_sheet = []
        for r in base:
            stamp, rest = r.split(",", 1)
            d, t = stamp.split(" ")
            y, m, dd = d.split("-")
            hh, mm, _ = t.split(":")
            as_sheet.append(f"{int(dd)}/{m}/{y} {int(hh)}:{mm},{rest}")
        peaks = {}
        for header, rows in (("Date-Time", base), ("timestamp", as_2016), ("Date-Time", as_sheet)):
            fd, path = tempfile.mkstemp(suffix=".csv")
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(f"{header},Lat,Lon,UV_Index\n" + "\n".join(rows) + "\n")
            peaks[len(peaks)] = normals.daily_peaks_arpansa(path)
            os.remove(path)
        self.assertEqual(peaks[0], peaks[1])
        self.assertEqual(peaks[0], peaks[2])
        self.assertEqual(len(peaks[0]), 1)

    def test_a_year_it_cannot_read_stops_the_run(self):
        # 2016 read as "0 valid days" for every station and the run carried on.
        fd, path = tempfile.mkstemp(suffix=".csv")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("When,Lat,Lon,UV_Index\n")
            for i in range(normals.UNREADABLE_ROWS + 10):
                f.write(f"someday {i},-31.9,115.9,5.0\n")
        self.addCleanup(os.remove, path)
        with self.assertRaises(ValueError):
            normals.daily_peaks_arpansa(path)


class LoadEnv(unittest.TestCase):
    """fetch.common.load_env: .env for local runs, never over a real variable."""

    def test_reads_values_and_never_overrides(self):
        from fetch.common import load_env
        fd, path = tempfile.mkstemp(suffix=".env")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("# comment\nUVATLAS_TEST_A=from-file\nUVATLAS_TEST_B='quoted'\nUVATLAS_TEST_EMPTY=\n")
        self.addCleanup(os.remove, path)
        os.environ["UVATLAS_TEST_A"] = "from-actions"
        self.addCleanup(lambda: [os.environ.pop(k, None) for k in ("UVATLAS_TEST_A", "UVATLAS_TEST_B", "UVATLAS_TEST_EMPTY")])
        load_env(path)
        self.assertEqual(os.environ["UVATLAS_TEST_A"], "from-actions")  # a real variable wins
        self.assertEqual(os.environ["UVATLAS_TEST_B"], "quoted")
        self.assertNotIn("UVATLAS_TEST_EMPTY", os.environ)                # blanks are not set

    def test_a_missing_file_is_no_error(self):
        from fetch.common import load_env
        load_env("/no/such/.env")
