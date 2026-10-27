# Setup — the things only Keith can do

Everything here is free. Each item is blocking for the step named beside it.

## 0. Where keys live

`SECRETS.local.md` in the repository root is the scratchpad for keys and ids.
It is **never committed**: `.gitignore` excludes `*.local.md`, and
`.githooks/pre-commit` refuses any commit that stages a secrets file or that
contains something shaped like a Copernicus or Cloudflare key. This repository
is public, so that matters.

`core.hooksPath` is local configuration and does not travel with a clone. In any
fresh clone, enable the hook once:

```sh
git config core.hooksPath .githooks
```

Keys still have to reach GitHub Actions, which is where the fetchers actually
run. Always set them with `gh secret set <NAME> --repo Keithy1/uv-index-site`,
which prompts for the value rather than taking it on the command line, so it
never lands in your shell history or in a log.

## 1. Copernicus ADS — DONE (25 October 2026)

The Australian forecast (tomorrow's peak, today's curve, sun-protection times)
comes from CAMS. All three prerequisites are in place:

- [x] **Account** — signed in as Keith Edward Chester.
- [x] **CC-BY dataset licence accepted** — the Terms of use section on the
      [CAMS forecasts download tab](https://ads.atmosphere.copernicus.eu/datasets/cams-global-atmospheric-composition-forecasts?tab=download)
      now reads "✓ Accepted". Requests fail without this.
- [x] **`ADS_API_KEY` set** as a GitHub Actions secret on `Keithy1/uv-index-site`.

The key lives only in GitHub Actions, which is also the only place the CAMS
fetcher runs — so CAMS is tested by dispatching the workflow, not from a laptop.
That is deliberate: nobody needs a copy of the key locally.

## 2. Cloudflare D1 database — DONE (25 October 2026)

- [x] `wrangler login` (browser OAuth; no token ever passes through the agent).
- [x] `wrangler d1 create uvatlas --location wnam` — id
      `36e40279-adf1-4e11-8c0b-4d5b9f9f4686`, confirmed `running_in_region: WNAM`,
      and written into `wrangler.jsonc`.
- [x] `schema.sql` applied remotely: `readings`, `daily`, `monthly_normals`,
      `source_health`.
- [x] Verified end to end with live EPA data: 37 records in, 34 readings and
      3 daily rows out, health row recorded.

**Why WNAM.** D1's free plan has a single primary region and every cache-miss
render reads from it. The site is worldwide, so this is a compromise: the US
has much the largest search volume, Europe is about 140 ms away and Australia
about 160 ms, where Eastern North America would have put Australia at ~230 ms.
Edge caching (5 minutes for Australian pages, 60 for US) means most requests
never reach the database at all.

The first attempt defaulted to Western Europe and was deleted while still
empty. Note for next time: `wrangler d1 delete <name>` resolves the name
against `wrangler.jsonc`, so with a placeholder id in there it fails — pass the
UUID instead.

## 3. Cloudflare API token — DONE (25 October; deploys proven 27 October)

Stored as GitHub secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
Proven able to deploy on 27 October 2026, when `.github/workflows/deploy.yml`
ran by hand, passed its 224 tests and shipped version `ebc7108e`.

Deploys are still by hand day to day (`npx wrangler deploy`). The one
automatic deploy is the yearly normals run (June), which calls `deploy.yml`
only when the figures change -- so new "this time of year" numbers reach the
site without anyone having to remember. `deploy.yml` can also be run from the
Actions tab. If the token is ever replaced, it needs Workers deploy rights as
well as D1, or June's run will compute and commit but not ship.

To recreate it: Cloudflare dashboard → My Profile → API Tokens → Create Token
→ **Edit Cloudflare Workers** template. Then:

```sh
gh secret set CLOUDFLARE_API_TOKEN --repo Keithy1/uv-index-site
gh secret set CLOUDFLARE_ACCOUNT_ID --repo Keithy1/uv-index-site
```

Your account ID is on the right of the Cloudflare dashboard home page.

## 3b. Always Use HTTPS — DONE (25 October 2026)

Enabled on the zone, with encryption mode Full. `http://uvatlas.com/au/` now
returns 301 to https.

Deliberately NOT done in the Worker, and Cloudflare's own warning on that
settings page says why: "Enabling this while your origin also forces HTTPS
redirects can cause redirect loops." The Worker does not reliably see the
scheme the visitor used -- an earlier attempt sent a plain-http *local*
request to `https://uvatlas.com` for exactly that reason -- so the edge owns
the scheme and the Worker owns the path.

The cost of that split is one extra hop for an http visitor whose path also
needs fixing: the edge upgrades the scheme, then the Worker fixes the path.
Verified across every pattern:

| Request | Hops | Ends at |
|---|---|---|
| `https://uvatlas.com/au/perth/` | 0 | itself |
| `https://www.uvatlas.com/AU/Perth` | 1 | `https://uvatlas.com/au/perth/` |
| `http://uvatlas.com/au/` | 1 | https |
| `http://uvatlas.com/AU/Perth` | 2 | `https://uvatlas.com/au/perth/` |

Two hops is the worst case and only affects plain-http visitors with a
non-canonical path. No loops anywhere, and `/sitemap.xml` and `/robots.txt`
redirect zero times.

**HSTS is deliberately off.** It tells browsers to refuse http for months, is
cached client-side, and with "preload" is genuinely hard to undo. It is the
right call for a mature site and a bad bet for one that has not launched.

## 3c. GitHub token so the Worker can trigger the fetch — NOT DONE

GitHub's scheduler dropped the CAMS fetch for sixteen hours on 26 October.
Because the eastern Australian cities had rolled past midnight, their
"tomorrow" became a day the stale data no longer reached, and ten of thirteen
cities showed a dash.

Two mitigations are in place: the forecast now fetches 96 lead hours instead
of 72, so a missed run shortens the horizon rather than emptying a column; and
the Worker's cron — which has never missed — now watches `source_health` and
asks GitHub to run the workflow when a source is badly overdue.

That last part needs a token, and does nothing without one:

1. GitHub → Settings → Developer settings → **Fine-grained personal access
   tokens** → Generate new token.
2. Repository access: **only** `Keithy1/uv-index-site`.
3. Permissions → Repository → **Actions: Read and write**. Nothing else.
4. Then, from the project directory:

       npx wrangler secret put GITHUB_DISPATCH_TOKEN

   Paste it at the prompt; it is a Worker secret, not a repository secret, and
   never appears in the config or the repository.

Scope it tightly: this token can start workflows on a public repository.
Actions: write on one repository is the whole requirement.

## 3d. External uptime monitor — DONE (26 October 2026)

Two UptimeRobot monitors, free tier, 5-minute checks, alerting to
`keithchester1@gmail.com`:

| Monitor | URL | Catches |
|---|---|---|
| `uvatlas.com` | `https://uvatlas.com` | total outage |
| `uvatlas health` | `https://uvatlas.com/api/health` | a source going quiet, a lapsed dispatch token |

Both are needed. The home page renders perfectly well from stale data, so it
stays green through every silent failure; and when the Worker is down the
health endpoint is down with it and can report nothing.

Alerts go to the Gmail address directly rather than `contact@uvatlas.com`, and
that is deliberate: if Cloudflare Email Routing ever breaks, alerts sent to
`contact@` would vanish exactly when they matter.

Alert delay and repeat are paid features, so the first failed check sends an
email. Expect occasional false alarms from transient blips; not worth paying to
avoid, since every data source has hours of tolerance built in.

Deliberately NOT monitored: a city page. One ARPANSA station going quiet would
page you for something the staleness rule already handles by showing "Live
reading delayed".

The `health-check.yml` workflow remains as a backstop. It is not a substitute:
it runs on GitHub's scheduler, which this project measured dropping runs for
sixteen hours.

## 3e. Google Search Console — DONE (27 October 2026)

`uvatlas.com` is a **Domain** property (covers http, https and www), verified
by DNS. The record is in Cloudflare → uvatlas.com → DNS:

    TXT  @  google-site-verification=K5AdjoOq4R6KESDO-Bb5V89YSckrls_ZFYLcf40JHnc

**Do not delete it** — Search Console re-checks it and drops the property if
it disappears. The token is public by design; it proves ownership only while
it sits in this domain's DNS.

Google offered to add the record itself by connecting to the Cloudflare
account. Declined: one manual record does not need standing account access.

**Launched 27 October 2026.** `SITE_INDEXABLE` set to `"true"` and deployed;
every page type checked for a leftover `noindex` (none, and the workers.dev
preview stays `noindex` as designed); all 71 sitemap URLs fetched 200 first;
`https://uvatlas.com/sitemap.xml` submitted. Search Console showed "Couldn't
fetch" straight after submitting -- its usual placeholder before the first
fetch -- while the same sitemap served 200, `application/xml`, valid XML, to a
Googlebot user agent. The home page was already in Google's index from before
launch, "indexed, though blocked by robots.txt"; the live test now reads "Page
can be indexed".

Next: Bing Webmaster Tools can import this property in one step, and ARPANSA
is owed the site address (see section 4).

## 3f. Bing Webmaster Tools — DONE (27 October 2026)

`https://uvatlas.com/` verified by DNS. The record is in Cloudflare:

    CNAME  2da36ce8a5c8a701ebfa59ac278eaff9  verify.bing.com   (DNS only)

**DNS only, and keep it.** Proxied, Cloudflare answers with its own addresses
and Bing never sees the alias; deleted, the site drops out of Bing's tools.
Not imported from Search Console, because that route grants Microsoft access
to the Google account; one record does the same job. Sitemap
`https://uvatlas.com/sitemap.xml` submitted the same day.

## 4. ARPANSA — blocks advertising in Australia, not the build

ARPANSA's terms allow free use of the real-time feed with credit, but
**advertising alongside its data needs written authorisation**. The site is built
with ads off everywhere, so this is not urgent, but it has a long lead time:

- You notified ARPANSA as a developer on 19 October 2026. If they have replied,
  I need to know what conditions they attached.
- When the site is live, send them the address, as their developer notes ask.
- Ask explicitly about two things: advertising, and whether plotting their
  readings over the day as a chart is acceptable (the design document assumes it
  is not, until they say otherwise).

The United States can carry ads first regardless, because EPA data is public
domain.

## 5. Domain — done

`uvatlas.com` is registered on Cloudflare. Nothing to do until there is something
to deploy, at which point the Worker gets a route on the zone.

## 6. Decide, when it comes up

- **Brand colour and wordmark.** I can propose options with the first templates.
- [x] **Contact email — DONE (25 October 2026).** `contact@uvatlas.com`, via
  Cloudflare Email Routing to a verified inbox; a test showed `Forwarded` in
  the routing activity log. Set in `src/lib/site.ts`.

  Routing is receive-only: Cloudflare cannot send, so replies leave as the
  destination address unless an SMTP relay is added later.

  When testing, do not send from the destination inbox. The mail forwards
  straight back to it and Gmail dedupes a message it sent to itself, which
  looks exactly like a broken forward. Use another account, or read the
  activity log.
