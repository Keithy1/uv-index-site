# uvatlas — UV Index site (AU + US)

Live UV index for Australia and the United States: measured readings (ARPANSA) and
forecasts (EPA, CAMS), server-generated static pages served from Cloudflare at
**uvatlas.com** for **$0/month** (free tiers only; secrets never touch this repo).

## How it works

```
free data sources            GitHub Actions (scheduled)              Cloudflare free tier
ARPANSA (measured, AU)  ─┐
EPA Envirofacts (US)    ─┼─► Python fetchers (fetch/) ─► JSON/JSONL ─► R2 public bucket
CAMS/ADS (forecast)     ─┘        │                            └─► uvatlas.com (edge cached)
                                  └─► page generator (build/, Phase 2) ─► static HTML
```

- **Scheduler**: GitHub Actions, every 5 minutes (ARPANSA), hourly (EPA), twice daily (CAMS).
- **Storage**: Cloudflare R2 free tier (10 GB, 10M reads/mo, zero egress). No database.
- **Serving**: full HTML pages generated at fetch time → R2 → edge cache.
  SEO rules from the design doc (one URL per page, canonicals, sitemaps) are unchanged.
- **Micro Worker** (free tier) will provide `/api/where` (location hint) and `/api/health`.

## Repository secrets (GitHub → Settings → Secrets and variables → Actions)

| Secret | Purpose |
|---|---|
| `CF_API_TOKEN` | Cloudflare API token (R2 Storage Edit + Workers Scripts Edit + Account Settings Read) |
| `CF_ACCOUNT_ID` | Cloudflare account ID |
| `ADS_API_KEY` | CAMS Atmosphere Data Store key, format `UID:API_KEY` |

None of these are required to build or test; fetchers and tests run without them.

## Layout

- `fetch/` — data adapters (fetch → parse → check → common record) + CLI + tests
- `build/` — page generator (Phase 2)
- `site/` — templates, CSS, SVG map build (Phase 2)
- `docs/site-notes.md` — verified endpoints, licences, architecture notes
- `.github/workflows/fetch-and-publish.yml` — scheduled fetch + publish

## Develop

```sh
python -m unittest discover -s fetch/tests -v   # all adapter tests
python fetch/main.py --source arpansa --out data   # one-off fetch
```

Data is never committed to git (`.gitignore`); it flows straight to R2.
