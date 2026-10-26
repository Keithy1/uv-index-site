import { describe, expect, it } from "vitest";

import {
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
