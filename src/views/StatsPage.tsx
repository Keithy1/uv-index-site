/**
 * The private views page, at /stats/<key>/. One reader, one question: is anyone
 * reading, what, and is it growing?
 *
 * Its own shell, not Layout: Layout carries the page-view pixel (this page
 * must not count itself), canonical and share tags, and the public footer.
 * Same tokens and typeface as the site, so it looks like part of it.
 *
 * The chart is HTML, not SVG: columns in a grid stay crisp at any width
 * without a viewBox stretching the text, and each column's title attribute is
 * a hover tooltip with no script.
 */
import { FONT_CSS } from "./Layout";
import { TOKENS_CSS } from "./tokens";
import { COUNTING_SINCE, headline, type Day, type Range, type Tally } from "../lib/stats";

export interface StatsView {
  readonly urlKey: string;
  readonly range: Range;
  readonly days: readonly Day[];
  readonly pages: readonly Tally[];
  readonly countries: readonly Tally[];
  readonly error: string | null;
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:var(--sky);color:var(--shade);
font:var(--t-1)/1.5 "Atkinson Hyperlegible Next","AHN Segoe","AHN Roboto","AHN Arial",system-ui,sans-serif}
.wrap{max-width:52rem;margin:0 auto;padding:var(--s-5) 16px var(--s-7)}
a{color:var(--zenith)}
a:focus-visible,summary:focus-visible{outline:3px solid var(--zenith);outline-offset:2px}
.top{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:var(--s-3)}
.top h1{font-size:var(--t-2);margin:0}
.top h1 a{color:inherit;text-decoration:none}
nav.range{display:flex;gap:var(--s-1)}
nav.range a{padding:4px 10px;border:1px solid var(--horizon);border-radius:8px;text-decoration:none;font-size:var(--t-0)}
nav.range a[aria-current]{background:var(--zenith);border-color:var(--zenith);color:var(--sky)}
.lede{font-size:var(--t-3);line-height:1.2;font-weight:700;letter-spacing:-.01em;margin:var(--s-6) 0 var(--s-5)}
@media (min-width:620px){.lede{font-size:var(--t-4)}}
.err{border-left:4px solid var(--zenith);padding:var(--s-3) var(--s-4);background:var(--cloud)}
.chart{position:relative;height:180px;margin:var(--s-5) 0 var(--s-1);border-bottom:1px solid var(--shade)}
.chart .max{position:absolute;left:0;right:0;top:0;border-top:1px dashed var(--horizon);
font-size:var(--t-0);color:var(--haze);font-variant-numeric:tabular-nums}
.chart .max span{position:absolute;top:2px;left:0;background:var(--sky);padding-right:6px}
.cols{position:absolute;inset:0;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:2px;align-items:end}
.cols.dense{gap:1px}
.col{height:100%;display:flex;align-items:flex-end}
.bar{width:100%;background:var(--zenith);border-radius:4px 4px 0 0;min-height:2px}
.dense .bar{border-radius:2px 2px 0 0}
.bar.part{background:repeating-linear-gradient(135deg,var(--zenith) 0 3px,transparent 3px 6px);
outline:1px solid var(--zenith);outline-offset:-1px}
.bar.none{min-height:0;height:0}
.bar.unk{background:var(--horizon);height:3px;min-height:3px;border-radius:0}
.axis{display:flex;justify-content:space-between;font-size:var(--t-0);color:var(--haze)}
.key{font-size:var(--t-0);color:var(--haze);margin:var(--s-2) 0 0;display:flex;flex-wrap:wrap;gap:var(--s-1) var(--s-4)}
.key i{display:inline-block;width:12px;height:12px;vertical-align:-1px;margin-right:6px}
.key .part{background:repeating-linear-gradient(135deg,var(--zenith) 0 3px,transparent 3px 6px);outline:1px solid var(--zenith);outline-offset:-1px}
.key .unk{background:var(--horizon);height:3px;vertical-align:3px}
details{margin:var(--s-4) 0 0}
summary{cursor:pointer;color:var(--zenith)}
.split{display:grid;gap:var(--s-6);margin-top:var(--s-6)}
@media (min-width:720px){.split{grid-template-columns:3fr 2fr}}
h2{font-size:var(--t-1);margin:0 0 var(--s-2)}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:var(--t-0)}
th{text-align:left;font-weight:400;color:var(--haze);padding:4px 0;border-bottom:1px solid var(--horizon)}
td{padding:5px 0;border-bottom:1px solid var(--horizon);vertical-align:middle}
th.n,td.n{text-align:right;padding-left:var(--s-3);white-space:nowrap}
td.what{overflow-wrap:anywhere}
.mag{display:block;height:4px;margin-top:3px;background:var(--zenith);border-radius:2px;opacity:.55}
.foot{margin-top:var(--s-6);font-size:var(--t-0);color:var(--haze);max-width:44rem}
`;

const DAY_FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const dayLabel = (iso: string) => DAY_FMT.format(new Date(`${iso}T00:00:00Z`));

let regionNames: Intl.DisplayNames | null = null;
function countryName(code: string): string {
  if (code === "XX" || code === "T1") return code === "T1" ? "Tor" : "Unknown";
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

function Chart({ days }: { days: readonly Day[] }) {
  const max = Math.max(1, ...days.map((d) => d.views ?? 0));
  const dense = days.length > 31;
  const hasPartial = days.some((d) => d.partial && (d.views ?? 0) > 0);
  const hasUnknown = days.some((d) => d.views === null);
  return (
    <figure style="margin:0">
      <div class="chart" role="img" aria-label="Views per day; the same figures are in the table below">
        <div class="max">
          <span>{max}</span>
        </div>
        <div class={dense ? "cols dense" : "cols"}>
          {days.map((d) => {
            const tip =
              d.views === null
                ? `${dayLabel(d.day)}: not counted (counting began ${dayLabel(COUNTING_SINCE)})`
                : `${dayLabel(d.day)}: ${d.views} view${d.views === 1 ? "" : "s"}${d.partial ? " so far today" : ""}`;
            const cls = d.views === null ? "bar unk" : d.views === 0 ? "bar none" : d.partial ? "bar part" : "bar";
            const h = d.views ? `height:${((d.views / max) * 100).toFixed(1)}%` : undefined;
            return (
              <div class="col" title={tip} key={d.day}>
                <div class={cls} style={h} />
              </div>
            );
          })}
        </div>
      </div>
      <div class="axis" aria-hidden="true">
        <span>{days[0] ? dayLabel(days[0].day) : ""}</span>
        <span>Today (UTC)</span>
      </div>
      {hasPartial || hasUnknown ? (
        <p class="key">
          {hasPartial ? (
            <span>
              <i class="part" />
              Today, still counting
            </span>
          ) : null}
          {hasUnknown ? (
            <span>
              <i class="unk" />
              Before counting began on {dayLabel(COUNTING_SINCE)}
            </span>
          ) : null}
        </p>
      ) : null}
    </figure>
  );
}

function TallyTable({ title, what, rows, link }: { title: string; what: string; rows: readonly Tally[]; link: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.views));
  return (
    <section>
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p class="foot" style="margin:0">None yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{what}</th>
              <th class="n">Views</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td class="what">
                  {link ? <a href={r.label}>{r.label === "/" ? "Home" : r.label}</a> : countryName(r.label)}
                  <span class="mag" style={`width:${((r.views / max) * 100).toFixed(1)}%`} />
                </td>
                <td class="n">{r.views}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function StatsPage(v: StatsView) {
  const counted = v.days.filter((d) => d.views !== null);
  const total = counted.reduce((n, d) => n + (d.views ?? 0), 0);
  const phone = counted.reduce((n, d) => n + d.phone, 0);
  return (
    <html lang="en-GB">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <meta name="referrer" content="no-referrer" />
        <title>uvatlas page views</title>
        <link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
        <style dangerouslySetInnerHTML={{ __html: TOKENS_CSS + FONT_CSS + CSS }} />
      </head>
      <body>
        <main class="wrap">
          <div class="top">
            <h1>
              <a href="/">uvatlas</a> page views
            </h1>
            <nav class="range" aria-label="Period">
              {([7, 30, 90] as const).map((r) => (
                <a key={r} href={`/stats/${v.urlKey}/?days=${r}`} aria-current={r === v.range ? "page" : undefined}>
                  {r} days
                </a>
              ))}
            </nav>
          </div>

          {v.error ? (
            <p class="err">
              The counts could not be read just now. {v.error}
            </p>
          ) : (
            <>
              <p class="lede">{headline(total, phone, v.range)}</p>
              <Chart days={v.days} />
              <details>
                <summary>Views by day</summary>
                <table>
                  <thead>
                    <tr>
                      <th>Day (UTC)</th>
                      <th class="n">Views</th>
                      <th class="n">On a phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...v.days].reverse().map((d) => (
                      <tr key={d.day}>
                        <td>
                          {dayLabel(d.day)}
                          {d.partial ? " (so far)" : ""}
                        </td>
                        <td class="n">{d.views ?? "not counted"}</td>
                        <td class="n">{d.views === null ? "" : d.phone}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
              <div class="split">
                <TallyTable title="Top pages" what="Page" rows={v.pages} link={true} />
                <TallyTable title="Countries" what="Country" rows={v.countries} link={false} />
              </div>
            </>
          )}

          <p class="foot">
            A view is a browser loading a page and its counting image. Visitors that say they are bots,
            and most that don't, never load the image. Readers who block images are missed, and one person
            reading three pages is three views. Days are UTC. Counting began on {dayLabel(COUNTING_SINCE)}{" "}
            2026.
          </p>
        </main>
      </body>
    </html>
  );
}
