/**
 * Tomorrow's forecast peak for every city in a country.
 *
 * Everything here is a forecast and the page never pretends otherwise: no
 * "measured" column, the issue time stated, and the accuracy linked rather
 * than left to be assumed.
 *
 * Before tomorrow's forecast exists the page says when to expect it instead of
 * showing an empty table, because an empty table reads as "no UV tomorrow".
 */
import type { CountrySettings, Location } from "../lib/locations";
import { minutesToClock } from "../lib/chart";
import { localTimeWithZone } from "../lib/time";
import { bandFor, formatUvi, PROTECTION_THRESHOLD } from "../lib/uv";
import { Layout, ORIGIN } from "./Layout";

export interface TomorrowRow {
  readonly location: Location;
  /** Tomorrow's forecast peak, in the city's own day. */
  readonly peak: number | null;
  /** Minutes after local midnight at which the peak occurs. */
  readonly peakMinutes: number | null;
  /** Clear-sky protection window, where the forecast covers the whole day. */
  readonly window: { start: number; end: number } | null;
}

export interface TomorrowView {
  readonly country: CountrySettings;
  readonly rows: readonly TomorrowRow[];
  readonly now: Date;
  /** When the forecast run was issued, ISO UTC. */
  readonly issuedAt: string | null;
  /** A city whose zone the issue time is shown in. */
  readonly issuedTz: string;
  readonly cityPages: boolean;
}

const PAGE_CSS = `
.lead{background:var(--card);border:1px solid var(--line);border-radius:12px;
padding:16px;margin:16px 0}
.lead .n{font-size:2.8rem;font-weight:700;line-height:1;font-variant-numeric:tabular-nums;
letter-spacing:-.03em}
.lead .row{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.band{display:inline-block;padding:3px 10px;border-radius:999px;font-weight:600;font-size:.95rem}
table{border-collapse:collapse;width:100%;margin:8px 0}
th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line)}
thead th{font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;
color:var(--muted);font-weight:600}
tbody th{font-weight:400}
td.n{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
td.t{color:var(--muted);font-size:.85rem;white-space:nowrap}
.credits{margin-top:28px;padding-top:12px;border-top:1px solid var(--line);
font-size:.82rem;color:var(--muted)}
.credits p{margin:4px 0}
@media (max-width:460px){th.hide,td.hide{display:none}}
`;

export function TomorrowPage(view: TomorrowView) {
  const { country, rows, now } = view;
  const withData = rows.filter((r) => r.peak !== null);
  const highest = withData.length
    ? withData.reduce((a, b) => (b.peak! > a.peak! ? b : a))
    : null;
  const band = highest ? bandFor(highest.peak!) : null;

  const title = `UV Index ${country.name} Tomorrow: Forecast for Every City`;
  const description =
    `Tomorrow's forecast UV index for cities across ${country.name}: peak level, ` +
    "when it occurs, and the hours sun protection is needed.";
  const path = `/${country.code}/tomorrow/`;

  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: title,
      description,
      url: `${ORIGIN}${path}`,
      inLanguage: "en",
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${ORIGIN}/` },
        { "@type": "ListItem", position: 2, name: country.name, item: `${ORIGIN}/${country.code}/` },
        { "@type": "ListItem", position: 3, name: "Tomorrow", item: `${ORIGIN}${path}` },
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

      <h1>UV Index {country.name} tomorrow</h1>

      {highest ? (
        <>
          <div class="lead">
            <div class="row">
              <div class="n">{formatUvi(highest.peak!)}</div>
              <div>
                <p style="margin:0">
                  Highest tomorrow:{" "}
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

          <table>
            <thead>
              <tr>
                <th scope="col">City</th>
                <th scope="col" style="text-align:right">Peak</th>
                <th scope="col">Band</th>
                <th scope="col" class="hide">At</th>
                <th scope="col" class="hide">Protection needed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const b = r.peak !== null ? bandFor(r.peak) : null;
                return (
                  <tr key={r.location.id}>
                    <th scope="row">
                      {view.cityPages ? (
                        <a href={`/${r.location.country}/${r.location.slug}/`}>
                          {r.location.name}
                        </a>
                      ) : (
                        r.location.name
                      )}
                    </th>
                    <td class="n">{r.peak !== null ? formatUvi(r.peak) : "—"}</td>
                    <td>
                      {b ? (
                        <span class="band" style={`background:${b.bg};color:${b.fg}`}>
                          {b.name}
                        </span>
                      ) : (
                        <span class="muted small">no forecast</span>
                      )}
                    </td>
                    <td class="t hide">
                      {r.peakMinutes !== null ? minutesToClock(r.peakMinutes) : "—"}
                    </td>
                    <td class="t hide">
                      {r.window
                        ? `${minutesToClock(r.window.start)} to ${minutesToClock(r.window.end)}`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p class="small muted">
            Sorted by tomorrow's forecast peak, highest first. Times are local to each
            city. Protection hours are the times UV is forecast to reach{" "}
            {PROTECTION_THRESHOLD} or above under clear skies, so they assume no cloud —
            cloud may reduce the level on the day, but it can clear at any time.
          </p>
        </>
      ) : (
        <p>
          Tomorrow's forecast has not been published yet. It is issued twice a day,
          and this page updates with it.
        </p>
      )}

      <p class="small">
        <a href={`/${country.code}/`}>Today's UV in {country.name}</a> ·{" "}
        <a href="/methods/">How accurate is this forecast?</a>
      </p>

      <div class="credits">
        {view.issuedAt && (
          <p>Forecast issued {localTimeWithZone(view.issuedAt, view.issuedTz)}.</p>
        )}
        <p>
          Contains modified Copernicus Atmosphere Monitoring Service information{" "}
          {now.getUTCFullYear()}. Neither the European Commission nor ECMWF is
          responsible for any use of this information.
        </p>
      </div>
    </Layout>
  );
}
