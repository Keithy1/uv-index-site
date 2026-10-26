import { describe, expect, it } from "vitest";

import {
  adviceLevel,
  currentLevel,
  NEAR_HOUR_MS,
  nextLocalDay,
  peakOnLocalDay,
  pointsOnLocalDay,
} from "../src/lib/current";

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

  it("returns nothing when there is nothing to go on", () => {
    expect(adviceLevel({ now: null, today: [], tomorrowPeak: null, nowMinutes: 600 })).toBeNull();
  });
});
