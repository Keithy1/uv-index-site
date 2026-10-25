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

## 2. Cloudflare D1 database — blocks deployment

```sh
npx wrangler login
npx wrangler d1 create uvatlas
```

Put the `database_id` it prints into `wrangler.jsonc`, then:

```sh
npm run db:init:remote
```

## 3. Cloudflare API token — blocks automatic deploys

Cloudflare dashboard → My Profile → API Tokens → Create Token → **Edit
Cloudflare Workers** template. Then:

```sh
gh secret set CLOUDFLARE_API_TOKEN --repo Keithy1/uv-index-site
gh secret set CLOUDFLARE_ACCOUNT_ID --repo Keithy1/uv-index-site
```

Your account ID is on the right of the Cloudflare dashboard home page.

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
- **A contact email for the About page.** AdSense reviewers look for one, and the
  uptime monitor needs somewhere to send alerts.
