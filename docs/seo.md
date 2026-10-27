# What each page is for

The keyword work was done before the build and then lived only in
`UV-Index-Site-Technical-Design.docx`, where nothing checked it. That is how
fifty US city pages came to be titled "Live Reading and Forecast" when they have
no instrument: the research said what each page was for, and the code drifted
away from it unobserved. This file is the version the code is held to, and
`test/seo.test.ts` asserts the parts of it that can be asserted.

## The bet

The site does not try to win "uv index". That is the head term, weather.com owns
it, and a site with twenty-odd pages will not take it. The research found the
opening one level down: **city terms outside the two largest cities**. Perth,
Brisbane, Adelaide and their US equivalents had no small, fast, single-purpose
UV site on page one — only weather portals where the UV index is a widget three
scrolls down.

So the city page is the product. Everything else exists to support it or to
catch the searches that lead to it.

## Per page

| URL | Main searches | Title pattern |
|---|---|---|
| `/` | uv index, uv index map | UV Index Today and Tomorrow: Australia and the United States |
| `/au/` | uv index australia, uv index today | UV Index Australia Today and Tomorrow: Every City |
| `/us/` | uv index today, uv index tomorrow | UV Index Today and Tomorrow in the United States: Every City |
| `/au/{city}/` | uv index perth, perth uv today | UV Index {City} Today: Live Reading and Forecast |
| `/us/{city}-{st}/` | uv index miami, miami uv today | UV Index {City}, {ST} Today: Hourly Forecast |
| `/uv-index-explained/` | what is the uv index, uv index scale | UV Index Explained: What the Numbers Mean and When to Cover Up |
| `/methods/` | none; builds trust | Methods: Where uvatlas Gets Its UV Data |
| `/about/`, `/privacy/`, `/terms/` | none | — |

`/au/tomorrow/` and `/us/tomorrow/` were separate pages in the design, targeting
"uv index tomorrow". They were merged into the country pages, which now carry a
tomorrow column and say "Today and Tomorrow" in the title and H1. The old URLs
301 to the country pages, so the term is still served and nothing is duplicated.

## Rules the code is held to

**A title may not promise what the page has not got.** A US city page says
"Hourly Forecast", not "Live Reading", because there is no instrument within a
thousand kilometres of most of them. This is the honesty rule from `CLAUDE.md`
applied to the `<head>`, and it is the one a search engine can also detect: a
title that oversells its page is a title Google rewrites.

**A US city carries its state, everywhere it stands alone.** "UV Index Portland
Today" does not say Oregon or Maine. Columbus is OH and GA; Arlington is TX and
VA. The slug always knew; the title did not. See `cityLabel` in
`src/lib/locations.ts`.

**One H1 per page, and it matches the title.** Same words, sentence case.

**A description describes the page, never the data.** "Live UV index for Perth,
measured by ARPANSA" is fine; "UV is 7.2 in Perth" is a search result that is
wrong within the hour.

**Every page carries** a self-referential canonical, `WebSite` or `WebPage`,
`Organization`, `BreadcrumbList` below the home page, Open Graph title,
description, url and image, and `twitter:card: summary_large_image`.

**The share image** is `/og-image.png`, 1200x630, drawn once by
`tools/og-image.py` and committed. It is branding, not a per-page preview, so it
never goes stale. Paths that are files and not pages have to be added to
`FILE_PATHS` in `src/lib/urls.ts` or they get a trailing slash and 301 into
nothing.

## Still open

- ~~**"This time of year"**~~ Built 27 October 2026, for both countries.
  Australia from ARPANSA's measurements; the US from NOAA's archived noon
  forecasts, which cover 36 of the 50 cities (30 directly, 6 within 60 km of a
  bulletin city). The other 14 have no long, licensed record near enough, and
  their pages stay thinner -- Tucson, San Diego, Austin, San Antonio, El Paso,
  Fresno, Sacramento, San Jose, Nashville, Charlotte, Columbus, Kansas City,
  Tulsa, Colorado Springs. See fetch/normals.py.
- **The home page** is about 120 words, has no H2, and never uses the word
  "map" while nominally targeting "uv index map". Low priority: see the bet.
- ~~**No favicon**~~ Added 27 October 2026, with a real 404 page.
- **`SITE_INDEXABLE` is still `"false"`**, so every page carries
  `X-Robots-Tag: noindex, nofollow`. Nothing above matters until it is flipped
  and the sitemaps are submitted.
