"""ARPANSA real-time UV feed adapter (Australia, measured readings).

Feed: https://uvdata.arpansa.gov.au/xml/uvvalues.xml  (~4.4 KB XML, ~1 min cadence)
Structure: <stations><location id="Adelaide"><name>adl</name><index>0.0</index>
           <time>10:18 PM</time><date>23/10/2026</date>...
           <utcdatetime>2026/10/23 12:48</utcdatetime><status>ok</status></location>...

Adapter check per design doc: status must be "ok" and index within 0..20.
Credits: "UV observations courtesy of ARPANSA" (see docs/site-notes.md).
"""
from __future__ import annotations

import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from .common import Record, check_uvi, utc_now

# Primary feed, plus the ARPANSA website mirror as a fallback.
URLS = [
    "https://uvdata.arpansa.gov.au/xml/uvvalues.xml",
    "https://www.arpansa.gov.au/uvindex/realtime/xml/uvvalues.xml",
]
UA = {"User-Agent": "Mozilla/5.0 (compatible; uvatlas-fetcher/1.0)"}
TIMEOUT = 60
RETRIES = 2


def fetch() -> bytes:
    last: Exception | None = None
    for attempt in range(RETRIES + 1):
        for url in URLS:
            try:
                req = urllib.request.Request(url, headers=UA)
                with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                    return resp.read()
            except Exception as exc:  # noqa: BLE001 - any transport error: try next
                last = exc
        time.sleep(5 * (attempt + 1))  # backoff before the next full round
    raise last if last else RuntimeError("ARPANSA fetch failed")


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
