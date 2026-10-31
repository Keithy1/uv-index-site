import { describe, expect, it } from "vitest";

import { cityLabel, locationsIn } from "../src/lib/locations";
import { canonicalPath } from "../src/lib/urls";
import { CityPage, type CityView } from "../src/views/CityPage";
import { countryHeading, countryTitle, inProse } from "../src/views/CountryPage";
import { Guide } from "../src/views/pages/Guide";

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
    strip: null,
    tomorrowStrip: null,
    stripCredit: "Forecast by CAMS",
    peakToday: null,
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
    expect(h).toContain("<h1>UV index Portland, OR today</h1>");
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
      expect(h).toContain(`<h1>UV index ${city} today</h1>`);
    }
  });

  it("names a share image with its size, so a shared link is not a bare line", () => {
    for (const h of pages) {
      expect(h).toContain('property="og:image" content="https://uvatlas.com/og-image.jpg"');
      expect(h).toContain('content="1200"');
      expect(h).toContain('content="630"');
      expect(h).toContain('name="twitter:card" content="summary_large_image"');
    }
  });

  it("declares the publisher and the breadcrumb trail", () => {
    for (const h of pages) {
      expect(h).toContain('"@type":"Organization"');
      // Square, so Google can show it beside the site's results.
      expect(h).toContain('"logo":"https://uvatlas.com/logo.jpg"');
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
    expect(canonicalPath("/og-image.jpg")).toBeNull();
    expect(canonicalPath("/logo.jpg")).toBeNull();
    expect(canonicalPath("/mark.webp")).toBeNull();
  });
});

describe("the forecast timestamp", () => {
  it("says it is the current hour, on the city's own clock", () => {
    // Read from another zone, "Forecast for 6:00 PM PDT on Monday, October 26"
    // looked like a stale date, or the time the forecast was issued.
    const h = html(view(US, false)).replace(/<!--.*?-->/gs, "");
    // The credit now sits inside the reading: who forecast it, and for when.
    expect(h).toMatch(/Forecast by the US EPA and CAMS for [^<]+, the current hour in Portland/);
  });
});

describe("the searches each page is for", () => {
  // From the research (SITE BUILD RESEARCH, 19 October 2026). Each was audited
  // missing on 27 October and is held here so a copy edit cannot drop it.

  it("leads the US page with 'UV index today', the biggest single search", () => {
    const title = countryTitle("United States", false);
    expect(title.toLowerCase().startsWith("uv index today")).toBe(true);
    expect(title.toLowerCase()).toContain("tomorrow");
    expect(title.length).toBeLessThanOrEqual(65);
    expect(countryHeading("United States", false)).toBe("UV index today and tomorrow in the United States");
  });

  it("keeps the country's name first where readings are measured", () => {
    expect(countryTitle("Australia", true)).toMatch(/^UV Index Australia/);
    expect(countryHeading("Australia", true)).toBe("UV index Australia today and tomorrow");
  });

  it("gives a country page an H1 in the title's own words, sentence case", () => {
    // docs/seo.md: one H1, and it matches the title. /au/ said "UV Index
    // Australia" under a title about today and tomorrow in every city.
    for (const [name, measured] of [["Australia", true], ["United States", false]] as const) {
      const t = countryTitle(name, measured).replace(/: Every City$/, "");
      expect(countryHeading(name, measured).toLowerCase()).toBe(t.toLowerCase());
    }
  });

  it("puts 'the' before a United country, in prose", () => {
    expect(inProse("United States")).toBe("the United States");
    expect(inProse("United Kingdom")).toBe("the United Kingdom");
    expect(inProse("Australia")).toBe("Australia");
  });

  it("answers 'what is the UV index' and names 'the UV index scale' in the guide", () => {
    const h = String(Guide()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();
    expect(h).toContain("what is the uv index?");
    expect(h).toContain("the uv index scale");
  });
});
