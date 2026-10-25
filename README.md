# uvatlas

Live UV index for Australia and the United States, at **uvatlas.com**.
Measured readings from ARPANSA, forecasts from EPA and Copernicus CAMS,
server-rendered at the edge for **$0 a month** — the domain is the only cost.

## How it works

```
ARPANSA XML ──► Worker cron (every 5 min) ──┐
                                            ├─► D1 ──► Worker renders HTML ──► edge cache
EPA JSON    ──► GitHub Actions (hourly) ────┤
CAMS netCDF ──► GitHub Actions (2x daily) ──┘
```

The split is forced by Cloudflare's free-plan limits: EPA needs more subrequests
than one invocation allows and CAMS needs netCDF processing, while both are
forecasts and tolerate a late run. ARPANSA stays on the Worker's own cron because
GitHub's scheduler is best-effort and routinely runs tens of minutes late, and a
live measured reading is the one thing that cannot be late.

Pages only ever read from D1, so a broken source can make the data older but
never make a page slow. Everything is full HTML from the server: no client
framework, under 100 KB a page, under 5 KB of JavaScript.

**Read `docs/architecture.md` first.** `CLAUDE.md` has the rules that are easy to
break by accident, and `docs/setup.md` lists the accounts still needed.

## Develop

```sh
npm ci
npm run db:init:local   # apply schema.sql to a local D1
npm run dev             # http://127.0.0.1:8787

npm test                # 46 tests, no network
npm run typecheck
python -m unittest discover -s fetch/tests -t .
```

To run the scheduled handler locally:
`curl http://127.0.0.1:8787/cdn-cgi/handler/scheduled`

## Layout

| Path | What |
|---|---|
| `src/index.tsx` | Worker routes and the cron handler |
| `src/lib/` | Locations registry, UV bands, D1 access |
| `src/sources/` | One adapter per source |
| `src/views/` | Server-rendered templates |
| `fetch/` | Python adapters for sources a Worker cannot run |
| `schema.sql` | D1 schema |

## Attribution

UV observations courtesy of ARPANSA. © Commonwealth of Australia as represented
by the Australian Radiation Protection and Nuclear Safety Agency (ARPANSA).
US forecasts: US Environmental Protection Agency. Forecasts generated using
Copernicus Atmosphere Monitoring Service information.

Not a substitute for medical advice.
