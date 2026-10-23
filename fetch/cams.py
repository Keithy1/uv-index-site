"""CAMS global UV index forecast adapter (forecast feed for AU, backup for US).

Dataset: cams-global-atmospheric-composition-forecasts (Atmosphere Data Store).
Variables (per ECMWF forum + GRIB param DB):
- uvbed   214002  UV biologically effective dose RATE, W/m2 (cloud-adjusted)
- uvbedcs 214003  clear-sky twin, W/m2
UV index = rate / 0.025 W/m2 = rate * 40 (WHO definition, instantaneous).
Licence: free, commercial use OK; credit line in docs/site-notes.md.

The ADS HTTP transport is implemented per the long-standing ADS/CDS retrieve API;
it is validated against the live API at first deploy (needs Keith's ADS_API_KEY,
format "UID:API_KEY"). Until then `run()` raises; unit tests cover the payload
shape and the UVI conversion, which are the science-critical parts.
"""
from __future__ import annotations

import base64
import json
import os
import urllib.request
from datetime import datetime, timezone

from .common import Record, check_uvi, utc_now

ADS_URL = "https://ads.atmosphere.copernicus.eu/api"
DATASET = "cams-global-atmospheric-composition-forecasts"
UA = {"User-Agent": "Mozilla/5.0 (compatible; uvatlas-fetcher/1.0)"}

# Launch locations needing a CAMS forecast: 13 AU cities (+ later: US as backup).
AU_STATIONS: dict[str, tuple[float, float, str]] = {
    "au-adl": (-34.93, 138.60, "Australia/Adelaide"),      # Adelaide
    "au-ali": (-23.70, 133.88, "Australia/Darwin"),        # Alice Springs (NT time)
    "au-bri": (-27.47, 153.03, "Australia/Brisbane"),      # Brisbane
    "au-can": (-35.28, 149.13, "Australia/Sydney"),        # Canberra
    "au-dar": (-12.46, 130.84, "Australia/Darwin"),        # Darwin
    "au-eme": (-23.53, 148.16, "Australia/Brisbane"),      # Emerald (Qld time)
    "au-gld": (-28.02, 153.40, "Australia/Brisbane"),      # Gold Coast
    "au-hob": (-42.99, 147.29, "Australia/Hobart"),        # Hobart (Kingston stn)
    "au-mel": (-37.81, 144.96, "Australia/Melbourne"),     # Melbourne
    "au-new": (-32.93, 151.78, "Australia/Sydney"),        # Newcastle
    "au-per": (-31.95, 115.86, "Australia/Perth"),         # Perth
    "au-syd": (-33.87, 151.21, "Australia/Sydney"),        # Sydney
    "au-tow": (-19.26, 146.82, "Australia/Brisbane"),      # Townsville (Qld)
}


def uvi_from_uvbed(rate_w_m2: float) -> float:
    """WHO UVI from CAMS uvbed dose rate (W/m2): divide by 0.025, i.e. * 40."""
    return rate_w_m2 * 40.0


def request_payload(date: str, run_time: str, area: list[float], lead_hours: int = 120) -> dict:
    """Standard ADS request for one 0.4-deg area subset, 1-hourly uvbed fields."""
    return {
        "dataset": DATASET,
        "request": {
            "type": ["forecast"],
            "date": [date],                    # YYYY-MM-DD
            "time": [run_time],                # "00:00" | "12:00"
            "leadtime_hour": [str(h) for h in range(lead_hours + 1)],
            "variable": ["uvbed", "uvbedcs"],
            "area": area,                      # [N, W, S, E]
            "format": "netcdf",
        },
    }


def area_for(stations: list[str]) -> list[float]:
    """Bounding box (with margin) around the given AU station coordinates."""
    pts = [AU_STATIONS[s][:2] for s in stations]
    lats = [p[0] for p in pts]
    lons = [p[1] for p in pts]
    return [round(max(lats) + 2, 2), round(min(lons) - 2, 2),
            round(min(lats) - 2, 2), round(max(lons) + 2, 2)]


def _auth_header() -> dict[str, str]:
    key = os.environ.get("ADS_API_KEY", "")
    if not key:
        raise RuntimeError("ADS_API_KEY is not set (format UID:API_KEY)")
    token = base64.b64encode(key.encode()).decode()
    return {"Authorization": f"Basic {token}"}


def fetch(payload: dict) -> bytes:
    """POST the retrieve request to the ADS API. Validated at first deploy."""
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{ADS_URL}/retrieve/v1/processes/{DATASET}/execute",
        data=body, headers={**UA, **_auth_header(), "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        return resp.read()


def run() -> list[Record]:
    """Phase 1: transport requires the live ADS key; raise until validated."""
    raise RuntimeError(
        "CAMS fetch is not validated yet: it needs the live ADS_API_KEY, which is "
        "only available at deploy time. See docs/site-notes.md."
    )
