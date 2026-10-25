/**
 * A deliberately plain page that proves the data path end to end:
 * ARPANSA -> cron -> D1 -> server-rendered HTML.
 *
 * This is not the launch design. It exists so that the Worker, the database and
 * the credits are all exercised before any layout work starts, and it carries
 * the ARPANSA attribution because the rule is that no template may show a
 * reading without its credit.
 */
import { locationsIn } from "../lib/locations";
import type { LatestReading } from "../lib/store";
import { bandFor, formatUvi } from "../lib/uv";

interface Props {
  readonly latest: Map<string, LatestReading>;
  readonly generatedAt: Date;
}

/** The reading's own local time, in the city's zone. */
function localTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

export function Preview({ latest, generatedAt }: Props) {
  const cities = locationsIn("au");

  return (
    <html lang="en-AU">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Not for indexing: this preview is replaced by the real templates. */}
        <meta name="robots" content="noindex" />
        <title>uvatlas — data path preview</title>
        <style>{`
          :root { color-scheme: light dark; }
          body { font: 16px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 48rem; padding: 1.5rem; }
          table { border-collapse: collapse; width: 100%; }
          th, td { text-align: left; padding: .4rem .5rem; border-bottom: 1px solid #8884; }
          td.n { text-align: right; font-variant-numeric: tabular-nums; }
          .band { display: inline-block; padding: .1rem .45rem; border-radius: .25rem; font-size: .85rem; }
          .stale { opacity: .6; }
          footer { margin-top: 2rem; font-size: .85rem; color: #6668; }
          footer p { color: inherit; }
        `}</style>
      </head>
      <body>
        <h1>Australia — measured UV index</h1>
        <p>
          Preview of the data path only. Page templates, forecasts and the world map
          are not built yet.
        </p>

        <table>
          <thead>
            <tr>
              <th scope="col">City</th>
              <th scope="col" class="n">UV</th>
              <th scope="col">Band</th>
              <th scope="col">Measured</th>
            </tr>
          </thead>
          <tbody>
            {cities.map((city) => {
              const reading = latest.get(city.id);
              if (!reading) {
                return (
                  <tr key={city.id} class="stale">
                    <td>{city.name}</td>
                    <td class="n">—</td>
                    <td>no data yet</td>
                    <td>—</td>
                  </tr>
                );
              }
              const band = bandFor(reading.uvi);
              return (
                <tr key={city.id} class={reading.stale ? "stale" : undefined}>
                  <td>{city.name}</td>
                  <td class="n">{formatUvi(reading.uvi)}</td>
                  <td>
                    <span class="band" style={`background:${band.bg};color:${band.fg}`}>
                      {band.name}
                    </span>
                  </td>
                  <td>
                    {localTime(reading.validAt, city.tz)}
                    {reading.stale ? " (delayed)" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <footer>
          {/* ARPANSA's licence requires this wherever a reading appears. */}
          <p>UV observations courtesy of ARPANSA.</p>
          <p>
            © Commonwealth of Australia as represented by the Australian Radiation
            Protection and Nuclear Safety Agency (ARPANSA).
          </p>
          <p>Not a substitute for medical advice.</p>
          <p>Generated {generatedAt.toISOString()}.</p>
        </footer>
      </body>
    </html>
  );
}
