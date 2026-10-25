"""CAMS global UV index forecast adapter (forecast feed for AU, backup for US).

Dataset: cams-global-atmospheric-composition-forecasts (Atmosphere Data Store).

Variable names and request keys below were read off the ADS download form's own
"Corresponding API request" panel on 25 October 2026, which is the only
authoritative source for them. Three things there differ from the GRIB parameter
database, and each would have failed the request outright:

  * the API takes "uv_biologically_effective_dose" and
    "uv_biologically_effective_dose_clear_sky", not the short GRIB names
    "uvbed" (214002) and "uvbedcs" (214003);
  * the format key is "data_format", not "format";
  * its netCDF value is "netcdf_zip", not "netcdf". netCDF is also marked
    experimental on the form, so GRIB is the safer default.

The physics is unchanged: both variables are dose RATES in W/m2, and
UV index = rate / 0.025 W/m2 = rate * 40 (WHO definition, instantaneous).

Licence: free, commercial use allowed; credit line in docs/licences.md.

TRANSPORT IS STILL UNVERIFIED. The form generates `cdsapi` client code rather
than a plain POST, because a retrieve is an asynchronous job that must be polled
and then downloaded. The hand-rolled POST below has never run against the live
API, so `run()` raises. The payload shape and the UVI conversion are unit-tested
because they are the parts that can be checked without a key.
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
    "au-emd": (-23.53, 148.16, "Australia/Brisbane"),      # Emerald (Qld time)
    "au-gco": (-28.02, 153.40, "Australia/Brisbane"),      # Gold Coast
    "au-kin": (-42.98, 147.30, "Australia/Hobart"),        # Hobart (Kingston stn)
    "au-mel": (-37.81, 144.96, "Australia/Melbourne"),     # Melbourne
    "au-new": (-32.93, 151.78, "Australia/Sydney"),        # Newcastle
    "au-per": (-31.95, 115.86, "Australia/Perth"),         # Perth
    "au-syd": (-33.87, 151.21, "Australia/Sydney"),        # Sydney
    "au-tow": (-19.26, 146.82, "Australia/Brisbane"),      # Townsville (Qld)
}


def uvi_from_uvbed(rate_w_m2: float) -> float:
    """WHO UVI from CAMS uvbed dose rate (W/m2): divide by 0.025, i.e. * 40."""
    return rate_w_m2 * 40.0


# The two UV variables, named as the ADS API expects them.
VARIABLES = [
    "uv_biologically_effective_dose",
    "uv_biologically_effective_dose_clear_sky",
]


def request_payload(date: str, run_time: str, area: list[float], lead_hours: int = 120) -> dict:
    """Standard ADS request for one area subset, 1-hourly UV dose-rate fields.

    `date` is given as the "start/end" range the form emits even for a single
    day ("2026-10-25/2026-10-25"); a bare date is not the documented shape.
    """
    return {
        "dataset": DATASET,
        "request": {
            "type": ["forecast"],
            "date": [f"{date}/{date}"],        # YYYY-MM-DD/YYYY-MM-DD
            "time": [run_time],                # "00:00" | "12:00"
            "leadtime_hour": [str(h) for h in range(lead_hours + 1)],
            "variable": list(VARIABLES),
            "area": area,                      # [N, W, S, E]
            "data_format": "grib",
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
    """Not usable yet: the transport has never run against the live ADS API.

    The payload is now correct (read off the ADS form), but a retrieve is an
    asynchronous job and this module does not yet poll for it or download the
    result. Switching to the official `cdsapi` client is the likely fix once a
    key is available to test with. See docs/architecture.md.
    """
    raise RuntimeError(
        "CAMS fetch is not validated yet: the payload is correct but the "
        "asynchronous retrieve transport is unimplemented. See docs/architecture.md."
    )
