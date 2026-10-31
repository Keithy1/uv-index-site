import { describe, expect, it } from "vitest";

import { sunTimes } from "../src/lib/sun";

/** Within this many minutes of the published time: the formula is good to one or two. */
const SLACK = 5;

function clock(h: number, m: number): number {
  return h * 60 + m;
}

describe("sunTimes", () => {
  it("puts Sydney's longest day at about 5:41 am to 8:05 pm, daylight saving included", () => {
    const t = sunTimes(-33.87, 151.21, "2026-12-21", "Australia/Sydney")!;
    expect(Math.abs(t.sunrise - clock(5, 41))).toBeLessThanOrEqual(SLACK);
    expect(Math.abs(t.sunset - clock(20, 5))).toBeLessThanOrEqual(SLACK);
  });

  it("puts Perth's shortest day at about 7:15 am to 5:20 pm, with no daylight saving", () => {
    const t = sunTimes(-31.95, 115.86, "2026-06-21", "Australia/Perth")!;
    expect(Math.abs(t.sunrise - clock(7, 15))).toBeLessThanOrEqual(SLACK);
    expect(Math.abs(t.sunset - clock(17, 20))).toBeLessThanOrEqual(SLACK);
  });

  it("uses Adelaide's half-hour offset rather than a whole-hour one", () => {
    // Adelaide is UTC+10:30 in summer. A whole-hour assumption would be 30 minutes out.
    const t = sunTimes(-34.93, 138.6, "2026-12-21", "Australia/Adelaide")!;
    expect(Math.abs(t.sunrise - clock(5, 57))).toBeLessThanOrEqual(SLACK);
    expect(Math.abs(t.sunset - clock(20, 27))).toBeLessThanOrEqual(SLACK);
  });

  it("returns null where the sun does not set or rise", () => {
    expect(sunTimes(78.2, 15.6, "2026-06-21", "Arctic/Longyearbyen")).toBeNull();
    expect(sunTimes(78.2, 15.6, "2026-12-21", "Arctic/Longyearbyen")).toBeNull();
  });
});
