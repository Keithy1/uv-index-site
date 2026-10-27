# Data licences and the credits they require

Every source must be **free** and **licensed for commercial use**, because the
site will carry ads later. The second test is the one that eliminates otherwise
attractive options.

The rule in code: a credit lives in the same component as the data it covers, so
no template can show a reading without its attribution.

## In use

### ARPANSA real-time feed — Australia, measured
- `https://uvdata.arpansa.gov.au/xml/uvvalues.xml`
- Free with credit. Requires a browser-like `User-Agent`; a bare fetch gets a 403.
- **Credit, wherever a reading appears:** "UV observations courtesy of ARPANSA",
  plus "© Commonwealth of Australia as represented by the Australian Radiation
  Protection and Nuclear Safety Agency (ARPANSA)" and a link to their disclaimer.
- **Obligations:** display readings unmodified; **advertising alongside the data
  needs written authorisation**; notify ARPANSA as a developer and send the site
  address at launch.
- Open question for ARPANSA: whether plotting their readings through the day as a
  chart counts as modification. Assumed not permitted until they say otherwise,
  so city charts plot the CAMS forecast, not ARPANSA's readings.
- **One accepted exception (27 October 2026):** when today's forecast has fewer
  than three points, the city chart falls back to the measured readings so far
  (`src/index.tsx`, the `series` fallback). That needs a forecast outage — a
  GitHub Actions failure the Worker's dispatch also failed to recover — so it is
  rare, and Keith judged the risk acceptable pending ARPANSA's answer. If they
  say charts are modification, remove the fallback; if they say yes, measured
  charts can be built properly.
- **Letter sent 19 October 2026** to ARPANSA's UV team: developer notification,
  the chart question, and prior written authorisation for advertising. No reply
  as of 27 October. Still to do: send the site address at launch.

### Copernicus CAMS — forecasts
- Dataset `cams-global-atmospheric-composition-forecasts` via the Atmosphere Data Store.
- Free, worldwide, royalty-free, perpetual. **Commercial use, adaptation and
  redistribution all allowed** — this is why it beats Open-Meteo.
- **Credit:** "Generated using Copernicus Atmosphere Monitoring Service
  information [year]"; for anything derived, "Contains modified Copernicus
  Atmosphere Monitoring Service information [year]". Our sun-protection windows
  are derived, so they take the second form. Must also state that neither the
  European Commission nor ECMWF is responsible for any use of the information.

### EPA Envirofacts UV — United States, forecast
- `https://data.epa.gov/dmapservice/getEnvirofactsUV{HOURLY,DAILY}/CITY/{city}/STATE/{st}/JSON`
- US government work, public domain. No restriction on ads.
- **Credit:** "Forecast: US Environmental Protection Agency", with a link.

### ARPANSA historical datasets — "this time of year"
- data.gov.au, CC BY 2.5 Australia.
- **Credit:** ARPANSA, name the licence, and state that the monthly figures were
  calculated by this site.

### Natural Earth — the world map
- 1:110m country outlines, public domain, no credit required.
- "Made with Natural Earth" on the methods page anyway.

## Ruled out

| Source | Why not |
|---|---|
| **Open-Meteo free tier** | Non-commercial use only (under 10,000 calls a day). The data is CC BY 4.0, but that does not override the API's own terms, and ads make the site commercial. Its paid plan is $29/month, which breaks the $0 rule |
| **Google Weather API** | Terms bar using the data in a service whose primary purpose is weather information — which is exactly this site |
| **Apple WeatherKit** | The developer agreement bars building "a substitute or similar service". Not worth the legal reading while CAMS is free and clear |

## Where the credits must appear

| Data | Credit shown |
|---|---|
| An Australian measured reading | Beside the reading, and in the page footer |
| An Australian forecast or protection window | Beside the forecast (modified-CAMS wording) |
| A US forecast | Beside the forecast |
| Monthly normals | Under "This time of year" |
| Everything | Methods page, plus "Not a substitute for medical advice" in every footer |
