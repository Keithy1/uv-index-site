/**
 * Today's UV curve, drawn on the server as inline SVG.
 *
 * No chart library reaches the browser: the design budget is under 100 KB a
 * page and under 5 KB of JavaScript, and a UV curve is a dozen points. This
 * builds the path geometry only; the markup lives in the view.
 *
 * Accessibility: a chart that carries information must also say it in words.
 * `summary` is the sentence that goes beside it, and every page using this must
 * render it — a shape alone is unreadable to a screen reader and to anyone who
 * cannot distinguish the band colours.
 */
import { PROTECTION_THRESHOLD, formatUvi } from "./uv";

export interface CurvePoint {
  /** Minutes since local midnight, 0-1439. */
  readonly minutes: number;
  readonly uvi: number;
}

export interface ChartGeometry {
  readonly width: number;
  readonly height: number;
  /** Filled area under the forecast curve. */
  readonly areaPath: string;
  /** The forecast line itself. */
  readonly linePath: string;
  /** Horizontal rule at UV 3, where protection starts to matter. */
  readonly thresholdY: number | null;
  /** Where the latest measured reading sits, if there is one. */
  readonly measured: { x: number; y: number; uvi: number } | null;
  /** Hour gridlines, already positioned. */
  readonly hours: readonly { x: number; label: string }[];
  /** Labelled UV levels up the left edge, already positioned. */
  readonly levels: readonly { y: number; uvi: number }[];
  /** The peak, for labelling. */
  readonly peak: { x: number; y: number; uvi: number; minutes: number } | null;
  readonly maxUvi: number;
}

const WIDTH = 640;
const HEIGHT = 200;
const PAD_LEFT = 28;
const PAD_RIGHT = 12;
const PAD_TOP = 16;
const PAD_BOTTOM = 24;

/** Daylight only: a flat line through the night tells nobody anything. */
const START_MINUTES = 5 * 60;
const END_MINUTES = 20 * 60;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function buildCurve(
  points: readonly CurvePoint[],
  measured: CurvePoint | null = null,
): ChartGeometry | null {
  const visible = points
    .filter((p) => p.minutes >= START_MINUTES && p.minutes <= END_MINUTES)
    .sort((a, b) => a.minutes - b.minutes);
  if (visible.length < 3) return null;

  // Round the top up to a sensible scale so the curve does not fill the box
  // on a quiet day and look alarming.
  const highest = Math.max(
    ...visible.map((p) => p.uvi),
    measured?.uvi ?? 0,
    PROTECTION_THRESHOLD,
  );
  const maxUvi = Math.max(4, Math.ceil(highest / 2) * 2);

  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const x = (minutes: number) =>
    PAD_LEFT + ((clamp(minutes, START_MINUTES, END_MINUTES) - START_MINUTES) /
      (END_MINUTES - START_MINUTES)) * plotWidth;
  const y = (uvi: number) => PAD_TOP + plotHeight - (clamp(uvi, 0, maxUvi) / maxUvi) * plotHeight;

  const coords = visible.map((p) => ({ x: x(p.minutes), y: y(p.uvi) }));
  const linePath = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ");
  const baseline = PAD_TOP + plotHeight;
  const first = coords[0]!;
  const last = coords[coords.length - 1]!;
  const areaPath =
    `M${first.x.toFixed(1)},${baseline.toFixed(1)} ` +
    coords.map((c) => `L${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ") +
    ` L${last.x.toFixed(1)},${baseline.toFixed(1)} Z`;

  const peakPoint = visible.reduce((a, b) => (b.uvi > a.uvi ? b : a));

  const hours: { x: number; label: string }[] = [];
  for (let h = 6; h <= 19; h += 3) {
    hours.push({ x: x(h * 60), label: `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}` });
  }

  return {
    width: WIDTH,
    height: HEIGHT,
    levels: axisLevels(maxUvi).map((uvi) => ({ y: y(uvi), uvi })),
    areaPath,
    linePath,
    thresholdY: maxUvi >= PROTECTION_THRESHOLD ? y(PROTECTION_THRESHOLD) : null,
    measured: measured ? { x: x(measured.minutes), y: y(measured.uvi), uvi: measured.uvi } : null,
    hours,
    peak: { x: x(peakPoint.minutes), y: y(peakPoint.uvi), uvi: peakPoint.uvi, minutes: peakPoint.minutes },
    maxUvi,
  };
}

/**
 * The UV levels labelled on the vertical axis.
 *
 * The WHO band boundaries -- 0, 3, 6, 8, 11 -- rather than even steps, so the
 * axis reads in the same terms as the coloured bands everywhere else on the
 * site: a curve crossing the 8 line is crossing into Very High. The axis once
 * labelled only the 3, and a reader could not tell whether the peak was 7 or
 * 12. The top of the scale is labelled too when it is clear of the last
 * boundary, so the height of the chart always has a number on it.
 */
export function axisLevels(maxUvi: number): number[] {
  const levels = [0, 3, 6, 8, 11].filter((v) => v <= maxUvi);
  if (maxUvi - levels[levels.length - 1]! >= 2) levels.push(maxUvi);
  return levels;
}

/** Minutes since midnight as "12:20 pm", for chart labels and summaries. */
export function minutesToClock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/**
 * The sentence that must appear beside the chart.
 *
 * Example: "Peak 11.0 at 12:20 pm; protection needed from 8:50 am to 3:40 pm."
 */
export function describeCurve(points: readonly CurvePoint[]): string {
  const visible = points.filter((p) => p.minutes >= START_MINUTES && p.minutes <= END_MINUTES);
  if (visible.length === 0) return "No forecast available for today.";

  const peak = visible.reduce((a, b) => (b.uvi > a.uvi ? b : a));
  const headline = `Peak ${formatUvi(peak.uvi)} at ${minutesToClock(peak.minutes)}, with cloud included.`;

  // Deliberately no times here. This curve is cloud-adjusted, while the sun
  // protection times above it are computed from the clear-sky forecast, so
  // quoting a window in both places put two different answers to the same
  // question on one page -- 12:46 pm here against 8:17 am there, for Perth on
  // a cloudy day. The conservative clear-sky figure is the one that should be
  // acted on, so it gets to be the only one.
  if (peak.uvi < PROTECTION_THRESHOLD) {
    return `${headline} Cloud is forecast to keep UV below the level at which ` +
      "sun protection is usually advised, but it can clear at any time.";
  }
  return headline;
}

/**
 * First and last minute at which the forecast reaches UV 3.
 *
 * Interpolates between hourly points rather than snapping to the hour, because
 * "protection needed from 9:00 am" when the real crossing is 8:50 is advice
 * that is wrong in the dangerous direction.
 */
export function protectionWindow(
  points: readonly CurvePoint[],
): { start: number; end: number } | null {
  const sorted = [...points].sort((a, b) => a.minutes - b.minutes);
  if (sorted.length < 2) return null;

  // If the series already starts at or above the threshold, the morning
  // crossing happened before the data begins and we do not know when.
  //
  // This is not hypothetical: a CAMS 00Z run with 24 lead hours starts at
  // 11 am in Sydney, so a naive answer would be "protection needed from
  // 11:00 am" when the real crossing is around 8:30. That is wrong in the
  // dangerous direction, which is the one error this page must not make.
  // Refuse to answer rather than answer late.
  if (sorted[0]!.uvi >= PROTECTION_THRESHOLD) return null;
  if (sorted[sorted.length - 1]!.uvi >= PROTECTION_THRESHOLD) return null;

  let start: number | null = null;
  let end: number | null = null;

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    const rising = a.uvi < PROTECTION_THRESHOLD && b.uvi >= PROTECTION_THRESHOLD;
    const falling = a.uvi >= PROTECTION_THRESHOLD && b.uvi < PROTECTION_THRESHOLD;
    if (!rising && !falling) continue;
    const ratio = (PROTECTION_THRESHOLD - a.uvi) / (b.uvi - a.uvi);
    const crossing = Math.round(a.minutes + ratio * (b.minutes - a.minutes));
    if (rising && start === null) start = crossing;
    if (falling) end = crossing;
  }

  // Both crossings must have been observed. Anything else means the series
  // does not cover the whole daylight period, and a guessed boundary would be
  // presented as fact.
  return start !== null && end !== null && end > start ? { start, end } : null;
}
