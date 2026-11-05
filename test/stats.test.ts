import { describe, expect, it } from "vitest";

import { COUNTING_SINCE, fillDays, headline, keyMatches, rangeDays, statsQueries } from "../src/lib/stats";
import { StatsPage, type StatsView } from "../src/views/StatsPage";

describe("rangeDays", () => {
  it("offers 7, 30 and 90 days and falls back to 7", () => {
    expect(rangeDays("30")).toBe(30);
    expect(rangeDays("90")).toBe(90);
    expect(rangeDays(undefined)).toBe(7);
    // Only the offered ranges: the number goes into SQL.
    expect(rangeDays("12")).toBe(7);
    expect(rangeDays("7; DROP")).toBe(7);
  });
});

describe("statsQueries", () => {
  it("counts sampled rows by their interval, on the real site only", () => {
    for (const sql of Object.values(statsQueries(30))) {
      expect(sql).toContain("SUM(_sample_interval)");
      expect(sql).toContain("blob4 = 'uvatlas.com'");
      expect(sql).toContain("INTERVAL '30' DAY");
    }
  });
});

describe("fillDays", () => {
  const today = new Date("2026-11-12T09:00:00Z");

  it("gives every day in the range a row, with no views as 0", () => {
    const days = fillDays([{ day: "2026-11-10", views: "5", phone: "2" }], 7, today);
    expect(days.map((d) => d.day)).toEqual([
      "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12",
    ]);
    expect(days.find((d) => d.day === "2026-11-10")).toMatchObject({ views: 5, phone: 2 });
    expect(days.find((d) => d.day === "2026-11-09")).toMatchObject({ views: 0, phone: 0 });
  });

  it("marks today as unfinished", () => {
    const days = fillDays([], 7, today);
    expect(days.at(-1)).toMatchObject({ day: "2026-11-12", partial: true });
    expect(days.filter((d) => d.partial)).toHaveLength(1);
  });

  it("does not call days before counting began zero", () => {
    // Nothing was counted before the pixel shipped; a zero there would read
    // as nobody visiting.
    const days = fillDays([], 30, today);
    const before = days.filter((d) => d.day < COUNTING_SINCE);
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((d) => d.views === null)).toBe(true);
    expect(days.find((d) => d.day === COUNTING_SINCE)?.views).toBe(0);
  });
});

describe("headline", () => {
  it("is a sentence with the total and the phone share", () => {
    expect(headline(31, 12, 7)).toBe("31 views in the last 7 days, 39% on a phone.");
    expect(headline(1, 1, 30)).toBe("1 view in the last 30 days, 100% on a phone.");
  });

  it("says so when there are none", () => {
    expect(headline(0, 0, 7)).toBe("No views in the last 7 days.");
  });
});

describe("keyMatches", () => {
  it("needs a configured key and an exact match", async () => {
    expect(await keyMatches("abc123", "abc123")).toBe(true);
    expect(await keyMatches("abc124", "abc123")).toBe(false);
    expect(await keyMatches("abc12", "abc123")).toBe(false);
    // Unset or empty secret: the page does not exist.
    expect(await keyMatches("", "")).toBe(false);
    expect(await keyMatches("x", undefined)).toBe(false);
  });
});

describe("StatsPage", () => {
  const view: StatsView = {
    urlKey: "k3y",
    range: 7,
    days: fillDays([{ day: "2026-11-11", views: "4", phone: "1" }], 7, new Date("2026-11-12T09:00:00Z")),
    pages: [{ label: "/au/sydney/", views: 3 }, { label: "/", views: 1 }],
    countries: [{ label: "AU", views: 4 }],
    error: null,
  };
  const html = String(StatsPage(view));

  it("is kept out of search and leaks no key in a referrer", () => {
    expect(html).toContain('<meta name="robots" content="noindex, nofollow"');
    expect(html).toContain('<meta name="referrer" content="no-referrer"');
  });

  it("does not count itself as a page view", () => {
    expect(html).not.toContain("/api/v");
  });

  it("links each range to the same key, marking the current one", () => {
    expect(html).toContain('href="/stats/k3y/?days=30"');
    expect(html).toMatch(/aria-current="page"[^>]*>7 days|>7 days<\/a>/);
  });

  it("has a table for every chart and the headline sentence", () => {
    expect(html).toContain("4 views in the last 7 days, 25% on a phone.");
    expect(html).toContain("<table");
    expect(html).toContain("/au/sydney/");
  });

  it("says what went wrong when the query fails, instead of showing zeros", () => {
    const failed = String(StatsPage({ ...view, days: [], pages: [], countries: [], error: "HTTP 403" }));
    expect(failed).toContain("HTTP 403");
    expect(failed).not.toContain("No views");
  });
});
