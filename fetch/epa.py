"""EPA Envirofacts UV forecast adapter (United States).

Verified live 23 Oct 2026 via the DMAP-EF service:
- Hourly: https://data.epa.gov/dmapservice/getEnvirofactsUVHOURLY/CITY/{city}/STATE/{st}/JSON
  rows: {CITY, DATE_TIME ("Oct/23/2026 07 AM", city-local), ORDER, STATE, UV_VALUE, ZIP}
- Daily:  https://data.epa.gov/dmapservice/getEnvirofactsUVDAILY/CITY/{city}/STATE/{st}/JSON
  rows: {CITY, DATE ("Oct/23/2026"), STATE, UV_ALERT, UV_INDEX}

Times in the feed are city-local with no offset; we attach the city's IANA zone
(the doc's time-zone rule: never hard-code offsets) and store UTC.
EPA data is US government public domain; credit EPA.
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from .common import Record, check_uvi, utc_now

BASE = "https://data.epa.gov/dmapservice"
UA = {"User-Agent": "Mozilla/5.0 (compatible; uvatlas-fetcher/1.0)"}

# Launch set: 50 largest US metros -> (EPA city, EPA state, IANA zone).
US_CITIES: dict[str, tuple[str, str, str]] = {
    "us-new-york-ny": ("New York", "NY", "America/New_York"),
    "us-los-angeles-ca": ("Los Angeles", "CA", "America/Los_Angeles"),
    "us-chicago-il": ("Chicago", "IL", "America/Chicago"),
    "us-houston-tx": ("Houston", "TX", "America/Chicago"),
    "us-phoenix-az": ("Phoenix", "AZ", "America/Phoenix"),
    "us-philadelphia-pa": ("Philadelphia", "PA", "America/New_York"),
    "us-san-antonio-tx": ("San Antonio", "TX", "America/Chicago"),
    "us-san-diego-ca": ("San Diego", "CA", "America/Los_Angeles"),
    "us-dallas-tx": ("Dallas", "TX", "America/Chicago"),
    "us-san-jose-ca": ("San Jose", "CA", "America/Los_Angeles"),
    "us-austin-tx": ("Austin", "TX", "America/Chicago"),
    "us-jacksonville-fl": ("Jacksonville", "FL", "America/New_York"),
    "us-fort-worth-tx": ("Fort Worth", "TX", "America/Chicago"),
    "us-columbus-oh": ("Columbus", "OH", "America/New_York"),
    "us-charlotte-nc": ("Charlotte", "NC", "America/New_York"),
    "us-indianapolis-in": ("Indianapolis", "IN", "America/Indiana/Indianapolis"),
    "us-seattle-wa": ("Seattle", "WA", "America/Los_Angeles"),
    "us-denver-co": ("Denver", "CO", "America/Denver"),
    "us-washington-dc": ("Washington", "DC", "America/New_York"),
    "us-boston-ma": ("Boston", "MA", "America/New_York"),
    "us-el-paso-tx": ("El Paso", "TX", "America/Denver"),
    "us-nashville-tn": ("Nashville", "TN", "America/Chicago"),
    "us-detroit-mi": ("Detroit", "MI", "America/Detroit"),
    "us-oklahoma-city-ok": ("Oklahoma City", "OK", "America/Chicago"),
    "us-portland-or": ("Portland", "OR", "America/Los_Angeles"),
    "us-las-vegas-nv": ("Las Vegas", "NV", "America/Los_Angeles"),
    "us-memphis-tn": ("Memphis", "TN", "America/Chicago"),
    "us-louisville-ky": ("Louisville", "KY", "America/New_York"),
    "us-baltimore-md": ("Baltimore", "MD", "America/New_York"),
    "us-milwaukee-wi": ("Milwaukee", "WI", "America/Chicago"),
    "us-albuquerque-nm": ("Albuquerque", "NM", "America/Denver"),
    "us-tucson-az": ("Tucson", "AZ", "America/Phoenix"),
    "us-fresno-ca": ("Fresno", "CA", "America/Los_Angeles"),
    "us-sacramento-ca": ("Sacramento", "CA", "America/Los_Angeles"),
    "us-kansas-city-mo": ("Kansas City", "MO", "America/Chicago"),
    "us-mesa-az": ("Mesa", "AZ", "America/Phoenix"),
    "us-atlanta-ga": ("Atlanta", "GA", "America/New_York"),
    "us-omaha-ne": ("Omaha", "NE", "America/Chicago"),
    "us-colorado-springs-co": ("Colorado Springs", "CO", "America/Denver"),
    "us-raleigh-nc": ("Raleigh", "NC", "America/New_York"),
    "us-miami-fl": ("Miami", "FL", "America/New_York"),
    "us-long-beach-ca": ("Long Beach", "CA", "America/Los_Angeles"),
    "us-virginia-beach-va": ("Virginia Beach", "VA", "America/New_York"),
    "us-oakland-ca": ("Oakland", "CA", "America/Los_Angeles"),
    "us-minneapolis-mn": ("Minneapolis", "MN", "America/Chicago"),
    "us-tulsa-ok": ("Tulsa", "OK", "America/Chicago"),
    "us-tampa-fl": ("Tampa", "FL", "America/New_York"),
    "us-arlington-tx": ("Arlington", "TX", "America/Chicago"),
    "us-new-orleans-la": ("New Orleans", "LA", "America/Chicago"),
    "us-wichita-ks": ("Wichita", "KS", "America/Chicago"),
}


def _url(kind: str, city: str, state: str) -> str:
    city_q = urllib.parse.quote(city)
    return f"{BASE}/getEnvirofactsUV{kind}/CITY/{city_q}/STATE/{state}/JSON"


def _fetch_json(url: str) -> list[dict]:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.load(resp)
    if not isinstance(data, list):
        raise ValueError(f"EPA returned non-list: {type(data).__name__}")
    return data


def parse_hourly(rows: list[dict], key: str, tz_name: str, fetched_at: datetime | None = None) -> list[Record]:
    tz = ZoneInfo(tz_name)
    records: list[Record] = []
    for row in rows:
        try:
            uvi = float(row["UV_VALUE"])
            local = datetime.strptime(row["DATE_TIME"], "%b/%d/%Y %I %p").replace(tzinfo=tz)
        except (KeyError, ValueError, TypeError):
            continue
        if not check_uvi(uvi):
            continue
        records.append(
            Record(source="epa", kind="forecast", location=key, uvi=uvi,
                   valid_at=local.astimezone(timezone.utc), fetched_at=fetched_at)
        )
    return records


def parse_daily(rows: list[dict], key: str, tz_name: str, fetched_at: datetime | None = None) -> list[Record]:
    tz = ZoneInfo(tz_name)
    records: list[Record] = []
    for row in rows:
        try:
            uvi = float(row["UV_INDEX"])
            day = datetime.strptime(row["DATE"], "%b/%d/%Y").replace(hour=12, tzinfo=tz)
        except (KeyError, ValueError, TypeError):
            continue
        if not check_uvi(uvi):
            continue
        records.append(
            Record(source="epa", kind="forecast", location=key, uvi=uvi,
                   valid_at=day.astimezone(timezone.utc), fetched_at=fetched_at,
                   extra={"alert": str(row.get("UV_ALERT", "0"))})
        )
    return records


def run(cities: dict[str, tuple[str, str, str]] | None = None) -> list[Record]:
    """Fetch hourly + daily for every city. A failing city is skipped so one
    bad row never blocks the rest (last-good data is kept upstream)."""
    cities = cities or US_CITIES
    fetched_at = utc_now()
    records: list[Record] = []
    for key, (city, state, tz_name) in cities.items():
        for kind, parser in (("HOURLY", parse_hourly), ("DAILY", parse_daily)):
            try:
                rows = _fetch_json(_url(kind, city, state))
            except Exception:
                continue
            try:
                records.extend(parser(rows, key, tz_name, fetched_at))
            except Exception:
                continue
    return records
