/**
 * The city page — the one that carries the most search weight, and the one
 * that must never be a thin page with a single number on it.
 *
 * Order, top to bottom: the reading now, when and where it was measured, the
 * sun-protection window, today's curve, tomorrow, what to do, nearby cities,
 * credits. Sections whose data is missing are omitted rather than faked; a
 * page that says "forecast not available" is honest, a page that invents one
 * is not.
 *
 * Two rules enforced here:
 *   * a reading is never shown without its credit, so the attribution lives in
 *     the same component as the number;
 *   * a band colour never carries meaning alone — every reading shows the
 *     number and the band word, for contrast and for screen readers.
 */
import type { Advice } from "../lib/current";
import type { Location } from "../lib/locations";
import { cityLabel, locationsIn } from "../lib/locations";
import type { ChartGeometry, CurvePoint } from "../lib/chart";
import { CHART_PAD_LEFT, curvePeak, describeCurve, LOW_CLOUD_NOTE, minutesToClock, protectionWindow } from "../lib/chart";
import { howLongAgo, localDate, localeFor, localTimeWithZone } from "../lib/time";
import { bandFor, formatUvi, PROTECTION_THRESHOLD } from "../lib/uv";
import type { CityNormals } from "../lib/normals";
import { Layout, ORIGIN } from "./Layout";
import { NORMALS_CSS, ThisTimeOfYear } from "./ThisTimeOfYear";
import { DAY_STRIP_CSS, DayStripView } from "./DayStrip";
import type { DayStrip } from "../lib/strip";

export interface CityView {
  readonly location: Location;
  readonly now: Date;
  /** The reading to present as "now", or null when there is none. */
  readonly reading: { uvi: number; validAt: string; stale: boolean } | null;
  /** Today's forecast curve, cloud-adjusted. */
  readonly curve: readonly CurvePoint[];
  /** Clear-sky curve, used only for the protection window. */
  readonly clearSky: readonly CurvePoint[];
  readonly geometry: ChartGeometry | null;
  /** Tomorrow's peak, if known. */
  readonly tomorrow: { uvi: number; minutes: number } | null;
  /** True when the forecast came from CAMS, so its credit is required. */
  readonly hasForecast: boolean;
  /**
   * Whether this city has an instrument. Australia does; the United States
   * has only forecasts, and the page must not imply a measurement where there
   * is none -- so this changes the wording and the credit, not just the data.
   */
  readonly measured: boolean;
  /** Which source to credit beneath the reading. */
  readonly credit: "arpansa" | "epa";
  /**
   * The level the advice is for, which is NOT the current reading. See
   * lib/current.ts: at 12:19 am this page said "no protection needed" beside
   * its own forecast of 12.1 Extreme later the same day.
   */
  readonly advice: Advice | null;
  /** Today from sunrise to sunset, hour by hour, or null with no sun times. */
  readonly strip: DayStrip | null;
  /** Tomorrow's, drawn small. */
  readonly tomorrowStrip: DayStrip | null;
  /** Who made the strip's values: "Forecast by CAMS". */
  readonly stripCredit: string;
  /** Monthly normals for "this time of year", or null where there are none. */
  readonly normals: CityNormals | null;
  /** The current month, 1-12, in the city's own zone. */
  readonly month: number;
}

const PAGE_CSS = `
/* Reading first, then the day strip, then what to do. From 900 px the reading
   and the advice sit side by side over a full-width strip; the DOM order stays
   reading, strip, advice, which is the order on a phone and for a screen reader. */
.top{display:grid;grid-template-columns:minmax(0,1fr);column-gap:var(--s-6)}
@media (min-width:900px){.top{grid-template-columns:minmax(0,1fr) minmax(0,1fr);
grid-template-areas:"now todo" "strip strip"}.top>.now{grid-area:now}
.top>.strip{grid-area:strip}.top>.todo{grid-area:todo}.todo h2{margin-top:var(--s-4)}}
/* The reading is the one panel on the page, in Cloud. The chart, the map and
   the lists below it sit on the page itself (audit finding G2). */
.reading{margin:var(--s-4) 0 var(--s-2);background:var(--cloud);border-radius:4px;padding:var(--s-4)}
.reading .row{display:flex;align-items:center;flex-wrap:wrap;gap:var(--s-2) var(--s-4)}
.reading .n{font-size:var(--t-reading);line-height:1;font-weight:800;letter-spacing:-.02em}
.reading .band{font-size:var(--t-2);padding:var(--s-1) var(--s-3)}
.band{display:inline-block;white-space:nowrap;padding:2px var(--s-2);border-radius:4px;font-weight:700;font-size:var(--t-0)}
.peakfig{font-size:var(--t-2);color:var(--shade);margin:0 2px}
.advice{margin:var(--s-3) 0 0}
.delayed{border-left:4px solid var(--shade);padding-left:var(--s-3);margin:var(--s-3) 0}
/* Kept for a future ad, at a fixed size, so switching ads on moves nothing.
   Empty while they are off. Never between a number and its credit. */
.adslot{min-height:100px;margin:var(--s-5) 0}
.rest{display:grid;grid-template-columns:minmax(0,1fr);column-gap:var(--s-6)}
@media (min-width:900px){.rest{grid-template-columns:minmax(0,1fr) minmax(0,1fr) 300px;
grid-template-areas:"chart chart chart" "tomorrow normals ad" "nearby nearby nearby"}
.rest>.chart{grid-area:chart}.rest>.tomorrow{grid-area:tomorrow}.rest>.normals-sec{grid-area:normals}
.rest>.adslot{grid-area:ad;min-height:250px}.rest>.nearby-sec{grid-area:nearby}}
/* The chart's geometry is SVG, stretched to the box; its words are HTML laid
   over it. A 640-wide viewBox scaled to a 360 px phone set 11-unit labels at
   about 7 px. Text in HTML stays at its own size whatever the chart's width,
   and vector-effect keeps the strokes from stretching with it. Positions are
   percentages of the plot, taken from the same geometry as the paths. */
.chartbox{margin:var(--s-2) 0 0;padding:var(--s-2) 0}
.plot{position:relative;height:200px;margin:4px 4px 0 32px}
.plot svg{display:block;width:100%;height:100%;overflow:visible}
.plot .hl{position:absolute;bottom:0;transform:translateX(-50%);font-size:var(--t-0);
line-height:1;color:var(--haze);white-space:nowrap}
.plot .lv{position:absolute;left:-30px;width:24px;transform:translateY(-50%);text-align:center;
font-size:12px;font-weight:700;line-height:1;padding:2px 0;border-radius:4px}
.plot .nowl{position:absolute;top:0;font-size:12px;font-weight:700;line-height:1;color:var(--haze)}
.plot .dot{position:absolute;width:14px;height:14px;border-radius:50%;
transform:translate(-50%,-50%);border:2px solid var(--sky)}
@media (min-width:620px){.plot{height:240px}}
details.table{margin:var(--s-3) 0}
details.table summary{cursor:pointer;font-weight:700;color:var(--zenith)}
details.table table{border-collapse:collapse;margin:var(--s-2) 0;min-width:16rem;background:var(--cloud)}
details.table th,details.table td{text-align:left;padding:var(--s-1) var(--s-4) var(--s-1) var(--s-2);
border-bottom:1px solid var(--horizon)}
details.table thead th{font-size:var(--t-0);color:var(--haze);font-weight:700}
details.table tbody th{font-weight:400}
ul.todo{margin:var(--s-2) 0;padding-left:20px}
ul.todo li{margin:var(--s-1) 0}
.nearby{display:flex;gap:var(--s-2) var(--s-4);flex-wrap:wrap;margin:var(--s-2) 0;padding:0;list-style:none}
/* Where the day has got to, on a chart with no measured dot to show it. Grey
   and dashed, in no band colour, so it reads as a time and not a reading. */
.nowmark line{stroke:var(--shade);stroke-width:1;stroke-dasharray:3 3;opacity:.5}
/* No motion here, on purpose. The curve used to draw itself in, the shading
   fade and the measured dot pop: for most of a second the chart showed a day
   that was not the forecast. Readings never animate. */
.reading .credit{margin:var(--s-2) 0 0;font-size:var(--t-0);color:var(--haze)}
.credits{margin-top:var(--s-6);padding-top:var(--s-3);border-top:1px solid var(--horizon);
font-size:var(--t-0);color:var(--haze)}
.credits p{margin:var(--s-1) 0}
`;

/** Band-specific advice. Kept short, and tied to the number, not the colour. */
function whatToDo(uvi: number): string[] {
  const band = bandFor(uvi).name;
  if (band === "Low") {
    return [
      "No protection needed for most people during normal outdoor activity.",
      "If you burn easily or will be out for hours, a hat and sunscreen still help.",
    ];
  }
  const common = [
    "Slip on clothing that covers your shoulders and back.",
    "Slop on SPF 50+ sunscreen 20 minutes before going out, and reapply every two hours.",
    "Slap on a broad-brimmed hat, and wrap on sunglasses.",
  ];
  if (band === "Moderate") {
    return [...common, "Seek shade around the middle of the day."];
  }
  if (band === "High" || band === "Very High") {
    return [
      ...common,
      "Stay in the shade between mid-morning and mid-afternoon where you can.",
      "Water, sand and concrete reflect UV and increase your exposure.",
    ];
  }
  return [
    ...common,
    "Avoid being outside between mid-morning and mid-afternoon if at all possible.",
    "Unprotected skin can burn in minutes at this level.",
    "Water, sand and concrete reflect UV and increase your exposure.",
  ];
}

/** A strip with nothing in it says nothing; the page says so in words instead. */
function showStrip(strip: DayStrip | null): boolean {
  return strip !== null && strip.missing < strip.cells.length;
}

/** A geometry position as a percentage of the plot, which starts at the left pad. */
function pctX(g: ChartGeometry, x: number): string {
  return `${(((x - CHART_PAD_LEFT) / (g.width - CHART_PAD_LEFT)) * 100).toFixed(2)}%`;
}
function pctY(g: ChartGeometry, y: number): string {
  return `${((y / g.height) * 100).toFixed(2)}%`;
}

/** "12:00 pm: UV 9.0 Very High", for the tooltip on each hour. */
function hourTitle(p: { minutes: number; uvi: number }): string {
  return `${minutesToClock(p.minutes)}: UV ${formatUvi(p.uvi)} ${bandFor(p.uvi).name}`;
}

function Chart({ geometry, summary, peak }: { geometry: ChartGeometry; summary: string; peak: CurvePoint | null }) {
  const g = geometry;
  const left = CHART_PAD_LEFT;
  const top = 16, bottom = g.height - 24;
  return (
    <>
      <div class="chartbox">
        <div class="plot">
          {/* The left pad is cropped off the viewBox, and the level labels sit
              in HTML in the margin instead. The same information is in the
              sentence below and the table under it, in words. */}
          <svg
            viewBox={`${left} 0 ${g.width - left} ${g.height}`}
            role="img"
            aria-label={summary}
            preserveAspectRatio="none"
          >
            {g.hours.map((h) => (
              <line key={h.label} x1={h.x} y1={top} x2={h.x} y2={bottom}
                stroke="var(--horizon)" stroke-width="1" vector-effect="non-scaling-stroke" />
            ))}
            {/* 3 keeps its dashed rule: it is where protection starts. The
                other levels get a faint solid line, there to read against. */}
            {g.levels.map((l) => (
              <line key={l.uvi} x1={left} y1={l.y} x2={g.width - 12} y2={l.y}
                stroke={l.uvi === 3 ? "var(--haze)" : "var(--horizon)"} stroke-width="1"
                stroke-dasharray={l.uvi === 3 ? "4 4" : undefined}
                vector-effect="non-scaling-stroke" />
            ))}
            {g.now && (
              <g class="nowmark">
                <line x1={g.now.x} y1={top} x2={g.now.x} y2={bottom} vector-effect="non-scaling-stroke" />
              </g>
            )}
            <path class="area" d={g.areaPath} fill="var(--zenith)" opacity="0.14" />
            <path class="line" d={g.linePath} fill="none" stroke="var(--zenith)"
              stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"
              vector-effect="non-scaling-stroke" />
            {/* One invisible column per hour, so pointing at the chart names
                the hour and its level. Native tooltips, so no script. */}
            {g.points.map((p, i) => {
              const prev = g.points[i - 1], next = g.points[i + 1];
              const x0 = prev ? (prev.x + p.x) / 2 : left;
              const x1 = next ? (next.x + p.x) / 2 : g.width - 12;
              return (
                <rect key={p.minutes} x={x0.toFixed(1)} y="0" width={(x1 - x0).toFixed(1)}
                  height={g.height} fill="transparent">
                  <title>{hourTitle(p)}</title>
                </rect>
              );
            })}
          </svg>
          {/* Each level in its band's colour, as a pill rather than coloured
              text: Moderate's yellow is unreadable as text on a light
              background, but band.fg on band.bg meets contrast everywhere. */}
          {g.levels.map((l) => (
            <span key={l.uvi} class="lv" aria-hidden="true"
              style={`top:${pctY(g, l.y)};background:${bandFor(l.uvi).bg};color:${bandFor(l.uvi).fg}`}>
              {l.uvi}
            </span>
          ))}
          {g.hours.map((h) => (
            <span key={h.label} class="hl" aria-hidden="true" style={`left:${pctX(g, h.x)}`}>{h.label}</span>
          ))}
          {g.now && (
            <span class="nowl" aria-hidden="true"
              style={`left:${pctX(g, g.now.x)};transform:translateX(${
                g.now.x > g.width - 40 ? "-100%" : g.now.x < 48 ? "0" : "-50%"})`}>
              Now
            </span>
          )}
          {g.measured && (
            <span class="dot" aria-hidden="true"
              style={`left:${pctX(g, g.measured.x)};top:${pctY(g, g.measured.y)};background:${bandFor(g.measured.uvi).bg}`} />
          )}
        </div>
      </div>
      {peak ? (
        <p class="small muted peakline">
          Peak <strong class="peakfig">{formatUvi(peak.uvi)}</strong>{" "}
          <span class="band" style={`background:${bandFor(peak.uvi).bg};color:${bandFor(peak.uvi).fg}`}>
            {bandFor(peak.uvi).name}
          </span>{" "}
          at {minutesToClock(peak.minutes)}, with cloud included.
          {peak.uvi < PROTECTION_THRESHOLD ? ` ${LOW_CLOUD_NOTE}` : ""}
        </p>
      ) : (
        <p class="small muted">{summary}</p>
      )}
      <details class="table">
        <summary>Hour by hour</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">UV index</th>
              <th scope="col">Band</th>
            </tr>
          </thead>
          <tbody>
            {g.points.map((p) => (
              <tr key={p.minutes}>
                <td>{minutesToClock(p.minutes)}</td>
                <td>{formatUvi(p.uvi)}</td>
                <td>{bandFor(p.uvi).name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

export function CityPage(view: CityView) {
  const { location: loc, reading, now } = view;
  const tz = loc.tz;
  const locale = localeFor(loc.country);
  // Carries the state for a US city, so the title and H1 say which Portland.
  const label = cityLabel(loc);
  const band = reading ? bandFor(reading.uvi) : null;
  const window = view.clearSky.length ? protectionWindow(view.clearSky) : null;
  const nearby = locationsIn(loc.country)
    .filter((l) => l.id !== loc.id && l.status === "live")
    .slice(0, 3);

  // The title must not promise what the page has not got. It said "Live
  // Reading and Forecast" for every city, including the fifty US ones that
  // have no instrument and say so three lines later: the body read "Forecast
  // for 11:00 AM EDT" under a title offering a live reading. A title that
  // oversells its own page is the kind of mismatch Google reads as a reason to
  // rewrite it, and it is a promise this site cannot keep.
  const title = view.measured
    ? `UV Index ${label} Today: Live Reading and Forecast`
    : `UV Index ${label} Today: Hourly Forecast`;
  const description = view.measured
    ? `Live UV index for ${label}, measured by ARPANSA and updated every ` +
      `few minutes, with today's forecast curve and sun protection times.`
    : `UV index forecast for ${label}: the level now, today's curve, ` +
      `tomorrow's peak and sun protection times.`;
  const path = `/${loc.country}/${loc.slug}/`;

  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: title,
      description,
      url: `${ORIGIN}${path}`,
      inLanguage: "en-AU",
      about: {
        "@type": "Place",
        name: label,
        geo: { "@type": "GeoCoordinates", latitude: loc.lat, longitude: loc.lon },
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${ORIGIN}/` },
        { "@type": "ListItem", position: 2, name: "Australia", item: `${ORIGIN}/au/` },
        { "@type": "ListItem", position: 3, name: label, item: `${ORIGIN}${path}` },
      ],
    },
  ];

  return (
    <Layout
      title={title}
      description={description}
      path={path}
      country={loc.country}
      structuredData={structuredData}
    >
      <style dangerouslySetInnerHTML={{ __html: PAGE_CSS + DAY_STRIP_CSS + (view.normals ? NORMALS_CSS : "") }} />

      <h1>UV index {label} today</h1>

      <div class="top">
        <section class="now">
          {reading ? (
            <>
              <div class="reading">
                <div class="row">
                  <div class="n">{formatUvi(reading.uvi)}</div>
                  {/* Number and word together: colour alone never carries meaning. */}
                  <span class="band" style={`background:${band!.bg};color:${band!.fg}`}>
                    {band!.name}
                  </span>
                </div>
                <p class="advice">{band!.advice}</p>
                {/* The credit is part of the reading, not a footnote to it: who
                    produced the number, and for when. */}
                <p class="credit">
                  {view.measured ? (
                    reading.stale ? (
                      <>
                        Last measured by ARPANSA at {localTimeWithZone(reading.validAt, tz, locale)} on{" "}
                        {localDate(reading.validAt, tz, locale)}, {howLongAgo(reading.validAt, now)}
                      </>
                    ) : (
                      <>
                        Measured by ARPANSA at {localTimeWithZone(reading.validAt, tz, locale)},{" "}
                        {howLongAgo(reading.validAt, now)}
                      </>
                    )
                  ) : (
                    <>
                      {/* Never "measured": there is no US instrument. And say
                          whose clock it is: "6:00 pm PDT on Monday, October 26",
                          read in Sydney on Tuesday the 27th, looked like a stale
                          date; it is the hour nearest now, in this city's time. */}
                      Forecast by the US EPA and CAMS for {localTimeWithZone(reading.validAt, tz, locale)} on{" "}
                      {localDate(reading.validAt, tz, locale)}, the current hour in {loc.name}
                    </>
                  )}
                </p>
              </div>

              {view.measured && reading.stale && (
                <p class="delayed">
                  <strong>Live reading delayed.</strong> ARPANSA's {loc.name} station has not
                  reported recently, so this is the last reading it sent rather than the
                  level right now.
                </p>
              )}

              {reading.uvi < 0.5 && (
                <p>
                  UV is effectively zero at {loc.name} right now.
                  {view.tomorrow
                    ? ` Tomorrow is forecast to peak at ${formatUvi(view.tomorrow.uvi)} around ${minutesToClock(view.tomorrow.minutes)}.`
                    : ""}
                </p>
              )}
            </>
          ) : (
            <p>
              {view.measured
                ? `No measured reading is available for ${loc.name} at the moment. This page updates as soon as ARPANSA's station reports again.`
                : `No current forecast is available for ${loc.name}. This page updates when the next forecast is published.`}
            </p>
          )}

          {loc.stationNote && <p class="small muted">{loc.stationNote}</p>}
        </section>

        {showStrip(view.strip) ? (
          <DayStripView strip={view.strip!} credit={view.stripCredit} />
        ) : (
          window && (
            // No strip to bracket (no forecast for today yet), but the
            // protection window still stands on its own.
            <p class="strip">
              <strong>Cover up {minutesToClock(window.start)} to {minutesToClock(window.end)}</strong>{" "}
              <span class="small muted">
                when the clear-sky forecast reaches {PROTECTION_THRESHOLD} or above
              </span>
            </p>
          )
        )}

        {view.advice && (
          <section class="todo">
            <h2>
              {view.advice.scope === "tomorrow"
                ? "What to do tomorrow"
                : view.advice.scope === "today"
                  ? "What to do today"
                  : "What to do now"}
            </h2>
            {/* The level this advice is for, stated, because it is deliberately
                not the reading at the top of the page. */}
            <p class="small muted">
              {view.advice.scope === "tomorrow"
                ? "Tomorrow is forecast to reach "
                : view.advice.scope === "today"
                  ? "UV is forecast to reach "
                  : "At "}
              <strong>{formatUvi(view.advice.uvi)}</strong>{" "}
              <span
                class="band"
                style={`background:${bandFor(view.advice.uvi).bg};color:${bandFor(view.advice.uvi).fg}`}
              >
                {bandFor(view.advice.uvi).name}
              </span>
              {view.advice.scope === "today"
                ? " later today."
                : view.advice.peak
                  ? (
                    <>
                      {" now, up to "}
                      <strong>{formatUvi(view.advice.peak.uvi)}</strong>
                      {` around ${minutesToClock(view.advice.peak.minutes)}.`}
                    </>
                  )
                  : "."}
            </p>
            <ul class="todo">
              {whatToDo(view.advice.uvi).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p class="small">
              <a href="/uv-index-explained/">What the UV index numbers mean</a>
            </p>
          </section>
        )}
      </div>

      <div class="rest">
        <div class="adslot" aria-hidden="true" />

        {view.tomorrow && (
          <section class="tomorrow">
            <h2>Tomorrow</h2>
            <p>
              Forecast to peak at <strong>{formatUvi(view.tomorrow.uvi)}</strong>{" "}
              <span class="band" style={`background:${bandFor(view.tomorrow.uvi).bg};color:${bandFor(view.tomorrow.uvi).fg}`}>
                {bandFor(view.tomorrow.uvi).name}
              </span>{" "}
              around {minutesToClock(view.tomorrow.minutes)}.
            </p>
            {showStrip(view.tomorrowStrip) && (
              <DayStripView strip={view.tomorrowStrip!} credit={view.stripCredit} compact />
            )}
          </section>
        )}

        {view.geometry && (
          <section class="chart">
            <h2>Today's forecast</h2>
            <Chart geometry={view.geometry} summary={describeCurve(view.curve)} peak={curvePeak(view.curve)} />
          </section>
        )}

        {view.normals && (
          <section class="normals-sec">
            <ThisTimeOfYear normals={view.normals} month={view.month} city={loc.name} />
          </section>
        )}

        {nearby.length > 0 && (
          <section class="nearby-sec">
            <h2>Nearby</h2>
            <ul class="nearby">
              {nearby.map((l) => (
                <li key={l.id}>
                  <a href={`/${l.country}/${l.slug}/`}>{l.name}</a>
                </li>
              ))}
              <li>
                <a href={`/${loc.country}/#tomorrow`}>All cities, today and tomorrow</a>
              </li>
            </ul>
          </section>
        )}
      </div>

      {/* The credit lives with the data it covers, so no page can show a
          reading without it. */}
      <div class="credits">
        {reading && view.credit === "epa" && (
          <p>
            Forecast: US Environmental Protection Agency and the Copernicus
            Atmosphere Monitoring Service.{" "}
            <a href="https://www.epa.gov/sunsafety/uv-index-scale-0" rel="nofollow">
              About the EPA UV Index
            </a>
            .
          </p>
        )}
        {reading && view.credit === "arpansa" && (
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
        )}
        {view.hasForecast && (
          <p>
            Forecast contains modified Copernicus Atmosphere Monitoring Service
            information {new Date().getUTCFullYear()}. Neither the European Commission
            nor ECMWF is responsible for any use of this information.
          </p>
        )}
      </div>
    </Layout>
  );
}
