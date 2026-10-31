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
import { bandFor, formatUvi, PROTECTION_THRESHOLD, roundForBand } from "./uv";

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

/**
 * Today's peak: the highest of what has been measured so far today and what
 * is forecast for the rest of it.
 *
 * The forecast alone could name a peak below a reading already taken: /au/
 * once listed Newcastle at 8.2 now and 7.6 for its peak today. Measured wins a
 * tie, being the better evidence. The forecast must still cover the day, as in
 * peakOnLocalDay, unless the day's middle is already behind us and measured.
 */
export function peakToday(
  forecast: readonly { minutes: number; uvi: number }[],
  measuredMax: { minutes: number; uvi: number } | null,
  nowMinutes: number,
): { uvi: number; minutes: number; measured: boolean } | null {
  const whole = peakOnLocalDay(forecast);
  // Nothing measured (no instrument, or none today): the forecast's whole day,
  // as before, since there is nothing to replace its past hours with.
  if (!measuredMax) return whole ? { ...whole, measured: false } : null;
  const ahead = whole ? forecast.filter((p) => p.minutes > nowMinutes) : [];
  const forecastPeak = ahead.length > 0 ? ahead.reduce((a, b) => (b.uvi > a.uvi ? b : a)) : null;
  if (measuredMax && (!forecastPeak || measuredMax.uvi >= forecastPeak.uvi)) {
    if (!whole && nowMinutes < 16 * 60) return null;
    return { ...measuredMax, measured: true };
  }
  return forecastPeak ? { ...forecastPeak, measured: false } : null;
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
  /**
   * A higher point still ahead today in the same band, when "now" would
   * otherwise hide it. Miami at noon: 5.6 now, 7.0 at 1 pm, both High. The
   * advice is the same, but "At 5.6" under a chart still climbing read as if
   * the page had missed the peak.
   */
  readonly peak?: { readonly uvi: number; readonly minutes: number };
}

/**
 * How far a forecast point must sit above a measurement before it counts as a
 * peak still to come: the forecast's typical error. Below this the two are the
 * same reading seen twice (Alice Springs, 1:20 pm: 9.3 measured beside a 9.8
 * forecast point, the curve already falling).
 */
const FORECAST_ERROR = 1.2;

/**
 * The level sun-protection advice should be based on.
 *
 * NOT the current reading. At 12:19 am Alice Springs read 0.0 Low and the page
 * said "no protection needed for most people" -- while the same page forecast
 * a peak of 12.1 Extreme later that day. Anyone checking before going out got
 * advice that was wrong in the dangerous direction, which is the one error
 * this site must never make.
 *
 * So the advice follows the highest level still to come today, now included,
 * for as long as that reaches 3 -- the point at which protection is needed.
 * Only once the rest of today is below 3 does it turn to tomorrow. "Spent"
 * means below 3, not merely "lower than tomorrow".
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
  /** True when `now` is itself a forecast (US pages), so any rise is the curve's own. */
  readonly nowIsForecast?: boolean;
}): Advice | null {
  const ahead = opts.today.filter((p) => p.minutes >= opts.nowMinutes);
  const aheadPeak = ahead.length ? Math.max(...ahead.map((p) => p.uvi)) : null;
  const current = opts.now;

  // Whatever is highest between now and the end of today.
  const todayBest =
    aheadPeak === null ? current : current === null ? aheadPeak : Math.max(current, aheadPeak);

  // While today still needs protection, the advice is about today. This used
  // to switch to tomorrow whenever tomorrow's peak beat what was left of today:
  // at 1:30 pm in Alice Springs, with UV still near 10 and the morning's 12.1
  // just past, the page said "What to do tomorrow" because tomorrow forecast
  // 11.3. The switch is meant for the evening, once today is spent -- not for
  // any afternoon that happens to come after a higher morning.
  if (todayBest !== null && roundForBand(todayBest) >= PROTECTION_THRESHOLD) {
    // "Later today" only when a later hour reaches a higher band than now.
    // At 1:20 pm in Alice Springs the page said "forecast to reach 9.8 later
    // today" with the instrument at 9.3 and the curve already falling: the
    // 9.8 was the 1:30 pm forecast point, ten minutes away, disagreeing with
    // the measurement by half a point -- well inside the forecast's typical
    // error of 1.2. Within a band the advice is identical (whatToDo is keyed
    // by band), so nothing is lost by describing now; across a band boundary
    // the higher level still wins, so the advice is never weaker than what is
    // coming.
    if (current !== null && bandFor(todayBest).name === bandFor(current).name) {
      const top = ahead.reduce<(typeof ahead)[number] | null>(
        (best, p) => (best === null || p.uvi > best.uvi ? p : best),
        null,
      );
      const margin = opts.nowIsForecast ? 0 : FORECAST_ERROR;
      return top !== null && formatUvi(top.uvi) !== formatUvi(current) && top.uvi - current > margin
        ? { uvi: current, scope: "now", peak: { uvi: top.uvi, minutes: top.minutes } }
        : { uvi: current, scope: "now" };
    }
    return { uvi: todayBest, scope: current !== null && todayBest <= current ? "now" : "today" };
  }

  // Nothing left today that needs protection: look to tomorrow, so an evening
  // visitor is told what they are walking into in the morning.
  if (
    opts.tomorrowPeak !== null &&
    (todayBest === null || opts.tomorrowPeak > todayBest)
  ) {
    return { uvi: opts.tomorrowPeak, scope: "tomorrow" };
  }

  if (todayBest === null) return null;
  return { uvi: todayBest, scope: current !== null && todayBest <= current ? "now" : "today" };
}
