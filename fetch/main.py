"""CLI: run the adapters and write SQL for D1.

These are the sources that cannot run inside a Cloudflare Worker on the free
plan: EPA needs ~100 subrequests (the limit is 50) and CAMS needs GRIB
processing. ARPANSA is fetched by the Worker's own cron instead, so it is
deliberately absent here -- see src/sources/arpansa.ts.

Output is .sql files applied with `wrangler d1 execute`, the same path the
schema uses. A source that fails is reported and skipped: its last good data
stays in the database and `source_health` records the failure, so a broken feed
makes the site stale rather than empty.

    python -m fetch.main --source epa --out sql
    python -m fetch.main --source all --out sql
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone

from . import cams, d1, epa

SOURCES = {"epa": epa.run, "cams": cams.run}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="uvatlas data fetchers")
    parser.add_argument("--source", choices=sorted(SOURCES) + ["all"], default="all")
    parser.add_argument("--out", default="sql")
    args = parser.parse_args(argv)

    names = sorted(SOURCES) if args.source == "all" else [args.source]
    now = datetime.now(timezone.utc)
    failures = 0

    for name in names:
        statements: list[str] = []
        try:
            records = SOURCES[name]()
        except Exception as exc:  # noqa: BLE001 - one bad source must not stop the rest
            print(f"[{name}] FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
            # Still record the failure, so /api/health can report it rather
            # than the page quietly serving yesterday's forecast as today's.
            statements.append(d1.health_statement(name, False, 0, str(exc)[:400], now))
            failures += 1
        else:
            statements = d1.statements(records)
            issued = [r.issued_at for r in records if r.issued_at is not None]
            newest = max(issued) if issued else None
            statements.append(d1.health_statement(name, bool(records), len(records), None, now, newest))
            print(f"[{name}] {len(records)} records -> {len(statements)} statements")

        paths = d1.write_sql(statements, args.out, name)
        for path in paths:
            print(f"[{name}] wrote {path}")

    # A failure is reported in the exit code so the workflow goes red, but the
    # SQL that did succeed has already been written and should still be applied.
    return 1 if failures == len(names) else 0


if __name__ == "__main__":
    raise SystemExit(main())
