import { describe, expect, it } from "vitest";

import {
  howLongAgo,
  localDateKey,
  localeFor,
  localHour,
  localMinutes,
  localTimeWithZone,
} from "../src/lib/time";

/**
 * These tests exist because the daylight-saving split is the easiest way to
 * put every Australian reading an hour out, and it would be invisible in
 * review: the page would simply say the wrong time, consistently, for half
 * the year, in the half of the country that observes it.
 */
describe("local time across the daylight-saving divide", () => {
  // 2026-01-15T02:00:00Z — mid-summer, so NSW/VIC/SA are on daylight saving
  // and QLD/NT/WA are not.
  const summer = "2026-01-15T02:00:00Z";

  it("gives Sydney daylight saving and Brisbane none, though both are +10 in winter", () => {
    expect(localTimeWithZone(summer, "Australia/Sydney")).toBe("1:00 pm AEDT");
    expect(localTimeWithZone(summer, "Australia/Brisbane")).toBe("12:00 pm AEST");
  });

  it("gives Adelaide a half-hour offset and Darwin a different one again", () => {
    expect(localTimeWithZone(summer, "Australia/Adelaide")).toBe("12:30 pm ACDT");
    expect(localTimeWithZone(summer, "Australia/Darwin")).toBe("11:30 am ACST");
  });

  it("gives Perth no daylight saving at any time of year", () => {
    expect(localTimeWithZone(summer, "Australia/Perth")).toBe("10:00 am AWST");
    expect(localTimeWithZone("2026-07-15T02:00:00Z", "Australia/Perth")).toBe("10:00 am AWST");
  });

  it("puts Sydney and Brisbane back on the same clock in winter", () => {
    const winter = "2026-07-15T02:00:00Z";
    expect(localTimeWithZone(winter, "Australia/Sydney")).toBe("12:00 pm AEST");
    expect(localTimeWithZone(winter, "Australia/Brisbane")).toBe("12:00 pm AEST");
  });
});

describe("localDateKey", () => {
  it("uses the location's day, not the UTC day", () => {
    // 22:00 UTC is already tomorrow in Sydney but still today in Perth.
    const iso = "2026-01-15T22:00:00Z";
    expect(localDateKey(iso, "Australia/Sydney")).toBe("2026-01-16");
    expect(localDateKey(iso, "Australia/Perth")).toBe("2026-01-16");
    expect(localDateKey("2026-01-15T14:00:00Z", "Australia/Perth")).toBe("2026-01-15");
    expect(localDateKey("2026-01-15T14:00:00Z", "Australia/Sydney")).toBe("2026-01-16");
  });
});

describe("localMinutes and localHour", () => {
  it("count from local midnight", () => {
    expect(localMinutes("2026-01-15T02:00:00Z", "Australia/Sydney")).toBe(13 * 60);
    expect(localMinutes("2026-01-15T02:30:00Z", "Australia/Adelaide")).toBe(13 * 60);
    expect(localHour("2026-01-15T02:00:00Z", "Australia/Brisbane")).toBe(12);
  });

  it("handles midnight without wrapping to 1440", () => {
    expect(localMinutes("2026-01-14T13:00:00Z", "Australia/Sydney")).toBe(0);
    expect(localHour("2026-01-14T13:00:00Z", "Australia/Sydney")).toBe(0);
  });
});

describe("howLongAgo", () => {
  const now = new Date("2026-01-15T02:00:00Z");

  it("reads naturally at the scales a live reading actually has", () => {
    expect(howLongAgo("2026-01-15T01:59:40Z", now)).toBe("just now");
    expect(howLongAgo("2026-01-15T01:59:00Z", now)).toBe("1 minute ago");
    expect(howLongAgo("2026-01-15T01:46:00Z", now)).toBe("14 minutes ago");
    expect(howLongAgo("2026-01-15T01:00:00Z", now)).toBe("1 hour ago");
    expect(howLongAgo("2026-01-14T23:00:00Z", now)).toBe("3 hours ago");
  });
});

describe("formatter caching", () => {
  /**
   * A country page converts roughly 2,500 timestamps per render. Building an
   * Intl.DateTimeFormat for each one tipped the Worker over Cloudflare's
   * free-plan 10 ms CPU limit: single requests returned 200 while a crawl
   * produced "Worker exceeded CPU time limit". The bound below is generous —
   * it is here to catch a return to per-call construction, which is roughly
   * two orders of magnitude slower, not to police milliseconds.
   */
  it("converts a page's worth of timestamps quickly", () => {
    const zones = [
      "Australia/Sydney",
      "Australia/Perth",
      "Australia/Darwin",
      "Australia/Adelaide",
      "America/New_York",
    ];
    const start = performance.now();
    for (let i = 0; i < 2500; i++) {
      const tz = zones[i % zones.length]!;
      const iso = new Date(Date.UTC(2026, 0, 15, i % 24, 0, 0)).toISOString();
      localDateKey(iso, tz);
      localMinutes(iso, tz);
    }
    expect(performance.now() - start).toBeLessThan(1500);
  });

  it("still returns correct values when the cache is warm", () => {
    for (let i = 0; i < 50; i++) {
      expect(localDateKey("2026-01-15T22:00:00Z", "Australia/Sydney")).toBe("2026-01-16");
      expect(localMinutes("2026-01-15T02:00:00Z", "Australia/Sydney")).toBe(13 * 60);
    }
  });
});

describe("the locale a zone is named in", () => {
  it("names a US zone the way a US reader writes it", () => {
    // en-AU knows AEDT but renders America/New_York as "GMT-4", which is how
    // /us/miami-fl/ first went live: "Forecast for 11:00 am GMT-4".
    const miami = "2026-10-26T15:00:00Z";
    expect(localTimeWithZone(miami, "America/New_York", localeFor("us"))).toContain("EDT");
    expect(localTimeWithZone(miami, "America/Los_Angeles", localeFor("us"))).toContain("PDT");
  });

  it("still names an Australian zone", () => {
    const t = "2026-10-26T02:00:00Z";
    expect(localTimeWithZone(t, "Australia/Sydney", localeFor("au"))).toContain("AEDT");
    expect(localTimeWithZone(t, "Australia/Perth", localeFor("au"))).toContain("AWST");
  });
});
