"""Does the CAMS forecast agree with what ARPANSA actually measured?

This is the check that decides whether a CAMS-derived UV index can be published
at all. It answers two separate questions, which are easy to confuse:

  1. **Is the unit conversion right?** UVI = dose rate x 40 assumes the rate is
     in W/m2, and the GRIB carries no units to confirm it. Fitting measured UVI
     against the raw rate gives the multiplier the data itself implies. If that
     comes out near 40, the assumption holds; if it comes out near 33 or 45, we
     have been publishing the wrong number.

     Fitted on CLOUDLESS hours only (all-sky within 5% of clear-sky), because
     cloud error would otherwise swamp a units error.

  2. **How good is the forecast?** Bias and mean absolute error across all
     daylight hours, cloud included. This is the honest accuracy figure, and it
     is what the methods page should quote.

Runs in GitHub Actions, where ADS_API_KEY lives.

    python -m fetch.cams_validate --station au-syd --date 2025-10-20 --days 7
"""
from __future__ import annotations

import argparse
import statistics
import sys
from datetime import date, datetime, timedelta

from . import arpansa_history
from .cams import AU_STATIONS, area_for, parse_grib, request_payload, retrieve


def fit_multiplier(pairs: list[tuple[float, float]]) -> float | None:
    """Least-squares slope through the origin: measured = k * rate."""
    num = sum(measured * rate for measured, rate in pairs)
    den = sum(rate * rate for _measured, rate in pairs)
    return num / den if den > 0 else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="validate CAMS against ARPANSA")
    parser.add_argument("--station", default="au-syd", choices=sorted(AU_STATIONS))
    parser.add_argument("--date", default="2025-10-20", help="first day, YYYY-MM-DD")
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--cache", default="arpansa-cache")
    parser.add_argument("--grib", default="cams-validate.grib")
    args = parser.parse_args(argv)

    start = date.fromisoformat(args.date)
    end = start + timedelta(days=args.days - 1)
    lat, lon, tz = AU_STATIONS[args.station]

    print(f"station   {args.station}  ({lat}, {lon}, {tz})")
    print(f"period    {start} .. {end}")
    print(f"ARPANSA   local standard offset {arpansa_history.standard_offset(tz)} (no daylight saving)\n")

    # --- measured ---------------------------------------------------------
    csv_path = arpansa_history.download(args.station, start.year, args.cache)
    measured = arpansa_history.hourly_means(csv_path, tz, year=start.year)
    print(f"measured  {len(measured):,} hourly means from {csv_path}")

    # --- forecast ---------------------------------------------------------
    # One request covering the whole period: the 00Z run of each day, hours 0-23,
    # so every hour is a same-day forecast rather than a multi-day-old one.
    payload = request_payload(str(start), "00:00", area_for([args.station]), lead_hours=23)
    payload["request"]["date"] = [f"{start}/{end}"]
    try:
        retrieve(payload["request"], args.grib)
    except Exception as exc:  # noqa: BLE001
        print(f"RETRIEVE FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    records = parse_grib(args.grib, {args.station: AU_STATIONS[args.station]})
    print(f"forecast  {len(records)} hourly values\n")

    # --- align ------------------------------------------------------------
    rows = []
    for rec in records:
        obs = measured.get(rec.valid_at.replace(tzinfo=rec.valid_at.tzinfo))
        if obs is None:
            continue
        clear = rec.extra.get("clear_sky_uvi") if rec.extra else None
        rows.append((rec.valid_at, obs, rec.uvi, clear))

    daylight = [r for r in rows if r[1] >= 1.0 or r[2] >= 1.0]
    print(f"paired    {len(rows)} hours, {len(daylight)} of them daylight\n")
    if not daylight:
        print("No overlapping daylight hours: nothing to compare.", file=sys.stderr)
        return 1

    # --- 1. the units question -------------------------------------------
    cloudless = [
        (obs, model / 40.0)  # back to the raw dose rate
        for _t, obs, model, clear in daylight
        if clear and clear > 0 and model / clear >= 0.95
    ]
    print("1. UNIT CONVERSION  (cloudless hours only)")
    if len(cloudless) < 10:
        print(f"   only {len(cloudless)} cloudless hours: too few to fit, widen the period")
    else:
        k = fit_multiplier(cloudless)
        print(f"   cloudless hours fitted : {len(cloudless)}")
        print(f"   implied multiplier     : {k:.1f}   (we use 40.0)")
        if k is not None:
            drift = abs(k - 40.0) / 40.0 * 100
            verdict = "consistent with W/m2" if drift < 10 else "NOT consistent -- investigate"
            print(f"   difference from 40     : {drift:.1f}%  -> {verdict}")

    # --- 2. the accuracy question ----------------------------------------
    errors = [model - obs for _t, obs, model, _c in daylight]
    print("\n2. FORECAST ACCURACY  (all daylight hours, cloud included)")
    print(f"   hours compared : {len(errors)}")
    print(f"   mean bias      : {statistics.fmean(errors):+.2f} UVI  (positive = forecast too high)")
    print(f"   mean abs error : {statistics.fmean(abs(e) for e in errors):.2f} UVI")
    print(f"   worst miss     : {max(errors, key=abs):+.2f} UVI")
    within = sum(1 for e in errors if abs(e) <= 1.0) / len(errors) * 100
    print(f"   within 1.0 UVI : {within:.0f}% of hours")

    # --- a look at the biggest day ---------------------------------------
    by_day: dict[date, list] = {}
    for t, obs, model, _c in daylight:
        by_day.setdefault(t.date(), []).append((t, obs, model))
    print("\n3. DAILY PEAKS")
    print(f"   {'date':12} {'measured':>9} {'forecast':>9} {'diff':>7}")
    for day in sorted(by_day):
        vals = by_day[day]
        obs_peak = max(v[1] for v in vals)
        mod_peak = max(v[2] for v in vals)
        print(f"   {str(day):12} {obs_peak:9.1f} {mod_peak:9.1f} {mod_peak - obs_peak:+7.1f}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
