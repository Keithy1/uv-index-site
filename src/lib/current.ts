/**
 * What "now" means for a city, in one place.
 *
 * It existed in two: the country page used the forecast for the current hour,
 * the home page fell back to today's *peak*. So the home page announced
 * "forecast peak today" for the United States while /us/ showed "now", and the
 * same country had two different headline figures depending which page you
 * were on.
 *
 * That is the third time a figure has been computed twice and drifted -- after
 * the station coordinates and the protection window -- so this is a shared
 * function rather than a convention.
 *
 * No Worker types here deliberately: the policy is pure so it can be tested
 * without a database or a clock.
 */
import { localDateKey, localMinutes } from "./time";

export interface ForecastPoint {
  readonly validAt: string;
  readonly uvi: number;
}

export interface CurrentLevel {
  readonly uvi: number | null;
  /** True when the figure is a forecast rather than a measurement. */
  readonly forecast: boolean;
}

/**
 * How far from the current hour a forecast point may be and still count as
 * "now". Sources are hourly, so 90 minutes always finds the adjacent hour and
 * never reaches a third.
 */
export const NEAR_HOUR_MS = 90 * 60 * 1000;

/**
 * The level to present as "now".
 *
 * A measurement where there is an instrument and the reading is fresh;
 * otherwise the nearest hourly forecast. Returns which of the two it is, so
 * the page can label it rather than passing one off as the other.
 */
export function currentLevel(opts: {
  /** Fresh measured reading, or null when stale, missing, or no instrument. */
  readonly measured: number | null;
  readonly forecast: readonly ForecastPoint[];
  readonly now: Date;
}): CurrentLevel {
  if (opts.measured !== null) return { uvi: opts.measured, forecast: false };

  let nearest: number | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const point of opts.forecast) {
    const gap = Math.abs(Date.parse(point.validAt) - opts.now.getTime());
    if (gap < best && gap <= NEAR_HOUR_MS) {
      best = gap;
      nearest = point.uvi;
    }
  }
  return { uvi: nearest, forecast: nearest !== null };
}

/** The forecast points falling on one local day in a city's own zone. */
export function pointsOnLocalDay(
  forecast: readonly ForecastPoint[],
  tz: string,
  dayKey: string,
): { minutes: number; uvi: number }[] {
  return forecast
    .filter((p) => localDateKey(p.validAt, tz) === dayKey)
    .map((p) => ({ minutes: localMinutes(p.validAt, tz), uvi: p.uvi }));
}

/**
 * The day's peak, or null when the forecast does not cover the day.
 *
 * A maximum over a truncated range is still a number and looks exactly like a
 * real one: the tomorrow column once reported Brisbane peaking at 6.1 at 9 am,
 * because 9 am was the last hour that existed. Require the solar middle of the
 * day before claiming to know a peak.
 */
export function peakOnLocalDay(
  points: readonly { minutes: number; uvi: number }[],
): { uvi: number; minutes: number } | null {
  const covered =
    points.some((p) => p.minutes <= 9 * 60) && points.some((p) => p.minutes >= 16 * 60);
  if (points.length === 0 || !covered) return null;
  return points.reduce((a, b) => (b.uvi > a.uvi ? b : a));
}

/** Tomorrow's date key in a city's own zone, given today's. */
export function nextLocalDay(todayKey: string): string {
  return localDateKey(
    new Date(Date.parse(`${todayKey}T12:00:00Z`) + 86_400_000).toISOString(),
    "UTC",
  );
}

export type AdviceScope = "now" | "today" | "tomorrow";

export interface Advice {
  /** The level the advice is for. */
  readonly uvi: number;
  /** Which period it describes, so the heading can say so. */
  readonly scope: AdviceScope;
}

/**
 * The level sun-protection advice should be based on.
 *
 * NOT the current reading. At 12:19 am Alice Springs read 0.0 Low and the page
 * said "no protection needed for most people" -- while the same page forecast
 * a peak of 12.1 Extreme later that day. Anyone checking before going out got
 * advice that was wrong in the dangerous direction, which is the one error
 * this site must never make.
 *
 * So the advice follows the highest level still to come: the rest of today
 * while any of today remains, tomorrow once today is spent, and the current
 * reading only when it is itself the highest thing on offer.
 */
export function adviceLevel(opts: {
  /** Current level, measured or forecast. */
  readonly now: number | null;
  /** Today's forecast points, in local minutes. */
  readonly today: readonly { minutes: number; uvi: number }[];
  /** Tomorrow's peak, if the forecast covers it. */
  readonly tomorrowPeak: number | null;
  /** Minutes since local midnight, now. */
  readonly nowMinutes: number;
}): Advice | null {
  const ahead = opts.today.filter((p) => p.minutes >= opts.nowMinutes);
  const aheadPeak = ahead.length ? Math.max(...ahead.map((p) => p.uvi)) : null;
  const current = opts.now;

  // Whatever is highest between now and the end of today.
  const todayBest =
    aheadPeak === null ? current : current === null ? aheadPeak : Math.max(current, aheadPeak);

  if (todayBest !== null && (current === null || todayBest > current)) {
    return { uvi: todayBest, scope: "today" };
  }

  // Nothing left today worth warning about: look to tomorrow, so an evening
  // visitor is told what they are walking into in the morning.
  if (
    opts.tomorrowPeak !== null &&
    (todayBest === null || opts.tomorrowPeak > todayBest)
  ) {
    return { uvi: opts.tomorrowPeak, scope: "tomorrow" };
  }

  return todayBest === null ? null : { uvi: todayBest, scope: "now" };
}
