/**
 * Local time, derived from UTC at render time.
 *
 * Every timestamp in D1 is ISO 8601 UTC. Nothing is ever stored with an offset,
 * because Queensland, the Northern Territory and Western Australia do not
 * observe daylight saving while New South Wales, Victoria, South Australia and
 * Tasmania do. A hard-coded offset is always a bug; `Intl` and the location's
 * IANA zone are the only correct way to get local time.
 *
 * **Formatters are cached, and that is not a micro-optimisation.** Constructing
 * an `Intl.DateTimeFormat` is expensive — it loads locale and time-zone data —
 * and these functions are called once per forecast point. A country page with
 * 13 cities and 97 hourly values each was building about 2,500 formatters per
 * render and tipping over the Cloudflare free plan's 10 ms CPU limit: single
 * requests returned 200 while a crawl produced "Worker exceeded CPU time
 * limit". Cached, there are at most a handful per zone for the life of the
 * isolate.
 */

/**
 * Which locale names a zone.
 *
 * en-AU knows AEDT and AWST but renders America/New_York as "GMT-4", which is
 * both ugly and unhelpful to the reader it is for. The locale follows the
 * place, so an Australian city gets AEST and a US city gets EDT.
 */
export function localeFor(country: string): string {
  return country === "us" ? "en-US" : "en-AU";
}

type FormatterKey = string;

const formatters = new Map<FormatterKey, Intl.DateTimeFormat>();

function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  // The options are a small fixed set, so a JSON key is cheap and exact.
  const key = `${locale}|${JSON.stringify(options)}`;
  let found = formatters.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, found);
  }
  return found;
}

/**
 * Minutes since local midnight as "12:20 pm": the site's one way of writing a
 * time. Every clock on every page comes through here, so they cannot disagree.
 * Intl could not be trusted with it: en-US writes "4:00 PM" and en-AU "4:00 pm",
 * and Miami's page said the first while Sydney's said the second.
 */
export function minutesToClock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** "2:34 pm", in the location's zone. */
export function localTime(iso: string, tz: string): string {
  return minutesToClock(localMinutes(iso, tz));
}

/** "2:34 pm AWST" — the zone abbreviation matters on a page about a place. */
export function localTimeWithZone(iso: string, tz: string, locale = "en-AU"): string {
  const parts = formatter(locale, {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).formatToParts(new Date(iso));
  const zone = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  return `${localTime(iso, tz)} ${zone}`.trim();
}

/** "Sunday 25 October" */
export function localDate(iso: string, tz: string, locale = "en-AU"): string {
  return formatter(locale, {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(iso));
}

/** "25/10/26" in Australia, "10/25/26" in the US: the short date each locale reads. */
export function localShortDate(iso: string, tz: string, locale = "en-AU"): string {
  return formatter(locale, { timeZone: tz, day: "2-digit", month: "2-digit", year: "2-digit" }).format(new Date(iso));
}

/** "2026-10-25" in the location's own zone — the key `daily` rows use. */
export function localDateKey(iso: string, tz: string): string {
  const parts = formatter("en-CA", {
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
  const hour = formatter("en-GB", { timeZone: tz, hour: "numeric", hour12: false }).format(
    new Date(iso),
  );
  return Number(hour) % 24;
}

/** Minutes since local midnight, so a chart can place a reading precisely. */
export function localMinutes(iso: string, tz: string): number {
  const parts = formatter("en-GB", {
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

/**
 * "2 h ago": the same idea as howLongAgo, short enough for a table cell. Used
 * where a row is past the staleness rule, so the age is the point.
 */
export function agoShort(iso: string, now: Date = new Date()): string {
  const minutes = Math.round((now.getTime() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}
