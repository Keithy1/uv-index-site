/**
 * The home page: a world map with the served countries coloured in.
 *
 * Three rules shape it.
 *
 * The map is never the only way in. Every country it links to is also a text
 * link below it, with the same reading, so the page works without SVG, without
 * a pointer, and for a crawler that will not follow shapes.
 *
 * The page is identical for every visitor and fully cacheable. Google warns
 * that pages varying by location may not be crawled completely, and Googlebot
 * crawls mostly from US addresses. A visitor's own country is offered by a
 * small script calling /api/where afterwards, as a banner they can ignore --
 * never a redirect.
 *
 * Nothing claims a reading it does not have. A country with no data says so
 * rather than showing a dash that could be read as zero.
 */
import type { CountrySettings } from "../lib/locations";
import { COUNTRIES } from "../lib/locations";
import {
  COUNTRY_PATHS,
  OTHER_COUNTRIES_PATH,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  projectWorld,
} from "../lib/map-world";
import { bandFor, formatUvi } from "../lib/uv";
import { Layout, ORIGIN, SITE } from "./Layout";

export interface CountryHeadline {
  readonly country: CountrySettings;
  /** Highest reading or forecast peak in that country now. */
  readonly uvi: number | null;
  /** Where that reading is. */
  readonly cityName: string | null;
  readonly citySlug: string | null;
  /** True when the figure is a forecast rather than a measurement. */
  readonly forecast: boolean;
  /** A point on the map to mark, for countries too small to tap. */
  readonly marker: { lat: number; lon: number } | null;
}

export interface HomeView {
  readonly headlines: readonly CountryHeadline[];
  readonly now: Date;
}

const PAGE_CSS = `
.intro{font-size:1.05rem;max-width:34rem}
.mapbox{margin:16px 0 8px;border:1px solid var(--line);border-radius:12px;
background:var(--card);padding:8px}
.mapbox svg{display:block;width:100%;height:auto}
.mapbox a:focus-visible path,.mapbox a:focus-visible circle{outline:none}
.mapbox a path{transition:opacity .12s}
.mapbox a:hover path{opacity:.82}
/* The same hover label as the country maps. pointer-events:none so the label
   cannot block the country beneath it. */
.tip{opacity:0;pointer-events:none;transition:opacity .09s ease-out}
@media (prefers-reduced-motion:reduce){.mapbox a path,.tip{transition:none}}
.countries{list-style:none;padding:0;margin:16px 0;display:grid;gap:10px}
.countries li{border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.countries a.name{font-weight:600;font-size:1.05rem;text-decoration:none}
.countries a.name:hover{text-decoration:underline}
.countries .figure{display:flex;align-items:center;gap:10px;margin-top:6px;flex-wrap:wrap}
.countries .n{font-size:1.5rem;font-weight:700;font-variant-numeric:tabular-nums;line-height:1}
.band{display:inline-block;padding:2px 9px;border-radius:999px;font-weight:600;font-size:.85rem}
.later{color:var(--muted);font-size:.9rem;margin:12px 0 0}
#hint{display:none;margin:16px 0;padding:12px 14px;border:1px solid var(--line);
border-left:4px solid var(--link);border-radius:8px;background:var(--card)}
#hint a{font-weight:600}
#hint button{margin-left:10px;background:none;border:0;color:var(--muted);
cursor:pointer;font:inherit;text-decoration:underline}
@media (min-width:620px){.countries{grid-template-columns:1fr 1fr}}
`;

/**
 * Offers the visitor their own country, once, without changing the page for
 * crawlers. Kept to a few hundred bytes: the budget is 5 KB of JavaScript for
 * the whole site, and this is the only script on it.
 */
const HINT_JS = `
(function(){
  try{
    var box=document.getElementById('hint');
    if(!box||localStorage.getItem('uvatlas.hint')==='off')return;
    fetch('/api/where').then(function(r){return r.json()}).then(function(d){
      if(!d||!d.served||!d.country)return;
      var link=box.querySelector('a');
      var name=link.getAttribute('data-name-'+d.country);
      if(!name)return;
      link.textContent='See '+name+"'s UV now";
      link.setAttribute('href','/'+d.country+'/');
      box.querySelector('span').textContent='Looks like you are in '+name+'.';
      box.style.display='block';
    }).catch(function(){});
    box.querySelector('button').addEventListener('click',function(){
      box.style.display='none';
      try{localStorage.setItem('uvatlas.hint','off')}catch(e){}
    });
  }catch(e){}
})();
`.replace(/\n\s*/g, "");

function WorldMap({ headlines }: { headlines: readonly CountryHeadline[] }) {
  return (
    <div class="mapbox">
      <svg
        viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`}
        role="img"
        aria-label="World map. The countries this site covers are highlighted and listed as links below."
      >
        {/* Everywhere we do not serve: one path, grey, and hidden from
            assistive technology because it carries no information. */}
        <path
          d={OTHER_COUNTRIES_PATH}
          fill="var(--line)"
          stroke="var(--bg)"
          stroke-width="0.6"
          aria-hidden="true"
        />
        {COUNTRIES.filter((c) => c.status === "coming" && COUNTRY_PATHS[c.code]).map((c) => (
          <path
            key={c.code}
            d={COUNTRY_PATHS[c.code]}
            fill="var(--muted)"
            opacity="0.38"
            aria-hidden="true"
          />
        ))}
        {headlines.map((h) => {
          const path = COUNTRY_PATHS[h.country.code];
          if (!path) return null;
          const band = h.uvi !== null ? bandFor(h.uvi) : null;
          const marker = h.marker ? projectWorld(h.marker.lat, h.marker.lon) : null;
          // Same hover label as the country maps, so the three behave alike.
          const label =
            h.uvi !== null
              ? `${h.country.name} ${formatUvi(h.uvi)}`
              : h.country.name;
          const width = label.length * 7.5 + 20;
          return (
            <a
              key={h.country.code}
              class={`pin p-${h.country.code}`}
              href={`/${h.country.code}/`}
              aria-label={`${h.country.name}${
                h.uvi !== null ? `: UV ${formatUvi(h.uvi)} ${band!.name}` : ""
              }`}
            >
              <path d={path} fill={band ? band.bg : "var(--link)"} />
              {/* A country too small to tap at phone width still gets a
                  target big enough to hit. */}
              {marker && (
                <circle
                  cx={marker.x}
                  cy={marker.y}
                  r="9"
                  fill={band ? band.bg : "var(--link)"}
                  stroke="var(--bg)"
                  stroke-width="2"
                />
              )}
            </a>
          );
        })}
        {/* Labels last, so one is never painted under another country's
            marker. Same reason as the country maps: SVG paints in document
            order and has no working z-index. */}
        {headlines.map((h) => {
          if (!COUNTRY_PATHS[h.country.code] || !h.marker) return null;
          const marker = projectWorld(h.marker.lat, h.marker.lon);
          const label =
            h.uvi !== null ? `${h.country.name} ${formatUvi(h.uvi)}` : h.country.name;
          const width = label.length * 7.5 + 20;
          return (
            <g key={`${h.country.code}-tip`} class={`tip t-${h.country.code}`} aria-hidden="true">
              <rect x={marker.x - width / 2} y={marker.y - 38} width={width} height="24"
                rx="6" fill="var(--fg)" stroke="var(--bg)" stroke-width="1.2" />
              <text x={marker.x} y={marker.y - 21} font-size="14" font-weight="600"
                fill="var(--bg)" text-anchor="middle">{label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function HomePage(view: HomeView) {
  const title = "UV Index Today and Tomorrow: Australia and the United States";
  const description =
    "Live UV index by city, measured and forecast. Pick a country to see current " +
    "readings, today's curve and sun protection times.";
  const coming = COUNTRIES.filter((c) => c.status === "coming");

  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE,
      url: `${ORIGIN}/`,
      description,
    },
  ];

  return (
    <Layout title={title} description={description} path="/" structuredData={structuredData}>
      <style
        dangerouslySetInnerHTML={{
          __html:
            PAGE_CSS +
            view.headlines
              .map(
                (h) =>
                  `.mapbox:has(.p-${h.country.code}:hover) .t-${h.country.code},` +
                  `.mapbox:has(.p-${h.country.code}:focus-visible) .t-${h.country.code}{opacity:1}`,
              )
              .join(""),
        }}
      />

      <h1>UV index today and tomorrow</h1>
      <p class="intro">
        Live UV readings and forecasts, city by city. Choose a country to see what the
        UV is right now, what it reaches tomorrow, and the hours sun protection is
        needed.
      </p>

      {/* Hidden until the script confirms a served country; never a redirect. */}
      <div id="hint">
        <span />{" "}
        <a
          href="/au/"
          data-name-au="Australia"
          data-name-us="the United States"
        >
          See your country's UV
        </a>
        <button type="button">No thanks</button>
      </div>

      <WorldMap headlines={view.headlines} />

      {/* The same destinations as the map, in text, with the same figures. */}
      <ul class="countries">
        {view.headlines.map((h) => {
          const band = h.uvi !== null ? bandFor(h.uvi) : null;
          return (
            <li key={h.country.code}>
              <a class="name" href={`/${h.country.code}/`}>
                {h.country.name}
              </a>
              {h.uvi !== null ? (
                <div class="figure">
                  <span class="n">{formatUvi(h.uvi)}</span>
                  <span class="band" style={`background:${band!.bg};color:${band!.fg}`}>
                    {band!.name}
                  </span>
                  <span class="muted small">
                    {h.forecast ? "forecast peak today" : "highest now"}
                    {h.cityName ? ` · ${h.cityName}` : ""}
                  </span>
                </div>
              ) : (
                <div class="figure">
                  <span class="muted small">No current readings</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {coming.length > 0 && (
        <p class="later">
          Coming later: {coming.map((c) => c.name).join(", ")}.
        </p>
      )}

      <p class="small">
        <a href="/uv-index-explained/">What the UV index numbers mean</a>
      </p>

      <script dangerouslySetInnerHTML={{ __html: HINT_JS }} />
    </Layout>
  );
}
