/**
 * Sunrise and sunset, worked out rather than fetched.
 *
 * The day strip runs from sunrise to sunset, and its ends must not come from
 * the forecast: a run that starts at 11 am would otherwise make the day start
 * at 11 am, and the hours it lacks would vanish instead of showing as missing.
 * NOAA's general solar position formula, good to a minute or two at these
 * latitudes, which is far finer than one strip cell.
 */
import { localMinutes } from "./time";

const RAD = Math.PI / 180;

/** Local minutes since midnight of sunrise and sunset on a local date, or null in polar day or night. */
export function sunTimes(
  lat: number,
  lon: number,
  dateKey: string,
  tz: string,
): { sunrise: number; sunset: number } | null {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const midnightUtc = Date.UTC(y, m - 1, d);
  const dayOfYear = (midnightUtc - Date.UTC(y, 0, 1)) / 86_400_000 + 1;
  // The fractional year at local solar noon (12 - lon/15 hours UTC), which is
  // close enough to both events.
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 - lon / 360);

  const eqTime =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);

  // 90.833 degrees: the sun's upper edge on the horizon, with refraction.
  const cosHa =
    Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(decl)) -
    Math.tan(lat * RAD) * Math.tan(decl);
  if (cosHa < -1 || cosHa > 1) return null;
  const ha = Math.acos(cosHa) / RAD;

  // Minutes from midnight UTC on the date; negative or past 1440 is fine, because
  // the local clock is read from the instant, through the zone, not by adding an offset.
  const at = (utcMinutes: number) =>
    localMinutes(new Date(midnightUtc + Math.round(utcMinutes) * 60_000).toISOString(), tz);
  return {
    sunrise: at(720 - 4 * (lon + ha) - eqTime),
    sunset: at(720 - 4 * (lon - ha) - eqTime),
  };
}
