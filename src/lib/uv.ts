/**
 * WHO UV index bands, and the one rounding rule the whole site depends on.
 *
 * The design rule is subtle and easy to get wrong: a reading is *displayed* as
 * published (one decimal, e.g. "2.5") but its *band* comes from the reading
 * rounded to the nearest whole number, rounding halves up. So 2.4 is Low and
 * 2.5 is Moderate. JavaScript's Math.round already rounds halves up for
 * positive numbers, but we spell it out so the intent survives refactoring —
 * the Python adapters needed math.floor(x + 0.5) because Python's round() is
 * banker's rounding and got 2.5 and 10.5 wrong.
 */

export const BAND_NAMES = ["Low", "Moderate", "High", "Very High", "Extreme"] as const;

export type BandName = (typeof BAND_NAMES)[number];

export interface Band {
  readonly name: BandName;
  /** Inclusive upper bound of the rounded index; null means open-ended. */
  readonly max: number | null;
  /** Background colour for the badge. */
  readonly bg: string;
  /** Text colour that meets WCAG 2.2 AA contrast against `bg`. */
  readonly fg: string;
  /** One line of protection advice, shown beside the reading. */
  readonly advice: string;
}

export const BANDS: readonly Band[] = [
  {
    name: "Low",
    max: 2,
    bg: "#3a7d2c",
    fg: "#ffffff",
    advice: "No protection needed for most people.",
  },
  {
    name: "Moderate",
    max: 5,
    bg: "#f2d600",
    fg: "#1a1a1a",
    advice: "Slip on a shirt, slop on sunscreen, slap on a hat.",
  },
  {
    name: "High",
    max: 7,
    bg: "#e07b00",
    fg: "#1a1a1a",
    advice: "Protection needed. Seek shade during the middle of the day.",
  },
  {
    name: "Very High",
    max: 10,
    bg: "#d32010",
    fg: "#ffffff",
    advice: "Extra protection needed. Avoid being outside at midday.",
  },
  {
    name: "Extreme",
    max: null,
    bg: "#8b3fd1",
    fg: "#ffffff",
    advice: "Take full precautions. Unprotected skin can burn in minutes.",
  },
] as const;

/** Lowest and highest UV index we will accept from any source. */
export const UVI_MIN = 0;
export const UVI_MAX = 20;

/**
 * Round a UV index to the whole number used for banding: halves go up.
 * Exported so tests can pin the 2.5 and 10.5 edges directly.
 */
export function roundForBand(uvi: number): number {
  return Math.floor(uvi + 0.5);
}

/** The WHO band a reading falls in. */
export function bandFor(uvi: number): Band {
  const n = roundForBand(uvi);
  for (const band of BANDS) {
    if (band.max === null || n <= band.max) return band;
  }
  // Unreachable: the last band is open-ended. Kept so the return type is total.
  return BANDS[BANDS.length - 1]!;
}

/**
 * Adapter check: a value outside 0..20 is bad data, not a high reading.
 * The highest UV index ever recorded on Earth is around 43 at altitude in the
 * Andes, but nothing in Australia or the United States approaches 20, so a
 * value above it means the source changed format or units.
 */
export function isPlausibleUvi(uvi: number): boolean {
  return Number.isFinite(uvi) && uvi >= UVI_MIN && uvi <= UVI_MAX;
}

/** How a reading is written on the page: always one decimal place. */
export function formatUvi(uvi: number): string {
  return uvi.toFixed(1);
}

/** The UV index at or above which sun protection is advised. */
export const PROTECTION_THRESHOLD = 3;
