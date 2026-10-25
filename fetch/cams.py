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

import os
from datetime import datetime, timedelta, timezone

from .common import Record, check_uvi, utc_now

ADS_URL = "https://ads.atmosphere.copernicus.eu/api"
DATASET = "cams-global-atmospheric-composition-forecasts"
UA = {"User-Agent": "Mozilla/5.0 (compatible; uvatlas-fetcher/1.0)"}

# Launch locations needing a CAMS forecast: ARPANSA's 13 published stations.
# Coordinates are the INSTRUMENT's own position, taken from the Lat/Lon columns
# of ARPANSA's historical CSVs, not the city centre. Sydney's station is 20 km
# south of the CBD and Melbourne's 14 km north-east; at a 0.4 degree grid that
# can land in a different cell, and the whole point of validation is that the
# forecast and the measurement describe the same place.
AU_STATIONS: dict[str, tuple[float, float, str]] = {
    "au-adl": (-34.95, 138.52, "Australia/Adelaide"),      # Adelaide
    "au-ali": (-23.8, 133.89, "Australia/Darwin"),        # Alice Springs (NT time)
    "au-bri": (-27.45, 153.03, "Australia/Brisbane"),      # Brisbane
    "au-can": (-35.31, 149.2, "Australia/Sydney"),        # Canberra
    "au-dar": (-12.43, 130.89, "Australia/Darwin"),        # Darwin
    "au-emd": (-23.53, 148.16, "Australia/Brisbane"),      # Emerald (Qld time)
    "au-gco": (-28.0, 153.37, "Australia/Brisbane"),      # Gold Coast
    "au-kin": (-42.99, 147.29, "Australia/Hobart"),        # Hobart (Kingston stn)
    "au-mel": (-37.73, 145.1, "Australia/Melbourne"),     # Melbourne
    "au-new": (-32.9, 151.72, "Australia/Sydney"),        # Newcastle
    "au-per": (-31.93, 115.98, "Australia/Perth"),         # Perth
    "au-syd": (-34.04, 151.1, "Australia/Sydney"),        # Sydney
    "au-tow": (-19.33, 146.76, "Australia/Brisbane"),      # Townsville (Qld)
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

    Two model runs are requested, yesterday's 00Z and today's, each with 47
    lead hours. That is deliberate and not belt-and-braces:

    A single 00Z run with 24 lead hours covers 00:00-23:00 UTC, which in Perth
    is 08:00 to 07:00 the next morning -- so a city page would have no forecast
    for its own early morning, and the sun-protection window would start hours
    late. Yesterday's run reaches back far enough to cover that, and where the
    two overlap `parse_grib` keeps the later one, which is the better forecast.

    Roughly 5 MB per fetch, twice a day, in GitHub Actions. The Worker never
    touches this: it has 10 ms of CPU and no GRIB reader.
    """
    stations = stations if stations is not None else AU_STATIONS
    today = datetime.now(timezone.utc).date()
    yesterday = today - timedelta(days=1)

    payload = request_payload(str(today), "00:00", area_for(list(stations)), lead_hours=47)
    payload["request"]["date"] = [f"{yesterday}/{today}"]

    target = "cams.grib"
    retrieve(payload["request"], target)
    return parse_grib(target, stations)
