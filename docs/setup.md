# Setup — the things only Keith can do

Everything here is free. Each item is blocking for the step named beside it.

## 1. Copernicus ADS account — blocks the forecast feed

The whole Australian forecast (tomorrow's peak, today's curve, sun-protection
times) comes from CAMS, and it needs a free account.

1. Register at <https://ads.atmosphere.copernicus.eu/>.
2. Accept the licence for **CAMS global atmospheric composition forecasts**
   (this is a separate click from registering, and requests fail without it).
3. Copy the API key from your profile page. It looks like `12345:abcdef-...`.
4. Give it to me, or set it yourself:
   `gh secret set ADS_API_KEY --repo Keithy1/uv-index-site`

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
