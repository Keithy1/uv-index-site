"""Does the CAMS forecast agree with what ARPANSA actually measured?

This is the check that decides whether a CAMS-derived UV index can be published.
It keeps two questions apart, because conflating them is how a wrong number gets
shipped:

  1. **Is the unit conversion right?** UVI = dose rate x 40 assumes the rate is
     in W/m2, and the GRIB carries no units to confirm it. Fitting measured UVI
     against the raw rate gives the multiplier the data itself implies.

     Fitted on CLOUDLESS hours only (all-sky within 5% of clear-sky), because
     cloud error would otherwise swamp a units error. Known weakness: that
     filter uses CAMS's own clear-sky field, so it cannot detect a model that
     runs high in clear conditions -- it marks its own homework. Treat a
     consistent offset as model bias, not as proof the conversion is wrong.

  2. **How accurate is the forecast?** Bias and mean absolute error across all
     daylight hours, cloud included. These are the figures the methods page
     should quote.

Runs in GitHub Actions, where ADS_API_KEY lives.

    python -m fetch.cams_validate --station au-syd --dates 2025-10-14 --days 14
    python -m fetch.cams_validate --station all --dates 2025-01-08,2025-10-14
"""
from __future__ import annotations

import argparse
import statistics
import sys
from dataclasses import dataclass, field
from datetime import date, timedelta

from . import arpansa_history
from .cams import AU_STATIONS, area_for, parse_grib, request_payload, retrieve

RULE = "=" * 72

# All-sky within this fraction of clear-sky counts as a cloudless hour --
# according to CAMS itself. Kept only so the two filters can be compared.
CLOUDLESS_RATIO = 0.95
# Measured smoothness below which an hour is cloudless, from the INSTRUMENT
# alone. Calibrated on Sydney 2025: the distribution has a clear knee here
# (p25 = 0.0093, p50 = 0.055), and it picks ~26% of daylight hours, which
# matches the number of clear hours a year Sydney actually gets. A heavily
# clouded day scored 0.145 and a clear one 0.023.
CLEARNESS_MAX = 0.01
# Below this the hour is night or twilight and tells us nothing.
DAYLIGHT_UVI = 1.0
# Fewer cloudless hours than this and a fitted multiplier is noise.
MIN_CLOUDLESS = 10


def fit_multiplier(pairs: list[tuple[float, float]]) -> float | None:
    """Least-squares slope through the origin: measured = k * rate."""
    num = sum(measured * rate for measured, rate in pairs)
    den = sum(rate * rate for _measured, rate in pairs)
    return num / den if den > 0 else None


@dataclass
class Stats:
    station: str
    period: str
    daylight: int = 0
    errors: list[float] = field(default_factory=list)
    # Cloudless according to CAMS's own clear-sky field.
    cloudless: list[tuple[float, float]] = field(default_factory=list)
    # Cloudless according to the measured curve's smoothness -- independent of
    # the model, which is the whole point.
    cloudless_measured: list[tuple[float, float]] = field(default_factory=list)

    @property
    def bias(self) -> float | None:
        return statistics.fmean(self.errors) if self.errors else None

    @property
    def mae(self) -> float | None:
        return statistics.fmean(abs(e) for e in self.errors) if self.errors else None

    @property
    def within_one(self) -> float | None:
        if not self.errors:
            return None
        return sum(1 for e in self.errors if abs(e) <= 1.0) / len(self.errors) * 100

    @property
    def multiplier(self) -> float | None:
        if len(self.cloudless) < MIN_CLOUDLESS:
            return None
        return fit_multiplier(self.cloudless)

    @property
    def multiplier_measured(self) -> float | None:
        if len(self.cloudless_measured) < MIN_CLOUDLESS:
            return None
        return fit_multiplier(self.cloudless_measured)


def compare(station: str, records, measured, period: str, clearness=None) -> Stats:
    """Align one station's forecast against its measurements."""
    clearness = clearness or {}
    stats = Stats(station=station, period=period)
    for rec in records:
        if rec.location != station:
            continue
        obs = measured.get(rec.valid_at)
        if obs is None:
            continue
        if obs < DAYLIGHT_UVI and rec.uvi < DAYLIGHT_UVI:
            continue
        stats.daylight += 1
        stats.errors.append(rec.uvi - obs)
        rate = rec.uvi / 40.0  # back to the raw dose rate
        clear = rec.extra.get("clear_sky_uvi") if rec.extra else None
        if clear and clear > 0 and rec.uvi / clear >= CLOUDLESS_RATIO:
            stats.cloudless.append((obs, rate))
        smoothness = clearness.get(rec.valid_at)
        if smoothness is not None and smoothness <= CLEARNESS_MAX:
            stats.cloudless_measured.append((obs, rate))
    return stats


def run_period(
    stations: list[str], start: date, days: int, cache: str, grib: str
) -> list[Stats]:
    end = start + timedelta(days=days - 1)
    period = f"{start}..{end}"
    print(f"\n{RULE}\nPERIOD {period}   stations: {len(stations)}\n{RULE}")

    # One request covering every station: the 00Z run of each day, hours 0-23,
    # so every hour is a same-day forecast rather than a multi-day-old one.
    payload = request_payload(str(start), "00:00", area_for(stations), lead_hours=23)
    payload["request"]["date"] = [f"{start}/{end}"]
    retrieve(payload["request"], grib)
    records = parse_grib(grib, {s: AU_STATIONS[s] for s in stations})
    print(f"forecast: {len(records)} hourly values across {len(stations)} stations")

    results = []
    for station in stations:
        _lat, _lon, tz = AU_STATIONS[station]
        try:
            csv_path = arpansa_history.download(station, start.year, cache)
            measured = arpansa_history.hourly_means(csv_path, tz, year=start.year)
            clearness = arpansa_history.hourly_clearness(csv_path, tz, year=start.year)
        except Exception as exc:  # noqa: BLE001 - a missing year is not fatal
            print(f"  {station}: measurements unavailable ({exc})")
            continue
        results.append(compare(station, records, measured, period, clearness))
    return results


def print_table(results: list[Stats]) -> None:
    header = (
        f"  {'station':9} {'period':24} {'hours':>6} {'bias':>7} "
        f"{'MAE':>6} {'<=1.0':>6} {'clear':>6} {'implied k':>10}"
    )
    print(f"\n{header}")
    for st in results:
        k = f"{st.multiplier:.1f}" if st.multiplier else "-"
        bias = f"{st.bias:+.2f}" if st.bias is not None else "-"
        mae = f"{st.mae:.2f}" if st.mae is not None else "-"
        win = f"{st.within_one:.0f}%" if st.within_one is not None else "-"
        print(
            f"  {st.station:9} {st.period:24} {st.daylight:6} {bias:>7} "
            f"{mae:>6} {win:>6} {len(st.cloudless):6} {k:>10}"
        )


def summarise(results: list[Stats], label: str) -> float | None:
    errors = [e for st in results for e in st.errors]
    cloudless = [p for st in results for p in st.cloudless]
    if not errors:
        print(f"\n{label}: no data")
        return None
    k = fit_multiplier(cloudless)
    within = sum(1 for e in errors if abs(e) <= 1.0) / len(errors) * 100
    print(f"\n{label}")
    print(f"  daylight hours    : {len(errors):,}")
    print(f"  mean bias         : {statistics.fmean(errors):+.2f} UVI")
    print(f"  mean abs error    : {statistics.fmean(abs(e) for e in errors):.2f} UVI")
    print(f"  within 1.0 UVI    : {within:.0f}%")
    print(f"  cloudless hours   : {len(cloudless):,}")
    if k:
        print(f"  pooled multiplier : {k:.1f}   ({(k - 40) / 40 * 100:+.1f}% vs 40)")
        print(f"  implied model bias: {(40 / k - 1) * 100:+.0f}% (positive = CAMS reads high)")
    return k


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="validate CAMS against ARPANSA")
    parser.add_argument(
        "--station",
        default="au-syd",
        help="a station key, or 'all' for every ARPANSA station",
    )
    parser.add_argument(
        "--dates",
        default="2025-10-14",
        help="comma-separated first days, one per period",
    )
    parser.add_argument("--days", type=int, default=14)
    parser.add_argument("--cache", default="arpansa-cache")
    args = parser.parse_args(argv)

    stations = sorted(AU_STATIONS) if args.station == "all" else [args.station]
    for station in stations:
        if station not in AU_STATIONS:
            print(f"unknown station {station}", file=sys.stderr)
            return 2
    starts = [date.fromisoformat(d.strip()) for d in args.dates.split(",") if d.strip()]

    all_results: list[Stats] = []
    for i, start in enumerate(starts):
        try:
            all_results += run_period(stations, start, args.days, args.cache, f"cams-{i}.grib")
        except Exception as exc:  # noqa: BLE001
            print(f"PERIOD {start} FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
            return 1

    if not all_results:
        print("nothing compared", file=sys.stderr)
        return 1

    print(f"\n{RULE}\nPER STATION AND PERIOD\n{RULE}")
    print_table(all_results)

    periods = sorted({st.period for st in all_results})
    per_season: dict[str, float] = {}
    for period in periods:
        k = summarise([st for st in all_results if st.period == period], f"SEASON {period}")
        if k:
            per_season[period] = k

    summarise(all_results, "ALL STATIONS, ALL PERIODS POOLED")

    # A correction factor is only defensible if the bias is stable. If the
    # seasons disagree, one multiplier would be wrong in both.
    if len(per_season) > 1:
        spread = max(per_season.values()) - min(per_season.values())
        print("\nSEASONAL STABILITY")
        for period, k in per_season.items():
            print(f"  {period}: implied multiplier {k:.1f}")
        print(f"  spread: {spread:.1f}")
        print(
            "  A single correction factor is only defensible if this spread is\n"
            "  small relative to the distance from 40."
        )

    # Per-station spread matters for the same reason.
    station_ks = [st.multiplier for st in all_results if st.multiplier]
    if len(station_ks) > 2:
        print("\nPER-STATION SPREAD")
        print(f"  stations with a usable fit: {len(station_ks)}")
        print(f"  range {min(station_ks):.1f} - {max(station_ks):.1f}, "
              f"sd {statistics.stdev(station_ks):.1f}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
