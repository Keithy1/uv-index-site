"""CLI: run the adapters and write JSONL history + a latest snapshot.

Usage:
    python fetch/main.py --source arpansa --out data
    python fetch/main.py --source all --out data
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

from . import arpansa, cams, epa

SOURCES = {"arpansa": arpansa.run, "epa": epa.run, "cams": cams.run}


def write_records(out_dir: str, source: str, records: list) -> int:
    if not records:
        return 0
    os.makedirs(out_dir, exist_ok=True)
    history = os.path.join(out_dir, f"{source}.jsonl")
    with open(history, "a", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r.to_json()) + "\n")
    return len(records)


def write_latest(out_dir: str, by_source: dict[str, list]) -> None:
    os.makedirs(out_dir, exist_ok=True)  # may not exist yet if every source failed
    snapshot = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sources": {
            name: [r.to_json() for r in records]
            for name, records in by_source.items()
        },
    }
    with open(os.path.join(out_dir, "latest.json"), "w", encoding="utf-8") as f:
        json.dump(snapshot, f)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="uvatlas data fetchers")
    parser.add_argument("--source", choices=sorted(SOURCES) + ["all"], default="all")
    parser.add_argument("--out", default="data")
    args = parser.parse_args(argv)

    sources = sorted(SOURCES) if args.source == "all" else [args.source]
    by_source: dict[str, list] = {}
    for name in sources:
        try:
            records = SOURCES[name]()
        except Exception as exc:  # keep last good data; report and continue
            print(f"[{name}] FAILED: {exc}", file=sys.stderr)
            continue
        n = write_records(args.out, name, records)
        by_source[name] = records
        print(f"[{name}] {n} records -> {args.out}/{name}.jsonl")

    write_latest(args.out, by_source)
    print(f"latest.json written to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
