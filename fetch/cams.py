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

Note the two naming systems, both confirmed live on 25 October 2026: the
REQUEST takes the long names above, while the GRIB file that comes back uses the
short names "uvbed" and "uvbedcs". Use each in its own place.

The physics: both variables are dose RATES, and UV index = rate / 0.025 W/m2 =
rate * 40 (WHO definition, instantaneous). The probe got a Sydney peak of UVI
9.0 for 24 October, which is believable for late spring -- but the GRIB carries
NO units metadata, so "W/m2" still rests on the ECMWF forum, not on the file.
Validate against ARPANSA measurements in the same hour before publishing any
forecast.

Licence: free, commercial use allowed; credit line in docs/licences.md.

TRANSPORT IS STILL UNVERIFIED. The form generates `cdsapi` client code rather
than a plain POST, because a retrieve is an asynchronous job that must be polled
and then downloaded. The hand-rolled POST below has never run against the live
API, so `run()` raises. The payload shape and the UVI conversion are unit-tested
because they are the parts that can be checked without a key.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .common import Record, check_uvi, utc_now

ADS_URL = "https://ads.atmosphere.copernicus.eu/api"
DATASET = "cams-global-atmospheric-composition-forecasts"
UA = {"User-Agent": "Mozilla/5.0 (compatible; uvatlas-fetcher/1.0)"}

# Stations come from data/stations.json, the same file src/lib/locations.ts
# reads. They used to be written out separately in each language and they
# drifted: this table keyed three Australian stations au-eme, au-gld and
# au-hob while ARPANSA calls them emd, gco and kin, so those forecasts could
# never join the cities they belonged to.
_STATIONS_PATH = Path(__file__).resolve().parent.parent / "data" / "stations.json"


def _load_stations() -> dict[str, dict]:
    with open(_STATIONS_PATH, encoding="utf8") as f:
        return {s["id"]: s for s in json.load(f)["stations"]}


STATIONS = _load_stations()


def stations_for(country: str) -> dict[str, tuple[float, float, str]]:
    """(lat, lon, IANA zone) per station id, for one country."""
    return {
        sid: (s["lat"], s["lon"], s["tz"])
        for sid, s in STATIONS.items()
        if s["country"] == country
    }


AU_STATIONS = stations_for("au")
US_STATIONS = stations_for("us")

# Australia and the contiguous United States are nearly half the planet apart,
# so one bounding box covering both would download most of the Pacific. Two
# requests, each tight around its own cities, is far less data.
AREAS = {"au": AU_STATIONS, "us": US_STATIONS}


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


def area_for(
    stations: list[str],
    group: dict[str, tuple[float, float, str]] | None = None,
) -> list[float]:
    """Bounding box (with margin) around the given stations' coordinates."""
    group = group if group is not None else AU_STATIONS
    pts = [group[s][:2] for s in stations]
    lats = [p[0] for p in pts]
    lons = [p[1] for p in pts]
    return [round(max(lats) + 2, 2), round(min(lons) - 2, 2),
            round(min(lats) - 2, 2), round(max(lons) + 2, 2)]


def client():
    """An ADS client authenticated from ADS_API_KEY.

    Imported lazily so that the rest of this module -- the payload builder and
    the UVI conversion, which the unit tests cover -- stays importable without
    cdsapi installed.

    A retrieve is an asynchronous job: submit, poll, then download. cdsapi does
    all three, which is why the hand-rolled POST that used to live here was
    replaced rather than fixed. The key is read from the environment and is
    never logged.
    """
    try:
        import cdsapi
    except ImportError as exc:  # pragma: no cover - environment problem
        raise RuntimeError(
            "cdsapi is not installed; see requirements.txt"
        ) from exc

    key = os.environ.get("ADS_API_KEY", "")
    if not key:
        raise RuntimeError("ADS_API_KEY is not set")
    # quiet=True keeps the key out of cdsapi's own startup banner.
    return cdsapi.Client(url=ADS_URL, key=key, quiet=True, progress=False)


def retrieve(request: dict, target: str) -> str:
    """Run one retrieve and write the result to `target`. Returns the path."""
    client().retrieve(DATASET, request, target)
    return target


# Confirmed from the probe download on 25 October 2026:
#   * the file is GRIB edition 1 from ECMWF, read with cfgrib;
#   * uvbed is paramId 214002 and uvbedcs 214003;
#   * GRIB_stepType is "instant", so these are instantaneous RATES, not doses
#     accumulated over the hour. That is what makes UVI = rate * 40 valid;
#   * the grid is regular lat/lon at 0.4 degrees;
#   * missing points carry 3.4028234663852886e+38, which cfgrib turns into NaN.
GRIB_MISSING = 3.4028234663852886e38

# All-sky (cloud-adjusted) is what a visitor should see. The clear-sky twin is
# carried alongside it so a page can say how much cloud is taking off the peak.
ALL_SKY = "uvbed"
CLEAR_SKY = "uvbedcs"


def _is_missing(value: float) -> bool:
    return (
        value != value  # NaN
        or value >= GRIB_MISSING * 0.99
        or value < 0
    )


def flatten_series(valid_time, issued_time, values) -> list[tuple]:
    """Pair every forecast value with its valid instant and its issuing run.

    The file's shape depends on how many dates were requested, which is a trap:

      * one date   -> `time` is a scalar, data is (step, ...), valid_time is (step,)
      * many dates -> `time` is (time,),  data is (time, step, ...), valid_time
                      is (time, step)

    The probe only ever asked for one date, so the second shape was not
    discovered until a 14-day validation run failed on it. Handling both here,
    rather than at the call site, keeps that distinction in one place.

    Returns (valid_at, issued_at, value) triples in file order.
    """
    import numpy as np

    valid = np.asarray(valid_time)
    data = np.asarray(values)
    issued = np.asarray(issued_time)

    if issued.ndim == 0:
        issued_b = np.broadcast_to(issued, valid.shape)
    else:
        # `time` varies along the leading axis of valid_time; give it the same
        # rank so numpy can broadcast it across the step axis.
        shape = (issued.shape[0],) + (1,) * (valid.ndim - 1)
        issued_b = np.broadcast_to(issued.reshape(shape), valid.shape)

    if data.shape[: valid.ndim] != valid.shape:
        raise ValueError(
            f"data shape {data.shape} does not start with valid_time shape {valid.shape}"
        )

    return list(zip(valid.ravel(), issued_b.ravel(), data.reshape(valid.size)))


def parse_grib(
    path: str,
    stations: dict[str, tuple[float, float, str]] | None = None,
    fetched_at: datetime | None = None,
) -> list[Record]:
    """Turn a CAMS GRIB file into forecast Records, one per station per hour.

    Nearest grid point per station: at 0.4 degrees a cell is about 44 km, so the
    nearest point is the right choice for a city, and interpolating between
    cells would invent precision the model does not have.

    `valid_time` is used rather than `time + step` because cfgrib has already
    computed it, and it is unambiguously UTC.

    Where two model runs both cover the same hour, the later run wins: a newer
    forecast of the same instant is strictly better information.
    """
    import xarray as xr

    stations = stations if stations is not None else AU_STATIONS
    fetched = fetched_at or utc_now()
    best: dict[tuple[str, datetime], Record] = {}

    ds = xr.open_dataset(path, engine="cfgrib")
    try:
        if ALL_SKY not in ds.data_vars:
            raise ValueError(
                f"{path} has no {ALL_SKY} variable; found {list(ds.data_vars)}"
            )

        for key, (lat, lon, _tz) in stations.items():
            point = ds.sel(latitude=lat, longitude=lon, method="nearest")

            all_sky = flatten_series(
                point["valid_time"].values, point["time"].values, point[ALL_SKY].values
            )
            if CLEAR_SKY in ds.data_vars:
                clear_vals = [
                    v for _va, _is, v in flatten_series(
                        point["valid_time"].values,
                        point["time"].values,
                        point[CLEAR_SKY].values,
                    )
                ]
            else:
                clear_vals = [float("nan")] * len(all_sky)

            for (valid_raw, issued_raw, rate), rate_cs in zip(all_sky, clear_vals):
                rate = float(rate)
                if _is_missing(rate):
                    continue
                uvi = uvi_from_uvbed(rate)
                if not check_uvi(uvi):
                    continue

                extra = None
                rate_cs = float(rate_cs)
                if not _is_missing(rate_cs):
                    clear_uvi = uvi_from_uvbed(rate_cs)
                    if check_uvi(clear_uvi):
                        extra = {"clear_sky_uvi": round(clear_uvi, 2)}

                valid_at = _to_utc(valid_raw)
                issued_at = _to_utc(issued_raw)
                slot = (key, valid_at)
                previous = best.get(slot)
                if previous is not None and previous.issued_at is not None:
                    if previous.issued_at >= issued_at:
                        continue
                best[slot] = Record(
                    source="cams",
                    kind="forecast",
                    location=key,
                    uvi=round(uvi, 2),
                    valid_at=valid_at,
                    issued_at=issued_at,
                    fetched_at=fetched,
                    extra=extra,
                )
    finally:
        ds.close()

    return [best[k] for k in sorted(best, key=lambda k: (k[0], k[1]))]


def _to_utc(value) -> datetime:
    """numpy datetime64 -> timezone-aware UTC datetime."""
    import numpy as np

    stamp = np.datetime64(value, "s").astype("int64")
    return datetime.fromtimestamp(int(stamp), tz=timezone.utc)


def run(stations: dict[str, tuple[float, float, str]] | None = None) -> list[Record]:
    """Fetch the forecast covering today and tomorrow, everywhere we publish.

    Two model runs are requested, yesterday's 00Z and today's, each with 72
    lead hours. Both numbers were arrived at by getting them wrong first.

    24 lead hours covers 00:00-23:00 UTC, which in Perth is 08:00 to 07:00 the
    next morning -- so a city page had no forecast for its own early morning
    and the sun-protection window started hours late. Yesterday's run fixes
    that end, and where the two overlap `parse_grib` keeps the later one.

    47 then looked sufficient, and was not: it reaches only to the day after
    the run at 23:00 UTC, which for a UTC+10 city is 09:00 on its tomorrow. The
    tomorrow figures duly reported Brisbane peaking at 6.1 at 9 am, because
    9 am was the last hour that existed.

    72 covered tomorrow only while the fetch was recent. GitHub dropped the
    scheduled runs for sixteen hours, the eastern Australian cities rolled past
    midnight, and their tomorrow became a day the data no longer reached --
    three of thirteen cities kept a figure. 96 hours buys roughly a day and a
    half of slack, so a missed run degrades the forecast horizon instead of
    emptying a column.

    Both countries are fetched. The United States needs CAMS as well as EPA
    because EPA publishes today only -- there is no tomorrow in its feed at
    all -- so /us/tomorrow/ has no other source.

    Roughly 5 MB per area per fetch, twice a day, in GitHub Actions. The Worker
    never touches this: it has 10 ms of CPU and no GRIB reader.
    """
    today = datetime.now(timezone.utc).date()
    yesterday = today - timedelta(days=1)

    # An explicit set overrides the per-country split (used by the probe).
    areas = {"custom": stations} if stations is not None else AREAS

    records: list[Record] = []
    failures: list[str] = []
    for name, group in areas.items():
        if not group:
            continue
        payload = request_payload(str(today), "00:00", area_for(list(group), group), lead_hours=96)
        payload["request"]["date"] = [f"{yesterday}/{today}"]
        target = f"cams-{name}.grib"
        try:
            retrieve(payload["request"], target)
            records.extend(parse_grib(target, group))
        except Exception as exc:  # noqa: BLE001 - one area must not lose the other
            failures.append(f"{name}: {type(exc).__name__}: {exc}")

    if failures and not records:
        raise RuntimeError("; ".join(failures))
    if failures:
        print(f"[cams] partial failure: {'; '.join(failures)}", flush=True)
    return records
