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
import type { DayStrip, StripCell } from "../lib/strip";
import { minutesToClock } from "../lib/time";
import { formatUvi, roundForBand } from "../lib/uv";

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
  compact = false,
}: {
  strip: DayStrip;
  /** "Forecast by CAMS": who made the values in the cells. */
  credit: string;
  compact?: boolean;
}) {
  const w = strip.window;
  return (
    <figure class={compact ? "strip compact" : "strip"}>
      <div class="cells" style={`--n:${strip.cells.length}`} aria-hidden="true">
        {strip.cells.map((cell) => {
          const hour = Math.floor(cell.minutes / 60);
          const cls = [
            "c",
            cell.band === null ? "x" : `b${cell.band}`,
            cell.now ? "now" : "",
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
        {credit}, cloud included.
        {w && !compact
          ? " Cover-up times are from the clear-sky forecast, because cloud can clear at any time."
          : ""}
      </figcaption>
    </figure>
  );
}
