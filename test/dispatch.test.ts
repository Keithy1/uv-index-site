import { describe, expect, it } from "vitest";

import {
  DISPATCH_COOLDOWN_MS,
  DISPATCH_SOURCE,
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
        { source: "cams", last_ok_at: ago(4 * H) },
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
