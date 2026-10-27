import { describe, expect, it } from "vitest";

import { cityLabel, locationsIn } from "../src/lib/locations";
import { canonicalPath } from "../src/lib/urls";
import { CityPage, type CityView } from "../src/views/CityPage";

/**
 * The keyword work lived only in the design document, where nothing checked it,
 * and the code drifted away from it unnoticed: fifty US city pages went live
 * titled "Live Reading and Forecast" with no instrument behind them. The
 * description had always branched on `measured`; the title had not, and no test
 * looked at either.
 *
 * These assert the rules in docs/seo.md that can be asserted. They render the
 * real component rather than re-deriving its strings, so a change to the
 * template is a change these see.
 */

const AU = locationsIn("au").find((l) => l.slug === "perth")!;
const US = locationsIn("us").find((l) => l.slug === "portland-or")!;

function view(location: typeof AU, measured: boolean): CityView {
  return {
    location,
    now: new Date("2026-10-26T04:00:00Z"),
    reading: { uvi: 7.4, validAt: "2026-10-26T04:00:00Z", stale: false },
    curve: [],
    clearSky: [],
    geometry: null,
    tomorrow: null,
    hasForecast: true,
    measured,
    credit: measured ? "arpansa" : "epa",
    advice: { uvi: 7.4, scope: "now" },
    normals: null,
    month: 10,
  };
}

const html = (v: CityView) => String(CityPage(v));
const head = (h: string, rx: RegExp) => h.match(rx)?.[1]?.trim();
const title = (h: string) => head(h, /<title>(.*?)<\/title>/s);
const description = (h: string) => head(h, /<meta name="description" content="(.*?)"/s);

describe("a title never promises what the page has not got", () => {
  it("offers a live reading only where something measures one", () => {
    // The bug: every city page claimed "Live Reading and Forecast", including
    // the US ones whose own body reads "Forecast for 11:00 AM EDT".
    expect(title(html(view(AU, true)))).toContain("Live Reading");
    expect(title(html(view(US, false)))).not.toContain("Live Reading");
  });

  it("says forecast, on the page and in the description, where that is all there is", () => {
    const h = html(view(US, false));
    expect(title(h)).toContain("Hourly Forecast");
    expect(description(h)).toContain("forecast");
    expect(description(h)).not.toContain("measured");
  });

  it("credits ARPANSA only where ARPANSA measured it", () => {
    expect(html(view(AU, true))).toContain("ARPANSA");
    expect(description(html(view(AU, true)))).toContain("measured by ARPANSA");
  });
});

describe("a city stands on its own in a title", () => {
  it("names the state for a US city, because Portland is two places", () => {
    expect(cityLabel(US)).toBe("Portland, OR");
    const h = html(view(US, false));
    expect(title(h)).toContain("Portland, OR");
    expect(h).toContain("<h1>UV Index Portland, OR today</h1>");
  });

  it("leaves an Australian city alone, where there is only one", () => {
    expect(cityLabel(AU)).toBe("Perth");
    expect(title(html(view(AU, true)))).toContain("UV Index Perth Today");
  });

  it("gives every live US city a state, so none is left ambiguous", () => {
    for (const loc of locationsIn("us").filter((l) => l.status === "live")) {
      expect(cityLabel(loc), loc.id).toMatch(/, [A-Z]{2}$/);
    }
  });
});

describe("the head every page carries", () => {
  const pages = [html(view(AU, true)), html(view(US, false))];

  it("has exactly one h1, and the title's words in it", () => {
    for (const h of pages) {
      expect((h.match(/<h1[^>]*>/g) ?? []).length).toBe(1);
      const city = h.includes("Portland") ? "Portland, OR" : "Perth";
      expect(h).toContain(`<h1>UV Index ${city} today</h1>`);
    }
  });

  it("names a share image with its size, so a shared link is not a bare line", () => {
    for (const h of pages) {
      expect(h).toContain('property="og:image" content="https://uvatlas.com/og-image.png"');
      expect(h).toContain('content="1200"');
      expect(h).toContain('content="630"');
      expect(h).toContain('name="twitter:card" content="summary_large_image"');
    }
  });

  it("declares the publisher and the breadcrumb trail", () => {
    for (const h of pages) {
      expect(h).toContain('"@type":"Organization"');
      expect(h).toContain('"@type":"BreadcrumbList"');
    }
  });

  it("points its canonical at itself", () => {
    expect(html(view(AU, true))).toContain(
      '<link rel="canonical" href="https://uvatlas.com/au/perth/"',
    );
    expect(html(view(US, false))).toContain(
      '<link rel="canonical" href="https://uvatlas.com/us/portland-or/"',
    );
  });

  it("keeps the description a description, not a reading", () => {
    // A number in a description is wrong within the hour, and Google may have
    // cached it for a week.
    for (const h of pages) {
      const d = description(h)!;
      expect(d.length).toBeGreaterThan(50);
      expect(d.length).toBeLessThan(170);
      expect(d, d).not.toMatch(/\d+\.\d/);
    }
  });

  it("keeps the title short enough to survive a search result", () => {
    for (const h of pages) {
      expect(title(h)!.length, title(h)).toBeLessThanOrEqual(65);
    }
  });
});

describe("the share image is reachable", () => {
  it("is not given a trailing slash and redirected into nothing", () => {
    // It was: added as a route but not to FILE_PATHS, so it 301'd to
    // /og-image.png/, and every preview card would have had no picture.
    expect(canonicalPath("/og-image.png")).toBeNull();
  });
});

describe("the forecast timestamp", () => {
  it("says it is the current hour, on the city's own clock", () => {
    // Read from another zone, "Forecast for 6:00 PM PDT on Monday, October 26"
    // looked like a stale date, or the time the forecast was issued.
    const h = html(view(US, false)).replace(/<!--.*?-->/gs, "");
    expect(h).toMatch(/Hourly forecast for [^<]+, the current hour in Portland \(/);
  });
});
