"""Common record and UV band rules shared by all adapters.

Design-doc rules encoded here:
- every source outputs one common record shape;
- readings are shown as published (one decimal) and the band uses the value
  rounded to the nearest whole number (2.4 -> Low, 2.5 -> Moderate);
- a UV value outside 0..20 fails the check and is discarded;
- times are stored in UTC and converted per city IANA zone at render time.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, asdict
from datetime import datetime, timezone

# WHO UV index bands: (name, inclusive upper bound). 11+ is Extreme.
BANDS = [
    ("Low", 2),
    ("Moderate", 5),
    ("High", 7),
    ("Very High", 10),
    ("Extreme", None),
]


@dataclass
class Record:
    source: str            # "arpansa" | "epa" | "cams"
    kind: str              # "measured" | "forecast"
    location: str          # stable key, e.g. "au-adl", "us-new-york-ny"
    uvi: float
    valid_at: datetime     # UTC, aware
    issued_at: datetime | None = None   # when the source issued the value
    fetched_at: datetime | None = None  # when we fetched it
    extra: dict | None = None           # e.g. {"alert": "1"} for EPA

    def band(self) -> str:
        # Round half UP (2.5 -> Moderate, 10.5 -> Extreme), per design doc.
        # Python's round() is banker's rounding and gets 2.5 and 10.5 wrong.
        n = math.floor(self.uvi + 0.5)
        for name, cap in BANDS:
            if cap is None or n <= cap:
                return name
        return "Extreme"

    def to_json(self) -> dict:
        d = asdict(self)
        for key in ("valid_at", "issued_at", "fetched_at"):
            if d[key] is not None:
                d[key] = d[key].astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        return d


def check_uvi(value: float) -> bool:
    """Adapter check per design doc: UV must lie between 0 and 20."""
    return 0.0 <= value <= 20.0


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
