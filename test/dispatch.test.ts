import { describe, expect, it } from "vitest";

import {
  CAMS_DISPATCH_GRACE_MS,
  camsStale,
  DISPATCH_COOLDOWN_MS,
  DISPATCH_SOURCE,
  scheduledFetch,
  shouldDispatch,
} from "../src/lib/dispatch";

const NOW = new Date("2026-10-26T14:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const H = 60 * 60 * 1000;

describe("shouldDispatch", () => {
  it("does nothing while every source is current", () => {
    const d = shouldDispatch(
      [
        { source: "epa", last_ok_at: ago(1 * H) },
        { source: "cams", last_ok_at: ago(3 * H) },
      ],
      NOW,
    );
    expect(d.dispatch).toBe(false);
  });

  it("intervenes when CAMS has gone quiet", () => {
    // The real failure: sixteen hours with no CAMS run, which emptied
    // tomorrow's column for ten of thirteen Australian cities.
    const d = shouldDispatch(
      [
        { source: "epa", last_ok_at: ago(1 * H) },
        { source: "cams", last_ok_at: ago(16 * H) },
      ],
      NOW,
    );
    expect(d.dispatch).toBe(true);
    expect(d.reason).toContain("cams");
  });

  it("treats a source that has never run as stale, not absent", () => {
    // The same hole that once let /api/health report healthy while ARPANSA
    // had never fetched anything at all.
    expect(shouldDispatch([], NOW).dispatch).toBe(true);
    expect(shouldDispatch([{ source: "cams", last_ok_at: null }], NOW).dispatch).toBe(true);
  });

  it("leaves a merely late run alone", () => {
    // EPA is hourly; two hours late is GitHub being GitHub, not a failure.
    const d = shouldDispatch([
      { source: "epa", last_ok_at: ago(2 * H) },
      { source: "cams", last_ok_at: ago(2 * H) },
    ], NOW);
    expect(d.dispatch).toBe(false);
  });

  it("rescues EPA before health calls it unhealthy", () => {
    // 28 October 2026: both limits were 3 h, GitHub skipped three hourly runs,
    // and the monitor alerted for the ten minutes the rescue run took.
    const d = shouldDispatch(
      [
        { source: "epa", last_ok_at: ago(2.5 * H) },
        { source: "cams", last_ok_at: ago(1 * H) },
      ],
      NOW,
    );
    expect(d.reason).toBe("stale: epa");
  });

  it("asks for CAMS when today's run has not arrived, however recent the last fetch", () => {
    // 28 October 2026: a 09:00 UTC fetch held only yesterday's run. By age it
    // was five hours old and fine; by the publication clock it was a day late.
    const d = shouldDispatch(
      [
        { source: "epa", last_ok_at: ago(1 * H) },
        { source: "cams", last_ok_at: "2026-10-26T09:00:00Z" },
      ],
      NOW,
    );
    expect(d.reason).toBe("stale: cams");
  });

  it("holds off during the cooldown, however stale things are", () => {
    // Without this, a fetch failing for its own reasons would be re-triggered
    // every five minutes for as long as it kept failing.
    const d = shouldDispatch(
      [
        { source: "cams", last_ok_at: ago(48 * H) },
        { source: DISPATCH_SOURCE, last_ok_at: ago(DISPATCH_COOLDOWN_MS / 2) },
      ],
      NOW,
    );
    expect(d.dispatch).toBe(false);
    expect(d.reason).toMatch(/recently/);
  });

  it("tries again once the cooldown has passed", () => {
    const d = shouldDispatch(
      [
        { source: "cams", last_ok_at: ago(48 * H) },
        { source: DISPATCH_SOURCE, last_ok_at: ago(DISPATCH_COOLDOWN_MS + 60_000) },
      ],
      NOW,
    );
    expect(d.dispatch).toBe(true);
  });
});

describe("camsStale", () => {
  const at = (iso: string) => new Date(iso);
  const G = CAMS_DISPATCH_GRACE_MS;

  it("is content with yesterday's run until today's is due", () => {
    expect(camsStale("2026-10-27T10:45:00Z", at("2026-10-28T11:59:00Z"), G)).toBe(false);
  });

  it("wants today's run once publication plus grace has passed", () => {
    expect(camsStale("2026-10-27T10:45:00Z", at("2026-10-28T12:00:00Z"), G)).toBe(true);
    expect(camsStale("2026-10-28T10:45:00Z", at("2026-10-28T12:00:00Z"), G)).toBe(false);
  });

  it("does not count a fetch made before publication as holding today's run", () => {
    // The 07:40 UTC fetch that started this.
    expect(camsStale("2026-10-28T07:41:00Z", at("2026-10-28T13:00:00Z"), G)).toBe(true);
  });

  it("handles a cutoff that falls before 10:30 on the same day", () => {
    expect(camsStale("2026-10-27T11:00:00Z", at("2026-10-28T03:00:00Z"), G)).toBe(false);
  });

  it("treats a source that has never succeeded as stale", () => {
    expect(camsStale(null, at("2026-10-28T03:00:00Z"), G)).toBe(true);
  });
});

describe("scheduledFetch", () => {
  const at = (iso: string) => scheduledFetch(new Date(iso));

  it("asks for EPA once an hour, in the :20 slot", () => {
    expect(at("2026-10-28T05:20:00Z")).toBe("epa");
    expect(at("2026-10-28T05:24:59Z")).toBe("epa");
    expect(at("2026-10-28T05:15:00Z")).toBeNull();
    expect(at("2026-10-28T05:25:00Z")).toBeNull();
  });

  it("asks for CAMS at 10:40 and 13:40 UTC only", () => {
    expect(at("2026-10-28T10:40:02Z")).toBe("cams");
    expect(at("2026-10-28T13:40:00Z")).toBe("cams");
    expect(at("2026-10-28T07:40:00Z")).toBeNull();
    expect(at("2026-10-28T19:40:00Z")).toBeNull();
  });

  it("gives each fetch exactly one tick of the five-minute cron a day", () => {
    const counts: Record<string, number> = {};
    for (let m = 0; m < 24 * 60; m += 5) {
      const due = scheduledFetch(new Date(Date.UTC(2026, 9, 28, 0, m)));
      if (due) counts[due] = (counts[due] ?? 0) + 1;
    }
    expect(counts).toEqual({ epa: 24, cams: 2 });
  });
});

describe("shouldDispatch and the timetable", () => {
  it("runs the timetable through the cooldown", () => {
    // A rescue run at 10:30 must not cost the 10:40 CAMS fetch.
    const d = shouldDispatch(
      [{ source: DISPATCH_SOURCE, last_ok_at: "2026-10-28T10:30:00Z" }],
      new Date("2026-10-28T10:40:00Z"),
    );
    expect(d).toEqual({ dispatch: true, reason: "scheduled: cams", source: "cams" });
  });

  it("asks only for the source that is stale", () => {
    const now = new Date("2026-10-28T15:00:00Z");
    const d = shouldDispatch(
      [
        { source: "epa", last_ok_at: "2026-10-28T11:00:00Z" },
        { source: "cams", last_ok_at: "2026-10-28T10:45:00Z" },
      ],
      now,
    );
    expect(d.source).toBe("epa");
    expect(shouldDispatch([], now).source).toBe("all");
  });
});
