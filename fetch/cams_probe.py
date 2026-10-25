"""Find out what CAMS actually returns, before anything is built on top of it.

This is a diagnostic, not part of the pipeline. It makes the smallest useful
request, downloads it, and reports what arrived: size, file type, variable
names, units, and a sample UV index over Sydney. Nothing here guesses -- if a
step fails it says so and stops, because the entire point is to replace
assumptions with observations.

It runs in GitHub Actions, where ADS_API_KEY lives. Nobody needs the key
locally.

    python -m fetch.cams_probe [--date YYYY-MM-DD] [--run 00:00]
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import date, timedelta

from .cams import AU_STATIONS, DATASET, VARIABLES, area_for, request_payload, uvi_from_uvbed


def describe_file(path: str) -> str:
    """Identify the download by its magic bytes rather than its extension."""
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        head = f.read(8)
    if head[:4] == b"GRIB":
        kind = "GRIB"
    elif head[:3] == b"CDF" or head[:4] == b"\x89HDF":
        kind = "netCDF"
    elif head[:2] == b"PK":
        kind = "ZIP (netcdf_zip?)"
    else:
        kind = f"unknown, first bytes {head!r}"
    return f"{size:,} bytes, looks like {kind}"


def inspect_grib(path: str) -> int:
    """Open the file and report its variables and a Sydney UV index."""
    try:
        import xarray as xr
    except ImportError:
        print("xarray/cfgrib not installed: skipping contents inspection")
        return 0

    try:
        ds = xr.open_dataset(path, engine="cfgrib")
    except Exception as exc:  # noqa: BLE001 - diagnostic: report, do not raise
        print(f"could not open as GRIB: {exc}")
        return 1

    print(f"\ndimensions: {dict(ds.sizes)}")
    print("variables:")
    for name, var in ds.data_vars.items():
        units = var.attrs.get("units", "?")
        long_name = var.attrs.get("long_name", "")
        print(f"  {name:12} units={units:10} {long_name}")

    # Sydney: does the conversion give a believable UV index?
    lat, lon, _tz = AU_STATIONS["au-syd"]
    for name, var in ds.data_vars.items():
        try:
            point = var.sel(latitude=lat, longitude=lon, method="nearest")
            values = [float(v) for v in point.values.ravel()[:8]]
        except Exception as exc:  # noqa: BLE001
            print(f"  {name}: could not sample at Sydney ({exc})")
            continue
        peak = max(values) if values else 0.0
        print(
            f"\n  {name} at Sydney: first hours {[round(v, 4) for v in values]}\n"
            f"  peak dose rate {peak:.4f} -> UV index {uvi_from_uvbed(peak):.1f}"
        )
        print(
            "  Sanity check: a Sydney spring midday peak should land near 10-13. "
            "A value orders of magnitude out means the units are not W/m2 and the "
            "x40 conversion is wrong."
        )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="probe the CAMS retrieve API")
    # Yesterday by default: today's 00Z run is not published until mid-morning UTC.
    parser.add_argument("--date", default=str(date.today() - timedelta(days=1)))
    parser.add_argument("--run", default="00:00", choices=["00:00", "12:00"])
    parser.add_argument("--out", default="cams-probe.grib")
    args = parser.parse_args(argv)

    # Deliberately tiny: one run, the first 12 forecast hours, Australia only.
    payload = request_payload(args.date, args.run, area_for(list(AU_STATIONS)), lead_hours=12)
    request = payload["request"]

    print(f"dataset   {DATASET}")
    print(f"variables {VARIABLES}")
    print(f"date      {request['date']}  time {request['time']}")
    print(f"area      {request['area']}  (N, W, S, E)")
    print(f"format    {request['data_format']}")
    print(f"lead hrs  {len(request['leadtime_hour'])}\n")

    from .cams import retrieve  # imported here so --help works without cdsapi

    try:
        path = retrieve(request, args.out)
    except Exception as exc:  # noqa: BLE001 - the whole point is the message
        print(f"RETRIEVE FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    print(f"downloaded {path}: {describe_file(path)}")
    return inspect_grib(path)


if __name__ == "__main__":
    raise SystemExit(main())
