/**
 * "This time of year": the monthly normals in data/normals.json.
 *
 * Bundled rather than stored in D1, like stations.json. They change once a
 * year (see .github/workflows/normals.yml) and fit in a few kilobytes, so a
 * city page shows them at no database cost at all.
 *
 * Two sources that are not the same kind of thing, and the type keeps them
 * apart so a template cannot word one as the other: `arpansa` is what an
 * instrument measured; `noaa` is what NOAA forecast for solar noon the day
 * before.
 */
import data from "../../data/normals.json";

export interface MonthNormal {
  /** Valid days behind the figures, across all years. */
  readonly days: number;
  /** Median of the daily peaks. */
  readonly median: number;
  /** Share of days at 3+ (sun protection needed), after half-up rounding. */
  readonly protect: number;
  /** Share of days at 8+ (Very High or worse). */
  readonly veryHigh: number;
  /** Share of days at 11+ (Extreme). */
  readonly extreme: number;
}

export interface CityNormals {
  readonly source: "arpansa" | "noaa";
  /** For a US city that borrows a nearby bulletin city's forecasts. */
  readonly via?: { readonly name: string; readonly state: string; readonly km: number } | null;
  readonly years: readonly [number, number];
  /** January first; null where too few valid days to publish. */
  readonly months: readonly (MonthNormal | null)[];
}

const CITIES = (data as unknown as { cities: Record<string, CityNormals> }).cities;

export function normalsFor(locationId: string): CityNormals | null {
  const found = CITIES[locationId];
  return found && found.months.length === 12 ? found : null;
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * "on 58% of October days", "on every October day", "on almost no ...".
 *
 * Words at the ends, because a percentage rounds them wrong: 99.6% of days is
 * not "100% of days", and saying so would claim a certainty the record does
 * not have. Exactly all or none says "every" and "no"; within half a percent of
 * either says "nearly" or "almost".
 */
export function shareOfDays(share: number, month: string): string {
  if (share >= 1) return `on every ${month} day`;
  if (share >= 0.995) return `on nearly every ${month} day`;
  if (share <= 0) return `on no ${month} days`;
  if (share < 0.005) return `on almost no ${month} days`;
  return `on ${Math.round(share * 100)}% of ${month} days`;
}
