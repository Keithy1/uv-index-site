import { describe, expect, it } from "vitest";

import { buildCurve, type CurvePoint } from "../src/lib/chart";
import { COUNTRIES, locationsIn } from "../src/lib/locations";
import type { CityNormals } from "../src/lib/normals";
import { CityPage, type CityView } from "../src/views/CityPage";
import { CountryPage, type CityRow, type CountryView } from "../src/views/CountryPage";
import { HomePage } from "../src/views/HomePage";
import { NotFound } from "../src/views/NotFound";
import { Guide } from "../src/views/pages/Guide";
import { About, Privacy, Terms } from "../src/views/pages/Legal";
import { Methods } from "../src/views/pages/Methods";
import { NORMALS_CSS } from "../src/views/ThisTimeOfYear";

/**
 * The 30 October design audit (issue #1), held where a copy or CSS edit would
 * otherwise undo it quietly. Each block names the finding it guards.
 */

const PERTH = locationsIn("au").find((l) => l.slug === "perth")!;
const MIAMI = locationsIn("us").find((l) => l.slug === "miami-fl")!;
const NOW = new Date("2026-10-26T04:00:00Z");

// A plain bell over the day, hourly, peaking at 9 around 12:30.
const CURVE: CurvePoint[] = Array.from({ length: 24 }, (_, h) => ({
  minutes: h * 60,
  uvi: Math.max(0, Math.round((9 - ((h - 12.5) / 1.6) ** 2 / 2) * 10) / 10),
}));

const NORMALS: CityNormals = {
  source: "arpansa",
  years: [2010, 2024],
  months: Array.from({ length: 12 }, (_, i) => ({
    days: 400,
    median: 4 + i / 2,
    protect: 0.9,
    veryHigh: 0.4,
    extreme: 0.1,
  })),
};

function city(location: typeof PERTH, measured: boolean, over: Partial<CityView> = {}): string {
  const v: CityView = {
    location,
    now: NOW,
    reading: { uvi: 7.4, validAt: "2026-10-26T03:55:00Z", stale: false },
    curve: CURVE,
    clearSky: CURVE,
    geometry: buildCurve(CURVE, measured ? { minutes: 12 * 60, uvi: 7.4 } : null, 12 * 60),
    tomorrow: { uvi: 8.1, minutes: 12 * 60 + 20 },
    hasForecast: true,
    measured,
    credit: measured ? "arpansa" : "epa",
    advice: { uvi: 7.4, scope: "now" },
    normals: NORMALS,
    month: 10,
    ...over,
  };
  return String(CityPage(v));
}

const MAP = {
  width: 100,
  height: 100,
  outlinePath: "M0,0 L100,0 L100,100 Z",
  project: () => ({ x: 50, y: 50 }),
};

function row(slug: string, over: Partial<CityRow> = {}): CityRow {
  return {
    location: locationsIn("au").find((l) => l.slug === slug)!,
    uvi: 7.8,
    validAt: "2026-10-26T03:55:00Z",
    stale: false,
    peak: 9.1,
    tomorrow: 8.4,
    tomorrowMinutes: 750,
    alert: false,
    ...over,
  };
}

function country(rows: CityRow[]): string {
  const v: CountryView = {
    country: COUNTRIES.find((c) => c.code === "au")!,
    rows,
    now: NOW,
    hasForecast: true,
    map: MAP,
    measured: true,
    credit: "arpansa",
    cityPages: true,
  };
  return String(CountryPage(v));
}

/** Visible copy only: no tags, no <head>, no inline CSS or JSON-LD. */
function copy(html: string): string {
  return html
    .replace(/<head>.*?<\/head>/s, " ")
    .replace(/<style[^>]*>.*?<\/style>/gs, " ")
    .replace(/<script[^>]*>.*?<\/script>/gs, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/\s+/g, " ");
}

describe("F1: a reading never animates", () => {
  it("gives the hourly chart and the month bars no keyframes", () => {
    for (const h of [city(PERTH, true), city(MIAMI, false), NORMALS_CSS]) {
      expect(h).not.toMatch(/uv-(draw|fade|pop|rise)/);
      expect(h).not.toMatch(/stroke-dashoffset/);
    }
  });

  it("keeps the page transition, which moves no number", () => {
    expect(city(PERTH, true)).toContain("@view-transition");
  });
});

describe("F3 and C1: the hourly chart can be read on a phone and without a chart", () => {
  const h = city(PERTH, true);

  it("sets its axis labels in HTML text, not in a scaled-down SVG", () => {
    // The 640-wide viewBox drew 11-unit text at about 7 px on a 360 px phone.
    expect(h).not.toMatch(/<text[^>]*font-size="1[01]"/);
    expect(h).toMatch(/class="hl"[^>]*>6am</);
  });

  it("gives each hour a native tooltip", () => {
    expect(h).toMatch(/<title>12:00 pm: UV \d+\.\d \w/);
  });

  it("has an hour-by-hour table under the chart", () => {
    expect(h).toMatch(/<details[^>]*>\s*<summary>Hour by hour<\/summary>/);
    expect(h).toMatch(/<td>12:00 pm<\/td>/);
  });

  it("has a table view of this time of year", () => {
    expect(h).toMatch(/<summary>Every month as a table<\/summary>/);
    expect(h).toMatch(/<th scope="row">January<\/th>/);
  });
});

describe("W3 and W4: the credit is in the reading, and times read one way", () => {
  it("says who measured an Australian reading, and when", () => {
    expect(copy(city(PERTH, true))).toMatch(/Measured by ARPANSA at 11:55 am AWST/);
  });

  it("says a US reading is a forecast, and never measured", () => {
    const text = copy(city(MIAMI, false));
    expect(text).toMatch(/Forecast by the US EPA and CAMS for 11:55 pm EDT/);
    expect(text).not.toMatch(/Measured by/);
  });

  it("writes am and pm in lower case, in every locale", () => {
    expect(copy(city(MIAMI, false))).not.toMatch(/\d (AM|PM)\b/);
  });
});

describe("C2: a stale row looks stale", () => {
  const h = country([row("perth"), row("sydney", { stale: true, validAt: "2026-10-26T02:00:00Z" })]);
  const sydney = h.match(/<tr class="stale">.*?<\/tr>/s)?.[0] ?? "";

  it("says how old it is", () => {
    expect(sydney).toContain("2 h ago");
  });

  it("gives its current value no band colour", () => {
    const now = sydney.match(/<td class="now">.*?<\/td>/s)?.[0] ?? "";
    expect(now).toContain("7.8");
    expect(now).not.toContain("background:");
  });

  it("leaves it out of the headline", () => {
    expect(copy(h)).toMatch(/Highest now: Perth/);
  });
});

describe("F2: the country table fits a 360 px phone", () => {
  it("shrinks each band pill to a swatch on a narrow screen, keeping its word", () => {
    const h = country([row("perth")]);
    expect(h).toMatch(/@media \(max-width:420px\)\{\.uvi \.band\{font-size:0;width:12px/);
    // Not display:none: the band's name must still reach a screen reader.
    expect(h).not.toMatch(/\.uvi \.band\{display:none/);
  });
});

describe("F4: the selected day reads in dark mode", () => {
  it("sets the selected label in the page colour, not white", () => {
    const h = country([row("perth")]);
    expect(h).toContain("{background:var(--link);color:var(--bg)}");
    expect(h).not.toContain("color:#fff}");
  });
});

describe("F5: prose is set to be read", () => {
  it("holds text pages to 66 characters, left-aligned, at 17 px", () => {
    const h = String(Guide());
    expect(h).toMatch(/\.prose\{[^}]*max-width:66ch/);
    expect(h).toMatch(/\.prose\{[^}]*font-size:17px/);
    expect(h).not.toMatch(/text-align:justify|hyphens:auto/);
  });
});

describe("G3: no generated-page tells", () => {
  const pages = {
    home: String(HomePage({ headlines: [], now: NOW })),
    au: country([row("perth")]),
    perth: city(PERTH, true),
    miami: city(MIAMI, false),
    guide: String(Guide()),
    methods: String(Methods()),
    about: String(About()),
    privacy: String(Privacy()),
    terms: String(Terms()),
    notFound: String(NotFound()),
  };

  it("uses no tracked capitals on table headings", () => {
    for (const [name, h] of Object.entries(pages)) {
      expect(h, name).not.toContain("text-transform:uppercase");
    }
  });

  it("strings no meta together with middle dots or spaced dashes", () => {
    for (const [name, h] of Object.entries(pages)) {
      expect(copy(h), name).not.toMatch(/ · | — /);
      expect(h.match(/<title>(.*?)<\/title>/s)![1], name).not.toMatch(/ — /);
    }
  });
});

describe("W2 and W5: words that match what is there", () => {
  it("does not call the site live where the US half is forecast", () => {
    expect(copy(String(NotFound()))).not.toMatch(/\blive\b/i);
    const home = copy(String(HomePage({ headlines: [], now: NOW })));
    expect(home).not.toMatch(/\blive UV index map\b/i);
  });

  it("does not call the home page live in its search snippet either", () => {
    const h = String(HomePage({ headlines: [], now: NOW }));
    const description = h.match(/<meta name="description" content="(.*?)"/s)![1]!;
    expect(description).not.toMatch(/\blive\b/i);
    expect(description).toContain("forecast in the United States");
  });

  it("labels the header menu for what it does", () => {
    expect(String(NotFound())).toContain("<summary>Choose a country</summary>");
  });
});
