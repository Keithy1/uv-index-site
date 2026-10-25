"""Tests for CAMS: UVI conversion (science-critical) and payload/area shape."""
import unittest

from ..cams import AU_STATIONS, VARIABLES, area_for, request_payload, uvi_from_uvbed


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


if __name__ == "__main__":
    unittest.main()
