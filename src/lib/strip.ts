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
 * One cell an hour on every screen. CAMS forecasts hourly, so half-hour cells
 * would print values nobody forecast.
 */
import type { CurvePoint } from "./chart";
import { minutesToClock } from "./time";
import { BANDS, bandFor, formatUvi } from "./uv";

export interface StripCell {
  /** Local minutes at the middle of the cell: the instant its value is for. */
  readonly minutes: number;
  /** The forecast for that instant, or null where the forecast does not reach. */
  readonly uvi: number | null;
  /** Index into BANDS, or null when the value is missing. */
  readonly band: number | null;
  /** True for the one cell whose hour contains now. */
  readonly now: boolean;
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
}

const HOUR = 60;
const HALF = 30;
/** A forecast instant within this of a cell's middle is that cell's value. */
const EXACT = 5;

function valueAt(sorted: readonly CurvePoint[], minutes: number): number | null {
  let before: CurvePoint | null = null;
  let after: CurvePoint | null = null;
  for (const p of sorted) {
    if (Math.abs(p.minutes - minutes) <= EXACT) return p.uvi;
    if (p.minutes < minutes) before = p;
    else if (after === null) after = p;
  }
  // Only between neighbouring forecast hours, as in a half-hour zone such as
  // Adelaide, where CAMS's whole UTC hours fall at half past.
  if (before && after && after.minutes - before.minutes <= HOUR) {
    const ratio = (minutes - before.minutes) / (after.minutes - before.minutes);
    return Math.round((before.uvi + ratio * (after.uvi - before.uvi)) * 10) / 10;
  }
  return null;
}

export function dayStrip(input: StripInput): DayStrip | null {
  if (!input.sun) return null;
  const { sunrise, sunset } = input.sun;
  // The hours whose cells overlap daylight: a cell spans half an hour either side.
  const first = Math.floor((sunrise + HALF) / HOUR);
  const last = Math.ceil((sunset - HALF) / HOUR);
  if (last < first) return null;

  const sorted = [...input.points].sort((a, b) => a.minutes - b.minutes);
  const now = input.nowMinutes;
  const cells: StripCell[] = [];
  for (let h = first; h <= last; h++) {
    const minutes = h * HOUR;
    const uvi = valueAt(sorted, minutes);
    cells.push({
      minutes,
      uvi,
      band: uvi === null ? null : BANDS.indexOf(bandFor(uvi)),
      now: now !== null && now >= minutes - HALF && now < minutes + HALF,
    });
  }

  const from = first * HOUR - HALF;
  const to = last * HOUR + HALF;
  const frac = (m: number) => Math.min(1, Math.max(0, (m - from) / (to - from)));
  const window = input.window
    ? { ...input.window, left: frac(input.window.start), right: frac(input.window.end) }
    : null;

  const missing = cells.filter((c) => c.uvi === null).length;
  const peakCell =
    missing === 0 ? cells.reduce((a, b) => ((b.uvi ?? 0) > (a.uvi ?? 0) ? b : a)) : null;
  const peak = peakCell ? { minutes: peakCell.minutes, uvi: peakCell.uvi! } : null;

  return { cells, from, to, window, peak, missing, summary: describe(input.label ?? "Today", cells, peak, window) };
}

function describe(
  label: string,
  cells: readonly StripCell[],
  peak: DayStrip["peak"],
  window: DayStrip["window"],
): string {
  const parts = [
    `${label}, hour by hour from ${minutesToClock(cells[0]!.minutes)} to ${minutesToClock(cells[cells.length - 1]!.minutes)}`,
  ];
  if (peak) parts.push(`peak ${formatUvi(peak.uvi)} ${bandFor(peak.uvi).name} at ${minutesToClock(peak.minutes)}`);
  if (window) parts.push(`cover up ${minutesToClock(window.start)} to ${minutesToClock(window.end)}`);
  let text = `${parts.join(": ")}.`;

  const present = cells.filter((c) => c.uvi !== null);
  if (present.length === 0) return `${text} No forecast for any of it yet.`;
  const lead = cells.findIndex((c) => c.uvi !== null);
  const tail = cells.length - 1 - [...cells].reverse().findIndex((c) => c.uvi !== null);
  if (lead > 0) text += ` No forecast before ${minutesToClock(cells[lead]!.minutes)}.`;
  if (tail < cells.length - 1) text += ` No forecast after ${minutesToClock(cells[tail]!.minutes)}.`;
  if (cells.slice(lead, tail + 1).some((c) => c.uvi === null)) text += " Some hours have no forecast.";
  return text;
}
