/**
 * "This time of year": how high UV usually gets in this city this month.
 *
 * The design's one feature no competitor has, and the main reason a city page
 * is more than one number. Australia's figures are ARPANSA's measurements;
 * the US's are NOAA's noon forecasts. The wording differs accordingly -- an
 * instrument "recorded", a forecast "put" -- because a page must never pass a
 * forecast off as a measurement (see CLAUDE.md).
 *
 * The credit is inside this component, not in the page's credits block, for
 * the site's standing rule: no figure can be rendered without its source.
 */
import type { CityNormals } from "../lib/normals";
import { MONTH_NAMES, shareOfDays } from "../lib/normals";
import { bandFor, formatUvi } from "../lib/uv";

export const NORMALS_CSS = `
.normals{margin:8px 0 4px;padding-left:20px}
.normals li{margin:3px 0}
.months{display:block;width:100%;height:auto;margin:10px 0 2px}
.months text{font:11px system-ui,sans-serif;fill:var(--muted)}
.months .now text{fill:var(--fg);font-weight:700}
`;

/** Twelve bars of the median daily peak, this month outlined. Server-drawn. */
function MonthStrip({ normals, month }: { normals: CityNormals; month: number }) {
  // H leaves room under the bars for the month letters and, under this month,
  // its value -- a first cut at 96 clipped that value off the bottom edge.
  const W = 420, H = 108, top = 6, base = 74, gap = 6;
  const bar = (W - gap * 11) / 12;
  const scale = (base - top) / 14; // UV 14 fills the height; higher is clipped
  const label = normals.months
    .map((m, i) => `${MONTH_NAMES[i]} ${m ? formatUvi(m.median) : "no data"}`)
    .join(", ");
  return (
    <svg class="months" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Typical daily peak by month: ${label}`}>
      {normals.months.map((m, i) => {
        const x = i * (bar + gap);
        const h = m ? Math.max(2, Math.min(14, m.median) * scale) : 2;
        const band = m ? bandFor(m.median) : null;
        return (
          <g key={i} class={i + 1 === month ? "now" : undefined}>
            <rect x={x} y={base - h} width={bar} height={h} rx="3"
              fill={band ? band.bg : "var(--line)"}
              stroke={i + 1 === month ? "var(--fg)" : "none"} stroke-width="2" />
            <text x={x + bar / 2} y={base + 14} text-anchor="middle">{MONTH_NAMES[i]![0]}</text>
            {m && i + 1 === month && (
              <text x={x + bar / 2} y={base + 28} text-anchor="middle">{formatUvi(m.median)}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function ThisTimeOfYear({
  normals,
  month,
  city,
}: {
  normals: CityNormals;
  /** 1-12, the month in the city's own zone. */
  month: number;
  city: string;
}) {
  const m = normals.months[month - 1];
  // Too few valid days for this month: say nothing rather than a thin guess.
  if (!m) return null;

  const name = MONTH_NAMES[month - 1]!;
  const band = bandFor(m.median);
  const measured = normals.source === "arpansa";
  const years = `${normals.years[0]}–${normals.years[1]}`;
  const forecastFor = normals.via ? normals.via.name : city;

  return (
    <>
      <h2>This time of year</h2>
      <p>
        {measured
          ? `In ${name}, ${city}'s UV typically peaks around `
          : `In ${name}, NOAA's noon forecasts for ${forecastFor} typically put the UV around `}
        <strong>{formatUvi(m.median)}</strong>{" "}
        <span class="band" style={`background:${band.bg};color:${band.fg}`}>
          {band.name}
        </span>
        .
      </p>
      <p class="small muted">
        {measured
          ? `Across ${years}, ARPANSA's measurements reached:`
          : `Across ${years}, NOAA forecast UV of:`}
      </p>
      <ul class="normals">
        <li>3 or more, when sun protection is needed, {shareOfDays(m.protect, name)}</li>
        <li>8 or more, Very High or worse, {shareOfDays(m.veryHigh, name)}</li>
        <li>11 or more, Extreme, {shareOfDays(m.extreme, name)}</li>
      </ul>
      <MonthStrip normals={normals} month={month} />
      {normals.via && (
        <p class="small muted">
          NOAA does not forecast {city} separately; these are its forecasts for{" "}
          {normals.via.name}, {normals.via.state}, {normals.via.km} km away.
        </p>
      )}
      <p class="small muted">
        {measured ? (
          <>
            Calculated by uvatlas from ARPANSA's historical UV measurements on{" "}
            <a href="https://data.gov.au/data/organization/australian-radiation-protection-and-nuclear-safety-agency-arpansa" rel="nofollow">
              data.gov.au
            </a>
            , licensed CC BY 2.5 AU. Each day's peak is its highest five-minute
            average; {m.days} {name} days.
          </>
        ) : (
          <>
            From the NOAA/EPA UV Index bulletins archived by NOAA's{" "}
            <a href="https://www.cpc.ncep.noaa.gov/products/stratosphere/uv_index/" rel="nofollow">
              Climate Prediction Center
            </a>
            : forecasts for solar noon, cloud included, not measurements; {m.days} {name} days.
          </>
        )}
      </p>
    </>
  );
}
