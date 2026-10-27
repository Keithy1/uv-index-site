"""Monthly UV normals per city: what "this time of year" usually looks like.

Computed once a year and committed as data/normals.json, which the Worker
bundles the way it bundles stations.json. They change once a year and fill a
few kilobytes, so they cost the site no database reads and no writes -- the
lesson of 26 October 2026, when pages recomputing on every view exhausted D1's
daily allowance. Work out a value when the data lands, not when it is viewed.

Two sources, and the page says which, because they are not the same thing:

* **Australia: ARPANSA's own measurements**, one-minute resolution, one CSV per
  station per year on data.gov.au, CC BY 2.5 AU. A day's peak is the highest
  five-minute mean, which tracks the live site's five-minutely readings and is
  not thrown by a single-minute spike off a cloud edge.

* **United States: NOAA's daily UV Index bulletin**, the Climate Prediction
  Center's forecast for about 58 cities at solar noon, archived as plain text
  since 28 June 1994. US Government work, so public domain. These are
  *forecasts* -- cloud-adjusted, issued the day before -- not measurements, and
  the page must say so. There is no long, free, commercially licensed record of
  measured UV for US cities.

    30 of our 50 US cities are bulletin cities. Six more are within 60 km of one
    (Mesa and Phoenix, 23 km) and take its values, named on the page. The other
    fourteen are 100 km or more from any bulletin city and get no section: a
    borrowed climate from Los Angeles is not San Diego's, and saying nothing is
    better than saying something wrong.

Partial data must never render as a confident answer, here as everywhere: a day
counts only if the instrument covered the middle of it, and a month is published
only with at least MIN_DAYS valid days behind it.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import statistics
import sys
import time
import urllib.request
from datetime import date, datetime
from pathlib import Path

from . import arpansa_history
from .cams import STATIONS

OUT = Path(__file__).resolve().parent.parent / "data" / "normals.json"

BULLETIN = "https://www.cpc.ncep.noaa.gov/products/stratosphere/uv_index/Bulletin"

# A month with fewer valid days than this across all years is not published.
# Two years of a month is about 60 days; less is an anecdote, not a normal.
MIN_DAYS = 60

# A day needs this many one-minute readings between 10:00 and 14:00 local
# standard time (of 240 possible) to count. A day the instrument missed at
# midday would report a morning or afternoon value as its peak -- the
# truncated-maximum mistake that once had Brisbane "peaking at 6.1 at 9 am".
MIN_MIDDAY_MINUTES = 200

# How far a US city may be from a bulletin city and still take its values.
PROXY_MAX_KM = 60

# Bulletin cities we need as proxies but do not carry as stations ourselves.
# City-centre coordinates; a proxy is a few tens of kilometres, so the centre
# is precise enough.
EXTRA_BULLETIN_COORDS: dict[tuple[str, str], tuple[float, float]] = {
    ("NORFOLK", "VA"): (36.8508, -76.2859),
    ("SAN FRANCISCO", "CA"): (37.7749, -122.4194),
}

MONTHS = {m: i + 1 for i, m in enumerate(
    ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"])}


# --------------------------------------------------------------------------
# The statistics, shared by both sources
# --------------------------------------------------------------------------

def band_level(uvi: float) -> int:
    """The reading rounded half-up, which is what decides a WHO band.

    The project's rule: 2.4 is Low, 2.5 is Moderate. Python's round() rounds
    half to even, which would put 2.5 in Low, so it is not used here.
    """
    return math.floor(uvi + 0.5)


def monthly_stats(peaks: dict[date, float]) -> list[dict | None]:
    """Twelve months of normals from daily peaks; None where too few days."""
    by_month: dict[int, list[float]] = {m: [] for m in range(1, 13)}
    for day, peak in peaks.items():
        by_month[day.month].append(peak)
    out: list[dict | None] = []
    for m in range(1, 13):
        vals = by_month[m]
        if len(vals) < MIN_DAYS:
            out.append(None)
            continue
        levels = [band_level(v) for v in vals]
        share = lambda floor: round(sum(1 for lv in levels if lv >= floor) / len(levels), 3)
        out.append({
            "days": len(vals),
            "median": round(statistics.median(vals), 1),
            "protect": share(3),
            "veryHigh": share(8),
            "extreme": share(11),
        })
    return out


# --------------------------------------------------------------------------
# Australia: ARPANSA's measurements
# --------------------------------------------------------------------------

def daily_peaks_arpansa(path: str) -> dict[date, float]:
    """Each valid day's peak: the highest five-minute mean.

    The file's clock is the station's local STANDARD time all year (see
    arpansa_history), which is exactly right for a day boundary at midnight
    and a midday window: no daylight-saving jump inside either.
    """
    buckets: dict[tuple[date, int], list[float]] = {}
    midday: dict[date, int] = {}
    with open(path, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            raw = (row.get("UV_Index") or "").strip()
            # float("") would raise, but say it plainly: an empty field is
            # missing data, never a zero.
            if not raw or not any(ch.isdigit() for ch in raw):
                continue
            try:
                uv = float(raw)
                stamp = datetime.strptime(row.get("Date-Time", ""), "%Y-%m-%d %H:%M:%S")
            except ValueError:
                continue
            day = stamp.date()
            buckets.setdefault((day, stamp.hour * 12 + stamp.minute // 5), []).append(uv)
            if 10 <= stamp.hour < 14:
                midday[day] = midday.get(day, 0) + 1

    peaks: dict[date, float] = {}
    for (day, _slot), vals in buckets.items():
        if midday.get(day, 0) < MIN_MIDDAY_MINUTES:
            continue
        mean = sum(vals) / len(vals)
        if mean > peaks.get(day, float("-inf")):
            peaks[day] = mean
    return peaks


def australia(years: range, cache: str, keep: bool, only: set[str] | None) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for sid in sorted(arpansa_history.PACKAGES):
        if only and sid not in only:
            continue
        peaks: dict[date, float] = {}
        for year in years:
            try:
                path = arpansa_history.download(sid, year, cache)
            except LookupError:
                print(f"  {sid} {year}: not published, skipped", file=sys.stderr)
                continue
            got = daily_peaks_arpansa(path)
            print(f"  {sid} {year}: {len(got)} valid days", file=sys.stderr)
            peaks.update(got)
            if not keep:
                os.remove(path)
        if not peaks:
            continue
        out[sid] = {
            "source": "arpansa",
            "years": [min(d.year for d in peaks), max(d.year for d in peaks)],
            "months": monthly_stats(peaks),
        }
    return out


# --------------------------------------------------------------------------
# United States: NOAA's bulletin
# --------------------------------------------------------------------------

_VALID = re.compile(r"VALID\s+([A-Z]{3})\s+(\d{1,2})\s+(\d{4})")
_ENTRY = re.compile(r"([A-Z][A-Z .]*?[A-Z.])\s{2,}([A-Z]{2})\s+(\d{1,2})(?=\s|$)")


def parse_bulletin(text: str) -> tuple[date, dict[tuple[str, str], int]] | None:
    """The day a bulletin is valid for, and each city's noon UV.

    None for anything that does not look like a whole bulletin: a file that
    parses to a handful of cities is a truncated one, and its few values would
    quietly count as a full day.
    """
    m = _VALID.search(text)
    if not m or m.group(1) not in MONTHS:
        return None
    valid = date(int(m.group(3)), MONTHS[m.group(1)], int(m.group(2)))
    values: dict[tuple[str, str], int] = {}
    for line in text.splitlines():
        for e in _ENTRY.finditer(line):
            values[(e.group(1).strip(), e.group(2))] = int(e.group(3))
    return (valid, values) if len(values) >= 50 else None


def _get(url: str) -> str:
    req = urllib.request.Request(url, headers=arpansa_history.UA)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("latin-1")


def bulletins(years: range) -> dict[date, dict[tuple[str, str], int]]:
    """Every parseable bulletin in the given years, keyed by the day it is for."""
    out: dict[date, dict[tuple[str, str], int]] = {}
    for year in years:
        names = sorted(set(re.findall(r"uv\.\d{10}\.uvbull", _get(f"{BULLETIN}/{year}/"))))
        skipped = 0
        for name in names:
            try:
                parsed = parse_bulletin(_get(f"{BULLETIN}/{year}/{name}"))
            except OSError:
                parsed = None
            if parsed is None:
                skipped += 1
                continue
            out[parsed[0]] = parsed[1]
            time.sleep(0.1)  # one request at a time, politely
        print(f"  NOAA {year}: {len(names) - skipped} bulletins, {skipped} skipped", file=sys.stderr)
    return out


def km(a: tuple[float, float], b: tuple[float, float]) -> float:
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1] - a[1])
    c = math.sin(p1) * math.sin(p2) + math.cos(p1) * math.cos(p2) * math.cos(dl)
    return 6371 * math.acos(max(-1.0, min(1.0, c)))


def us_sources(cities: set[tuple[str, str]]) -> dict[str, dict | None]:
    """Which bulletin city each of our US cities takes its values from.

    Itself where it is a bulletin city; the nearest one within PROXY_MAX_KM
    otherwise; None where there is none that close.
    """
    ours = {sid: s for sid, s in STATIONS.items() if s["country"] == "us"}
    key = lambda s: (s["name"].upper(), s["epaState"])
    coords: dict[tuple[str, str], tuple[float, float]] = dict(EXTRA_BULLETIN_COORDS)
    for s in ours.values():
        if key(s) in cities:
            coords[key(s)] = (s["lat"], s["lon"])
    out: dict[str, dict | None] = {}
    for sid, s in ours.items():
        if key(s) in cities:
            out[sid] = {"key": key(s), "via": None}
            continue
        here = (s["lat"], s["lon"])
        near = min(((km(here, c), k) for k, c in coords.items() if k in cities), default=None)
        if near and near[0] <= PROXY_MAX_KM:
            out[sid] = {"key": near[1], "via": {
                "name": near[1][0].title(), "state": near[1][1], "km": round(near[0])}}
        else:
            out[sid] = None
    return out


def united_states(years: range, only: set[str] | None) -> dict[str, dict]:
    days = bulletins(years)
    cities = {k for values in days.values() for k in values}
    out: dict[str, dict] = {}
    for sid, src in sorted(us_sources(cities).items()):
        if src is None or (only and sid not in only):
            continue
        peaks = {d: float(v[src["key"]]) for d, v in days.items() if src["key"] in v}
        if not peaks:
            continue
        out[sid] = {
            "source": "noaa",
            "via": src["via"],
            "years": [min(d.year for d in peaks), max(d.year for d in peaks)],
            "months": monthly_stats(peaks),
        }
    return out


# --------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--au-years", default="2016-2025")
    ap.add_argument("--us-years", default="2015-2024")
    ap.add_argument("--only", default="", help="comma-separated station ids, for a quick local run")
    ap.add_argument("--cache", default=".cache/normals")
    ap.add_argument("--keep", action="store_true", help="keep the ARPANSA CSVs after reading them")
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--skip-au", action="store_true")
    ap.add_argument("--skip-us", action="store_true")
    args = ap.parse_args(argv)

    span = lambda s: range(int(s.split("-")[0]), int(s.split("-")[1]) + 1)
    only = {s.strip() for s in args.only.split(",") if s.strip()} or None

    cities: dict[str, dict] = {}
    if not args.skip_au:
        cities.update(australia(span(args.au_years), args.cache, args.keep, only))
    if not args.skip_us:
        cities.update(united_states(span(args.us_years), only))

    doc = {
        "_comment": (
            "Generated by fetch/normals.py; do not edit by hand. Monthly UV normals "
            "per city: months[0] is January, null where fewer than "
            f"{MIN_DAYS} valid days. median is the median daily peak; protect, "
            "veryHigh and extreme are the share of days at 3+, 8+ and 11+ after "
            "half-up rounding. arpansa = measured (CC BY 2.5 AU, data.gov.au); "
            "noaa = NOAA CPC noon forecasts (public domain)."
        ),
        "generated": date.today().isoformat(),
        "cities": dict(sorted(cities.items())),
    }
    Path(args.out).write_text(json.dumps(doc, indent=1) + "\n", encoding="utf8")
    print(f"wrote {args.out}: {len(cities)} cities", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
