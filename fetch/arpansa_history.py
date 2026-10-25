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
            stamp = row.get("Date-Time", "")
            try:
                uv = float(row["UV_Index"])
            except (KeyError, TypeError, ValueError):
                continue
            try:
                local = datetime.strptime(stamp, "%Y-%m-%d %H:%M:%S")
            except ValueError:
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
