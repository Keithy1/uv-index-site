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

function CountryOutline({
  rows,
  map,
  countryName,
}: {
  rows: readonly CityRow[];
  map: CountryMap;
  countryName: string;
}) {
  const plotted = rows.filter((r) => r.uvi !== null);
  return (
    <div class="mapbox">
      <svg
        viewBox={`0 0 ${map.width} ${map.height}`}
        role="img"
        aria-label={`Map of ${countryName} with a marker for each city. The same figures are listed in the table below.`}
      >
        <path d={map.outlinePath} fill="var(--line)" stroke="var(--muted)" stroke-width="0.8"
          stroke-linejoin="round" opacity="0.75" />
        {plotted.map((r) => {
          const { x, y } = map.project(r.location.lat, r.location.lon);
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

  const title = view.measured
    ? `UV Index ${country.name}: Live Readings for Every City`
    : `UV Index ${country.name}: Today's Forecast for Every City`;
  const description = view.measured
    ? `Live UV index for ${country.name}, measured by ARPANSA and updated every ` +
      "few minutes. Current reading, band and sun protection guidance for each station."
    : `Today's UV index forecast for cities across ${country.name}, from the US ` +
      "Environmental Protection Agency. Peak level, band and sun protection guidance.";
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

      <CountryOutline rows={rows} map={view.map} countryName={country.name} />

      <h2>Every station</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">City</th>
            <th scope="col" style="text-align:right">{view.measured ? "UV now" : "Peak today"}</th>
            <th scope="col">Band</th>
            {view.measured && view.hasForecast && (
              <th scope="col" class="hide" style="text-align:right">Peak today</th>
            )}
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
          : "Sorted by today's forecast peak, highest first. Forecasts are issued daily."}
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
