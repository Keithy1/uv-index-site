/**
 * The day strip's data: one cell per hour from sunrise to sunset.
 *
 * Shaped here, drawn in views/DayStrip.tsx. The strip is the page's answer to
 * "which hours need protection", so the rules that keep a partial forecast from
 * passing as a whole one apply to every cell:
 *
 *   * the strip's ends come from the sun, not from the data, so an hour the
 *     forecast does not reach is still drawn, as missing;
 *   * missing is null, never 0 -- 0 is a real reading at either end of the day;
 *   * a value between two forecast hours is read off the straight line between
 *     them only when they are adjacent, as the chart draws it; a gap is a gap;
 *   * no peak is named over a day the forecast only partly covers.
 *
 * One cell an hour on every screen, and each cell sits on a forecast instant,
 * so every value printed is one the source issued. CAMS forecasts on whole UTC
 * hours, which in a half-hour zone (Adelaide, Darwin) fall at half past: there
 * the cells move with them, spanning 8:00 to 9:00 for the 8:30 value. Cells
 * placed on the clock hour instead were blends of two forecasts, and the
 * strip's peak came out lower than the page's own (6.4 at 2 pm beside 6.7 at
 * 2:30 pm, for Adelaide). Half-hour cells would print values nobody forecast.
 *
 * Where an instrument exists, the hours already gone are measured, not
 * forecast: an all-forecast strip beside a reading of 8.6 showed 11 am at 6.5,
 * with the forecast's noon high above both. Each past cell takes the highest
 * reading in its hour; the current hour takes the latest reading, so the
 * outlined cell always agrees with the number at the top of the page.
 *
 * The highest, not the one nearest the hour: under passing cloud Gold Coast
 * read 4.7 at 9:39 am and 9.4 at 9:49, and a strip sampling on the hour showed
 * neither while the page named 9.4 as the day's peak. The highest in each hour
 * is what the hour asked of anyone outside, and it puts the peak on the strip.
 */
import type { CurvePoint } from "./chart";
import { minutesToClock } from "./time";
import { BANDS, bandFor, formatUvi, roundForBand } from "./uv";

export interface StripCell {
  /** Local minutes at the middle of the cell: the instant its value is for. */
  readonly minutes: number;
  /** The forecast for that instant, or null where the forecast does not reach. */
  readonly uvi: number | null;
  /** Index into BANDS, or null when the value is missing. */
  readonly band: number | null;
  /** True for the one cell whose hour contains now. */
  readonly now: boolean;
  /** True when the value was measured, false when it is a forecast. */
  readonly measured: boolean;
}

export interface DayStrip {
  readonly cells: readonly StripCell[];
  /** Local minutes at the strip's left and right edges. */
  readonly from: number;
  readonly to: number;
  /**
   * The protection window as protectionWindow gave it, and its bracket's edges
   * as fractions (0-1) of the strip's width. Null when there is no window.
   */
  readonly window: { start: number; end: number; left: number; right: number } | null;
  /** The highest cell, only when every cell has a value. */
  readonly peak: { minutes: number; uvi: number } | null;
  /** How many cells have no value. */
  readonly missing: number;
  /** How many cells, from the left, are measured rather than forecast. */
  readonly measuredCells: number;
  /** The strip in words, for anyone who cannot see it. */
  readonly summary: string;
}

export interface StripInput {
  /** The forecast, as local minutes on the strip's own day. */
  readonly points: readonly CurvePoint[];
  readonly sun: { sunrise: number; sunset: number } | null;
  /** protectionWindow's answer for the same day, unchanged. */
  readonly window: { start: number; end: number } | null;
  /** Local minutes now, or null when the strip is for another day. */
  readonly nowMinutes: number | null;
  /** How the summary opens: "Today", "Tomorrow". */
  readonly label?: string;
  /** Today's measured readings, as local minutes. Only used with nowMinutes. */
  readonly measured?: readonly CurvePoint[];
  /** The latest reading, when it is fresh: the current hour's value. */
  readonly latest?: CurvePoint | null;
}

const HOUR = 60;
const HALF = 30;
/** A forecast instant within this of a cell's middle is that cell's value. */
const EXACT = 5;
/** The highest reading in the cell around `minutes`, or null where there is none. */
function measuredAt(points: readonly CurvePoint[], minutes: number): number | null {
  let best: number | null = null;
  for (const p of points) {
    if (p.minutes >= minutes - HALF && p.minutes < minutes + HALF && (best === null || p.uvi > best)) {
      best = p.uvi;
    }
  }
  return best;
}

function valueAt(sorted: readonly CurvePoint[], minutes: number): number | null {
  let before: CurvePoint | null = null;
  let after: CurvePoint | null = null;
  for (const p of sorted) {
    if (Math.abs(p.minutes - minutes) <= EXACT) return p.uvi;
    if (p.minutes < minutes) before = p;
    else if (after === null) after = p;
  }
  // Only between neighbouring forecast hours, for a stray instant off the
  // grid (a run from another source); never across a gap.
  if (before && after && after.minutes - before.minutes <= HOUR) {
    const ratio = (minutes - before.minutes) / (after.minutes - before.minutes);
    return Math.round((before.uvi + ratio * (after.uvi - before.uvi)) * 10) / 10;
  }
  return null;
}

/**
 * Where in the hour the forecast's instants fall: 0 on most of the continent,
 * 30 in a half-hour zone. The commonest minute among the points, so one stray
 * value cannot shift the grid; 0 when there are none.
 */
function phaseOf(points: readonly CurvePoint[]): number {
  const counts = new Map<number, number>();
  for (const p of points) counts.set(p.minutes % HOUR, (counts.get(p.minutes % HOUR) ?? 0) + 1);
  let best = 0, most = 0;
  for (const [minute, n] of counts) if (n > most) [best, most] = [minute, n];
  return best;
}

export function dayStrip(input: StripInput): DayStrip | null {
  if (!input.sun) return null;
  const { sunrise, sunset } = input.sun;
  const phase = phaseOf(input.points);
  // The hours whose cells overlap daylight: a cell spans half an hour either
  // side of its instant, h * 60 + phase.
  const first = Math.floor((sunrise + HALF - phase) / HOUR);
  const last = Math.ceil((sunset - HALF - phase) / HOUR);
  if (last < first) return null;

  const sorted = [...input.points].sort((a, b) => a.minutes - b.minutes);
  const readings = input.measured ?? [];
  const now = input.nowMinutes;
  const cells: StripCell[] = [];
  for (let h = first; h <= last; h++) {
    const minutes = h * HOUR + phase;
    const isNow = now !== null && now >= minutes - HALF && now < minutes + HALF;
    // Measured only for time already gone: a reading taken at 11:10 says
    // nothing about 11:30.
    let actual: number | null = null;
    if (isNow) actual = input.latest?.uvi ?? (minutes <= now! ? measuredAt(readings, minutes) : null);
    else if (now !== null && minutes + HALF <= now) actual = measuredAt(readings, minutes);
    const uvi = actual ?? valueAt(sorted, minutes);
    cells.push({
      minutes,
      uvi,
      band: uvi === null ? null : BANDS.indexOf(bandFor(uvi)),
      now: isNow,
      measured: actual !== null,
    });
  }
  const lead = cells.findIndex((c) => !c.measured);
  const measuredCells = lead === -1 ? cells.length : lead;

  const from = first * HOUR + phase - HALF;
  const to = last * HOUR + phase + HALF;
  const frac = (m: number) => Math.min(1, Math.max(0, (m - from) / (to - from)));
  const window = input.window
    ? { ...input.window, left: frac(input.window.start), right: frac(input.window.end) }
    : null;

  const missing = cells.filter((c) => c.uvi === null).length;
  const peakCell =
    missing === 0 ? cells.reduce((a, b) => ((b.uvi ?? 0) > (a.uvi ?? 0) ? b : a)) : null;
  const peak = peakCell ? { minutes: peakCell.minutes, uvi: peakCell.uvi! } : null;

  return {
    cells,
    from,
    to,
    window,
    peak,
    missing,
    measuredCells,
    summary: describe(input.label ?? "Today", cells, peak, window, measuredCells),
  };
}

function describe(
  label: string,
  cells: readonly StripCell[],
  peak: DayStrip["peak"],
  window: DayStrip["window"],
  measuredCells: number,
): string {
  const parts = [
    `${label}, hour by hour from ${minutesToClock(cells[0]!.minutes)} to ${minutesToClock(cells[cells.length - 1]!.minutes)}`,
  ];
  if (peak) parts.push(`peak ${formatUvi(peak.uvi)} ${bandFor(peak.uvi).name} at ${minutesToClock(peak.minutes)}`);
  if (window) parts.push(`cover up ${minutesToClock(window.start)} to ${minutesToClock(window.end)}`);
  let text = `${parts.join(": ")}.`;
  if (measuredCells > 0) {
    text += ` Measured to ${minutesToClock(cells[measuredCells - 1]!.minutes)}, forecast after.`;
  }

  const present = cells.filter((c) => c.uvi !== null);
  if (present.length === 0) return `${text} No forecast for any of it yet.`;
  const lead = cells.findIndex((c) => c.uvi !== null);
  const tail = cells.length - 1 - [...cells].reverse().findIndex((c) => c.uvi !== null);
  if (lead > 0) text += ` No forecast before ${minutesToClock(cells[lead]!.minutes)}.`;
  if (tail < cells.length - 1) text += ` No forecast after ${minutesToClock(cells[tail]!.minutes)}.`;
  if (cells.slice(lead, tail + 1).some((c) => c.uvi === null)) text += " Some hours have no forecast.";
  return text;
}

/**
 * A clock shared by every strip on a country page, in local minutes on whole
 * hours. Small multiples only compare when they share an axis: each row is
 * drawn by its own city's local time, so 1 pm sits in the same column in Perth
 * and Sydney, and a city whose sun rises later starts further right.
 */
export interface StripAxis {
  readonly from: number;
  readonly to: number;
}

export function stripAxis(strips: readonly (DayStrip | null)[]): StripAxis | null {
  const drawn = strips.filter((s): s is DayStrip => s !== null);
  if (drawn.length === 0) return null;
  return {
    from: Math.floor(Math.min(...drawn.map((s) => s.from)) / HOUR) * HOUR,
    to: Math.ceil(Math.max(...drawn.map((s) => s.to)) / HOUR) * HOUR,
  };
}

/**
 * Where one strip sits on the shared axis, in half-hours: a cell is two wide,
 * and a half-hour zone's cells start half a cell later than everyone else's.
 */
export function placeOnAxis(strip: DayStrip, axis: StripAxis): { offset: number; span: number } {
  return { offset: (strip.from - axis.from) / HALF, span: (axis.to - axis.from) / HALF };
}

/**
 * The level a compact cell draws: the whole number its band comes from, up to
 * the strip's fixed scale of 12. One number fixes both the bar's height and
 * its colour, so a cell needs one class. Null is missing, never 0.
 */
export function cellLevel(cell: StripCell): number | null {
  return cell.uvi === null ? null : Math.min(roundForBand(cell.uvi), 12);
}
