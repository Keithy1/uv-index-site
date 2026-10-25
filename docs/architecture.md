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

**Why ARPANSA is not in Actions**, which is what the earlier plan assumed:
GitHub's `schedule` trigger is explicitly best-effort, and we have measured
exactly how best-effort on this very repository.

The original `fetch-and-publish` workflow ran ARPANSA on `*/5 * * * *` from
23 to 25 October 2026. Over a 43.9-hour window it should have fired 527 times.
It fired **14**:

| | Scheduled | Actual |
|---|---|---|
| Runs in 43.9 hours | 527 | 14 (**2.7%**) |
| Mean gap | 5 min | **203 min** |
| Shortest gap ever achieved | 5 min | 116 min |
| Longest gap | 5 min | 292 min |

Twelve of the thirteen gaps exceeded two hours. The feed was never fresher than
roughly two hours old, and was routinely close to five hours stale — against a
staleness rule that refuses to present anything older than 20 minutes as current.
Australia would have shown "Live reading delayed" essentially always.

This is far worse than the published benchmarks suggested (a median of 26 minutes
late), and it is worth knowing why: GitHub de-prioritises high-frequency crons,
and a new repository with little activity sits at the back of that queue. A UV
site whose whole Australian proposition is a live measured reading cannot be
built on this, at any cadence.

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

## Does the CAMS forecast agree with reality?

Validated 25 October 2026 against ARPANSA's measured history: **all 13 stations,
two seasons** (8–21 January and 14–27 October 2025), 3,516 paired daylight hours.
Run 40217881221.

### Forecast accuracy

| | January (summer) | October (spring) | Pooled |
|---|---|---|---|
| Daylight hours | 1,845 | 1,671 | 3,516 |
| Mean bias | +0.27 | +0.52 | **+0.39 UVI** |
| Mean abs error | 1.32 | 1.08 | **1.20 UVI** |
| Within 1.0 UVI | 54% | 61% | **57%** |

Best stations are Adelaide, Melbourne, Perth, Newcastle and Sydney (MAE
0.82–0.96, ~70% within 1.0). Worst are the tropics and the subtropical east
coast in summer — Darwin 1.87, Gold Coast 1.98, Brisbane 1.85 — which is
convective cloud the model cannot place, not a UV failure.

These are the figures the methods page should quote.

### The model reads about 7% high — and no correction should be applied

Fitting measured UVI against the raw dose rate on cloudless hours, against the
40 that `UVI = rate / 0.025 W/m²` assumes. Everything turns on how "cloudless"
is decided, so it is now decided two ways:

| Cloudless judged by | Hours | Pooled multiplier | Implied CAMS bias |
|---|---|---|---|
| CAMS's own clear-sky field | 1,256 | 35.3 | +13% |
| **The measured curve's smoothness** | 795 | **37.3** | **+7%** |

The second is the trustworthy one. The first lets the model judge its own
cloud, and it turns out that mattered: the independent filter is stricter
(795 hours rather than 1,256) and moves the answer *up* at essentially every
station, by about 2.0 consistently.

**So roughly half of the apparent 13% bias was an artefact of the filter**, not
a property of the model. CAMS's clear-sky field was admitting hours that were
not actually clear, and those contaminated hours dragged the fit down.

Per-station, under the honest filter:

| | CAMS filter | Measured filter |
|---|---|---|
| Mean | 35.6 | **38.3** |
| Range | 32.6–39.6 | **33.1–44.5** |
| Standard deviation | 1.9 | **2.8** |
| Stations at or above 40 | 0 of 24 | **7 of 23** |

This is the decisive change. Under the CAMS filter every station sat below 40
with a tight spread, which is what made a single correction factor look
defensible. Under honest cloud detection the spread nearly doubles and seven
stations land *at or above* 40 — so a global ×0.88 would have made those seven
worse, not better.

**Conclusion: keep ×40, apply no correction.** It is the WHO definition, the
residual ~7% is within the station-to-station scatter, and the earlier plan to
divide it out rested on a filter that was quietly marking its own homework.
Publish the measured accuracy instead.

### How cloudless hours are detected

Over an hour a cloudless UV curve is nearly a straight line — an hour is a
small slice of a slow bell — while cloud puts dips and spikes through it. So
`arpansa_history.hourly_clearness` fits a least-squares line through the minute
readings around each hour and reports mean absolute deviation relative to the
level. Scale-free, so it behaves the same at UVI 3 and UVI 14, and it involves
no model at all.

Calibrated on Sydney 2025 (2,655 scored hours): the distribution has a knee at
0.01, where p25 is 0.0093 and p50 jumps to 0.055. That threshold selects 26% of
daylight hours. Checked against days whose cloud was already known:

| Day | Measured peak | Clearness |
|---|---|---|
| 19 Oct, clear | 8.5 | 0.023 |
| 24 Oct | 8.4 | 0.061 |
| 20 Oct, cloudy | 6.2 | 0.068 |
| 26 Oct, heavy cloud | 1.9 | 0.145 |

### Station coordinates corrected

Validation turned up a confound worth fixing on its own account. The registry
used city-centre coordinates, while ARPANSA's instruments are elsewhere: Sydney's
is 20 km south of the CBD, Melbourne's 14 km north-east. A CAMS cell is about
44 km across, so a forecast could describe a different cell from the one being
measured. Both the registry and the Python station table now use the
instrument's own position, taken from the Lat/Lon columns of ARPANSA's
historical CSVs.

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
- **CAMS transport and its UV-index derivation.** The *payload* is now correct:
  on 25 October 2026 the ADS download form's own "Corresponding API request"
  panel was read directly, and it contradicted our implementation in three ways,
  each of which would have failed the request outright:

  | We had | The API actually takes |
  |---|---|
  | `"variable": ["uvbed", "uvbedcs"]` | `"uv_biologically_effective_dose"`, `"uv_biologically_effective_dose_clear_sky"` |
  | `"format": "netcdf"` | `"data_format": "grib"` — and the netCDF value is `"netcdf_zip"`, not `"netcdf"` |
  | `"date": ["2026-10-25"]` | `"date": ["2026-10-25/2026-10-25"]` — a start/end range even for one day |

  The short names `uvbed` (214002) and `uvbedcs` (214003) are the *GRIB parameter*
  names and are not what the request API accepts. netCDF is also flagged
  experimental on the form, so GRIB is the safer default and the Actions job will
  need a GRIB reader.

  **Transport works.** Confirmed by the `cams-probe` workflow on 25 October 2026
  (run 40215142210): cdsapi submitted, polled and downloaded in about 57 seconds.

  What the probe established, replacing what we had assumed:

  | Question | Answer |
  |---|---|
  | Does the retrieve succeed? | Yes, with the corrected payload |
  | What comes back? | **GRIB**, confirmed by magic bytes — 700 KB for 13 hours over Australia alone |
  | Does area subsetting work? | Yes: an 86 × 104 grid for the AU bounding box |
  | Variable names *inside* the file | **`uvbed` and `uvbedcs`** |
  | Units in the metadata | **Absent** — cfgrib reports `~` |
  | Sydney peak, 24 Oct, × 40 | **UVI 9.0** from a dose rate of 0.2247 |

  Note the split that caught us out earlier, now confirmed from both sides: the
  *request* takes the long names (`uv_biologically_effective_dose`), while the
  *file* uses the short GRIB names (`uvbed`). Both are correct, in their own
  place. The original code used the short names for the request, which is why it
  could never have worked.

  A Sydney peak of 9.0 in late October is believable, so the × 40 conversion is
  not wildly wrong. **That is not the same as validated.** The GRIB carries no
  units, so the W/m² assumption still rests on the ECMWF forum rather than on
  anything the file says, and the hourly shape falls away faster in the
  afternoon than measured UV usually does. Before any forecast is published it
  must be compared against ARPANSA measurements in the same hour, across several
  stations and several days.

  Reading the file needs `cfgrib`, which works on the Actions runner from pip
  wheels alone, with no apt packages.

- All launch page templates: city, country, tomorrow, the guide, the world map,
  sitemaps, structured data.
- Monthly normals from ARPANSA's historical datasets.
- Deployment: no D1 database created, no Cloudflare token, no custom domain
  binding. See `setup.md`.
