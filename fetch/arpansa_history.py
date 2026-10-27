"""ARPANSA's historical UV measurements, from data.gov.au.

One CSV per station per year, minute resolution, about 21 MB a year:

    Date-Time,Lat,Lon,UV_Index
    2025-01-01 00:00:00,-34.04,151.10,0.01

Two things about this file were established by measurement, not assumption,
because both would quietly corrupt every comparison if guessed wrong:

1.  **Date-Time is the station's own LOCAL STANDARD time, and ignores daylight
    saving all year.** Checked by finding the mean time of the daily peak and
    comparing it with astronomical solar noon for the station's longitude:

        Sydney, June 2025     peak 11:56 -> 01:56 UTC at +10   solar noon 01:56
        Sydney, late Oct 2025 peak 11:53 -> 01:53 UTC at +10   solar noon 01:56
        Perth,  June 2025     peak 12:12 -> 04:12 UTC at  +8   solar noon 04:16

    Late October is inside NSW daylight saving. Had the file followed the clock
    on the wall the peak would have appeared near 12:53, so it does not. Sydney
    is +10 and Perth is +8, so it is each station's own standard offset rather
    than one shared zone.

    This matters most in exactly the season the site is built for: treating the
    file as `Australia/Sydney` would put every summer reading an hour out.

2.  **Lat/Lon are the instrument's real position**, not the city centre.
    Sydney's station sits at -34.04, 151.10, about 20 km south of the CBD.

Licence: CC BY 2.5 Australia. Credit ARPANSA, name the licence, and say that any
derived figures were calculated by this site.
"""
from __future__ import annotations

import csv
import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

CKAN = "https://data.gov.au/data/api/3/action"
UA = {"User-Agent": "Mozilla/5.0 (compatible; uvatlas/1.0; +https://uvatlas.com/methods/)"}

# Station key -> data.gov.au package. Kingston is Hobart's station.
PACKAGES: dict[str, str] = {
    "au-adl": "ultraviolet-radiation-index-adelaide",
    "au-ali": "ultraviolet-radiation-index-alice-springs",
    "au-bri": "ultraviolet-radiation-index-brisbane",
    "au-can": "ultraviolet-radiation-index-canberra",
    "au-dar": "ultraviolet-radiation-index-darwin",
    "au-emd": "ultraviolet-radiation-index-emerald",
    "au-gco": "ultraviolet-radiation-index-gold-coast",
    "au-kin": "ultraviolet-radiation-index-kingston",
    "au-mel": "ultraviolet-radiation-index-melbourne",
    "au-new": "ultraviolet-radiation-index-newcastle",
    "au-per": "ultraviolet-radiation-index-perth",
    "au-syd": "ultraviolet-radiation-index-sydney",
    "au-tow": "ultraviolet-radiation-index-townsville",
}


# The yearly files are not all laid out the same. Found on 27 October 2026,
# when a full run reported 0 valid days for every station in 2016 and for
# Newcastle in 2024 -- an instrument cannot fail at thirteen sites for a year at
# once, so the parser had silently understood nothing:
#
#     2016:            timestamp,Lat,Lon,UV_Index
#                      2016-01-01 00:01:00,...
#     most years:      Date-Time,Lat,Lon,UV_Index
#                      2025-01-01 00:00:00,...
#     Newcastle 2024:  Date-Time,Lat,Lon,UV_Index     (via a spreadsheet:
#                      1/01/2024 0:00,...              day first, no seconds)
#
# Day first, because these are Australian files and "1/01" is how an Australian
# spreadsheet writes the first of January. Read month-first, 13/01 would fail
# and 2/01 would land in February -- a mistake no test of a single day catches.
TIME_COLUMNS = ("Date-Time", "timestamp")
TIME_FORMATS = ("%Y-%m-%d %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y %H:%M:%S")


def parse_stamp(row: dict) -> datetime | None:
    """The row's clock time, in whichever layout this file uses; None if none fits."""
    raw = next((row[c] for c in TIME_COLUMNS if row.get(c)), "").strip()
    for fmt in TIME_FORMATS:
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


def standard_offset(tz_name: str, year: int = 2025) -> timedelta:
    """The zone's offset with daylight saving OFF.

    Derived from the zone database rather than hard-coded, which is the
    project's rule. July is mid-winter everywhere in Australia, so every
    Australian zone is on standard time then -- including the ones that never
    leave it (Queensland, the NT, WA).
    """
    offset = ZoneInfo(tz_name).utcoffset(datetime(year, 7, 1, 12))
    if offset is None:  # pragma: no cover - only for a broken zone database
        raise RuntimeError(f"no UTC offset for {tz_name}")
    return offset


def _get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def resource_url(station: str, year: int) -> str:
    """Find the CSV for one station and year through the CKAN API."""
    package = PACKAGES.get(station)
    if not package:
        raise KeyError(f"no data.gov.au package known for {station}")
    data = _get_json(f"{CKAN}/package_show?id={urllib.parse.quote(package)}")
    for res in data["result"]["resources"]:
        name = str(res.get("name", ""))
        if str(year) in name and str(res.get("format", "")).upper() == "CSV":
            return res["url"]
    raise LookupError(f"{package} has no {year} CSV")


def download(station: str, year: int, dest_dir: str) -> str:
    """Download the CSV once and reuse it; these files are ~21 MB each."""
    os.makedirs(dest_dir, exist_ok=True)
    path = os.path.join(dest_dir, f"{station}-{year}.csv")
    if os.path.exists(path) and os.path.getsize(path) > 1_000_000:
        return path
    req = urllib.request.Request(resource_url(station, year), headers=UA)
    with urllib.request.urlopen(req, timeout=600) as resp, open(path, "wb") as f:
        while chunk := resp.read(1 << 20):
            f.write(chunk)
    return path


def hourly_means(
    path: str,
    tz_name: str,
    window_minutes: int = 5,
    year: int = 2025,
) -> dict[datetime, float]:
    """Measurements averaged around each hour, keyed by UTC instant.

    CAMS values are instantaneous at the top of the hour, so each is compared
    against the mean of the measurements within +/- `window_minutes` of that
    instant. Averaging a few minutes takes the noise out of a single sample
    without smearing the curve.
    """
    offset = standard_offset(tz_name, year)
    buckets: dict[datetime, list[float]] = {}

    with open(path, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            try:
                uv = float(row["UV_Index"])
            except (KeyError, TypeError, ValueError):
                continue
            local = parse_stamp(row)
            if local is None:
                continue
            # The file's clock minus the station's standard offset is UTC.
            moment = local.replace(tzinfo=timezone.utc) - offset
            minute = moment.minute
            if minute <= window_minutes:
                hour = moment.replace(minute=0, second=0, microsecond=0)
            elif minute >= 60 - window_minutes:
                hour = moment.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
            else:
                continue
            buckets.setdefault(hour, []).append(uv)

    return {hour: sum(vals) / len(vals) for hour, vals in buckets.items() if vals}


def hourly_clearness(
    path: str,
    tz_name: str,
    window_minutes: int = 30,
    year: int = 2025,
) -> dict[datetime, float]:
    """How smooth the MEASURED curve was around each hour, keyed by UTC instant.

    This is a cloud detector built from the instrument alone, with no model
    involved. It exists because the obvious way to find cloudless hours -- ask
    CAMS whether its all-sky value matches its own clear-sky value -- lets the
    model mark its own homework. If CAMS is systematically optimistic about
    clear skies, that filter cannot see it, and the whole "CAMS reads 13% high"
    finding rests on it.

    How it works: over an hour, a cloudless UV curve is almost a straight line
    (it is a slow bell, and an hour is a small slice of it). Cloud puts dips and
    spikes in. So fit a least-squares line through the minute readings in the
    window and measure how far they sit from it, relative to the level:

        clearness = mean|value - fitted line| / mean(value)

    Near zero means smooth, hence cloudless. Larger means broken cloud.
    Scale-free, so it behaves the same at UVI 3 and UVI 14.

    Returns the ratio, not a yes/no: the threshold is a calibration decision and
    belongs with the caller.
    """
    offset = standard_offset(tz_name, year)
    buckets: dict[datetime, list[tuple[int, float]]] = {}

    with open(path, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            try:
                uv = float(row["UV_Index"])
            except (KeyError, TypeError, ValueError):
                continue
            local = parse_stamp(row)
            if local is None:
                continue
            moment = local.replace(tzinfo=timezone.utc) - offset
            hour = moment.replace(minute=0, second=0, microsecond=0)
            delta = (moment - hour).total_seconds() / 60.0
            # Each minute contributes to the hour it is nearest to.
            if delta <= window_minutes:
                buckets.setdefault(hour, []).append((int(delta), uv))
            if delta >= 60 - window_minutes:
                nxt = hour + timedelta(hours=1)
                buckets.setdefault(nxt, []).append((int(delta - 60), uv))

    out: dict[datetime, float] = {}
    for hour, points in buckets.items():
        if len(points) < 20:
            continue
        mean_uv = sum(v for _m, v in points) / len(points)
        if mean_uv < 1.0:
            continue  # night or twilight: nothing to judge
        out[hour] = _line_residual(points) / mean_uv
    return out


def _line_residual(points: list[tuple[int, float]]) -> float:
    """Mean absolute distance from the least-squares line through the points."""
    n = len(points)
    mean_x = sum(x for x, _y in points) / n
    mean_y = sum(y for _x, y in points) / n
    sxx = sum((x - mean_x) ** 2 for x, _y in points)
    sxy = sum((x - mean_x) * (y - mean_y) for x, y in points)
    slope = sxy / sxx if sxx > 0 else 0.0
    intercept = mean_y - slope * mean_x
    return sum(abs(y - (slope * x + intercept)) for x, y in points) / n
