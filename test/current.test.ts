import { describe, expect, it } from "vitest";

import {
  adviceLevel,
  currentLevel,
  NEAR_HOUR_MS,
  nextLocalDay,
  peakOnLocalDay,
  pointsOnLocalDay,
} from "../src/lib/current";
import { bandFor, roundForBand } from "../src/lib/uv";

const NOW = new Date("2026-10-26T14:00:00Z");
const at = (iso: string, uvi: number) => ({ validAt: iso, uvi });

describe("currentLevel", () => {
  it("prefers a measurement and says it is one", () => {
    const r = currentLevel({ measured: 7.3, forecast: [at("2026-10-26T14:00:00Z", 6.1)], now: NOW });
    expect(r).toEqual({ uvi: 7.3, forecast: false });
  });

  it("falls back to the forecast for THIS hour, not the day's peak", () => {
    // The bug this function exists to prevent: the home page fell back to
    // today's peak while the country page used the current hour, so one
    // country had two different headline figures.
    const r = currentLevel({
      measured: null,
      forecast: [
        at("2026-10-26T06:00:00Z", 9.9), // the day's peak, hours away
        at("2026-10-26T14:00:00Z", 2.5), // this hour
      ],
      now: NOW,
    });
    expect(r).toEqual({ uvi: 2.5, forecast: true });
  });

  it("picks the nearest hour when the current one is missing", () => {
    const r = currentLevel({
      measured: null,
      forecast: [at("2026-10-26T13:00:00Z", 3.1), at("2026-10-26T16:00:00Z", 1.0)],
      now: NOW,
    });
    expect(r.uvi).toBe(3.1);
  });

  it("refuses a forecast that is too far from now", () => {
    const far = new Date(NOW.getTime() + NEAR_HOUR_MS + 60_000).toISOString();
    expect(currentLevel({ measured: null, forecast: [at(far, 8)], now: NOW }).uvi).toBeNull();
  });

  it("returns null rather than inventing a level", () => {
    const r = currentLevel({ measured: null, forecast: [], now: NOW });
    expect(r.uvi).toBeNull();
    expect(r.forecast).toBe(false);
  });

  it("keeps a genuine zero, which is a real night-time reading", () => {
    expect(currentLevel({ measured: 0, forecast: [], now: NOW })).toEqual({
      uvi: 0,
      forecast: false,
    });
  });
});

describe("peakOnLocalDay", () => {
  const bell = (peak: number) =>
    Array.from({ length: 16 }, (_, i) => {
      const h = i + 5;
      return { minutes: h * 60, uvi: Math.max(0, peak * (1 - (Math.abs(h - 12) / 7) ** 2)) };
    });

  it("finds the peak of a full day", () => {
    expect(peakOnLocalDay(bell(11))!.uvi).toBeCloseTo(11, 5);
  });

  it("refuses a day that stops before the afternoon", () => {
    // Brisbane once "peaked at 6.1 at 9 am" because 9 am was the last hour the
    // forecast contained.
    expect(peakOnLocalDay(bell(11).filter((p) => p.minutes <= 9 * 60))).toBeNull();
  });

  it("refuses a day that starts after the morning", () => {
    expect(peakOnLocalDay(bell(11).filter((p) => p.minutes >= 13 * 60))).toBeNull();
  });

  it("refuses an empty day", () => {
    expect(peakOnLocalDay([])).toBeNull();
  });
});

describe("pointsOnLocalDay and nextLocalDay", () => {
  it("selects a city's own day, not the UTC day", () => {
    const forecast = [
      at("2026-10-26T13:00:00Z", 1), // 27 Oct in Sydney
      at("2026-10-26T12:00:00Z", 2), // 26 Oct in Sydney
    ];
    const sydney = pointsOnLocalDay(forecast, "Australia/Sydney", "2026-10-27");
    expect(sydney).toHaveLength(1);
    expect(sydney[0]!.uvi).toBe(1);
  });

  it("steps to the next day across a month end", () => {
    expect(nextLocalDay("2026-10-31")).toBe("2026-11-01");
    expect(nextLocalDay("2026-12-31")).toBe("2027-01-01");
    expect(nextLocalDay("2028-02-28")).toBe("2028-02-29");
  });
});

describe("adviceLevel", () => {
  /**
   * The bug: at 12:19 am Alice Springs read 0.0 Low and the page said "no
   * protection needed for most people" -- beside its own forecast of 12.1
   * Extreme later that day. Advice must follow what is coming, not what is
   * happening.
   */
  const day = (peak: number) =>
    Array.from({ length: 16 }, (_, i) => {
      const h = i + 5;
      return { minutes: h * 60, uvi: Math.max(0, peak * (1 - (Math.abs(h - 12) / 7) ** 2)) };
    });

  it("warns about the day ahead at midnight, not the reading", () => {
    const a = adviceLevel({ now: 0, today: day(12.1), tomorrowPeak: 11, nowMinutes: 19 });
    expect(a).not.toBeNull();
    expect(a!.scope).toBe("today");
    expect(a!.uvi).toBeCloseTo(12.1, 1);
  });

  it("drops back as the day is used up", () => {
    // Mid-afternoon, the peak has passed; advise for what is left.
    const a = adviceLevel({ now: 5, today: day(12), tomorrowPeak: 12, nowMinutes: 15 * 60 });
    expect(a!.scope).toBe("today");
    expect(a!.uvi).toBeLessThan(12);
    expect(a!.uvi).toBeGreaterThanOrEqual(5);
  });

  it("looks to tomorrow once today is spent", () => {
    // 9 pm: nothing left today, but the morning is Extreme.
    const a = adviceLevel({ now: 0, today: day(12), tomorrowPeak: 12.5, nowMinutes: 21 * 60 });
    expect(a!.scope).toBe("tomorrow");
    expect(a!.uvi).toBe(12.5);
  });

  it("uses the current reading when it is the highest thing on offer", () => {
    const a = adviceLevel({ now: 9, today: [], tomorrowPeak: 4, nowMinutes: 12 * 60 });
    expect(a!.scope).toBe("now");
    expect(a!.uvi).toBe(9);
  });

  it("never advises for a lower level than is coming", () => {
    // The property that matters: whatever the hour, the advice level is at
    // least the highest level still ahead today.
    for (let h = 0; h < 24; h++) {
      const today = day(13);
      const ahead = today.filter((p) => p.minutes >= h * 60).map((p) => p.uvi);
      const a = adviceLevel({ now: 0, today, tomorrowPeak: 1, nowMinutes: h * 60 });
      if (ahead.length === 0) continue;
      expect(a!.uvi, `hour ${h}`).toBeGreaterThanOrEqual(Math.max(...ahead) - 1e-9);
    }
  });

  it("stays on today in the afternoon while today still needs protection", () => {
    // Alice Springs, 27 October, 1:30 pm. The morning's 12.1 had passed; the
    // instrument read about 10, above the forecast for the rest of the
    // afternoon; tomorrow forecast 11.3. So the best of today was the reading
    // itself, tomorrow beat it, and the page said "What to do tomorrow" with
    // UV at 10. Today is not spent until the rest of it is below 3.
    const afternoon = [
      { minutes: 14 * 60, uvi: 9 },
      { minutes: 15 * 60, uvi: 6.5 },
      { minutes: 16 * 60, uvi: 3.8 },
    ];
    const a = adviceLevel({ now: 10, today: afternoon, tomorrowPeak: 11.3, nowMinutes: 13 * 60 + 30 });
    expect(a).toEqual({ uvi: 10, scope: "now" });
  });

  it("does not call a forecast 'later today' when it is only a measurement's neighbour", () => {
    // Alice Springs, 1:20 pm: instrument 9.3, the 1:30 pm forecast point 9.8,
    // the curve falling after. The page said "forecast to reach 9.8 later
    // today". Same band, same advice: describe now.
    const afternoon = [
      { minutes: 13 * 60 + 30, uvi: 9.8 },
      { minutes: 14 * 60 + 30, uvi: 5.1 },
      { minutes: 15 * 60 + 30, uvi: 2.2 },
    ];
    const a = adviceLevel({ now: 9.3, today: afternoon, tomorrowPeak: 11.3, nowMinutes: 13 * 60 + 20 });
    expect(a).toEqual({ uvi: 9.3, scope: "now" });
  });

  it("still says 'later today' when a later hour reaches a higher band", () => {
    // Morning: High now, Extreme by midday.
    const morning = [{ minutes: 11 * 60, uvi: 9.5 }, { minutes: 12 * 60, uvi: 12 }];
    expect(adviceLevel({ now: 6.2, today: morning, tomorrowPeak: 11, nowMinutes: 9 * 60 }))
      .toEqual({ uvi: 12, scope: "today" });
    // Right at a boundary: 10.4 is Very High, 10.6 is Extreme.
    expect(adviceLevel({ now: 10.4, today: [{ minutes: 13 * 60, uvi: 10.6 }], tomorrowPeak: 9, nowMinutes: 12 * 60 }))
      .toEqual({ uvi: 10.6, scope: "today" });
  });

  it("never advises for a lower band than is coming today", () => {
    // The safety property, in the terms the advice is actually given: whatever
    // the hour and however the reading compares with the forecast.
    const rank = (v: number) => ["Low", "Moderate", "High", "Very High", "Extreme"].indexOf(bandFor(v).name);
    const today = day(12.5);
    for (let h = 5; h < 21; h++) {
      for (const offset of [-2, -0.5, 0, 0.5, 2]) {
        const here = today.find((p) => p.minutes === h * 60)?.uvi ?? 0;
        const now = Math.max(0, here + offset);
        const ahead = today.filter((p) => p.minutes >= h * 60 + 20).map((p) => p.uvi);
        const a = adviceLevel({ now, today, tomorrowPeak: 3, nowMinutes: h * 60 + 20 });
        const coming = Math.max(now, ...ahead);
        if (a && a.scope !== "tomorrow") {
          expect(rank(a.uvi), `hour ${h}, offset ${offset}`).toBeGreaterThanOrEqual(rank(coming));
        }
      }
    }
  });

  it("turns to tomorrow once the rest of today is below 3", () => {
    // Late afternoon: still 2.6, which rounds to 3 -- protection still needed.
    expect(adviceLevel({ now: 2.6, today: [], tomorrowPeak: 11, nowMinutes: 17 * 60 })!.scope)
      .not.toBe("tomorrow");
    // A little later: 2.4 rounds to 2, so today is spent.
    expect(adviceLevel({ now: 2.4, today: [], tomorrowPeak: 11, nowMinutes: 17 * 60 + 30 })!.scope)
      .toBe("tomorrow");
  });

  it("never turns to tomorrow while any hour left today is 3 or more", () => {
    // The property behind both cases above, swept across the day.
    // The reading runs a little above the forecast all day, as it did in Alice
    // Springs, so the best of today is often the reading itself -- the case
    // the old rule got wrong whenever tomorrow forecast higher.
    const today = day(12);
    for (let h = 6; h < 21; h++) {
      const here = today.find((p) => p.minutes === h * 60)?.uvi ?? 0;
      const now = here + 0.5;
      const a = adviceLevel({ now, today, tomorrowPeak: 13, nowMinutes: h * 60 + 30 });
      if (roundForBand(now) >= 3) expect(a!.scope, `hour ${h}`).not.toBe("tomorrow");
    }
  });

  it("returns nothing when there is nothing to go on", () => {
    expect(adviceLevel({ now: null, today: [], tomorrowPeak: null, nowMinutes: 600 })).toBeNull();
  });
});
