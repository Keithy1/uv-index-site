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

## 3. Cloudflare API token — blocks automatic deploys

Cloudflare dashboard → My Profile → API Tokens → Create Token → **Edit
Cloudflare Workers** template. Then:

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
