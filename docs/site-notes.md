# UV Index Site — Research Notes (23 Oct 2026)

Source design doc: D:\keith\Documents\CODING PROJECTS\SITE BUILD RESEARCH\UV-Index-Site-Technical-Design.docx
(extracted to uv_design_doc.txt). Launch target: 16 Nov 2026. Build is ON HOLD per Keith
("let's finish the discussion first"). This file records verified facts for when the build starts.

## Verified data sources

### 1. ARPANSA real-time UV feed — VERIFIED LIVE
- URL: https://uvdata.arpansa.gov.au/xml/uvvalues.xml  (HTTP 200, ~4.4 KB)
- XML: `<stations><location id="Adelaide"><name>adl</name><index>0.0</index><time>10:18 PM</time>
  <date>23/10/2026</date><fulldate>Friday, 23 October 2026</fulldate>
  <utcdatetime>2026/10/23 12:48</utcdatetime><status>ok</status></location>...`
- 16 stations incl. 3 Antarctic (Casey, Davis, +1) which the design excludes.
- Has the `status` field the adapter check needs ("ok"). Night readings are 0.0.
- Fixture saved: research/arpansa-uvvalues.xml

### 2. ARPANSA historical (data.gov.au) — VERIFIED
- CKAN API works: https://data.gov.au/data/api/3/action/package_search?q=ARPANSA%20ultraviolet
  (note the /data/ path segment; bare /api/3 404s)
- Per-station datasets: "Ultraviolet Radiation Index - {Sydney, Perth, Melbourne, Kingston (=Hobart),
  Canberra, Brisbane, Darwin, Townsville, Newcastle, Emerald, ...}" — package IDs captured in
  research/datagovau-uv-search.json
- Licence CC BY 2.5 Australia per design doc; monthly "this time of year" figures are site-calculated.

### 3. CAMS (chosen forecast feed, replaces Open-Meteo) — VERIFIED, KEY FACTS
- ADS dataset: "cams-global-atmospheric-composition-forecasts"
- 0.4°×0.4° global grid, 1-hourly (single level), GRIB (optional netCDF), 5-day horizon,
  new 00UTC + 12UTC runs daily. Temporal coverage 2015–present.
- Relevant variable: "Downward UV radiation at the surface" (J m⁻²) — derive UVI.
  Candidate derivation: UVI ≈ (dose J/m² over the hour / 3600 s) × 40 — VALIDATE in Phase 1
  against ARPANSA readings in the same hour before trusting it.
- ADS API supports area subsetting + netCDF conversion (to be configured with Keith's ADS key).
- Licence (https://apps.ecmwf.int/datasets/licences/cams/): free of charge, worldwide, royalty-free,
  perpetual; commercial use, adaptation and redistribution allowed.
  Attribution required: "Generated using Copernicus Atmosphere Monitoring Service Information [Year]"
  and for derived data: "Contains modified Copernicus Atmosphere Monitoring Service Information [Year]",
  plus a line that neither the European Commission nor ECMWF is responsible for any use.
- Risk: file size vs Worker CPU. Fallback if too heavy: scheduled GitHub Action (free) downloads,
  computes per-city JSON, writes D1/R2. Decide in Phase 1 after measuring a real request.

### 4. EPA (US) — PARTIALLY VERIFIED, endpoint to pin in Phase 1
- Data: UV Index daily + hourly forecasts per city/ZIP + UV alert flag. Public domain, credit EPA.
- Legacy host iaspub.epa.gov/enviro/efservice/getEnvirofactsUV{HOURLY,DAILY}/... responds
  (502s on some queries right now; WAF active). https://enviro.epa.gov/envirofacts/uv/search is
  WAF-blocked for plain fetches.
- New dmapservice (data.epa.gov/dmapservice/{schema}.{table}/...) works per EPA docs, but the UV
  schema/table name is not yet confirmed (uv.uv_hourly → 404).
- Phase 1 task: pin the exact endpoint (try Envirofacts metadata model page, schema discovery,
  and proper headers + retry/backoff). EPA data is the fallback-safe part of the US pages.

### 5. Natural Earth (world map) — standard, public domain, no credit required
- 1:110m country outlines; Equal Earth projection via d3-geo at build time. Download in Phase 2.

## Environment facts (verified this session)
- GitHub: Keithy1, gh CLI logged in (scopes gist, read:org, repo, workflow). Repo created:
  https://github.com/Keithy1/uv-index-site (private). gh API works in-sandbox; rate limit 5000/h.
- git in-sandbox: use `-c http.sslBackend=openssl` + token from `gh auth token` (never print/store it).
  ~/.gitconfig writes are sandbox-denied; keep git settings per-command or via GIT_CONFIG_* env.
- npm in-sandbox: use --ignore-scripts and npm_config_cache=<workspace>\.npm-cache (postinstall
  scripts and piped-stdio spawns are blocked by the sandbox). vitest: use pool 'threads'.
- wrangler CLI cannot run in-sandbox (spawn EPERM) → ALL DEPLOYS GO VIA GITHUB ACTIONS
  (as the design doc already specifies). Actions runner = GitHub cloud, unrestricted.
- Python: system 3.14.7 + bundled runtime (pandas 3.0.1, numpy 2.3.5). Outbound HTTPS works;
  some sites need a browser User-Agent (Cloudflare 403s otherwise).
- Free data APIs verified reachable: Open-Meteo, USGS, Frankfurter, REST Countries, GitHub API.

## Cloudflare (user actions needed)
- Workers Paid plan ($5/mo) must be active on Keith's Cloudflare account (cron + D1 need it).
- Keith to create API token: "Edit Cloudflare Workers" template → store as GitHub repo secret
  (CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID) via `gh secret set` once received.
- Domain: register via Cloudflare Registrar (cost price). Candidates that were AVAILABLE on
  23 Oct 2026 (RDAP): uvatlas.com, uvchart.com, uvreading.com, uvstatus.com, uvtoday.net,
  uvindex.world, uvindex.app, uvtoday.app, uvmap.world, uvw…. Recommend uvatlas.com.

## Open decisions (design doc Table 9 + new)
- Domain name (doc deadline 21 Oct — OVERDUE) → register on Cloudflare.
- Forecast feed → CHOSEN: CAMS (free). Keith to create ADS account at ads.atmosphere.copernicus.eu
  and send the API key (stored as secret, never in repo).
- US city table: 25/50/100 → recommend 50 (needed 2 Nov).
- Guide: I draft, Keith checks every claim (needed 2 Nov).
- Ads order: US first (needed 9 Nov).
- Branding: brand colour + wordmark (propose in Phase 2).
- Emails: About-page contact + uptime-monitor alert address.

## Status
- Repo created (empty, README only).
- 23 Oct 15:00: Keith registered uvatlas.com on Cloudflare. NEW CONSTRAINT: **zero monthly cost**.
  Doc's $6/mo (Workers Paid $5 + domain $1) is REJECTED; revised architecture below is the build plan.

## Zero-cost architecture (verified against current official pricing, 23 Oct 2026)
- Scheduler + compute: **GitHub Actions** (free UNLIMITED minutes on public repos; private repos
  have a limited monthly quota, so the 5-minute ARPANSA cadence needs the repo public).
  ARPANSA every 5 min (one workflow, `*/5` cron); EPA hourly; CAMS twice daily.
- Pages: generated as static HTML (Python + Node) by the Actions run and uploaded to
  **Cloudflare R2** (free tier: 10 GB-month, 1M Class A/mo, 10M Class B/mo, egress free —
  https://developers.cloudflare.com/r2/pricing/). Served via R2 public bucket + custom domain
  uvatlas.com with edge cache (cache-control per object: 5 min AU pages, 60 min US, 1 day static).
- Micro Worker (free tier, 100k req/day): /api/where (CF country header) and /api/health.
- D1 replaced by JSON/JSONL files in R2 (readings history = JSONL per station). Simpler, single store.
- Preview: second R2 bucket served on free r2.dev URL. Production: uvatlas.com.
- Zone free features: Always Use HTTPS, Redirect Rules (www→apex, trailing slash), Web Analytics.
- Monitoring: health.json in R2 checked every 5 min by a free external uptime monitor.
- Secrets (CF token, ADS key) = GitHub Actions repo secrets; never in the repo, safe even if public.
- ONLY cost = domain renewal (~$10/year). Monthly cost: $0.
- SEO/accessibility/perf rules in the design doc are UNCHANGED (full HTML, one URL per page,
  canonicals, sitemaps, credits) — only the serving mechanism changed.

## Docx embedded diagrams (extracted to research/docx-media/)
- 3c39e0d1...png = home page wireframe (desktop + phone)   [research/docx-media/home-wireframe.png]
- 4a31b17d...png = architecture diagram (sources → jobs → D1 → worker → cache)
  [research/docx-media/architecture.png]
- 4c6831c9...png = build plan (4 weekly phases → launch 16 Nov)
  [research/docx-media/build-plan.png]
- NOTE: current model (deepseek-v4-pro) has NO image input — I cannot visually inspect
  these or any rendered screenshots. Phase 4 visual QA therefore = programmatic checks
  (computed contrast ratios, DOM assertions, axe-core) + Keith's own screenshot review.
  If visual QA by AI is wanted, Keith can switch the session to a vision-capable model.

## ADS (CAMS) API mechanics
- API base: https://ads.atmosphere.copernicus.eu/api (returns 200 unauthenticated; /api/v2 404s).
- Auth pattern (cdsapi-style): key "UID:API_KEY" from the ADS profile page; confirm exact
  request shape with Keith's key at Phase 1 start.
- Dataset: cams-global-atmospheric-composition-forecasts, DOI 10.24381/04a0b097,
  ADS page shows "CC-BY licence" + the CAMS licence obligations captured above.

## EPA status detail
- enviro.epa.gov/envirofacts/uv/search = WAF-blocked for plain fetches (403).
- iaspub.epa.gov efservice responds (mixed 404/502 today) — endpoint pinning is Phase 1 task #1
  (try metadata model page + dmapservice schema names + proper headers/backoff).
