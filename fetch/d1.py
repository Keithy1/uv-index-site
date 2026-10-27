"""Turn Records into SQL that D1 will accept.

The fetchers run in GitHub Actions and the database is Cloudflare D1, so the
bridge between them is a .sql file applied with `wrangler d1 execute`. That is
deliberately the same path the schema already uses: one way in, one set of
credentials, nothing new to get wrong.

Two properties this file has to guarantee:

  * **Idempotent writes.** Every statement is an upsert keyed on
    (location_id, source, kind, valid_at). Re-running a fetch, or two runs
    overlapping, costs one write per row rather than one row per write. That is
    what keeps us inside D1's free allowance of 100,000 writes a day.

  * **No write for a value we already hold.** The upsert only updates when uvi
    has changed, and each instant is written once per file. On 27 October 2026
    the account passed 100,000 rows written by mid-afternoon UTC: EPA's hourly
    run rewrote the same day's figures 24 times over, the evening CAMS run
    re-fetched the morning's 00Z forecast unchanged, and CAMS's two-run window
    wrote every overlapping hour twice. Every write also costs a second one in
    the readings_window index.

  * **No string injection.** Values are quoted here rather than interpolated
    trustingly. Location ids and source names come from our own tables, but a
    numeric field arriving as text from a feed would otherwise produce SQL that
    is silently wrong instead of loudly broken.
"""
from __future__ import annotations

import os
from datetime import datetime

from .common import Record

# wrangler reads the whole file into memory and D1 limits how much one call
# may carry, so a large fetch is split across several files.
STATEMENTS_PER_FILE = 2000


def quote(value: str) -> str:
    """Single-quote a string for SQLite, doubling any embedded quote."""
    return "'" + str(value).replace("'", "''") + "'"


def _iso(value: datetime | None) -> str:
    return quote(value.strftime("%Y-%m-%dT%H:%M:%SZ")) if value else "NULL"


def _number(value) -> str:
    """A UV value must be a number in SQL, not a quoted string."""
    number = float(value)
    if number != number or number in (float("inf"), float("-inf")):
        raise ValueError(f"refusing to write non-finite value {value!r}")
    return repr(round(number, 3))


def newest_per_instant(records: list[Record]) -> list[Record]:
    """One record per (location, source, kind, instant): the latest issued.

    CAMS is requested for yesterday's run and today's, so most instants arrive
    twice. Both would be written, and the later statement in the file would win
    -- by accident of order, at the cost of a write each.
    """
    best: dict[tuple, Record] = {}
    for r in records:
        if r.kind == "forecast_daily":
            continue
        key = (r.location, r.source, r.kind, r.valid_at)
        held = best.get(key)
        if held is None or (r.issued_at or datetime.min.replace(tzinfo=r.valid_at.tzinfo)) >= (
            held.issued_at or datetime.min.replace(tzinfo=r.valid_at.tzinfo)
        ):
            best[key] = r
    keep = {id(r) for r in best.values()}
    return [r for r in records if r.kind == "forecast_daily" or id(r) in keep]


def statements(records: list[Record]) -> list[str]:
    """One upsert per record, plus one per clear-sky twin where present."""
    out: list[str] = []
    for r in newest_per_instant(records):
        if r.kind == "forecast_daily":
            out.append(daily_statement(r))
            continue
        rows = [(r.kind, r.uvi)]
        clear = (r.extra or {}).get("clear_sky_uvi")
        if clear is not None and r.kind == "forecast":
            # The clear-sky series is its own kind rather than a column: it is
            # a different forecast, and the sun-protection window is computed
            # from it on purpose.
            rows.append(("forecast_clear", clear))

        for kind, uvi in rows:
            out.append(
                "INSERT INTO readings "
                "(location_id, source, kind, valid_at, uvi, issued_at, fetched_at) VALUES ("
                f"{quote(r.location)}, {quote(r.source)}, {quote(kind)}, "
                f"{_iso(r.valid_at)}, {_number(uvi)}, {_iso(r.issued_at)}, {_iso(r.fetched_at)}"
                ") ON CONFLICT (location_id, source, kind, valid_at) DO UPDATE SET "
                "uvi = excluded.uvi, issued_at = excluded.issued_at, "
                "fetched_at = excluded.fetched_at "
                # Unchanged: no write at all. issued_at and fetched_at go stale
                # on such a row, which nothing reads for freshness --
                # source_health records when a source last delivered.
                "WHERE readings.uvi IS NOT excluded.uvi;"
            )
    return out


def health_statement(source: str, ok: bool, count: int, error: str | None, now: datetime) -> str:
    stamp = _iso(now)
    return (
        "INSERT INTO source_health "
        "(source, last_ok_at, last_attempt_at, last_error, records_last_run) VALUES ("
        f"{quote(source)}, {stamp if ok else 'NULL'}, {stamp}, "
        f"{quote(error) if error else 'NULL'}, {int(count)}"
        ") ON CONFLICT (source) DO UPDATE SET "
        "last_ok_at = COALESCE(excluded.last_ok_at, source_health.last_ok_at), "
        "last_attempt_at = excluded.last_attempt_at, "
        "last_error = excluded.last_error, "
        "records_last_run = excluded.records_last_run;"
    )


def write_sql(lines: list[str], out_dir: str, prefix: str) -> list[str]:
    """Write the statements out, split into files wrangler can swallow."""
    os.makedirs(out_dir, exist_ok=True)
    paths: list[str] = []
    for index in range(0, len(lines), STATEMENTS_PER_FILE):
        chunk = lines[index : index + STATEMENTS_PER_FILE]
        path = os.path.join(out_dir, f"{prefix}-{index // STATEMENTS_PER_FILE:03d}.sql")
        with open(path, "w", encoding="utf8") as f:
            f.write("\n".join(chunk) + "\n")
        paths.append(path)
    return paths


def daily_statement(r: Record) -> str:
    """A per-day summary row: the peak and the alert flag, not an hourly value.

    Kept apart from `readings` because it is a different kind of fact. Writing
    it into `readings` as kind "forecast" collided with the hourly row at the
    same instant and one silently overwrote the other.
    """
    extra = r.extra or {}
    local_date = extra.get("local_date")
    if not local_date:
        raise ValueError(f"daily record for {r.location} has no local_date")
    alert = 1 if str(extra.get("alert", "0")).strip() not in ("", "0") else 0
    return (
        "INSERT INTO daily "
        "(location_id, local_date, source, peak_uvi, peak_at, alert, issued_at, fetched_at) "
        f"VALUES ({quote(r.location)}, {quote(local_date)}, {quote(r.source)}, "
        f"{_number(r.uvi)}, NULL, {alert}, {_iso(r.issued_at)}, {_iso(r.fetched_at)}) "
        "ON CONFLICT (location_id, local_date, source) DO UPDATE SET "
        "peak_uvi = excluded.peak_uvi, alert = excluded.alert, "
        "issued_at = excluded.issued_at, fetched_at = excluded.fetched_at "
        # EPA repeats the same day's peak every hour; as for readings, an
        # unchanged row costs no write.
        "WHERE daily.peak_uvi IS NOT excluded.peak_uvi OR daily.alert IS NOT excluded.alert;"
    )
