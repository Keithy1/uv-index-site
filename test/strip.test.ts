import { describe, expect, it } from "vitest";

import type { CurvePoint } from "../src/lib/chart";
import { cellLevel, dayStrip, placeOnAxis, stripAxis } from "../src/lib/strip";

// Sunrise 5:50 am, sunset 7:25 pm: cells centred on 6 am ... 7 pm, fourteen of them.
const SUN = { sunrise: 5 * 60 + 50, sunset: 19 * 60 + 25 };

/** A bell over the day, hourly on the hour, peaking at 9.0 at noon. */
function bell(from = 0, to = 23): CurvePoint[] {
  const out: CurvePoint[] = [];
  for (let h = from; h <= to; h++) {
    out.push({ minutes: h * 60, uvi: Math.max(0, Math.round((9 - ((h - 12) / 1.5) ** 2 / 2) * 10) / 10) });
  }
  return out;
}

describe("dayStrip: the cells", () => {
  it("runs from the hour of sunrise to the hour of sunset, one cell an hour", () => {
    const s = dayStrip({ points: bell(), sun: SUN, window: null, nowMinutes: null })!;
    expect(s.cells.map((c) => c.minutes / 60)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(s.from).toBe(5 * 60 + 30);
    expect(s.to).toBe(19 * 60 + 30);
  });

  it("gives each cell its WHO band from the value rounded half-up", () => {
    const points: CurvePoint[] = [
      { minutes: 6 * 60, uvi: 2.4 },
      { minutes: 7 * 60, uvi: 2.5 },
      { minutes: 8 * 60, uvi: 7.5 },
      { minutes: 9 * 60, uvi: 10.5 },
    ];
    const s = dayStrip({ points, sun: { sunrise: 5 * 60 + 50, sunset: 9 * 60 + 10 }, window: null, nowMinutes: null })!;
    expect(s.cells.map((c) => c.band)).toEqual([0, 1, 3, 4]);
  });

  it("draws an hour the forecast does not reach as missing, never as zero", () => {
    // A CAMS run with 24 lead hours starts at 11 am in Sydney.
    const s = dayStrip({ points: bell(11, 23), sun: SUN, window: null, nowMinutes: null })!;
    const early = s.cells.filter((c) => c.minutes < 11 * 60);
    expect(early).toHaveLength(5);
    for (const c of early) {
      expect(c.uvi).toBeNull();
      expect(c.band).toBeNull();
    }
    expect(s.missing).toBe(5);
  });

  it("keeps a real zero as a zero", () => {
    const points = bell().map((p) => (p.minutes === 6 * 60 ? { ...p, uvi: 0 } : p));
    const s = dayStrip({ points, sun: SUN, window: null, nowMinutes: null })!;
    expect(s.cells[0]!.uvi).toBe(0);
    expect(s.cells[0]!.band).toBe(0);
  });

  it("does not bridge a gap in the forecast", () => {
    const points = bell().filter((p) => p.minutes !== 10 * 60);
    const s = dayStrip({ points, sun: SUN, window: null, nowMinutes: null })!;
    expect(s.cells.find((c) => c.minutes === 10 * 60)!.uvi).toBeNull();
  });

  it("sets a half-hour zone's cells on its forecast instants, at half past", () => {
    // Adelaide is UTC+10:30, so CAMS's whole UTC hours arrive at 7:30, 8:30 local.
    const points: CurvePoint[] = [
      { minutes: 7 * 60 + 30, uvi: 2 },
      { minutes: 8 * 60 + 30, uvi: 4 },
      { minutes: 9 * 60 + 30, uvi: 6 },
    ];
    const s = dayStrip({ points, sun: { sunrise: 7 * 60 + 10, sunset: 9 * 60 + 50 }, window: null, nowMinutes: 8 * 60 + 5 })!;
    expect(s.cells.map((c) => c.minutes)).toEqual([450, 510, 570]);
    expect(s.cells.map((c) => c.uvi)).toEqual([2, 4, 6]);
    expect(s.from).toBe(7 * 60);
    expect(s.to).toBe(10 * 60);
    expect(s.cells.filter((c) => c.now).map((c) => c.minutes)).toEqual([510]);
  });

  it("names the same peak as the forecast itself, in a half-hour zone too", () => {
    // Verified 30 October: clock-hour cells blended 6.7 at 2:30 pm into 6.4 at 2 pm.
    const points = bell().map((p) => ({ minutes: p.minutes + 30, uvi: p.uvi }));
    const s = dayStrip({ points, sun: SUN, window: null, nowMinutes: null })!;
    const top = points.reduce((a, b) => (b.uvi > a.uvi ? b : a));
    expect(s.peak).toEqual({ minutes: top.minutes, uvi: top.uvi });
  });

  it("keeps its grid when one instant falls off it", () => {
    const points: CurvePoint[] = [
      { minutes: 7 * 60, uvi: 2 },
      { minutes: 8 * 60, uvi: 4 },
      { minutes: 8 * 60 + 20, uvi: 9 },
      { minutes: 9 * 60, uvi: 6 },
    ];
    const s = dayStrip({ points, sun: { sunrise: 6 * 60 + 40, sunset: 9 * 60 + 20 }, window: null, nowMinutes: null })!;
    expect(s.cells.map((c) => c.uvi)).toEqual([2, 4, 6]);
  });

  it("returns null where there is no sunrise or sunset to bound the day", () => {
    expect(dayStrip({ points: bell(), sun: null, window: null, nowMinutes: null })).toBeNull();
  });
});

describe("dayStrip: now", () => {
  it("marks the one cell whose hour contains now", () => {
    const s = dayStrip({ points: bell(), sun: SUN, window: null, nowMinutes: 12 * 60 + 25 })!;
    expect(s.cells.filter((c) => c.now).map((c) => c.minutes)).toEqual([12 * 60]);
  });

  it("moves to the next cell at half past", () => {
    const s = dayStrip({ points: bell(), sun: SUN, window: null, nowMinutes: 12 * 60 + 30 })!;
    expect(s.cells.filter((c) => c.now).map((c) => c.minutes)).toEqual([13 * 60]);
  });

  it("marks nothing before sunrise, after sunset, or on another day", () => {
    for (const nowMinutes of [3 * 60, 21 * 60, null]) {
      const s = dayStrip({ points: bell(), sun: SUN, window: null, nowMinutes })!;
      expect(s.cells.some((c) => c.now)).toBe(false);
    }
  });
});

describe("dayStrip: the protection bracket", () => {
  it("spans the window as fractions of the strip", () => {
    // The strip runs 5:30 am to 7:30 pm, 840 minutes.
    const s = dayStrip({ points: bell(), sun: SUN, window: { start: 8 * 60 + 50, end: 16 * 60 + 12 }, nowMinutes: null })!;
    expect(s.window!.start).toBe(8 * 60 + 50);
    expect(s.window!.end).toBe(16 * 60 + 12);
    expect(s.window!.left).toBeCloseTo(200 / 840, 6);
    expect(s.window!.right).toBeCloseTo(642 / 840, 6);
  });

  it("draws no bracket when protectionWindow gave none", () => {
    const s = dayStrip({ points: bell(), sun: SUN, window: null, nowMinutes: null })!;
    expect(s.window).toBeNull();
  });

  it("holds the bracket inside the strip", () => {
    const s = dayStrip({ points: bell(), sun: SUN, window: { start: 5 * 60, end: 20 * 60 }, nowMinutes: null })!;
    expect(s.window!.left).toBe(0);
    expect(s.window!.right).toBe(1);
  });
});

describe("dayStrip: the words", () => {
  it("names the peak and the protection window", () => {
    const s = dayStrip({ points: bell(), sun: SUN, window: { start: 8 * 60 + 50, end: 16 * 60 + 12 }, nowMinutes: null })!;
    expect(s.peak).toEqual({ minutes: 12 * 60, uvi: 9 });
    expect(s.summary).toContain("peak 9.0 Very High at 12:00 pm");
    expect(s.summary).toContain("cover up 8:50 am to 4:12 pm");
  });

  it("names no peak over a day the forecast only partly covers", () => {
    // A maximum over a truncated range is still a number, and looks like a real one.
    const s = dayStrip({ points: bell(13, 23), sun: SUN, window: null, nowMinutes: null })!;
    expect(s.peak).toBeNull();
    expect(s.summary).not.toMatch(/peak/i);
    expect(s.summary).toContain("No forecast before 1:00 pm");
  });

  it("says when the protection window is unknown", () => {
    const s = dayStrip({ points: bell(), sun: SUN, window: null, nowMinutes: null })!;
    expect(s.summary).not.toMatch(/cover up/i);
  });
});

describe("stripAxis and placeOnAxis: one clock for every row on a country page", () => {
  // Sydney-like: cells on the hour, 6 am to 7 pm, so the strip runs 5:30 am to 7:30 pm.
  const onTheHour = dayStrip({ points: bell(), sun: SUN, window: null, nowMinutes: null })!;
  // Adelaide-like: CAMS's whole UTC hours fall at half past, so cells sit on 6:30 ... 7:30.
  const halfPast = dayStrip({
    points: bell().map((p) => ({ ...p, minutes: p.minutes + 30 })),
    sun: { sunrise: 6 * 60 + 10, sunset: 19 * 60 + 50 },
    window: null,
    nowMinutes: null,
  })!;

  it("runs from the whole hour before the earliest strip to the whole hour after the latest", () => {
    expect(onTheHour.from).toBe(5 * 60 + 30);
    expect(halfPast.from).toBe(6 * 60);
    expect(stripAxis([onTheHour, halfPast])).toEqual({ from: 5 * 60, to: 20 * 60 });
  });

  it("ignores a city with no strip, and has no axis when none has one", () => {
    expect(stripAxis([null, onTheHour])).toEqual({ from: 5 * 60, to: 20 * 60 });
    expect(stripAxis([null, null])).toBeNull();
  });

  it("places each strip by its own local clock, in half-hours", () => {
    const axis = stripAxis([onTheHour, halfPast])!;
    // 30 half-hours across; a cell is two of them wide.
    expect(placeOnAxis(onTheHour, axis)).toEqual({ offset: 1, span: 30 });
    expect(placeOnAxis(halfPast, axis)).toEqual({ offset: 2, span: 30 });
  });
});

describe("cellLevel: what a compact cell draws", () => {
  const cell = (uvi: number | null) => ({ minutes: 720, uvi, band: null, now: false });

  it("is the whole number the band comes from", () => {
    expect(cellLevel(cell(2.4))).toBe(2);
    expect(cellLevel(cell(2.5))).toBe(3);
  });

  it("keeps a real zero, and a missing hour is null", () => {
    expect(cellLevel(cell(0))).toBe(0);
    expect(cellLevel(cell(null))).toBeNull();
  });

  it("stops at 12, the top of the drawn scale", () => {
    expect(cellLevel(cell(14.2))).toBe(12);
  });
});
