"""Write data/health.json for the uptime monitor: per-source last run status."""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone


def main(out_dir: str = "data") -> None:
    health: dict = {"status": "ok", "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "sources": {}}
    for name in ("arpansa", "epa", "cams"):
        path = os.path.join(out_dir, f"{name}.jsonl")
        if os.path.exists(path):
            health["sources"][name] = {
                "last_run": datetime.fromtimestamp(os.path.getmtime(path), tz=timezone.utc)
                .strftime("%Y-%m-%dT%H:%M:%SZ"),
                "records_appended": sum(1 for _ in open(path, encoding="utf-8")),
            }
        else:
            health["sources"][name] = {"last_run": None}
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "health.json"), "w", encoding="utf-8") as f:
        json.dump(health, f, indent=2)
    print(json.dumps(health))


if __name__ == "__main__":
    main()
