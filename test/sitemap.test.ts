import { describe, expect, it } from "vitest";

import { locationsIn } from "../src/lib/locations";
import {
  countrySitemap,
  pagesSitemap,
  sitemapCountries,
  sitemapIndex,
  todayUtc,
} from "../src/lib/sitemap";

const AT = new Date("2026-10-25T22:40:00Z");

describe("lastmod", () => {
  it("is a date, never a time", () => {
    // A sitemap whose dates churn every five minutes is one Google learns to
    // discount, and it invites crawling far more often than the content
    // justifies. Day resolution is deliberate.
    expect(todayUtc(AT)).toBe("2026-10-25");
    expect(todayUtc(new Date("2026-10-25T00:00:01Z"))).toBe("2026-10-25");
    expect(todayUtc(new Date("2026-10-25T23:59:59Z"))).toBe("2026-10-25");
  });

  it("does not move within a day, however often it is asked", () => {
    const morning = countrySitemap("au", new Date("2026-10-25T01:00:00Z"));
    const evening = countrySitemap("au", new Date("2026-10-25T23:00:00Z"));
    expect(morning).toBe(evening);
  });
});

describe("the sitemap index", () => {
  const xml = sitemapIndex(AT);

  it("lists one sitemap per live country plus the pages", () => {
    expect(xml).toContain("https://uvatlas.com/sitemap-au.xml");
    expect(xml).toContain("https://uvatlas.com/sitemap-us.xml");
    expect(xml).toContain("https://uvatlas.com/sitemap-pages.xml");
    expect((xml.match(/<sitemap>/g) ?? []).length).toBe(sitemapCountries().length + 1);
  });

  it("does not list countries that are not live", () => {
    for (const code of ["uk", "ca", "nz"]) {
      expect(xml, code).not.toContain(`sitemap-${code}.xml`);
    }
  });

  it("is well-formed enough to be a sitemap index", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.endsWith("</sitemapindex>")).toBe(true);
  });
});

describe("a country sitemap", () => {
  it("lists the country page and every published city", () => {
    const xml = countrySitemap("au", AT);
    const live = locationsIn("au").filter((l) => l.status === "live");
    expect((xml.match(/<url>/g) ?? []).length).toBe(live.length + 1);
    expect(xml).toContain("https://uvatlas.com/au/</loc>");
    for (const city of live) {
      expect(xml, city.id).toContain(`https://uvatlas.com/au/${city.slug}/`);
    }
  });

  it("never lists a city whose page would 404", () => {
    // The rule, not the count: a sitemap full of 404s is worse than no
    // sitemap. This originally asserted that /us/ had exactly one URL, which
    // was true only while the US city pages were unpublished -- so it failed
    // the moment they went live, for a change that was entirely correct.
    for (const country of ["au", "us"] as const) {
      const xml = countrySitemap(country, AT);
      const listed = [...xml.matchAll(/<loc>https:\/\/uvatlas\.com\/[a-z]{2}\/([a-z0-9-]+)\/<\/loc>/g)]
        .map((m) => m[1]);
      const live = new Set(
        locationsIn(country).filter((l) => l.status === "live").map((l) => l.slug),
      );
      for (const slug of listed) {
        expect(live.has(slug!), `${country}/${slug} is listed but not live`).toBe(true);
      }
      for (const slug of live) {
        expect(listed, `${country}/${slug} is live but not listed`).toContain(slug);
      }
    }
  });

  it("uses absolute URLs, as the spec requires", () => {
    for (const loc of countrySitemap("au", AT).match(/<loc>([^<]*)<\/loc>/g) ?? []) {
      expect(loc).toContain("https://uvatlas.com/");
    }
  });
});

describe("the pages sitemap", () => {
  const xml = pagesSitemap(AT);

  it("includes the home page and every text page", () => {
    for (const path of [
      "/",
      "/uv-index-explained/",
      "/methods/",
      "/about/",
      "/privacy/",
      "/terms/",
    ]) {
      expect(xml, path).toContain(`<loc>https://uvatlas.com${path}</loc>`);
    }
  });

  it("dates the text pages when they were edited, not today", () => {
    expect(xml).toContain("<loc>https://uvatlas.com/uv-index-explained/</loc><lastmod>2026-10-25</lastmod>");
    // Each page carries its own date: editing /methods/ does not re-date the guide.
    expect(xml).toContain("<loc>https://uvatlas.com/methods/</loc><lastmod>2026-10-27</lastmod>");
    // The home page carries live data, so it is dated today.
    expect(xml).toContain(`<loc>https://uvatlas.com/</loc><lastmod>${todayUtc(AT)}`);
  });
});
