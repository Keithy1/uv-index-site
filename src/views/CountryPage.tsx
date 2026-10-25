/**
 * The country page, e.g. /au/.
 *
 * Leads with the highest reading in the country right now, because that is
 * what the page is for: one glance tells you whether anywhere is dangerous.
 * Then a map with a dot per city, then every city as a real HTML table sorted
 * highest first.
 *
 * The map is decoration with a job: it is never the only way to reach a city,
 * and the table below carries the same links as crawlable text.
 */
import type { CountrySettings, Location } from "../lib/locations";
import { localTimeWithZone } from "../lib/time";
import { bandFor, formatUvi } from "../lib/uv";
import { Layout, ORIGIN } from "./Layout";

export interface CityRow {
  readonly location: Location;
  readonly uvi: number | null;
  readonly validAt: string | null;
  readonly stale: boolean;
  /** Today's forecast peak, when a forecast is available. */
  readonly peak: number | null;
  /**
   * Tomorrow's forecast peak, or null when the forecast does not cover the
   * city's whole tomorrow. Null rather than a truncated maximum: the page once
   * reported Brisbane peaking at 6.1 at 9 am because 9 am was the last hour
   * that existed.
   */
  readonly tomorrow: number | null;
  readonly tomorrowMinutes: number | null;
}

/** The generated outline for one country, passed in rather than imported. */
export interface CountryMap {
  readonly width: number;
  readonly height: number;
  readonly outlinePath: string;
  readonly project: (lat: number, lon: number) => { x: number; y: number };
}

export interface CountryView {
  readonly country: CountrySettings;
  readonly rows: readonly CityRow[];
  readonly now: Date;
  readonly hasForecast: boolean;
  readonly map: CountryMap;
  /**
   * Whether this country has a measured source at all.
   *
   * Australia has ARPANSA instruments; the United States has only EPA
   * forecasts. The page must not imply a measurement where there is none, so
   * this changes the column headings and the headline wording, not just the
   * numbers.
   */
  readonly measured: boolean;
  /** Which source to credit beneath the figures. */
  readonly credit: "arpansa" | "epa";
  /** True when city pages exist to link to. */
  readonly cityPages: boolean;
}

const PAGE_CSS = `
.lead{background:var(--card);border:1px solid var(--line);border-radius:12px;
padding:16px;margin:16px 0}
.lead .n{font-size:2.8rem;font-weight:700;line-height:1;font-variant-numeric:tabular-nums;
letter-spacing:-.03em}
.lead .row{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.band{display:inline-block;padding:3px 10px;border-radius:999px;font-weight:600;font-size:.95rem}
.mapbox{border:1px solid var(--line);border-radius:12px;background:var(--card);
padding:8px;margin:8px 0}
.mapbox svg{display:block;width:100%;height:auto}

/* Today/Tomorrow switch, with no JavaScript at all.
   Two hidden radios drive it: :checked for the chosen day, :has() for the
   hover preview. Radios rather than buttons because that is what this is --
   one of two mutually exclusive options -- so it arrives keyboard-operable
   and announced correctly without any ARIA. */
.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
clip:rect(0 0 0 0);white-space:nowrap;border:0}
.dayswitch{display:inline-flex;border:1px solid var(--line);border-radius:999px;
overflow:hidden;margin:4px 0 0}
.dayswitch label{padding:6px 16px;cursor:pointer;font-size:.9rem;font-weight:600;
color:var(--muted);user-select:none}
.dayswitch label:hover{color:var(--fg)}
#day-today:checked~.dayswitch label[for="day-today"],
#day-tomorrow:checked~.dayswitch label[for="day-tomorrow"]{background:var(--link);color:#fff}
/* Focus must be visible on the label, since the radio itself is off-screen. */
#day-today:focus-visible~.dayswitch label[for="day-today"],
#day-tomorrow:focus-visible~.dayswitch label[for="day-tomorrow"]{outline:3px solid var(--focus);
outline-offset:-3px}
/* One pair of rules drives both the SVG marker groups and the caption, so the
   words and the map can never disagree about which day is on screen. */
.m-tomorrow{display:none}
#day-tomorrow:checked~.mapbox .m-today,
#day-tomorrow:checked~.daycap .m-today{display:none}
#day-tomorrow:checked~.mapbox .m-tomorrow,
#day-tomorrow:checked~.daycap .m-tomorrow{display:inline}
/* Hover previews the other day without committing to it. */
.daymap:has(label[for="day-tomorrow"]:hover) .m-today{display:none}
.daymap:has(label[for="day-tomorrow"]:hover) .m-tomorrow{display:inline}
.daymap:has(label[for="day-today"]:hover) .m-tomorrow{display:none}
.daymap:has(label[for="day-today"]:hover) .m-today{display:inline}
.daycap{font-size:.85rem;color:var(--muted);margin:6px 0 0}

/* City name on hover. The label never takes pointer events, or it would cover
   neighbouring markers and make them unhoverable -- a real problem where the
   cities are close together. */
.pin .tip{opacity:0;pointer-events:none;transition:opacity .09s ease-out}
.pin:hover .tip{opacity:1}
.pin circle{cursor:default}
@media (prefers-reduced-motion:reduce){.pin .tip{transition:none}}
table{border-collapse:collapse;width:100%;margin:8px 0}
th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line)}
/* Column headings only. The city cells are row headers (th scope="row") for
   screen readers, and must not inherit the small uppercase treatment. */
thead th{font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;
color:var(--muted);font-weight:600}
tbody th{font-weight:400}
td.n{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
td.t{color:var(--muted);font-size:.85rem;white-space:nowrap}
tr.stale td{opacity:.62}
.credits{margin-top:28px;padding-top:12px;border-top:1px solid var(--line);
font-size:.82rem;color:var(--muted)}
.credits p{margin:4px 0}
@media (max-width:460px){th.hide,td.hide{display:none}}
`;

/**
 * One city marker, with the name on hover.
 *
 * The label is part of the SVG and shown by CSS, so there is still no
 * JavaScript. `pointer-events: none` on the label matters: without it the
 * label would sit over neighbouring markers and swallow their hover, which on
 * the crowded US east coast means several cities become unhoverable.
 *
 * The group carries an aria-label rather than a <title>, because <title>
 * produces a second, delayed native tooltip saying the same thing. Markers are
 * not focusable: fifty tab stops to reach a table that is directly below and
 * carries every figure would make the page worse, not better.
 */
function Marker({
  name,
  uvi,
  x,
  y,
}: {
  name: string;
  uvi: number;
  x: number;
  y: number;
}) {
  const band = bandFor(uvi);
  const label = `${name} ${formatUvi(uvi)}`;
  // SVG cannot size a box to its text, so estimate: ~4.6px per character at
  // font-size 8.5, plus padding. Generous rather than tight, since a label
  // slightly too wide looks fine and one too narrow clips.
  const width = label.length * 4.6 + 12;
  const flip = y < 26; // near the top edge, put the label below instead
  const ty = flip ? y + 13 : y - 23;

  return (
    <g class="pin" role="img" aria-label={`${name}: UV ${formatUvi(uvi)} ${band.name}`}>
      <circle cx={x} cy={y} r="6" fill={band.bg} stroke="var(--bg)" stroke-width="1.5" />
      <text x={x} y={y + 3.2} font-size="7.5" font-weight="700" fill={band.fg}
        text-anchor="middle">{Math.round(uvi)}</text>
      <g class="tip">
        <rect x={x - width / 2} y={ty} width={width} height="15" rx="4"
          fill="var(--fg)" stroke="var(--bg)" stroke-width="0.8" />
        <text x={x} y={ty + 10.5} font-size="8.5" font-weight="600" fill="var(--bg)"
          text-anchor="middle">{label}</text>
      </g>
    </g>
  );
}

function Markers({
  rows,
  map,
  value,
}: {
  rows: readonly CityRow[];
  map: CountryMap;
  value: (r: CityRow) => number | null;
}) {
  return (
    <>
      {rows.map((r) => {
        const uvi = value(r);
        if (uvi === null) return null;
        const { x, y } = map.project(r.location.lat, r.location.lon);
        return (
          <Marker key={r.location.id} name={r.location.name} uvi={uvi} x={x} y={y} />
        );
      })}
    </>
  );
}

function CountryOutline({
  rows,
  map,
  countryName,
  measured,
}: {
  rows: readonly CityRow[];
  map: CountryMap;
  countryName: string;
  measured: boolean;
}) {
  const hasTomorrow = rows.some((r) => r.tomorrow !== null);
  const todayLabel = measured ? "UV now" : "peak today";

  return (
    <div class="daymap">
      {/* Both days are rendered; CSS decides which is visible. Nothing is
          fetched or re-rendered on switching, so there is no flicker and no
          layout shift -- the two groups occupy the same box. */}
      {hasTomorrow && (
        <>
          <input class="sr" type="radio" name="day" id="day-today" checked />
          <input class="sr" type="radio" name="day" id="day-tomorrow" />
          <div class="dayswitch">
            <label for="day-today">Today</label>
            <label for="day-tomorrow">Tomorrow</label>
          </div>
        </>
      )}
      <div class="mapbox">
        <svg
          viewBox={`0 0 ${map.width} ${map.height}`}
          role="img"
          aria-label={`Map of ${countryName} with a marker for each city. The same figures are listed in the table below, for today and tomorrow.`}
        >
          <path d={map.outlinePath} fill="var(--line)" stroke="var(--muted)" stroke-width="0.8"
            stroke-linejoin="round" opacity="0.75" />
          <g class="m-today">
            <Markers rows={rows} map={map} value={(r) => r.uvi} />
          </g>
          {hasTomorrow && (
            <g class="m-tomorrow">
              <Markers rows={rows} map={map} value={(r) => r.tomorrow} />
            </g>
          )}
        </svg>
      </div>
      {hasTomorrow && (
        <p class="daycap">
          {/* The caption follows the map. Saying "showing peak today" while
              tomorrow's markers are on screen is exactly the kind of quiet
              contradiction this project keeps tripping over, so it is driven
              by the same rules rather than left static. */}
          <span class="m-today">
            Showing {todayLabel}. Hover or select Tomorrow for the forecast peak.
          </span>
          <span class="m-tomorrow">
            Showing tomorrow's forecast peak. Hover or select Today for {todayLabel}.
          </span>{" "}
          Every figure is also in the table below.
        </p>
      )}
    </div>
  );
}

export function CountryPage(view: CountryView) {
  const { country, rows, now } = view;
  const withReading = rows.filter((r) => r.uvi !== null && !r.stale);
  const highest = withReading.length
    ? withReading.reduce((a, b) => (b.uvi! > a.uvi! ? b : a))
    : null;
  const band = highest ? bandFor(highest.uvi!) : null;

  // One page carries both intents rather than splitting them across two thin
  // ones: "uv index <country>" and "uv index tomorrow <country>". The title,
  // the description and the table heading below all say "tomorrow" on purpose,
  // and the heading doubles as the #tomorrow anchor.
  const title = view.measured
    ? `UV Index ${country.name} Today and Tomorrow: Every City`
    : `UV Index ${country.name} Today and Tomorrow: Forecast for Every City`;
  const description = view.measured
    ? `Live UV index for ${country.name}, measured by ARPANSA and updated every few ` +
      "minutes, with tomorrow's forecast peak for every city. Band and sun " +
      "protection guidance for each station."
    : `UV index forecast for cities across ${country.name} today and tomorrow, from ` +
      "the US Environmental Protection Agency and Copernicus. Peak level, band and " +
      "sun protection guidance.";
  const path = `/${country.code}/`;

  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: title,
      description,
      url: `${ORIGIN}${path}`,
      inLanguage: "en-AU",
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${ORIGIN}/` },
        { "@type": "ListItem", position: 2, name: country.name, item: `${ORIGIN}${path}` },
      ],
    },
  ];

  return (
    <Layout
      title={title}
      description={description}
      path={path}
      country={country.code}
      structuredData={structuredData}
    >
      <style dangerouslySetInnerHTML={{ __html: PAGE_CSS }} />

      <h1>UV Index {country.name}</h1>

      {highest ? (
        <div class="lead">
          <div class="row">
            <div class="n">{formatUvi(highest.uvi!)}</div>
            <div>
              <p style="margin:0">
                {view.measured ? "Highest now: " : "Highest forecast today: "}
                {/* Same rule as the table: only link where a city page
                    exists. This one was missed first time round. */}
                <strong>
                  {view.cityPages ? (
                    <a href={`/${highest.location.country}/${highest.location.slug}/`}>
                      {highest.location.name}
                    </a>
                  ) : (
                    highest.location.name
                  )}
                </strong>{" "}
                <span class="band" style={`background:${band!.bg};color:${band!.fg}`}>
                  {band!.name}
                </span>
              </p>
              <p class="small muted" style="margin:4px 0 0">{band!.advice}</p>
            </div>
          </div>
        </div>
      ) : (
        <p>
          {view.measured
            ? "No current readings are available. ARPANSA's stations report every " +
              "few minutes; this page updates with them."
            : `No forecast is available for ${country.name} at the moment. ` +
              "This page updates when the next forecast is published."}
        </p>
      )}

      <CountryOutline
        rows={rows}
        map={view.map}
        countryName={country.name}
        measured={view.measured}
      />

      <h2 id="tomorrow">
        {view.measured
          ? `UV index today and tomorrow in ${country.name}`
          : `UV index today and tomorrow across ${country.name}`}
      </h2>
      <table>
        <thead>
          <tr>
            <th scope="col">City</th>
            <th scope="col" style="text-align:right">{view.measured ? "UV now" : "Peak today"}</th>
            <th scope="col">Band</th>
            {view.measured && view.hasForecast && (
              <th scope="col" class="hide" style="text-align:right">Peak today</th>
            )}
            <th scope="col" style="text-align:right">Tomorrow</th>
            <th scope="col" class="hide">Tomorrow's band</th>
            {view.measured && <th scope="col" class="hide">Measured</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const b = r.uvi !== null ? bandFor(r.uvi) : null;
            return (
              <tr key={r.location.id} class={r.stale ? "stale" : undefined}>
                <th scope="row">
                  {/* Only link where a city page actually exists; a link to a
                      404 is worse than no link. */}
                  {view.cityPages ? (
                    <a href={`/${r.location.country}/${r.location.slug}/`}>{r.location.name}</a>
                  ) : (
                    r.location.name
                  )}
                </th>
                <td class="n">{r.uvi !== null ? formatUvi(r.uvi) : "—"}</td>
                <td>
                  {b ? (
                    // Number and word both present: colour never carries meaning alone.
                    <span class="band" style={`background:${b.bg};color:${b.fg}`}>{b.name}</span>
                  ) : (
                    <span class="muted small">no data</span>
                  )}
                </td>
                {view.measured && view.hasForecast && (
                  <td class="n hide">{r.peak !== null ? formatUvi(r.peak) : "—"}</td>
                )}
                <td class="n">{r.tomorrow !== null ? formatUvi(r.tomorrow) : "—"}</td>
                <td class="hide">
                  {r.tomorrow !== null ? (
                    (() => {
                      const tb = bandFor(r.tomorrow);
                      return (
                        <span class="band" style={`background:${tb.bg};color:${tb.fg}`}>
                          {tb.name}
                        </span>
                      );
                    })()
                  ) : (
                    <span class="muted small">no forecast</span>
                  )}
                </td>
                {view.measured && (
                  <td class="t hide">
                    {r.validAt ? localTimeWithZone(r.validAt, r.location.tz) : "—"}
                    {r.stale ? " (delayed)" : ""}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p class="small muted">
        {view.measured
          ? "Sorted by the current reading, highest first. Times are local to each city."
          : "Sorted by today's forecast peak, highest first."}{" "}
        Tomorrow's figures are the forecast peak for each city's own day; a dash
        means the forecast does not yet cover it.
      </p>

      <p class="small">
        <a href="/uv-index-explained/">What the UV index numbers mean</a>
      </p>

      <div class="credits">
        {view.credit === "arpansa" ? (
          <>
            <p>UV observations courtesy of ARPANSA.</p>
            <p>
              © Commonwealth of Australia as represented by the Australian Radiation
              Protection and Nuclear Safety Agency (ARPANSA).{" "}
              <a href="https://www.arpansa.gov.au/disclaimer" rel="nofollow">
                ARPANSA disclaimer
              </a>
              .
            </p>
          </>
        ) : (
          <p>
            Forecast: US Environmental Protection Agency.{" "}
            <a href="https://www.epa.gov/sunsafety/uv-index-scale-0" rel="nofollow">
              About the EPA UV Index
            </a>
            .
          </p>
        )}
        {view.hasForecast && (
          <p>
            Forecast peaks contain modified Copernicus Atmosphere Monitoring Service
            information {now.getUTCFullYear()}. Neither the European Commission nor
            ECMWF is responsible for any use of this information.
          </p>
        )}
        <p>Made with Natural Earth.</p>
      </div>
    </Layout>
  );
}
