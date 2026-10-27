import { describe, expect, it } from "vitest";

import type { CityNormals, MonthNormal } from "../src/lib/normals";
import { locationsIn } from "../src/lib/locations";
import { normalsFor, shareOfDays } from "../src/lib/normals";
import { ThisTimeOfYear } from "../src/views/ThisTimeOfYear";

const month = (median: number, over: Partial<MonthNormal> = {}): MonthNormal => ({
  days: 300,
  median,
  protect: 1,
  veryHigh: 0.58,
  extreme: 0.03,
  ...over,
});

const twelve = (m: MonthNormal | null): (MonthNormal | null)[] => Array.from({ length: 12 }, () => m);

const PERTH: CityNormals = { source: "arpansa", years: [2016, 2025], months: twelve(month(8.3)) };
const MESA: CityNormals = {
  source: "noaa",
  via: { name: "Phoenix", state: "AZ", km: 23 },
  years: [2015, 2024],
  months: twelve(month(6)),
};

const render = (normals: CityNormals, city: string, m = 10) =>
  String(ThisTimeOfYear({ normals, month: m, city }) ?? "").replace(/&#39;/g, "'");

describe("shareOfDays", () => {
  it("says every and no only when it is exactly so", () => {
    expect(shareOfDays(1, "October")).toBe("on every October day");
    expect(shareOfDays(0, "October")).toBe("on no October days");
  });

  it("does not round 99.6% up to a certainty the record does not have", () => {
    expect(shareOfDays(0.996, "October")).toBe("on nearly every October day");
    expect(shareOfDays(0.004, "October")).toBe("on almost no October days");
  });

  it("gives a percentage in between", () => {
    expect(shareOfDays(0.58, "October")).toBe("on 58% of October days");
  });
});

describe("This time of year", () => {
  it("words ARPANSA's figures as measurements", () => {
    const html = render(PERTH, "Perth");
    expect(html).toContain("In October, Perth's UV typically peaks around");
    expect(html).toContain("ARPANSA's measurements reached");
    expect(html).not.toContain("forecast");
  });

  it("words NOAA's figures as forecasts, never as measurements", () => {
    // The rule the title test enforces for the page head, applied here: a US
    // city has no instrument, and nothing on its page may say otherwise.
    const html = render(MESA, "Mesa");
    expect(html).toContain("NOAA's noon forecasts for Phoenix");
    expect(html).toContain("not measurements");
    expect(html).not.toMatch(/measurements reached|recorded/);
  });

  it("names the city a proxy borrows from, and how far away it is", () => {
    expect(render(MESA, "Mesa")).toContain(
      "NOAA does not forecast Mesa separately; these are its forecasts for Phoenix, AZ, 23 km away.",
    );
    expect(render({ ...MESA, via: null }, "Phoenix")).not.toContain("separately");
  });

  it("carries its own credit, so the figures cannot appear without it", () => {
    expect(render(PERTH, "Perth")).toContain("licensed CC BY 2.5 AU");
    expect(render(MESA, "Mesa")).toContain("Climate Prediction Center");
  });

  it("shows nothing for a month with too few days, rather than a thin guess", () => {
    const sparse: CityNormals = { ...PERTH, months: PERTH.months.map((m, i) => (i === 9 ? null : m)) };
    expect(render(sparse, "Perth", 10)).toBe("");
    expect(render(sparse, "Perth", 11)).toContain("In November");
  });

  it("labels every month on the strip for a screen reader", () => {
    expect(render(PERTH, "Perth")).toContain("Typical daily peak by month: January 8.3,");
  });
});

describe("normalsFor", () => {
  it("returns nothing for a city it has no record of", () => {
    expect(normalsFor("xx-nowhere")).toBeNull();
  });
});

describe("data/normals.json", () => {
  /**
   * The committed figures themselves, so a bad recompute fails CI rather than
   * reaching a page. Both of these happened on the first run: every station
   * lost 2016 to a layout the parser did not know, and every US city claimed
   * "2015-2025" from the single 1 January 2025 bulletin.
   */
  const au = locationsIn("au").filter((l) => l.status === "live");

  it("covers every Australian city, all twelve months", () => {
    for (const loc of au) {
      const n = normalsFor(loc.id);
      expect(n, loc.id).not.toBeNull();
      expect(n!.source, loc.id).toBe("arpansa");
      expect(n!.months.filter(Boolean), loc.id).toHaveLength(12);
    }
  });

  it("uses a full ten years wherever the station has them", () => {
    // Emerald's record begins in 2019 and the Gold Coast's in 2018; every
    // other station has the whole decade, and losing a year means a parser
    // has stopped understanding a file.
    const late: Record<string, number> = { "au-emd": 2019, "au-gco": 2018 };
    for (const loc of au) {
      const n = normalsFor(loc.id)!;
      expect(n.years[0], loc.id).toBe(late[loc.id] ?? 2016);
      expect(n.years[1], loc.id).toBe(2025);
    }
  });

  it("covers at least 36 US cities, with no year range that overclaims", () => {
    const us = locationsIn("us").filter((l) => normalsFor(l.id) !== null);
    expect(us.length).toBeGreaterThanOrEqual(36);
    for (const loc of us) {
      const n = normalsFor(loc.id)!;
      expect(n.source, loc.id).toBe("noaa");
      expect(n.years, loc.id).toEqual([2015, 2024]);
    }
  });

  it("names the borrowed city for every proxy, within 60 km", () => {
    for (const loc of locationsIn("us")) {
      const via = normalsFor(loc.id)?.via;
      if (via) expect(via.km, loc.id).toBeLessThanOrEqual(60);
    }
  });
});
