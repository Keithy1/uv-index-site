import { describe, expect, it } from "vitest";

import { buildCurve, describeCurve, minutesToClock, protectionWindow } from "../src/lib/chart";
import type { CurvePoint } from "../src/lib/chart";

/** An hourly curve peaking at midday, like a real clear day. */
function bell(peak: number): CurvePoint[] {
  const points: CurvePoint[] = [];
  for (let h = 5; h <= 20; h++) {
    const from_noon = Math.abs(h - 12);
    points.push({ minutes: h * 60, uvi: Math.max(0, peak * (1 - (from_noon / 7) ** 2)) });
  }
  return points;
}

describe("minutesToClock", () => {
  it("formats 12-hour times the way the page reads them", () => {
    expect(minutesToClock(0)).toBe("12:00 am");
    expect(minutesToClock(9 * 60 + 5)).toBe("9:05 am");
    expect(minutesToClock(12 * 60)).toBe("12:00 pm");
    expect(minutesToClock(13 * 60 + 30)).toBe("1:30 pm");
    expect(minutesToClock(23 * 60 + 59)).toBe("11:59 pm");
  });
});

describe("protectionWindow", () => {
  it("interpolates the crossing rather than snapping to the hour", () => {
    // Crosses 3 halfway between 09:00 (2) and 10:00 (4) -> 09:30.
    const points: CurvePoint[] = [
      { minutes: 8 * 60, uvi: 1 },
      { minutes: 9 * 60, uvi: 2 },
      { minutes: 10 * 60, uvi: 4 },
      { minutes: 11 * 60, uvi: 5 },
      { minutes: 12 * 60, uvi: 4 },
      { minutes: 13 * 60, uvi: 2 },
    ];
    const w = protectionWindow(points);
    expect(w).not.toBeNull();
    expect(w!.start).toBe(9 * 60 + 30);
    // Falls back through 3 halfway between 12:00 (4) and 13:00 (2) -> 12:30.
    expect(w!.end).toBe(12 * 60 + 30);
  });

  it("rounds the start DOWN in effect, never late", () => {
    // Advice that starts after the real crossing is wrong in the dangerous
    // direction, so the interpolated time must precede the first hourly point
    // that is at or above the threshold.
    const w = protectionWindow(bell(10))!;
    const firstAbove = bell(10).find((p) => p.uvi >= 3)!;
    expect(w.start).toBeLessThanOrEqual(firstAbove.minutes);
  });

  it("returns null when the day never reaches 3", () => {
    expect(protectionWindow(bell(2))).toBeNull();
  });

  it("refuses to answer when the series starts above the threshold", () => {
    // A CAMS 00Z run with 24 lead hours begins at 11 am in Sydney, already
    // above 3. Reporting "protection needed from 11:00 am" would be two hours
    // late -- wrong in the dangerous direction. Better to say nothing.
    const points: CurvePoint[] = [
      { minutes: 11 * 60, uvi: 5 },
      { minutes: 12 * 60, uvi: 9 },
      { minutes: 18 * 60, uvi: 1 },
    ];
    expect(protectionWindow(points)).toBeNull();
  });

  it("refuses to answer when the series ends above the threshold", () => {
    const points: CurvePoint[] = [
      { minutes: 6 * 60, uvi: 1 },
      { minutes: 12 * 60, uvi: 9 },
      { minutes: 15 * 60, uvi: 6 },
    ];
    expect(protectionWindow(points)).toBeNull();
  });

  it("answers when the whole daylight period is covered", () => {
    const w = protectionWindow(bell(10));
    expect(w).not.toBeNull();
    expect(w!.start).toBeGreaterThan(5 * 60);
    expect(w!.end).toBeLessThan(20 * 60);
  });
});

describe("describeCurve", () => {
  it("gives the sentence that must sit beside the chart", () => {
    const text = describeCurve(bell(11));
    expect(text).toMatch(/^Peak 11\.0 at 12:00 pm/);
    expect(text).toMatch(/cloud included/);
  });

  it("quotes no protection times at all", () => {
    // The chart is cloud-adjusted; the sun protection times on the page are
    // computed from the clear-sky forecast. Quoting a window in both places
    // put two different answers to the same question on one page. The
    // conservative clear-sky figure is the one to act on, so it is the only
    // one allowed to give times.
    for (const peak of [2, 5, 11, 15]) {
      expect(describeCurve(bell(peak)), String(peak)).not.toMatch(/protection needed from/);
      expect(describeCurve(bell(peak)), String(peak)).not.toMatch(/to \d+:\d\d [ap]m/);
    }
  });

  it("says when cloud is keeping UV down, without implying the day is safe", () => {
    const text = describeCurve(bell(2));
    expect(text).toMatch(/below the level/);
    expect(text).toMatch(/can clear at any time/);
  });

  it("never returns an empty string, even with no data", () => {
    expect(describeCurve([]).length).toBeGreaterThan(10);
  });
});

describe("buildCurve", () => {
  it("returns null when there are too few points to draw a curve", () => {
    expect(buildCurve([{ minutes: 600, uvi: 5 }])).toBeNull();
  });

  it("produces paths and a peak for a normal day", () => {
    const g = buildCurve(bell(11))!;
    expect(g).not.toBeNull();
    expect(g.linePath.startsWith("M")).toBe(true);
    expect(g.areaPath.endsWith("Z")).toBe(true);
    expect(g.peak!.uvi).toBeCloseTo(11, 5);
    expect(g.thresholdY).not.toBeNull();
  });

  it("scales the axis so a quiet day does not look alarming", () => {
    // A peak of 2 must not fill the chart the way a peak of 12 does.
    expect(buildCurve(bell(2))!.maxUvi).toBeLessThan(buildCurve(bell(12))!.maxUvi);
    expect(buildCurve(bell(2))!.maxUvi).toBeGreaterThanOrEqual(4);
  });

  it("places the measured marker inside the plot area", () => {
    const g = buildCurve(bell(11), { minutes: 12 * 60, uvi: 9 })!;
    expect(g.measured).not.toBeNull();
    expect(g.measured!.x).toBeGreaterThan(0);
    expect(g.measured!.x).toBeLessThan(g.width);
    expect(g.measured!.y).toBeGreaterThan(0);
    expect(g.measured!.y).toBeLessThan(g.height);
  });
});

describe("a truncated day must not be reported as a peak", () => {
  /**
   * The /au/tomorrow/ page once announced Brisbane peaking at 6.1 at 9 am,
   * because 9 am was the last hour the forecast contained. The real peak was
   * later and higher — wrong in the direction that matters. The route now
   * requires the solar middle of the day to be present; these pin the shape of
   * that judgement.
   */
  const covered = (points: CurvePoint[]) =>
    points.some((p) => p.minutes <= 9 * 60) && points.some((p) => p.minutes >= 16 * 60);

  it("rejects a day that stops in the morning", () => {
    const partial = bell(11).filter((p) => p.minutes <= 9 * 60);
    expect(covered(partial)).toBe(false);
  });

  it("rejects a day that starts in the afternoon", () => {
    const partial = bell(11).filter((p) => p.minutes >= 13 * 60);
    expect(covered(partial)).toBe(false);
  });

  it("accepts a full day", () => {
    expect(covered(bell(11))).toBe(true);
  });

  it("also refuses a protection window for the truncated day", () => {
    const partial = bell(11).filter((p) => p.minutes <= 9 * 60);
    expect(protectionWindow(partial)).toBeNull();
  });
});
