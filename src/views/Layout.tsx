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

export const SITE = "uvatlas";
export const ORIGIN = "https://uvatlas.com";

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

const CSS = `
:root{color-scheme:light dark;--bg:#fff;--fg:#16181d;--muted:#5b6370;--line:#dfe3e9;
--card:#f6f7f9;--link:#0b57d0;--focus:#0b57d0}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#15171b;--fg:#e9ecf1;
--muted:#9aa4b2;--line:#2c313a;--card:#1d2026;--link:#8ab4f8;--focus:#8ab4f8}}
:root[data-theme="dark"]{--bg:#15171b;--fg:#e9ecf1;--muted:#9aa4b2;--line:#2c313a;
--card:#1d2026;--link:#8ab4f8;--focus:#8ab4f8}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
-webkit-text-size-adjust:100%}
.wrap{max-width:44rem;margin:0 auto;padding:0 16px}
a{color:var(--link)}
a:focus-visible,summary:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
header.site{border-bottom:1px solid var(--line)}
header.site .wrap{display:flex;align-items:center;justify-content:space-between;
gap:12px;padding-top:12px;padding-bottom:12px}
header.site a.brand{font-weight:700;text-decoration:none;color:var(--fg);letter-spacing:-.01em}
details.country{position:relative}
details.country summary{cursor:pointer;list-style:none;padding:6px 10px;
border:1px solid var(--line);border-radius:8px;font-size:.9rem}
details.country summary::-webkit-details-marker{display:none}
details.country ul{position:absolute;right:0;margin:6px 0 0;padding:6px;list-style:none;
background:var(--bg);border:1px solid var(--line);border-radius:8px;min-width:12rem;z-index:5}
details.country li a{display:block;padding:6px 8px;text-decoration:none;border-radius:6px}
h1{font-size:1.7rem;line-height:1.2;margin:24px 0 4px;letter-spacing:-.02em}
h2{font-size:1.15rem;margin:32px 0 8px}
p{margin:8px 0}
.muted{color:var(--muted)}
.small{font-size:.875rem}
footer.site{margin-top:48px;border-top:1px solid var(--line);padding:16px 0 40px;
font-size:.85rem;color:var(--muted)}
footer.site a{color:var(--muted)}
footer.site nav{margin-top:8px;display:flex;gap:14px;flex-wrap:wrap}
@media (max-width:420px){h1{font-size:1.45rem}}
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
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={SITE} />
        <meta property="og:title" content={props.title} />
        <meta property="og:description" content={props.description} />
        <meta property="og:url" content={canonical} />
        <meta name="twitter:card" content="summary" />
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
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
            <a class="brand" href="/">
              {SITE}
            </a>
            {/* <details> so the menu works with JavaScript switched off. */}
            <details class="country">
              <summary>Country</summary>
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
                    {c.name} — coming later
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
