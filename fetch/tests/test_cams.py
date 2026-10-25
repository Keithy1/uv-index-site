"""Tests for CAMS: UVI conversion (science-critical) and payload/area shape."""
import unittest

from ..cams import (
    AU_STATIONS,
    VARIABLES,
    area_for,
    flatten_series,
    request_payload,
    uvi_from_uvbed,
)


class CamsTests(unittest.TestCase):
    def test_uvi_conversion(self):
        # WHO definition: UVI = uvbed (W/m2) / 0.025
        self.assertAlmostEqual(uvi_from_uvbed(0.0), 0.0)
        self.assertAlmostEqual(uvi_from_uvbed(0.025), 1.0)
        self.assertAlmostEqual(uvi_from_uvbed(0.275), 11.0)
        self.assertAlmostEqual(uvi_from_uvbed(0.3), 12.0)

    def test_station_set(self):
        self.assertEqual(len(AU_STATIONS), 13)

    def test_area_covers_stations(self):
        area = area_for(list(AU_STATIONS))
        n, w, s, e = area
        for key, (lat, lon, _tz) in AU_STATIONS.items():
            self.assertLess(lat, n, key)
            self.assertGreater(lat, s, key)
            self.assertLess(lon, e, key)
            self.assertGreater(lon, w, key)

    def test_request_payload_shape(self):
        p = request_payload("2026-10-23", "00:00", [0.0, 110.0, -50.0, 160.0])
        self.assertEqual(p["dataset"], "cams-global-atmospheric-composition-forecasts")
        r = p["request"]
        self.assertEqual(r["type"], ["forecast"])
        self.assertEqual(len(r["leadtime_hour"]), 121)

    def test_variable_names_are_the_api_names_not_the_grib_names(self):
        # Read off the ADS download form on 25 Oct 2026. The short GRIB names
        # "uvbed"/"uvbedcs" are rejected by the API, so this is worth pinning.
        self.assertEqual(
            VARIABLES,
            [
                "uv_biologically_effective_dose",
                "uv_biologically_effective_dose_clear_sky",
            ],
        )
        r = request_payload("2026-10-23", "00:00", [0.0, 110.0, -50.0, 160.0])["request"]
        self.assertEqual(r["variable"], VARIABLES)

    def test_format_key_and_date_range_match_the_form(self):
        r = request_payload("2026-10-23", "00:00", [0.0, 110.0, -50.0, 160.0])["request"]
        # "data_format", not "format"; and its netCDF value would be
        # "netcdf_zip", not "netcdf".
        self.assertEqual(r["data_format"], "grib")
        self.assertNotIn("format", r)
        # Even one day is expressed as a start/end range.
        self.assertEqual(r["date"], ["2026-10-23/2026-10-23"])


class FlattenSeriesTests(unittest.TestCase):
    """The GRIB changes shape with the number of dates requested.

    One date  -> time is a scalar, data is (step,)
    Many dates-> time is (time,),  data is (time, step)

    The probe only ever asked for one date, so the second shape went
    undiscovered until a 14-day validation run crashed on it.
    """

    def test_single_run_scalar_time(self):
        valid = [10, 11, 12]
        issued = 10  # scalar: one model run
        values = [0.1, 0.2, 0.3]
        out = flatten_series(valid, issued, values)
        self.assertEqual(
            out, [(10, 10, 0.1), (11, 10, 0.2), (12, 10, 0.3)]
        )

    def test_many_runs_two_dimensional(self):
        # Two runs, three steps each. Every value must keep the run it came from.
        valid = [[10, 11, 12], [34, 35, 36]]
        issued = [10, 34]
        values = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]
        out = flatten_series(valid, issued, values)
        self.assertEqual(
            out,
            [
                (10, 10, 0.1), (11, 10, 0.2), (12, 10, 0.3),
                (34, 34, 0.4), (35, 34, 0.5), (36, 34, 0.6),
            ],
        )

    def test_issuing_run_is_never_smeared_across_runs(self):
        # The bug this guards: broadcasting the wrong way round would stamp
        # every value with the first run's time.
        valid = [[0, 1], [24, 25]]
        issued = [0, 24]
        values = [[1.0, 2.0], [3.0, 4.0]]
        issued_out = [i for _v, i, _d in flatten_series(valid, issued, values)]
        self.assertEqual(issued_out, [0, 0, 24, 24])

    def test_mismatched_shapes_are_rejected(self):
        with self.assertRaises(ValueError):
            flatten_series([10, 11, 12], 10, [0.1, 0.2])


if __name__ == "__main__":
    unittest.main()
