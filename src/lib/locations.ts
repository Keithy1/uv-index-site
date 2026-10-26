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

import stationData from "../../data/stations.json";

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

/**
 * How a city is named where it has to stand on its own: a title, an H1, a
 * breadcrumb.
 *
 * US cities take their state. "UV Index Portland Today" does not say whether it
 * means Oregon or Maine, and the same goes for Columbus (OH and GA) and
 * Arlington (TX and VA) -- the slug has always known (`portland-or`) while the
 * title did not, so the page neither disambiguated itself nor matched the way
 * the search is actually typed. Deciding this per city would rot the moment a
 * second Springfield arrived, so every US city gets its state.
 *
 * Australian cities do not: there is one Perth that anyone searches for, and
 * "Perth, WA" reads like a postal address rather than a place.
 */
export function cityLabel(loc: Location): string {
  return loc.country === "us" && loc.epaState ? `${loc.name}, ${loc.epaState}` : loc.name;
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
    // Ten minutes, not an hour. An hour was right while the page showed only a
    // daily peak; it now shows an hourly "now" figure, and an hour-old "now"
    // is just wrong. A reader seeing a stale switch label was the symptom that
    // surfaced this.
    cacheSeconds: 600,
  },
  { code: "uk", name: "United Kingdom", status: "coming", current: [], forecast: [], ads: false, cacheSeconds: 3600 },
  { code: "ca", name: "Canada", status: "coming", current: [], forecast: [], ads: false, cacheSeconds: 3600 },
  { code: "nz", name: "New Zealand", status: "coming", current: [], forecast: [], ads: false, cacheSeconds: 3600 },
] as const;

/**
 * The stations themselves come from data/stations.json, which Python reads
 * too. They used to be written out in both languages, and they drifted: the
 * Python table keyed three Australian stations au-eme, au-gld and au-hob while
 * ARPANSA calls them emd, gco and kin, so those forecasts could never join the
 * cities they belonged to. One file, one set of rows.
 */
interface StationRecord {
  id: string;
  country: string;
  name: string;
  slug: string;
  lat: number;
  lon: number;
  tz: string;
  arpansaCode?: string;
  epaCity?: string;
  epaState?: string;
  stationNote?: string;
  status: string;
}

const STATIONS = (stationData as { stations: StationRecord[] }).stations.map(
  (s): Location => ({
    ...s,
    country: s.country as CountryCode,
    status: s.status as Status,
  }),
);

/**
 * ARPANSA's Antarctic stations. Present in the feed, never published: they have
 * no search demand and no sun-protection audience.
 */
export const ARPANSA_EXCLUDED_CODES: readonly string[] = ["cas", "dav", "maw"] as const;

/** "New York", "NY" -> "new-york-ny", giving /us/new-york-ny/. */
export function usSlug(city: string, state: string): string {
  const base = city
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${base}-${state.toLowerCase()}`;
}

export const LOCATIONS: readonly Location[] = STATIONS;

const BY_ID = new Map(LOCATIONS.map((l) => [l.id, l]));
const BY_ARPANSA = new Map(
  LOCATIONS.filter((l) => l.arpansaCode).map((l) => [l.arpansaCode!, l]),
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
