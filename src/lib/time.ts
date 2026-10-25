/**
 * Local time, derived from UTC at render time.
 *
 * Every timestamp in D1 is ISO 8601 UTC. Nothing is ever stored with an offset,
 * because Queensland, the Northern Territory and Western Australia do not
 * observe daylight saving while New South Wales, Victoria, South Australia and
 * Tasmania do. A hard-coded offset is always a bug; `Intl` and the location's
 * IANA zone are the only correct way to get local time.
 */

/** "2:34 pm" */
export function localTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  })
    .format(new Date(iso))
    .replace(/ /g, " ");
}

/** "2:34 pm AWST" — the zone abbreviation matters on a page about a place. */
export function localTimeWithZone(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).formatToParts(new Date(iso));
  const zone = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  return `${localTime(iso, tz)} ${zone}`.trim();
}

/** "Sunday 25 October" */
export function localDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(iso));
}

/** "2026-10-25" in the location's own zone — the key `daily` rows use. */
export function localDateKey(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The hour of the day, 0-23, in the location's zone. Used to place chart points. */
export function localHour(iso: string, tz: string): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
  }).format(new Date(iso));
  return Number(hour) % 24;
}

/** Minutes since local midnight, so a chart can place a reading precisely. */
export function localMinutes(iso: string, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return (get("hour") % 24) * 60 + get("minute");
}

/** "4 minutes ago", "just now" — only ever used for a measured reading. */
export function howLongAgo(iso: string, now: Date = new Date()): string {
  const minutes = Math.round((now.getTime() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}
