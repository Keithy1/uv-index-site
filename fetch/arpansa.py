"""ARPANSA real-time UV feed adapter (Australia, measured readings).

Feed: https://uvdata.arpansa.gov.au/xml/uvvalues.xml  (~4.4 KB XML, ~1 min cadence)
Structure: <stations><location id="Adelaide"><name>adl</name><index>0.0</index>
           <time>10:18 PM</time><date>23/10/2026</date>...
           <utcdatetime>2026/10/23 12:48</utcdatetime><status>ok</status></location>...

Adapter check per design doc: status must be "ok" and index within 0..20.
Credits: "UV observations courtesy of ARPANSA" (see docs/site-notes.md).
"""
from __future__ import annotations

import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from .common import Record, check_uvi, utc_now

URL = "https://uvdata.arpansa.gov.au/xml/uvvalues.xml"
UA = {"User-Agent": "Mozilla/5.0 (compatible; uvatlas-fetcher/1.0)"}


def fetch() -> bytes:
    req = urllib.request.Request(URL, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def parse(xml_bytes: bytes, fetched_at: datetime | None = None) -> list[Record]:
    root = ET.fromstring(xml_bytes)
    records: list[Record] = []
    for loc in root.findall("location"):
        code = (loc.findtext("name") or "").strip()
        status = (loc.findtext("status") or "").strip().lower()
        utc_raw = (loc.findtext("utcdatetime") or "").strip()
        try:
            uvi = float(loc.findtext("index", ""))
            valid_at = datetime.strptime(utc_raw, "%Y/%m/%d %H:%M").replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            continue  # malformed row: skip, keep last good data
        if status != "ok" or not check_uvi(uvi) or not code:
            continue
        records.append(
            Record(
                source="arpansa",
                kind="measured",
                location=f"au-{code}",
                uvi=uvi,
                valid_at=valid_at,
                fetched_at=fetched_at,
            )
        )
    return records


def run() -> list[Record]:
    return parse(fetch(), fetched_at=utc_now())
