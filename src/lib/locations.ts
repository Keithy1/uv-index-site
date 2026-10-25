/**
 * The location registry and the per-country settings.
 *
 * This file is the single place that decides what the site serves. Adding a
 * country means adding a `CountrySettings` entry and its locations; the world
 * map colours itself from `status`, and the source precedence lists decide
 * which adapter wins without any code change.
 *
 * ARPANSA station codes are taken from the live feed's own <name> element
 * (uvvalues.xml), not invented: adl, ali, bri, can, dar, emd, gco, kin, mel,
 * new, per, syd, tow. The feed also carries three Antarctic stations (cas,
 * dav, maw) which the site deliberately does not publish.
 */

export type CountryCode = "au" | "us" | "uk" | "ca" | "nz";

export type Status = "live" | "coming" | "off";

export interface Location {
  readonly id: string;          // "au-per" — stable key used in every table
  readonly country: CountryCode;
  readonly name: string;        // "Perth"
  readonly slug: string;        // "perth" -> /au/perth/
  readonly lat: number;
  readonly lon: number;
  readonly tz: string;          // IANA zone; never a fixed offset
  readonly arpansaCode?: string;
  readonly epaCity?: string;
  readonly epaState?: string;
  /** Shown on the page when the measuring station is not in the city itself. */
  readonly stationNote?: string;
  readonly status: Status;
}

export interface CountrySettings {
  readonly code: CountryCode;
  readonly name: string;
  readonly status: Status;
  /** Sources for "the reading now", best first. The first to pass its checks wins. */
  readonly current: readonly string[];
  /** Sources for forecasts, best first. */
  readonly forecast: readonly string[];
  /** Ads are off everywhere until the licence position for that country allows them. */
  readonly ads: boolean;
  /** Edge cache lifetime for this country's pages, in seconds. */
  readonly cacheSeconds: number;
}

export const COUNTRIES: readonly CountrySettings[] = [
  {
    code: "au",
    name: "Australia",
    status: "live",
    // ARPANSA is measured and authoritative; CAMS covers it if the feed stalls.
    current: ["arpansa", "cams"],
    forecast: ["cams"],
    // Blocked on ARPANSA's written authorisation for advertising.
    ads: false,
    cacheSeconds: 300,
  },
  {
    code: "us",
    name: "United States",
    status: "live",
    current: ["epa", "cams"],
    forecast: ["epa", "cams"],
    // EPA data is public domain, so the US may switch on first.
    ads: false,
    cacheSeconds: 3600,
  },
  { code: "uk", name: "United Kingdom", status: "coming", current: [], forecast: [], ads: false, cacheSeconds: 3600 },
  { code: "ca", name: "Canada", status: "coming", current: [], forecast: [], ads: false, cacheSeconds: 3600 },
  { code: "nz", name: "New Zealand", status: "coming", current: [], forecast: [], ads: false, cacheSeconds: 3600 },
] as const;

/**
 * ARPANSA's 13 mainland and Tasmanian stations.
 *
 * Coordinates are the INSTRUMENT's own position, read from the Lat/Lon columns
 * of ARPANSA's historical CSVs on data.gov.au -- not the city centre. This
 * matters because a CAMS grid cell is about 44 km across, so a station 20 km
 * from the CBD can fall in a different cell, and a forecast would then describe
 * somewhere other than the place being measured.
 *
 * The largest differences: Sydney's station is 20 km south of the CBD, at
 * -34.04, and Melbourne's is 14 km north-east. Hobart's is at Kingston.
 */
const AU_LOCATIONS: readonly Location[] = [
  { id: "au-adl", country: "au", name: "Adelaide",      slug: "adelaide",      lat: -34.95, lon: 138.52, tz: "Australia/Adelaide",  arpansaCode: "adl", status: "live" },
  { id: "au-ali", country: "au", name: "Alice Springs", slug: "alice-springs", lat: -23.8, lon: 133.89, tz: "Australia/Darwin",    arpansaCode: "ali", status: "live" },
  { id: "au-bri", country: "au", name: "Brisbane",      slug: "brisbane",      lat: -27.45, lon: 153.03, tz: "Australia/Brisbane",  arpansaCode: "bri", status: "live" },
  { id: "au-can", country: "au", name: "Canberra",      slug: "canberra",      lat: -35.31, lon: 149.2, tz: "Australia/Sydney",    arpansaCode: "can", status: "live" },
  { id: "au-dar", country: "au", name: "Darwin",        slug: "darwin",        lat: -12.43, lon: 130.89, tz: "Australia/Darwin",    arpansaCode: "dar", status: "live" },
  { id: "au-emd", country: "au", name: "Emerald",       slug: "emerald",       lat: -23.53, lon: 148.16, tz: "Australia/Brisbane",  arpansaCode: "emd", status: "live" },
  { id: "au-gco", country: "au", name: "Gold Coast",    slug: "gold-coast",    lat: -28.0, lon: 153.37, tz: "Australia/Brisbane",  arpansaCode: "gco", status: "live" },
  {
    id: "au-kin", country: "au", name: "Hobart", slug: "hobart",
    lat: -42.99, lon: 147.29, tz: "Australia/Hobart", arpansaCode: "kin",
    stationNote: "Measured at ARPANSA's Kingston station, 11 km south of central Hobart.",
    status: "live",
  },
  { id: "au-mel", country: "au", name: "Melbourne",  slug: "melbourne",  lat: -37.73, lon: 145.1, tz: "Australia/Melbourne", arpansaCode: "mel", status: "live" },
  { id: "au-new", country: "au", name: "Newcastle",  slug: "newcastle",  lat: -32.9, lon: 151.72, tz: "Australia/Sydney",    arpansaCode: "new", status: "live" },
  { id: "au-per", country: "au", name: "Perth",      slug: "perth",      lat: -31.93, lon: 115.98, tz: "Australia/Perth",     arpansaCode: "per", status: "live" },
  { id: "au-syd", country: "au", name: "Sydney",     slug: "sydney",     lat: -34.04, lon: 151.1, tz: "Australia/Sydney",    arpansaCode: "syd", status: "live" },
  { id: "au-tow", country: "au", name: "Townsville", slug: "townsville", lat: -19.33, lon: 146.76, tz: "Australia/Brisbane",  arpansaCode: "tow", status: "live" },
] as const;

/**
 * ARPANSA's Antarctic stations. Present in the feed, never published: they have
 * no search demand and no sun-protection audience.
 */
export const ARPANSA_EXCLUDED_CODES: readonly string[] = ["cas", "dav", "maw"] as const;

/**
 * The 50 US cities EPA forecasts for at launch.
 *
 * Written as tuples rather than objects because repetition is where
 * transcription errors hide: [EPA city, EPA state, latitude, longitude, IANA zone].
 * The slug is derived, so the URL and the id can never drift apart.
 * Coordinates are city centres and exist only for the CAMS fallback; a test
 * asserts each one lands inside the United States, which catches the realistic
 * mistakes (a dropped minus sign, latitude and longitude transposed).
 */
type UsCity = readonly [city: string, state: string, lat: number, lon: number, tz: string];

const US_CITY_TABLE: readonly UsCity[] = [
  ["New York", "NY", 40.71, -74.01, "America/New_York"],
  ["Los Angeles", "CA", 34.05, -118.24, "America/Los_Angeles"],
  ["Chicago", "IL", 41.88, -87.63, "America/Chicago"],
  ["Houston", "TX", 29.76, -95.37, "America/Chicago"],
  ["Phoenix", "AZ", 33.45, -112.07, "America/Phoenix"],
  ["Philadelphia", "PA", 39.95, -75.17, "America/New_York"],
  ["San Antonio", "TX", 29.42, -98.49, "America/Chicago"],
  ["San Diego", "CA", 32.72, -117.16, "America/Los_Angeles"],
  ["Dallas", "TX", 32.78, -96.80, "America/Chicago"],
  ["San Jose", "CA", 37.34, -121.89, "America/Los_Angeles"],
  ["Austin", "TX", 30.27, -97.74, "America/Chicago"],
  ["Jacksonville", "FL", 30.33, -81.66, "America/New_York"],
  ["Fort Worth", "TX", 32.76, -97.33, "America/Chicago"],
  ["Columbus", "OH", 39.96, -83.00, "America/New_York"],
  ["Charlotte", "NC", 35.23, -80.84, "America/New_York"],
  ["Indianapolis", "IN", 39.77, -86.16, "America/Indiana/Indianapolis"],
  ["Seattle", "WA", 47.61, -122.33, "America/Los_Angeles"],
  ["Denver", "CO", 39.74, -104.99, "America/Denver"],
  ["Washington", "DC", 38.90, -77.04, "America/New_York"],
  ["Boston", "MA", 42.36, -71.06, "America/New_York"],
  ["El Paso", "TX", 31.76, -106.49, "America/Denver"],
  ["Nashville", "TN", 36.16, -86.78, "America/Chicago"],
  ["Detroit", "MI", 42.33, -83.05, "America/Detroit"],
  ["Oklahoma City", "OK", 35.47, -97.52, "America/Chicago"],
  ["Portland", "OR", 45.52, -122.68, "America/Los_Angeles"],
  ["Las Vegas", "NV", 36.17, -115.14, "America/Los_Angeles"],
  ["Memphis", "TN", 35.15, -90.05, "America/Chicago"],
  ["Louisville", "KY", 38.25, -85.76, "America/Kentucky/Louisville"],
  ["Baltimore", "MD", 39.29, -76.61, "America/New_York"],
  ["Milwaukee", "WI", 43.04, -87.91, "America/Chicago"],
  ["Albuquerque", "NM", 35.08, -106.65, "America/Denver"],
  ["Tucson", "AZ", 32.22, -110.97, "America/Phoenix"],
  ["Fresno", "CA", 36.74, -119.79, "America/Los_Angeles"],
  ["Sacramento", "CA", 38.58, -121.49, "America/Los_Angeles"],
  ["Kansas City", "MO", 39.10, -94.58, "America/Chicago"],
  ["Mesa", "AZ", 33.42, -111.83, "America/Phoenix"],
  ["Atlanta", "GA", 33.75, -84.39, "America/New_York"],
  ["Omaha", "NE", 41.26, -95.93, "America/Chicago"],
  ["Colorado Springs", "CO", 38.83, -104.82, "America/Denver"],
  ["Raleigh", "NC", 35.78, -78.64, "America/New_York"],
  ["Miami", "FL", 25.76, -80.19, "America/New_York"],
  ["Long Beach", "CA", 33.77, -118.19, "America/Los_Angeles"],
  ["Virginia Beach", "VA", 36.85, -75.98, "America/New_York"],
  ["Oakland", "CA", 37.80, -122.27, "America/Los_Angeles"],
  ["Minneapolis", "MN", 44.98, -93.27, "America/Chicago"],
  ["Tulsa", "OK", 36.15, -95.99, "America/Chicago"],
  ["Tampa", "FL", 27.95, -82.46, "America/New_York"],
  ["Arlington", "TX", 32.74, -97.11, "America/Chicago"],
  ["New Orleans", "LA", 29.95, -90.07, "America/Chicago"],
  ["Wichita", "KS", 37.69, -97.34, "America/Chicago"],
] as const;

/** "New York", "NY" -> "new-york-ny", giving /us/new-york-ny/. */
export function usSlug(city: string, state: string): string {
  const base = city
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${base}-${state.toLowerCase()}`;
}

const US_LOCATIONS: readonly Location[] = US_CITY_TABLE.map(([city, state, lat, lon, tz]) => {
  const slug = usSlug(city, state);
  return {
    id: `us-${slug}`,
    country: "us" as const,
    name: city,
    slug,
    lat,
    lon,
    tz,
    epaCity: city,
    epaState: state,
    // US city pages go live only where Search Console shows real impressions,
    // so they are fetched and stored but not published yet.
    status: "coming" as const,
  };
});

export const LOCATIONS: readonly Location[] = [...AU_LOCATIONS, ...US_LOCATIONS];

const BY_ID = new Map(LOCATIONS.map((l) => [l.id, l]));
const BY_ARPANSA = new Map(
  AU_LOCATIONS.filter((l) => l.arpansaCode).map((l) => [l.arpansaCode!, l]),
);

export function locationById(id: string): Location | undefined {
  return BY_ID.get(id);
}

/** Resolve an ARPANSA feed <name> code to a location, or undefined if unpublished. */
export function locationByArpansaCode(code: string): Location | undefined {
  return BY_ARPANSA.get(code.trim().toLowerCase());
}

export function locationsIn(country: CountryCode): readonly Location[] {
  return LOCATIONS.filter((l) => l.country === country);
}

export function countrySettings(code: CountryCode): CountrySettings | undefined {
  return COUNTRIES.find((c) => c.code === code);
}

export function liveCountries(): readonly CountrySettings[] {
  return COUNTRIES.filter((c) => c.status === "live");
}
