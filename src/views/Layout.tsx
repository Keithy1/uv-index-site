/**
 * The shell every page shares: head, stylesheet, header, footer.
 *
 * The CSS is inlined rather than linked. At this size that is one request
 * instead of two and no render-blocking round trip, which is most of the
 * Largest Contentful Paint budget on a page whose content is a number.
 *
 * Two rules the footer enforces for every page that uses this layout: the
 * medical-advice disclaimer, and links to terms, privacy and methods.
 */
import type { Child } from "hono/jsx";

import { COUNTRIES, liveCountries } from "../lib/locations";
import type { CountryCode } from "../lib/locations";
import { LOGO_PATH, MARK_PATH, OG_IMAGE_PATH } from "../assets/brand";
import { FONT_PATH } from "../assets/font";
import { TOKENS_CSS } from "./tokens";
import { Wordmark, WORDMARK_CSS } from "./Wordmark";
import { ORIGIN, SITE } from "../lib/urls";

export { ORIGIN, SITE } from "../lib/urls";

interface Props {
  readonly title: string;
  readonly description: string;
  /** Path only, e.g. "/au/perth/". Becomes the canonical and the OG url. */
  readonly path: string;
  readonly lang?: string;
  readonly country?: CountryCode;
  /** JSON-LD objects. Only for things actually on the page. */
  readonly structuredData?: readonly object[];
  readonly children?: Child;
}

/**
 * The typeface, and a stand-in measured to it.
 *
 * Atkinson Hyperlegible Next was drawn for low-vision readers by the Braille
 * Institute: every figure and letter is built not to be mistaken for another,
 * which is the job on a page read in glare. One variable file, 34 KB, carries
 * the 400, 700 and 800 the site uses (see tools/font.py).
 *
 * font-display:swap shows the text at once in a system face, then swaps. The
 * stand-ins are system faces resized to this one's average width and line
 * metrics, so the swap moves nothing: measured on the site's own words, Segoe
 * UI runs 0.6% narrower, Roboto 0.9%, Arial 2.3%. A local() face that is not
 * installed is skipped, so each platform lands on the one it has; macOS has
 * Arial, and San Francisco cannot be named in local().
 */
const FONT_CSS = `
@font-face{font-family:"Atkinson Hyperlegible Next";src:url(${FONT_PATH}) format("woff2");
font-weight:200 800;font-style:normal;font-display:swap}
@font-face{font-family:"AHN Segoe";src:local("Segoe UI");size-adjust:99.45%;
ascent-override:98.94%;descent-override:31.77%;line-gap-override:0%}
@font-face{font-family:"AHN Roboto";src:local("Roboto");size-adjust:99.15%;
ascent-override:99.25%;descent-override:31.87%;line-gap-override:0%}
@font-face{font-family:"AHN Arial";src:local("Arial"),local("Helvetica");size-adjust:97.66%;
ascent-override:100.76%;descent-override:32.36%;line-gap-override:0%}
`;

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:var(--sky);color:var(--shade);
font:var(--t-1)/1.55 "Atkinson Hyperlegible Next","AHN Segoe","AHN Roboto","AHN Arial",
system-ui,sans-serif;-webkit-text-size-adjust:100%}
/* Figures that line up, wherever numbers sit in columns or beside each other. */
table,.n,.strip{font-variant-numeric:tabular-nums}
/* One column, 64rem, and on the data pages text runs the full width of the
   boxes. It has been three widths: 44rem left two-thirds of a 1920 px screen
   as margin and could not carry the standard 728 px in-page ad (ads go in the
   flow, never beside a reading); 64rem with paragraphs held at 44rem left text
   visibly narrower than the charts above it; 48rem for everything pulled the
   whole page back into the middle. The text-only pages keep a reading column
   of their own -- see Prose.tsx. */
.wrap{max-width:64rem;margin:0 auto;padding:0 16px}
/* Left-aligned everywhere, with no hyphenation. Text was justified from
   tablet width up; at the 64rem column that made 105-character lines with
   rivers in them. Prose pages hold their own 66-character column instead. */
a{color:var(--zenith)}
a:focus-visible,summary:focus-visible{outline:3px solid var(--zenith);outline-offset:2px}
header.site{border-bottom:1px solid var(--horizon)}
header.site .wrap{display:flex;align-items:center;justify-content:space-between;
gap:12px;padding-top:12px;padding-bottom:12px}
header.site a.brand{font-weight:700;text-decoration:none;color:var(--shade);letter-spacing:-.01em;
display:inline-flex;align-items:center;gap:8px}
header.site a.brand img{display:block}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
details.country{position:relative}
details.country summary{cursor:pointer;list-style:none;padding:6px 10px;
border:1px solid var(--horizon);border-radius:8px;font-size:var(--t-0)}
details.country summary::-webkit-details-marker{display:none}
details.country ul{position:absolute;right:0;margin:6px 0 0;padding:6px;list-style:none;
background:var(--sky);border:1px solid var(--horizon);border-radius:8px;min-width:12rem;z-index:5}
details.country li a{display:block;padding:6px 8px;text-decoration:none;border-radius:6px}
h1{font-size:var(--t-3);line-height:1.2;margin:var(--s-5) 0 var(--s-1);letter-spacing:-.01em}
@media (min-width:620px){h1{font-size:var(--t-4)}}
h2{font-size:var(--t-2);line-height:1.25;margin:var(--s-6) 0 var(--s-2)}
p{margin:8px 0}
.muted{color:var(--haze)}
.small{font-size:var(--t-0)}
footer.site{margin-top:48px;border-top:1px solid var(--horizon);padding:16px 0 40px;
font-size:var(--t-0);color:var(--haze)}
footer.site a{color:var(--haze)}
footer.site nav{margin-top:8px;display:flex;gap:14px;flex-wrap:wrap}
/* Motion, in CSS only and only for those who have not asked for less. The site
   ships no JavaScript for it: GSAP would have cost about 23 KB, against a
   budget held for the ad script to come, for effects the browser does itself.
   Nothing here moves a reading -- a number that counted up through 0.0 to 9.7
   would spend a moment showing the wrong UV level, on the one page whose job
   is to show the right one.
   Page transitions: the header holds still while the page beneath crossfades.
   Browsers without cross-document view transitions simply navigate. */
@media (prefers-reduced-motion:no-preference){
@view-transition{navigation:auto}
header.site{view-transition-name:site-header}
::view-transition-old(root),::view-transition-new(root){animation-duration:.18s}
}
`;

export function Layout(props: Props) {
  const canonical = `${ORIGIN}${props.path}`;
  const served = liveCountries();
  return (
    <html lang={props.lang ?? "en-AU"}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        <meta name="description" content={props.description} />
        <link rel="canonical" href={canonical} />
        <link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={SITE} />
        <meta property="og:title" content={props.title} />
        <meta property="og:description" content={props.description} />
        <meta property="og:url" content={canonical} />
        {/* Without an image a shared link renders as a bare line of text, and
            "summary" without one renders smaller still. The picture is the same
            on every page: it is branding, not a per-page preview, so there is
            nothing to go stale. */}
        <meta property="og:image" content={`${ORIGIN}${OG_IMAGE_PATH}`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta
          property="og:image:alt"
          content="uvatlas: a globe with the sun breaking over its edge, and the words Live UV index, city by city, for Australia and the United States"
        />
        <meta name="twitter:card" content="summary_large_image" />
        {/* Fetched with the page rather than after the CSS is parsed, so the
            swap happens before most readers see the fallback. */}
        <link rel="preload" href={FONT_PATH} as="font" type="font/woff2" crossorigin="anonymous" />
        <style dangerouslySetInnerHTML={{ __html: TOKENS_CSS + FONT_CSS + CSS + WORDMARK_CSS }} />
        {/* The publisher, on every page. The design asked for WebSite,
            Organization and BreadcrumbList. `logo` arrived with the artwork:
            Google wants a square-ish logo, and until there was one, claiming
            the 1200x630 share card would have been worse than leaving it out. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: SITE,
              url: `${ORIGIN}/`,
              logo: `${ORIGIN}${LOGO_PATH}`,
              description:
                "Live and forecast UV index for cities in Australia and the United States, " +
                "from ARPANSA, the US EPA and Copernicus.",
            }),
          }}
        />
        {(props.structuredData ?? []).map((data, i) => (
          <script
            key={i}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
          />
        ))}
      </head>
      <body>
        <header class="site">
          <div class="wrap">
            {/* The wordmark is drawn (see Wordmark.tsx) and hidden from
                assistive technology; the name is here as real text for screen
                readers and search engines. The globe is decorative, so alt="". */}
            <a class="brand" href="/">
              <img src={MARK_PATH} width="36" height="36" alt="" />
              <Wordmark />
              <span class="vh">uvatlas</span>
            </a>
            {/* <details> so the menu works with JavaScript switched off. */}
            <details class="country">
              <summary>Choose a country</summary>
              <ul>
                {served.map((c) => (
                  <li key={c.code}>
                    <a href={`/${c.code}/`} aria-current={props.country === c.code ? "page" : undefined}>
                      {c.name}
                      {props.country === c.code ? " ✓" : ""}
                    </a>
                  </li>
                ))}
                {COUNTRIES.filter((c) => c.status === "coming").map((c) => (
                  <li key={c.code} class="muted small" style="padding:6px 8px">
                    {c.name} (coming later)
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </header>

        <main class="wrap">{props.children}</main>

        <footer class="site">
          <div class="wrap">
            <p>Not a substitute for medical advice.</p>
            <nav>
              {/* The served countries, so every page reaches the readings
                  without the header menu. Today and tomorrow share one page
                  each, so there is nothing else to list. */}
              {served.map((c) => (
                <a key={c.code} href={`/${c.code}/`}>
                  {c.name}
                </a>
              ))}
              <a href="/uv-index-explained/">UV index explained</a>
              <a href="/methods/">Methods</a>
              <a href="/about/">About</a>
              <a href="/privacy/">Privacy</a>
              <a href="/terms/">Terms</a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
