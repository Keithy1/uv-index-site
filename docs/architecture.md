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

Live on uvatlas.com and on workers.dev, with indexing held off by
`SITE_INDEXABLE` until the site is finished.

**Data.** D1 in WNAM; the ARPANSA cron in the Worker every 5 minutes; EPA and
CAMS from GitHub Actions through `fetch/d1.py` as idempotent upserts. CAMS
covers both countries, 72 lead hours from two model runs. The forecast is
validated against ARPANSA and the measured accuracy is published.

**Pages.** Home with the Equal Earth world map, `/au/` and `/us/`,
`/au/tomorrow/` and `/us/tomorrow/`, 13 Australian city pages, the guide,
methods, about, privacy and terms. Zero dead internal links.

**Checks.** Typecheck, 88 TypeScript tests, 45 Python tests, and a workerd
bundle check, all in CI.

## Partial data must never render as a confident answer

Four bugs so far have been the same bug. In each, the data was incomplete, the
code did not notice, and the page stated a confident figure that was wrong in
the dangerous direction.

| Symptom | Cause | Guard now in place |
|---|---|---|
| Sydney: "protection needed from 11:00 am", two hours late | 24 lead hours left no forecast before 11 am local | `protectionWindow` returns null unless both threshold crossings are observed |
| Brisbane: "peaks at 6.1 at 9 am" | 47 lead hours ended at 09:00 on an Australian tomorrow, so 6.1 was simply the last value that existed | The route refuses a peak unless the solar middle of the day is present |
| Two protection windows on one page, 4.5 hours apart | The chart summary computed its own from the cloud-adjusted curve | The chart summary quotes no times at all |
| `/us/` served "UV Index Australia" | The route matched any country; the template knew one | A country with no page entry 404s instead of borrowing another's |

The pattern worth remembering: **a maximum over a truncated range is still a
number, and it looks exactly like a real one.** Any aggregate over forecast
data has to ask whether the range it covers is the range it claims.

Resolved with 72 lead hours from two model runs, verified in production on
25 October 2026: 97 hourly values per city across all 63 stations. Australian
peaks of 12.0 (Emerald), 11.6 (Alice Springs) and 11.4 (Townsville); US peaks
of 6.7 (Miami) and 6.3 (Houston). The five US cities with no protection window
are the five lowest peaks, all below 3.0, with Boston at 3.2 the first to
qualify.

## Two things the EPA feed actually does

Found when the writer first ran against the live service.

**It returns today only.** A request made at 11:00 UTC came back with hourly
values from 11:00 to 23:00 UTC and exactly one daily row — today's. The design
document assumed EPA supplied today *and* tomorrow, and `/us/tomorrow/` was to
be built on it. It cannot be. Tomorrow's US forecast has to come from CAMS,
which the country settings already list as the US fallback.

**Its daily row collides with its hourly series.** The daily forecast is the
day's *peak*, but it is stamped at local noon, so as kind "forecast" it shared
a primary key with the hourly value at the same instant and one silently
overwrote the other — 25 records became 23 rows. Nobody would have noticed
until a peak looked wrong on a page.

Daily rows now go to the `daily` table, which the schema already had for this,
and carry the UV alert flag with them. A test asserts that an hourly row and a
daily row at the same instant both survive.

## One source of station data

`data/stations.json` is the single registry both languages read. It exists
because these rows lived in TypeScript and Python separately and drifted:
`fetch/cams.py` keyed three Australian stations `au-eme`, `au-gld` and
`au-hob` while ARPANSA calls them `emd`, `gco` and `kin`, so those forecasts
could never join the cities they belonged to.

Note for anyone editing `.gitignore`: the ignore rules are deliberately
specific to fetched artefacts rather than the `data/` directory. A blanket
`data/` once excluded the registry entirely, and nothing noticed — esbuild
inlines the JSON import at build time, so the deployed Worker kept working
from a file that was not in the repository. Only CI, which starts from a clean
checkout, could see it.

## What is not built

- **US city pages.** The 50 cities are fetched and tabulated but not published;
  the design adds them only where Search Console shows real demand, so nothing
  links to them yet.
- **"This time of year".** Monthly normals from ARPANSA's historical datasets
  on data.gov.au. The reader for those files exists — `arpansa_history.py`
  uses it for validation — but nothing computes or stores the normals.
- **Sitemaps and redirects.** No `/sitemap.xml`, and no www-to-apex or
  trailing-slash rules; only the apex is routed.
- **Monitoring.** `/api/health` is correct and reports a source that has never
  run, but no external uptime monitor polls it, and nothing backs up D1.
- **Ads.** Slots are not in the layout. Australia needs ARPANSA's written
  authorisation before any advertising appears beside its readings.

## Known costs of the current write volume

CAMS writes about 12,200 rows per run twice a day across both countries, and
EPA about 1,100 every hour. That is roughly 45,000 of D1's free allowance of
100,000 writes a day. It fits, but EPA is the wasteful part: it rewrites the
same rows hourly for a forecast that changes far less often. Dropping EPA to
every three hours would halve the total if headroom is ever needed.

## Reads are the constraint, not writes, and reads are invisible

On 26 October 2026 the site answered 500 to every request for the rest of the
day: D1's free plan allows a fixed number of row **reads** a day, and the
allowance was gone by mid-afternoon.

The cause was a missing index, but the shape of the mistake is the part worth
keeping. `readings` is `WITHOUT ROWID`, so its primary key
`(location_id, source, kind, valid_at)` *is* the table. Every page query filters
on `location_id` and a range of `valid_at` and says nothing about `source` or
`kind` — which sit between them in the key. SQLite seeked to the location and
then read everything that location had ever had, against a 400-day retention.
One home-page render did that for all 63 cities.

Three things made it invisible:

1. **A read is a row examined, not a row returned.** The queries returned a few
   hundred rows and looked perfectly healthy from the outside.
2. **SQLite called the bad plan a `SEARCH`, not a `SCAN`.** It *was* a seek — it
   just read 400 days after seeking. A rule that forbids `SCAN` passes it.
3. **Nothing got slower.** D1 answered in milliseconds throughout. The only
   symptom was a counter nobody was watching, until it ran out.

So the guard is in the build. `test/query-plans.test.ts` reads the SQL out of
`src/lib/store.ts` — not a copy, so a new query is covered the day it is
written — loads the real `schema.sql` into SQLite and plans each statement. It
fails on a scan of a growing table, and, more importantly, on a query whose
`valid_at` range never reaches the index. Reverting the indexes fails six of its
cases. Retention's `DELETE ... WHERE valid_at < ?` is the one named exemption:
it runs once a day and an index for it would be paid for on every insert.

`ROW_BUDGET` in `src/lib/store.ts` is the backstop for what the plan test cannot
see — a plan that is still correct against a table that has outgrown it. It logs
and never throws.
