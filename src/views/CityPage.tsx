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
import { describeCurve, minutesToClock, protectionWindow } from "../lib/chart";
import { howLongAgo, localDate, localeFor, localTimeWithZone } from "../lib/time";
import { bandFor, formatUvi, PROTECTION_THRESHOLD } from "../lib/uv";
import type { CityNormals } from "../lib/normals";
import { Layout, ORIGIN } from "./Layout";
import { NORMALS_CSS, ThisTimeOfYear } from "./ThisTimeOfYear";

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
  /** Monthly normals for "this time of year", or null where there are none. */
  readonly normals: CityNormals | null;
  /** The current month, 1-12, in the city's own zone. */
  readonly month: number;
}

const PAGE_CSS = `
.reading{display:flex;align-items:center;gap:18px;margin:16px 0 8px;
background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
.reading .n{font-size:3.4rem;line-height:1;font-weight:700;font-variant-numeric:tabular-nums;
letter-spacing:-.03em}
.band{display:inline-block;padding:3px 10px;border-radius:999px;font-weight:600;font-size:.95rem}
.advice{margin:6px 0 0}
.delayed{border-left:4px solid #d32010;padding-left:12px;margin:12px 0}
.chartbox{margin:8px 0 0;border:1px solid var(--line);border-radius:12px;padding:8px;
background:var(--card)}
.chartbox svg{display:block;width:100%;height:auto}
.window{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin:10px 0}
.window strong{font-size:1.1rem}
ul.todo{margin:8px 0;padding-left:20px}
ul.todo li{margin:4px 0}
.nearby{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0;padding:0;list-style:none}
.nearby a{display:inline-block;padding:6px 12px;border:1px solid var(--line);
border-radius:999px;text-decoration:none}
.credits{margin-top:28px;padding-top:12px;border-top:1px solid var(--line);
font-size:.82rem;color:var(--muted)}
.credits p{margin:4px 0}
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

function Chart({ geometry, summary }: { geometry: ChartGeometry; summary: string }) {
  const g = geometry;
  return (
    <>
      <div class="chartbox">
        {/* The chart is decorative to assistive technology: the same
            information is in the sentence below it, in words. */}
        <svg
          viewBox={`0 0 ${g.width} ${g.height}`}
          role="img"
          aria-label={summary}
          preserveAspectRatio="xMidYMid meet"
        >
          {g.hours.map((h) => (
            <g key={h.label}>
              <line x1={h.x} y1={16} x2={h.x} y2={g.height - 24}
                stroke="var(--line)" stroke-width="1" />
              <text x={h.x} y={g.height - 8} fill="var(--muted)"
                font-size="11" text-anchor="middle">{h.label}</text>
            </g>
          ))}
          {g.levels.map((l) => (
            <g key={l.uvi}>
              {/* 3 keeps its dashed rule: it is where protection starts. The
                  other levels get a faint solid line, there to read against. */}
              <line x1={28} y1={l.y} x2={g.width - 12} y2={l.y}
                stroke={l.uvi === 3 ? "var(--muted)" : "var(--line)"} stroke-width="1"
                stroke-dasharray={l.uvi === 3 ? "4 4" : undefined} />
              <text x={22} y={l.y + 4} fill="var(--muted)" font-size="11"
                text-anchor="end">{l.uvi}</text>
            </g>
          ))}
          <path d={g.areaPath} fill="var(--link)" opacity="0.14" />
          <path d={g.linePath} fill="none" stroke="var(--link)" stroke-width="2.5"
            stroke-linejoin="round" stroke-linecap="round" />
          {g.measured && (
            <circle cx={g.measured.x} cy={g.measured.y} r="5"
              fill={bandFor(g.measured.uvi).bg} stroke="var(--bg)" stroke-width="2" />
          )}
        </svg>
      </div>
      <p class="small muted">{summary}</p>
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
      <style dangerouslySetInnerHTML={{ __html: PAGE_CSS + (view.normals ? NORMALS_CSS : "") }} />

      <h1>UV Index {label} today</h1>

      {reading ? (
        <>
          <p class="muted small">
            {view.measured ? (
              <>
                {reading.stale ? "Last measured " : "Measured "}
                {localTimeWithZone(reading.validAt, tz, locale)} on {localDate(reading.validAt, tz, locale)}
                {" · "}
                {howLongAgo(reading.validAt, now)}
              </>
            ) : (
              <>
                {/* Never "measured": there is no US instrument to measure it.
                    And say whose clock it is. "Forecast for 6:00 PM PDT on
                    Monday, October 26", read in Sydney on Tuesday the 27th,
                    looked like a stale date or the time the forecast was made;
                    it is the hourly value for the hour nearest now, in this
                    city's own time. */}
                Hourly forecast for {localTimeWithZone(reading.validAt, tz, locale)}, the
                current hour in {loc.name} ({localDate(reading.validAt, tz, locale)})
              </>
            )}
          </p>

          <div class="reading">
            <div class="n">{formatUvi(reading.uvi)}</div>
            <div>
              {/* Number and word together: colour alone never carries meaning. */}
              <span class="band" style={`background:${band!.bg};color:${band!.fg}`}>
                {band!.name}
              </span>
              <p class="advice">{band!.advice}</p>
            </div>
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

      {window && (
        <>
          <h2>Sun protection times</h2>
          <div class="window">
            <strong>
              {minutesToClock(window.start)} to {minutesToClock(window.end)}
            </strong>
            <span class="muted small">
              when UV is forecast to reach {PROTECTION_THRESHOLD} or above
            </span>
          </div>
          {/* Deliberately the clear-sky figure: cloud can break at any time, and
              under-warning is the dangerous error. Said plainly on the page. */}
          <p class="small muted">
            Calculated from the clear-sky forecast, so it assumes no cloud. Cloud may
            reduce the UV level on the day, but it can clear at any time — treat these
            as the hours to be careful.
          </p>
        </>
      )}

      {view.geometry && (
        <>
          <h2>Today's forecast</h2>
          <Chart geometry={view.geometry} summary={describeCurve(view.curve)} />
        </>
      )}

      {view.tomorrow && (
        <>
          <h2>Tomorrow</h2>
          <p>
            Forecast to peak at <strong>{formatUvi(view.tomorrow.uvi)}</strong>{" "}
            <span class="band" style={`background:${bandFor(view.tomorrow.uvi).bg};color:${bandFor(view.tomorrow.uvi).fg}`}>
              {bandFor(view.tomorrow.uvi).name}
            </span>{" "}
            around {minutesToClock(view.tomorrow.minutes)}.
          </p>
        </>
      )}

      {view.normals && (
        <ThisTimeOfYear normals={view.normals} month={view.month} city={loc.name} />
      )}

      {view.advice && (
        <>
          <h2>
            {view.advice.scope === "tomorrow" ? "What to do tomorrow" : "What to do today"}
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
            {view.advice.scope === "today" ? " later today." : "."}
          </p>
          <ul class="todo">
            {whatToDo(view.advice.uvi).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p class="small">
            <a href="/uv-index-explained/">What the UV index numbers mean</a>
          </p>
        </>
      )}

      {nearby.length > 0 && (
        <>
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
        </>
      )}

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
