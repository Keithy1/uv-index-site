# uvatlas — working notes for Claude

Live UV index for Australia and the United States, at **uvatlas.com**.
Read `docs/architecture.md` before changing anything structural.

## The two constraints that decide almost everything

1. **$0 a month.** The domain is the only cost. Everything runs on free tiers:
   Cloudflare Workers Free, D1 Free, GitHub Actions (free and unlimited because
   the repository is public). Never introduce a paid plan, a paid API, or a
   service with a trial that later bills. If a feature seems to need one, say so
   rather than adding it.
2. **Every data source must be free and licensed for commercial use**, because
   the site will carry ads later. This rules out Open-Meteo's free tier, which is
   non-commercial only. See `docs/licences.md`.

## Commands

```sh
npm test              # vitest, 299 tests, no network
npm run typecheck     # both tsconfigs
npm run dev           # wrangler dev on :8787
npm run deploy        # deploys pushed origin/main and tags it deploy-YYYY-MM-DD-HHMM
npm run db:init:local # apply schema.sql to the local D1
python -m unittest discover -s fetch/tests -t .   # the Python fetchers
```

Before committing: `npm run typecheck && npm test` and the Python suite.
CI additionally runs `wrangler deploy --dry-run`, which catches code that
typechecks but will not bundle for workerd.

To exercise the cron locally, start `npm run dev` and
`curl http://127.0.0.1:8787/cdn-cgi/handler/scheduled`.

## Where things live

| Path | What |
|---|---|
| `src/index.tsx` | Worker: routes and the scheduled handler |
| `src/lib/locations.ts` | **Single source of truth** for cities, zones, station codes |
| `src/lib/uv.ts` | WHO bands and the rounding rule |
| `src/lib/store.ts` | Everything that touches D1, including the staleness rule |
| `src/sources/` | One adapter per source: fetch, parse, check |
| `src/views/` | Server-rendered templates (Hono JSX) |
| `src/views/tokens.ts` | **Every colour**, the type scale and spacing. No hex anywhere else but `uv.ts`; a test enforces it |
| `src/lib/strip.ts`, `src/views/DayStrip.tsx` | The day strip: data shaping, then the drawing (full and `compact`) |
| `fetch/` | Python adapters for the sources a Worker cannot run (EPA, CAMS) |
| `schema.sql` | D1 schema. There is no `locations` table, on purpose |
| `docs/seo.md` | **What each page is for**, and the title rules a test enforces |

## Rules that are easy to break by accident

- **Times are ISO 8601 UTC strings everywhere**, converted to local time only at
  render time via a location's IANA zone. Queensland, the NT and WA have no
  daylight saving while Sydney, Adelaide and Hobart do, so a hard-coded offset is
  always a bug. Never use `new Date("2026/10/23 12:48")` on feed text — JavaScript
  reads that as local time.
- **`Number("")` is `0`, and `0` is a valid night-time UV reading.** Always check
  that a field contains digits before converting it, or missing data becomes a
  plausible-looking zero.
- **A band comes from the reading rounded half-up**, the displayed value from
  `formatUvi` (one decimal). 2.4 is Low, 2.5 is Moderate.
- **ARPANSA's `<status>` is not a pass/fail flag.** It carries text like
  `"174 Mins Slow"`, and on an ordinary day six of the thirteen stations say so at
  once. Never drop a reading for this; store it and let the staleness rule decide
  whether it may be shown as current.
- **No template may show a reading without its credit.** The credit belongs in
  the same component as the number, so the two cannot be separated.
- **Pages read `city_now`, never `readings` in bulk.** Work out a value when the
  data lands, not when a page is viewed: D1 Free bills rows *examined*, and the
  daily allowance ran out on 26 October from pages recomputing on every view.
  `test/query-plans.test.ts` enforces it. See `docs/architecture.md`.
- **An upsert writes only when the value changed** (`WHERE ... IS NOT
  excluded...`). D1 Free allows 100,000 rows written a day, each readings row
  costs two (table and index), and the feeds repeat themselves: on 27 October
  rewriting unchanged values passed the limit by mid-afternoon UTC and writes
  were refused until midnight.
- **A title may not promise what the page has not got.** US city pages have no
  instrument, so they say "Hourly Forecast", not "Live Reading". Fifty of them
  shipped claiming one. See `docs/seo.md`.
- **No credential is ever written into a tracked file.** The repository is
  public. Live values are GitHub Actions secrets (`ADS_API_KEY`,
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) and a Worker secret
  (`GITHUB_DISPATCH_TOKEN`, via `wrangler secret put`); local copies go in the
  git-ignored `.env` (fetchers) and `.dev.vars` (Worker), with names listed in
  the committed `.env.example`. `.githooks/pre-commit` and the CI `secrets`
  job enforce it — never bypass them with `--no-verify`.
- **Ads stay off** in `COUNTRIES` until the licence position for that country
  allows them. Australia needs ARPANSA's written authorisation. A test asserts this.

## House style

Full HTML from the server, one URL per page, no client framework. Comments
explain *why*, especially where a rule exists because a source behaved
unexpectedly.

**Budgets, not constraints.** Under 100 KB a page and under 5 KB of JavaScript
come from the design doc's performance table (alongside "the reading painted in
under 1.5 s on a phone"). They are targets, not rules like the two at the top:
weigh a library on what it does that CSS cannot, rather than refusing it on the
number. What the JavaScript budget mainly protects now is headroom: AdSense
alone will add 100 KB or more when ads go on. As of 27 October 2026 the home
page ships 0.7 KB of script and every other page none; motion is CSS only
(view transitions, keyframes) and switched off under `prefers-reduced-motion`.
Never animate a reading.
