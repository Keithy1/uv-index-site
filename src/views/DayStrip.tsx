/**
 * The day strip: today from sunrise to sunset, one cell an hour, each in its
 * WHO band colour. The page's one memorable thing, and the answer to "which
 * hours do I cover up for" at a glance.
 *
 * A CSS grid of spans: no script, no SVG, nothing that moves. Each cell is a
 * bar in its band colour, as tall as its level, standing on an ink baseline so
 * that Low's green and Moderate's yellow still read as shapes on a pale page.
 * The value is printed beneath in ink, never in the band colour (Moderate's
 * yellow is unreadable as text). The current hour is outlined, and the
 * protection window is bracketed underneath.
 *
 * Two sizes. The full strip is the city page's; `compact` is a short one with
 * no values, for tomorrow and for a row per city on a country page. Both carry
 * their credit, because no figure on the site goes without its source.
 *
 * The drawn strip is hidden from screen readers; its summary says the same in
 * words, and the hourly table under the chart has every value.
 */
import { cellLevel, placeOnAxis, type DayStrip, type StripAxis, type StripCell } from "../lib/strip";
import { minutesToClock } from "../lib/time";
import { BANDS, bandFor, formatUvi, roundForBand } from "../lib/uv";

export const DAY_STRIP_CSS = `
.strip{margin:var(--s-4) 0 var(--s-2)}
.strip i{display:block;font-style:normal}
.strip .cells{display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));gap:0 2px}
.strip .c{display:flex;flex-direction:column;align-items:stretch;text-align:center;min-width:0}
.strip .t,.strip .v{font-size:var(--t-0);line-height:1.2;color:var(--haze);white-space:nowrap}
.strip .t{height:1.2em;margin-bottom:var(--s-1)}
.strip .v{color:var(--shade);font-weight:700;margin-top:var(--s-1)}
/* The bar area. Each cell stands on its own length of ink baseline. */
.strip .well{position:relative;height:64px;border-bottom:2px solid var(--shade)}
.strip .bar{position:absolute;left:0;right:0;bottom:0;height:calc(var(--h)*100%)}
${[0, 1, 2, 3, 4].map((i) => `.strip .b${i} .bar{background:var(--band-${i})}`).join("")}
/* Missing: hatched, on a dashed baseline, with a dash for its value. Never a
   zero bar -- 0 is a real reading at either end of the day. */
.strip .x .well{border-bottom-style:dashed;border-bottom-color:var(--haze);
background:repeating-linear-gradient(135deg,transparent 0 4px,var(--horizon) 4px 6px)}
.strip .x .v{color:var(--haze);font-weight:400}
.strip .now{outline:2px solid var(--shade);outline-offset:2px;border-radius:2px}
.strip .c.now .t{color:var(--shade);font-weight:700;visibility:visible}
/* Hour labels every other hour on a phone, every hour with am and pm from 620 px. */
.strip .ap,.strip .d{display:none}
/* When now is an odd hour its label shows, and its neighbours' make way. */
@media (max-width:619px){.strip .odd .t{visibility:hidden}
.strip .c.now.odd+.c .t,.strip .c:has(+.c.now.odd) .t{visibility:hidden}}
@media (min-width:620px){.strip .well{height:88px}.strip .ap,.strip .d{display:inline}.strip .i{display:none}}
.strip .bracket{position:relative;height:10px;margin-top:var(--s-2)}
.strip .bracket i{position:absolute;top:0;bottom:0;border:2px solid var(--shade);border-top:0}
/* The words follow the bracket's left edge, but never off the right of the strip. */
.strip .cover{margin:var(--s-1) 0 0;font-weight:700}
.strip figcaption{font-size:var(--t-0);color:var(--haze);margin-top:var(--s-2)}
/* Where measured hours end and forecast ones begin: a tick at the boundary,
   each word on its own side, pulled inward near the strip's ends. Forecast
   values are set lighter than measured ones, so a cell says which it is. */
.strip .phase{position:relative;height:1.5em;font-size:var(--t-0);line-height:1.2;margin-bottom:var(--s-1)}
.strip .phase i{position:absolute;top:0;bottom:-4px;left:var(--p);border-left:2px solid var(--shade)}
.strip .phase b{position:absolute;top:0;white-space:nowrap}
.strip .phase .pm{right:calc(100% - max(var(--p),5.5em));padding-right:6px;color:var(--shade)}
.strip .phase .pf{left:min(var(--p),calc(100% - 5.5em));padding-left:6px;color:var(--haze);font-weight:400}
.strip .f .v{font-weight:400}
.strip.compact .well{height:28px}
/* Small: a label every third hour, wherever it is drawn. */
.strip.compact .t{visibility:hidden}.strip.compact .h3 .t{visibility:visible}
@media (min-width:620px){.strip.compact .well{height:36px}.strip.compact .ap{display:none}}
`;

/** "6", or "6 am" where there is room for it. */
function HourLabel({ minutes }: { minutes: number }) {
  const h = Math.floor(minutes / 60) % 24;
  return (
    <i class="t">
      {((h + 11) % 12) + 1}
      <span class="ap">{h < 12 ? " am" : " pm"}</span>
    </i>
  );
}

/**
 * The value under a cell. On a phone a cell is about 22 px wide, too narrow for
 * "10.4", so it shows the whole number the band is worked out from (10.4 is
 * 10, Very High), which is how the WHO writes the index. From 620 px there is
 * room for the one decimal the rest of the site prints.
 */
function Value({ cell }: { cell: StripCell }) {
  if (cell.uvi === null) return <i class="v">–</i>;
  return (
    <i class="v">
      <span class="i">{roundForBand(cell.uvi)}</span>
      <span class="d">{formatUvi(cell.uvi)}</span>
    </i>
  );
}

/** Bars are drawn against a fixed UV 12, so a quiet day looks quiet and two strips compare. */
const SCALE = 12;

function pct(f: number): string {
  return `${(f * 100).toFixed(2)}%`;
}

export function DayStripView({
  strip,
  credit,
  measuredBy,
  compact = false,
}: {
  strip: DayStrip;
  /** "Forecast by CAMS": who made the forecast values in the cells. */
  credit: string;
  /** "ARPANSA": who measured the hours already gone, where anyone did. */
  measuredBy?: string;
  compact?: boolean;
}) {
  const w = strip.window;
  const k = measuredBy ? strip.measuredCells : 0;
  const n = strip.cells.length;
  return (
    <figure class={compact ? "strip compact" : "strip"}>
      {k > 0 && !compact && (
        <div class="phase" style={`--p:${pct(k / n)}`} aria-hidden="true">
          {k < n && <i />}
          <b class="pm">Measured</b>
          {k < n && <b class="pf">Forecast</b>}
        </div>
      )}
      <div class="cells" style={`--n:${n}`} aria-hidden="true">
        {strip.cells.map((cell) => {
          const hour = Math.floor(cell.minutes / 60);
          const cls = [
            "c",
            cell.band === null ? "x" : `b${cell.band}`,
            cell.now ? "now" : "",
            k > 0 && !cell.measured ? "f" : "",
            hour % 2 ? "odd" : "",
            hour % 3 === 0 ? "h3" : "",
          ].filter(Boolean).join(" ");
          const h = cell.uvi === null ? 0 : Math.min(cell.uvi, SCALE) / SCALE;
          return (
            <span key={cell.minutes} class={cls} style={`--h:${h.toFixed(3)}`}>
              <HourLabel minutes={cell.minutes} />
              <i class="well"><i class="bar" /></i>
              {!compact && <Value cell={cell} />}
            </span>
          );
        })}
      </div>
      {w && (
        <>
          <div class="bracket" aria-hidden="true">
            <i style={`left:${pct(w.left)};right:${pct(1 - w.right)}`} />
          </div>
          <p class="cover" style={`padding-left:min(${pct(w.left)},calc(100% - 15em))`}>
            Cover up {minutesToClock(w.start)} to {minutesToClock(w.end)}
          </p>
        </>
      )}
      <figcaption>
        <span class="vh">{strip.summary} </span>
        {k > 0
          ? `Measured by ${measuredBy} ${strip.cells[k - 1]!.now ? "up to now" : `to ${minutesToClock(strip.cells[k - 1]!.minutes)}`}` +
            (k < n ? `, then ${credit.charAt(0).toLowerCase()}${credit.slice(1)}, cloud included.` : ".")
          : `${credit}, cloud included.`}
        {w && !compact
          ? " Cover-up times are from the clear-sky forecast, because cloud can clear at any time."
          : ""}
      </figcaption>
    </figure>
  );
}

/**
 * The strip as one row of a country page: a bar per hour and nothing else.
 *
 * Not the `compact` strip above, for weight. That one spends about 130 bytes a
 * cell on labels, wells and a per-cell height, and a US page draws some 1,200
 * cells (fifty cities, today and tomorrow): 150 KB of strip on a page meant to
 * be under 100 KB. Here a cell is an empty <i> whose one class, its level,
 * sets both its height and its band colour; a level-0 cell has no class at all.
 * The hour labels are drawn once, in the column heading, against the axis every
 * row shares (stripAxis), and the offset is one custom property per row.
 */
export const ROW_STRIP_CSS = `
.ms{display:flex;align-items:flex-end;height:28px;--hh:26px}
.ms i{flex:none;box-sizing:border-box;width:calc(200%/var(--n));height:2px;
border-bottom:2px solid var(--shade);border-right:2px solid transparent;
background:var(--band-0);background-clip:padding-box}
.ms>:first-child{margin-left:calc(var(--o,0)*100%/var(--n))}
${Array.from({ length: 12 }, (_, i) => {
  const n = i + 1;
  return `.ms .u${n}{height:calc(2px + var(--hh)*${n}/12);background-color:var(--band-${BANDS.indexOf(bandFor(n))})}`;
}).join("")}
.ms .x{height:100%;border-bottom:2px dashed var(--haze);
background:repeating-linear-gradient(135deg,transparent 0 3px,var(--horizon) 3px 5px)}
.ms .n{outline:2px solid var(--shade);outline-offset:1px}
@media (min-width:620px){.ms{height:40px;--hh:38px}}
`;

export function RowStrip({ strip, axis, cls }: { strip: DayStrip; axis: StripAxis; cls: string }) {
  const { offset } = placeOnAxis(strip, axis);
  return (
    <div class={`ms ${cls}`} style={offset ? `--o:${offset}` : undefined}>
      {strip.cells.map((cell) => {
        const level = cellLevel(cell);
        const k = [level === null ? "x" : level > 0 ? `u${level}` : "", cell.now ? "n" : ""]
          .filter(Boolean)
          .join(" ");
        return <i class={k || undefined} />;
      })}
    </div>
  );
}
