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
import { OUTLINE_PATH, VIEW_HEIGHT, VIEW_WIDTH, project } from "../lib/map-au";
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
}

export interface CountryView {
  readonly country: CountrySettings;
  readonly rows: readonly CityRow[];
  readonly now: Date;
  readonly hasForecast: boolean;
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

function CountryMap({ rows }: { rows: readonly CityRow[] }) {
  const plotted = rows.filter((r) => r.uvi !== null);
  return (
    <div class="mapbox">
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-label="Map of Australia with a marker for each measuring station. The same readings are listed in the table below."
      >
        <path d={OUTLINE_PATH} fill="var(--line)" stroke="var(--muted)" stroke-width="0.8"
          stroke-linejoin="round" opacity="0.75" />
        {plotted.map((r) => {
          const { x, y } = project(r.location.lat, r.location.lon);
          const band = bandFor(r.uvi!);
          return (
            <g key={r.location.id}>
              <circle cx={x} cy={y} r="6" fill={band.bg} stroke="var(--bg)" stroke-width="1.5" />
              <text x={x} y={y + 3.2} font-size="7.5" font-weight="700" fill={band.fg}
                text-anchor="middle">{Math.round(r.uvi!)}</text>
            </g>
          );
        })}
      </svg>
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

  const title = `UV Index Australia: Live Readings for Every City`;
  const description =
    "Live UV index for Australian cities, measured by ARPANSA and updated every " +
    "few minutes. Current reading, band and sun protection guidance for each station.";
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

      <h1>UV Index Australia</h1>

      {highest ? (
        <div class="lead">
          <div class="row">
            <div class="n">{formatUvi(highest.uvi!)}</div>
            <div>
              <p style="margin:0">
                Highest now:{" "}
                <strong>
                  <a href={`/${highest.location.country}/${highest.location.slug}/`}>
                    {highest.location.name}
                  </a>
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
          No current readings are available. ARPANSA's stations report every few
          minutes; this page updates with them.
        </p>
      )}

      <CountryMap rows={rows} />

      <h2>Every station</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">City</th>
            <th scope="col" style="text-align:right">UV now</th>
            <th scope="col">Band</th>
            {view.hasForecast && <th scope="col" class="hide" style="text-align:right">Peak today</th>}
            <th scope="col" class="hide">Measured</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const b = r.uvi !== null ? bandFor(r.uvi) : null;
            return (
              <tr key={r.location.id} class={r.stale ? "stale" : undefined}>
                <th scope="row">
                  <a href={`/${r.location.country}/${r.location.slug}/`}>{r.location.name}</a>
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
                {view.hasForecast && (
                  <td class="n hide">{r.peak !== null ? formatUvi(r.peak) : "—"}</td>
                )}
                <td class="t hide">
                  {r.validAt ? localTimeWithZone(r.validAt, r.location.tz) : "—"}
                  {r.stale ? " (delayed)" : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p class="small muted">
        Sorted by the current reading, highest first. Times are local to each city.
      </p>

      <p class="small">
        <a href="/uv-index-explained/">What the UV index numbers mean</a>
      </p>

      <div class="credits">
        <p>UV observations courtesy of ARPANSA.</p>
        <p>
          © Commonwealth of Australia as represented by the Australian Radiation
          Protection and Nuclear Safety Agency (ARPANSA).{" "}
          <a href="https://www.arpansa.gov.au/disclaimer" rel="nofollow">
            ARPANSA disclaimer
          </a>
          .
        </p>
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
