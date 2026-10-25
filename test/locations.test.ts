import { describe, expect, it } from "vitest";

import {
  ARPANSA_EXCLUDED_CODES,
  COUNTRIES,
  LOCATIONS,
  liveCountries,
  locationByArpansaCode,
  locationsIn,
  usSlug,
} from "../src/lib/locations";

describe("the registry", () => {
  it("has ARPANSA's 13 published stations and 50 US cities", () => {
    expect(locationsIn("au")).toHaveLength(13);
    expect(locationsIn("us")).toHaveLength(50);
  });

  it("gives every location a unique id", () => {
    const ids = LOCATIONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every location a unique URL within its country", () => {
    const paths = LOCATIONS.map((l) => `/${l.country}/${l.slug}/`);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("uses slugs that are safe in a URL without escaping", () => {
    for (const location of LOCATIONS) {
      expect(location.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("names a real IANA time zone for every location", () => {
    // A fixed offset would break Queensland, the NT and WA, which have no
    // daylight saving, as well as the cities that do. An invalid zone name
    // throws here rather than at render time in production.
    for (const location of LOCATIONS) {
      expect(() =>
        new Intl.DateTimeFormat("en-AU", { timeZone: location.tz }).format(new Date()),
      ).not.toThrow();
    }
  });
});

describe("Australian stations", () => {
  it("resolves each published ARPANSA code", () => {
    for (const code of ["adl", "ali", "bri", "can", "dar", "emd", "gco", "kin", "mel", "new", "per", "syd", "tow"]) {
      expect(locationByArpansaCode(code), code).toBeDefined();
    }
  });

  it("does not publish the Antarctic stations", () => {
    for (const code of ARPANSA_EXCLUDED_CODES) {
      expect(locationByArpansaCode(code), code).toBeUndefined();
    }
  });

  it("maps Hobart to the Kingston station and says so on the page", () => {
    const hobart = locationByArpansaCode("kin");
    expect(hobart?.name).toBe("Hobart");
    expect(hobart?.slug).toBe("hobart");
    expect(hobart?.stationNote).toMatch(/Kingston/);
  });

  it("puts every Australian station in the southern hemisphere and the right longitudes", () => {
    for (const location of locationsIn("au")) {
      expect(location.lat, location.id).toBeLessThan(-10);
      expect(location.lat, location.id).toBeGreaterThan(-44);
      expect(location.lon, location.id).toBeGreaterThan(112);
      expect(location.lon, location.id).toBeLessThan(154);
    }
  });
});

describe("US cities", () => {
  it("derives the slug from the city and state", () => {
    expect(usSlug("New York", "NY")).toBe("new-york-ny");
    expect(usSlug("Fort Worth", "TX")).toBe("fort-worth-tx");
    expect(usSlug("Colorado Springs", "CO")).toBe("colorado-springs-co");
  });

  it("places every city inside the contiguous United States", () => {
    // Catches the mistakes that actually happen in a hand-written table: a
    // dropped minus sign on longitude, or latitude and longitude transposed.
    for (const location of locationsIn("us")) {
      expect(location.lat, location.id).toBeGreaterThan(24);
      expect(location.lat, location.id).toBeLessThan(50);
      expect(location.lon, location.id).toBeLessThan(-66);
      expect(location.lon, location.id).toBeGreaterThan(-125);
    }
  });

  it("carries the EPA city and state needed to query the forecast", () => {
    for (const location of locationsIn("us")) {
      expect(location.epaCity, location.id).toBeTruthy();
      expect(location.epaState, location.id).toMatch(/^[A-Z]{2}$/);
    }
  });
});

describe("country settings", () => {
  it("launches with Australia and the United States live", () => {
    expect(liveCountries().map((c) => c.code)).toEqual(["au", "us"]);
  });

  it("has ads off everywhere until the licence position allows them", () => {
    // Australia needs ARPANSA's written authorisation; this assertion is the
    // tripwire that stops ads being switched on by accident.
    for (const country of COUNTRIES) {
      expect(country.ads, country.code).toBe(false);
    }
  });

  it("gives every live country at least one source for current and forecast", () => {
    for (const country of liveCountries()) {
      expect(country.current.length, country.code).toBeGreaterThan(0);
      expect(country.forecast.length, country.code).toBeGreaterThan(0);
    }
  });
});
