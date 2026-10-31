import { describe, expect, it } from "vitest";

import { buildCurve, protectionWindow, type CurvePoint } from "../src/lib/chart";
import { dayStrip } from "../src/lib/strip";
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
    strip: dayStrip({
      points: CURVE,
      sun: { sunrise: 5 * 60 + 20, sunset: 18 * 60 + 40 },
      window: protectionWindow(CURVE),
      nowMinutes: 12 * 60,
    }),
    tomorrowStrip: dayStrip({
      points: CURVE,
      sun: { sunrise: 5 * 60 + 20, sunset: 18 * 60 + 40 },
      window: protectionWindow(CURVE),
      nowMinutes: null,
      label: "Tomorrow",
    }),
    stripCredit: measured ? "Forecast by CAMS" : "Forecast by the US EPA and CAMS",
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
    strip: dayStrip({ points: CURVE, sun: { sunrise: 5 * 60 + 20, sunset: 18 * 60 + 40 }, window: null, nowMinutes: 12 * 60 }),
    tomorrowStrip: dayStrip({ points: CURVE, sun: { sunrise: 5 * 60 + 20, sunset: 18 * 60 + 40 }, window: null, nowMinutes: null }),
    ...over,
  };
}

function country(rows: CityRow[], us = false): string {
  const v: CountryView = {
    country: COUNTRIES.find((c) => c.code === (us ? "us" : "au"))!,
    rows,
    now: NOW,
    hasForecast: true,
    map: MAP,
    measured: !us,
    credit: us ? "epa" : "arpansa",
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
    const now = sydney.match(/<td class="k-now">.*?<\/td>/s)?.[0] ?? "";
    expect(now).toContain(">7.8<");
    expect(now).toContain('class="old"');
    expect(now).not.toMatch(/class="b\d"/);
  });

  it("leaves it out of the headline", () => {
    expect(copy(h)).toMatch(/Highest now: Perth/);
  });
});

describe("F2: the country list fits a 360 px phone", () => {
  it("has no band pill to push the row wide", () => {
    const h = country([row("perth")]);
    expect(h).not.toMatch(/class="band"/);
    expect(h).not.toContain("tablewrap");
  });
});

describe("G4: a swatch and the number, not a pill in every cell", () => {
  const h = country([row("perth"), row("sydney", { uvi: 2.4, peak: 11.2 })]);
  const body = h.match(/<tbody>.*<\/tbody>/s)?.[0] ?? "";

  it("prints no band word in the rows", () => {
    expect(copy(body)).not.toMatch(/Low|Moderate|High|Extreme/);
  });

  it("gives each value its band as a swatch class, from the rounded value", () => {
    expect(body).toContain('<b class="b0">2.4</b>');
    expect(body).toContain('<b class="b4">11.2</b>');
    expect(h).toMatch(/\.list \.b4\{--sw:var\(--band-4\)\}/);
  });

  it("keeps the band word where it changes the advice", () => {
    expect(copy(h)).toMatch(/Highest now: Perth , 7\.8 Very High\./);
  });
});

describe("Session 3: the country page as small multiples", () => {
  const many = locationsIn("au").slice(0, 12).map((l) => row(l.slug));
  const h = country(many);

  it("draws today's and tomorrow's strip in every row, one <i> a cell", () => {
    const rows = h.match(/<tbody>.*<\/tbody>/s)![0].split("<tr").filter((r) => r.includes("s-today"));
    expect(rows).toHaveLength(12);
    for (const r of rows) {
      expect(r).toContain('class="ms s-tomorrow"');
      expect(r).not.toMatch(/style="--h:/);
    }
  });

  it("marks the current hour in today's strip only", () => {
    const today = h.match(/class="ms s-today"[^>]*>.*?<\/div>/s)![0];
    const tomorrow = h.match(/class="ms s-tomorrow"[^>]*>.*?<\/div>/s)![0];
    expect(today).toMatch(/class="[^"]*\bn\b/);
    expect(tomorrow).not.toMatch(/class="[^"]*\bn\b/);
  });

  it("puts the list before the map (C3)", () => {
    expect(h.indexOf("<tbody>")).toBeGreaterThan(0);
    expect(h.indexOf("<tbody>")).toBeLessThan(h.indexOf('class="mapbox"'));
  });

  it("reserves one empty ad slot after row 10, hidden from screen readers", () => {
    const body = h.match(/<tbody>.*<\/tbody>/s)![0];
    const trs = body.match(/<tr[^>]*>/g)!;
    expect(trs[10]).toBe('<tr class="ad" aria-hidden="true">');
    expect(trs.filter((t) => t.includes('class="ad"'))).toHaveLength(1);
    expect(h).toMatch(/\.list tr\.ad td\{height:100px/);
  });

  it("has no ad slot on a page of ten cities or fewer", () => {
    expect(country(many.slice(0, 10))).not.toContain('class="ad"');
  });

  it("credits ARPANSA for the value now and CAMS for the strip, in the list itself", () => {
    const list = h.match(/<div class="list">.*?<\/table>/s)![0];
    expect(copy(list)).toContain("Measured by ARPANSA");
    expect(copy(list)).toContain("Today hour by hour, forecast by CAMS");
  });

  it("says forecast, never measured, for the United States", () => {
    const us = country([row("perth", { location: MIAMI })], true);
    const list = copy(us.match(/<div class="list">.*?<\/table>/s)![0]);
    expect(list).toContain("Now, forecast");
    expect(list).toContain("forecast by the US EPA and CAMS");
    expect(list).not.toMatch(/measured/i);
  });

  it("keeps every figure for a screen reader, whichever view is on screen", () => {
    // Collapsed off screen, never display:none, which would take them out.
    expect(h).not.toMatch(/\.k-(now|peak|tomorrow)[^{]*\{display:none/);
    expect(h).toMatch(/#day-now:checked~\.list \.k-peak>\*/);
  });

  it("draws no switch and no strip column when there is no forecast at all", () => {
    const bare = country([row("perth", { peak: null, tomorrow: null, strip: null, tomorrowStrip: null })]);
    expect(bare).not.toContain('type="radio"');
    expect(bare).not.toContain('class="s"');
    expect(bare).toContain('class="k-now"');
  });

  it("never animates a strip", () => {
    expect(h).not.toMatch(/\.ms[^{]*\{[^}]*(animation|transition)/);
  });

});

describe("F4: the selected day reads in dark mode", () => {
  it("sets the selected label in the page colour, not white", () => {
    const h = country([row("perth")]);
    expect(h).toContain("{background:var(--zenith);color:var(--sky)}");
    expect(h).not.toContain("color:#fff}");
  });
});

describe("F5: prose is set to be read", () => {
  it("holds text pages to 66 characters, left-aligned, at 17 px", () => {
    const h = String(Guide());
    expect(h).toMatch(/\.prose\{[^}]*max-width:66ch/);
    expect(h).toMatch(/\.prose\{[^}]*font-size:var\(--t-1\)/);
    expect(h).toMatch(/--t-1:17px/);
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

describe("The day strip on a city page (session 2)", () => {
  /** The strip's own markup, from its <figure> to the end of it. */
  function strip(html: string): string {
    return html.match(/<figure class="strip">.*?<\/figure>/s)![0];
  }

  it("comes after the reading and before what to do", () => {
    const h = city(PERTH, true);
    const at = (s: string) => h.indexOf(s);
    expect(at('class="reading"')).toBeGreaterThan(0);
    expect(at('class="strip"')).toBeGreaterThan(at('class="reading"'));
    expect(at('class="todo"')).toBeGreaterThan(at('class="strip"'));
    expect(at('class="adslot"')).toBeGreaterThan(at('class="todo"'));
    expect(at('class="tomorrow"')).toBeGreaterThan(at('class="adslot"'));
    expect(at('class="chart"')).toBeGreaterThan(at('class="tomorrow"'));
  });

  it("carries its credit inside itself, and the reading keeps its own", () => {
    const h = city(PERTH, true);
    expect(copy(strip(h))).toContain("Forecast by CAMS");
    expect(copy(h.match(/<div class="reading">.*?<\/div>\s*<\/section>|<div class="reading">.*?<p class="credit">.*?<\/p>/s)![0])).toContain(
      "Measured by ARPANSA",
    );
    expect(copy(strip(city(MIAMI, false)))).toContain("Forecast by the US EPA and CAMS");
  });

  it("never calls a US strip live or measured", () => {
    expect(copy(strip(city(MIAMI, false)))).not.toMatch(/\blive\b|measured/i);
  });

  it("brackets the protection window, in words a reader can act on", () => {
    const w = protectionWindow(CURVE)!;
    expect(w).not.toBeNull();
    expect(copy(strip(city(PERTH, true)))).toMatch(/Cover up \d+:\d\d am to \d+:\d\d pm/);
  });

  it("draws no bracket when there is no window", () => {
    const flat = CURVE.map((p) => ({ ...p, uvi: Math.min(p.uvi, 2) }));
    const s = dayStrip({ points: flat, sun: { sunrise: 320, sunset: 1120 }, window: protectionWindow(flat), nowMinutes: null });
    const h = strip(city(PERTH, true, { strip: s }));
    expect(h).not.toContain('class="bracket"');
    expect(copy(h)).not.toMatch(/cover up/i);
  });

  it("names the peak and the window for a screen reader", () => {
    const text = copy(strip(city(PERTH, true)));
    expect(text).toMatch(/peak 9\.0 Very High at 12:00 pm/);
    expect(text).toMatch(/cover up \d+:\d\d am to \d+:\d\d pm/);
  });

  it("prints values in ink, colours bars only, and marks missing hours as missing", () => {
    const morning = CURVE.filter((p) => p.minutes >= 11 * 60);
    const s = dayStrip({ points: morning, sun: { sunrise: 320, sunset: 1120 }, window: null, nowMinutes: null });
    const h = city(PERTH, true, { strip: s });
    expect(strip(h)).toContain('class="c x');
    expect(h).toMatch(/\.strip \.v\{color:var\(--shade\)/);
    expect(h).toMatch(/\.strip \.b3 \.bar\{background:var\(--band-3\)\}/);
    expect(copy(strip(h))).toContain("No forecast before 11:00 am");
  });

  it("outlines the hour that holds now, and only on today's strip", () => {
    const h = city(PERTH, true);
    expect(strip(h).match(/class="c [^"]*\bnow\b/g)).toHaveLength(1);
    const tomorrow = h.match(/<figure class="strip compact">.*?<\/figure>/s)![0];
    expect(tomorrow).not.toMatch(/\bnow\b"/);
  });

  it("moves nothing", () => {
    const css = city(PERTH, true).match(/<style>(?!.*@font-face).*?<\/style>/gs)!.join("");
    expect(css).not.toMatch(/@keyframes|animation:|\.strip[^{]*\{[^}]*transition/);
  });

  it("reserves the ad slot at a fixed height while ads are off", () => {
    const h = city(PERTH, true);
    expect(h).toMatch(/\.adslot\{min-height:100px/);
    expect(h).toContain('<div class="adslot" aria-hidden="true"></div>');
  });
});

describe("G2: one panel, not a page of boxes", () => {
  it("drops the hover lift", () => {
    for (const h of [city(PERTH, true), String(HomePage({ headlines: [], now: NOW }))]) {
      expect(h).not.toMatch(/class="[^"]*\blift\b|\.lift[{:]/);
      expect(h).not.toMatch(/translateY\(-2px\)/);
    }
  });

  it("gives the chart no panel of its own", () => {
    expect(city(PERTH, true)).toMatch(/\.chartbox\{[^}]*\}/);
    expect(city(PERTH, true).match(/\.chartbox\{[^}]*\}/)![0]).not.toMatch(/background|border/);
  });
});
