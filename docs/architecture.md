# Architecture and decisions

Updated 25 October 2026. This supersedes the "Zero-cost architecture" section of
`site-notes.md`, which is kept as the research record.

## Decisions taken 25 October 2026

| Decision | Choice | Why |
|---|---|---|
| Monetisation | Ads later; build ad-ready, ship with ads off | Decides the licence test every source must pass |
| Forecast feed | **Copernicus CAMS** | Free *and* licensed for commercial use. Open-Meteo's free tier is non-commercial only, so ads would breach it |
| Serving | Worker renders from D1, edge-cached | Always fresh, no rebuild storm, and no dependence on GitHub's scheduler |
| Launch date | No fixed date | Correctness over the December peak; CAMS's UV-index derivation needs validating against real ARPANSA readings before anyone trusts it |
| AI discoverability | Conventional SEO only | No `llms.txt`, public API or MCP endpoint |

## Why the work is split across two runtimes

Both halves are free. The split is forced by two Cloudflare free-plan limits and
one GitHub behaviour.

**Cloudflare Worker (free plan) — ARPANSA and all page rendering.**
Cron Triggers *are* available on the free plan: 5 per account, 10 ms CPU per run,
and time spent waiting on `fetch` or D1 does not count toward it. Parsing
ARPANSA's 4.4 KB XML and rendering a page fit comfortably. Crucially, the Worker's
scheduler is reliable, so "measured 4 minutes ago" is a promise we can keep.

**GitHub Actions (free, unlimited on a public repo) — EPA and CAMS.**
Two things cannot move into the Worker:

- EPA needs about 100 subrequests per run (50 cities × hourly + daily) and the
  free-plan ceiling is 50 per invocation.
- CAMS ships GRIB/netCDF that needs real numerical processing.

Both are *forecasts*, so a run arriving late changes nothing a visitor sees.

**Why ARPANSA is not in Actions**, which is what the earlier plan assumed: GitHub's
`schedule` trigger is explicitly best-effort. Reported delays run 3–10 minutes
routinely and far longer under load; one published benchmark measured a median of
26 minutes late, and a project polling on `*/5` observed a 30-minute gap with no
runs at all. A UV site whose whole Australian proposition is a live measured
reading cannot be built on that.

## Data flow

```
ARPANSA XML ──► Worker cron (every 5 min) ──┐
                                            ├─► D1 ──► Worker renders HTML ──► edge cache
EPA JSON    ──► GitHub Actions (hourly) ────┤                                   5 min AU
CAMS netCDF ──► GitHub Actions (2x daily) ──┘                                   60 min US
```

Pages only ever read from D1, so a slow or broken source can never slow a page
down — it can only make the data older, which the page then says.

## Storage

D1 (SQLite), schema in `schema.sql`. Four tables: `readings`, `daily`,
`monthly_normals`, `source_health`.

There is deliberately **no `locations` table**. The registry of cities lives in
`src/lib/locations.ts`: 63 rows that change a few times a year do not need a
database, and keeping a second copy in D1 would create two things to keep in step.

Writes are idempotent upserts, so re-fetching the same minute costs one write
rather than one row. Current volume is roughly 4,600 ARPANSA writes a day against
D1's free allowance of 100,000.

## What ARPANSA's feed actually does

Two findings from the live feed that the design document did not anticipate, both
now encoded in `src/sources/arpansa.ts`:

1. **`<status>` is not a pass/fail flag.** Besides `"ok"` it carries self-reported
   lateness such as `"174 Mins Slow"`. At 15:52 UTC on 25 October 2026, six of the
   thirteen published stations — Sydney, Melbourne, Brisbane, Adelaide, Canberra
   and Newcastle — reported exactly that, simultaneously, while their
   `<utcdatetime>` sat about three hours behind the other seven.

   Rejecting non-`"ok"` rows, as the first implementation did, would therefore have
   silently dropped the four largest Australian cities on an ordinary day. A late
   reading is still a real measurement and the feed states which instant it
   belongs to, so it is stored as published; whether it may be shown as the
   reading *now* is decided by its age (20 minutes, in `lib/store.ts`), which is
   the rule the design document already specified for stale data.

2. **The feed is served with a UTF-8 BOM**, which is not valid XML content and
   must be stripped before parsing.

A fixture of that feed is kept at
`test/fixtures/arpansa-uvvalues-slow-stations.xml` so the behaviour stays pinned.

## What is built

- D1 schema, and the storage layer including the staleness rule.
- The location registry: ARPANSA's 13 published stations and 50 US cities.
- WHO bands with the half-up rounding rule.
- The ARPANSA adapter, in TypeScript, with 46 tests covering band edges, the
  time-zone conversions, malformed feeds and the late-station case.
- The Worker: cron, `/api/health`, `/api/where`, `robots.txt`, and a plain preview
  page that proves ARPANSA → cron → D1 → rendered HTML end to end.
- CI: typecheck, both test suites, and a workerd bundle check.

## What is not built

- **Writing EPA and CAMS records into D1.** The Python fetchers produce the
  records but nothing yet carries them into the database (it needs the D1 HTTP
  API and a Cloudflare token). Until that lands, `fetch-epa-cams.yml` is
  manual-only and uploads an artifact instead.
- **CAMS transport and its UV-index derivation.** `uvbed` is a dose rate in W/m²
  and UVI = rate × 40, which is unit-tested, but the ADS request has never run
  against the live API, and the derived index must be validated against ARPANSA
  measurements in the same hour before it is published anywhere.
- All launch page templates: city, country, tomorrow, the guide, the world map,
  sitemaps, structured data.
- Monthly normals from ARPANSA's historical datasets.
- Deployment: no D1 database created, no Cloudflare token, no custom domain
  binding. See `setup.md`.
