import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseFeed, parseUtcDateTime } from "../src/sources/arpansa";

/** The live feed as served on 23 Oct 2026, byte for byte, BOM included. */
const FIXTURE = readFileSync(
  fileURLToPath(new URL("./fixtures/arpansa-uvvalues.xml", import.meta.url)),
  "utf8",
);
const FETCHED_AT = new Date("2026-10-23T12:50:00Z");

function feed(locations: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n<stations>${locations}</stations>`;
}

function station(overrides: Partial<Record<string, string>> = {}): string {
  const f = {
    name: "per",
    index: "7.4",
    utcdatetime: "2026/10/23 04:30",
    status: "ok",
    ...overrides,
  };
  return `<location id="Perth"><name>${f.name}</name><index>${f.index}</index>` +
    `<utcdatetime>${f.utcdatetime}</utcdatetime><status>${f.status}</status></location>`;
}

describe("parseUtcDateTime", () => {
  it("reads the feed's format as UTC, not as local time", () => {
    // If this ever returns a time shifted by the host's offset, every reading
    // on the site is wrong by hours. Asserting the exact string pins it.
    expect(parseUtcDateTime("2026/10/23 12:48")).toBe("2026-10-23T12:48:00Z");
    expect(parseUtcDateTime("2026/01/01 00:00")).toBe("2026-01-01T00:00:00Z");
    expect(parseUtcDateTime("2026/12/31 23:59")).toBe("2026-12-31T23:59:00Z");
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseUtcDateTime("  2026/10/23 12:48  ")).toBe("2026-10-23T12:48:00Z");
  });

  it("rejects anything it cannot read exactly", () => {
    expect(parseUtcDateTime("")).toBeNull();
    expect(parseUtcDateTime("23/10/2026 12:48")).toBeNull();
    expect(parseUtcDateTime("2026-10-23T12:48:00Z")).toBeNull();
    expect(parseUtcDateTime("2026/10/23")).toBeNull();
  });

  it("rejects dates that do not exist instead of rolling them over", () => {
    // Date.UTC would turn these into early March and 1 January.
    expect(parseUtcDateTime("2026/02/31 10:00")).toBeNull();
    expect(parseUtcDateTime("2026/13/01 10:00")).toBeNull();
  });
});

describe("parseFeed against the live fixture", () => {
  const result = parseFeed(FIXTURE, FETCHED_AT);

  it("reads past the UTF-8 BOM the feed is served with", () => {
    expect(result.readings.length).toBeGreaterThan(0);
  });

  it("returns one reading per published station and no more", () => {
    expect(result.readings).toHaveLength(13);
    const ids = result.readings.map((r) => r.locationId).sort();
    expect(ids).toEqual([
      "au-adl", "au-ali", "au-bri", "au-can", "au-dar", "au-emd", "au-gco",
      "au-kin", "au-mel", "au-new", "au-per", "au-syd", "au-tow",
    ]);
  });

  it("drops the three Antarctic stations and says why", () => {
    const skipped = result.rejected.filter((r) => /not published/.test(r));
    expect(skipped).toHaveLength(3);
    expect(skipped.join(" ")).toMatch(/cas/);
    expect(skipped.join(" ")).toMatch(/dav/);
    expect(skipped.join(" ")).toMatch(/maw/);
  });

  it("keeps night-time zeros rather than treating them as missing data", () => {
    // The fixture was captured at about 10:48 pm AEDT: every station reads 0.0.
    expect(result.readings.every((r) => r.uvi === 0)).toBe(true);
  });

  it("labels every reading as measured, from ARPANSA, with both timestamps", () => {
    for (const reading of result.readings) {
      expect(reading.source).toBe("arpansa");
      expect(reading.kind).toBe("measured");
      expect(reading.validAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(reading.fetchedAt).toBe("2026-10-23T12:50:00Z");
    }
  });
});

describe("parseFeed checks", () => {
  it("keeps a good reading", () => {
    const result = parseFeed(feed(station()), FETCHED_AT);
    expect(result.readings).toHaveLength(1);
    expect(result.readings[0]).toMatchObject({
      locationId: "au-per",
      uvi: 7.4,
      validAt: "2026-10-23T04:30:00Z",
    });
  });

  it("keeps a station that reports itself behind, and notes it", () => {
    // Dropping these would cost the site Sydney, Melbourne, Brisbane and
    // Adelaide on an ordinary day. The reading is real; how old it is decides
    // whether it may be shown as current, and that is the store's job.
    const result = parseFeed(feed(station({ status: "174 Mins Slow" })), FETCHED_AT);
    expect(result.readings).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.notes.join(" ")).toMatch(/174 Mins Slow/);
  });

  it("notes nothing when every station is ok", () => {
    const result = parseFeed(feed(station({ status: "ok" })), FETCHED_AT);
    expect(result.notes).toHaveLength(0);
  });

  it("accepts the status field in any case", () => {
    const result = parseFeed(feed(station({ status: "OK" })), FETCHED_AT);
    expect(result.readings).toHaveLength(1);
    expect(result.notes).toHaveLength(0);
  });

  it("drops a row with no status field at all, which means a malformed feed", () => {
    const result = parseFeed(feed(station({ status: "" })), FETCHED_AT);
    expect(result.readings).toHaveLength(0);
    expect(result.rejected.join(" ")).toMatch(/no status/);
  });

  it("drops an index outside the plausible range", () => {
    for (const index of ["-1", "99", "not-a-number", ""]) {
      const result = parseFeed(feed(station({ index })), FETCHED_AT);
      expect(result.readings, index).toHaveLength(0);
    }
  });

  it("drops a row with an unreadable timestamp", () => {
    const result = parseFeed(feed(station({ utcdatetime: "23/10/2026 4:30pm" })), FETCHED_AT);
    expect(result.readings).toHaveLength(0);
    expect(result.rejected.join(" ")).toMatch(/utcdatetime/);
  });

  it("keeps the good stations when one row is broken", () => {
    // A single bad row must never cost us the other twelve cities.
    const result = parseFeed(
      feed(station() + station({ name: "syd", index: "" }) + station({ name: "mel", index: "3.1" })),
      FETCHED_AT,
    );
    expect(result.readings.map((r) => r.locationId)).toEqual(["au-per", "au-mel"]);
  });

  it("handles a feed that has shrunk to a single station", () => {
    // fast-xml-parser yields an object rather than an array in this case.
    const result = parseFeed(feed(station()), FETCHED_AT);
    expect(result.readings).toHaveLength(1);
  });

  it("throws when the feed is not the XML we expect", () => {
    // Throwing is deliberate: the caller keeps the last good data and marks the
    // source unhealthy, rather than publishing an empty country page.
    expect(() => parseFeed("", FETCHED_AT)).toThrow(/did not parse/);
    expect(() => parseFeed("<html><body>503</body></html>", FETCHED_AT)).toThrow(/did not parse/);
    expect(() => parseFeed(feed(""), FETCHED_AT)).toThrow(/did not parse/);
  });
});

describe("the empty-index trap", () => {
  it("never turns a missing index into a night-time zero", () => {
    // Number("") === 0 in JavaScript and 0 is a valid reading after dark, so a
    // feed that stops publishing a value must be rejected, not published as 0.0.
    for (const index of ["", "   ", "N/A", "-"]) {
      const result = parseFeed(feed(station({ index })), FETCHED_AT);
      expect(result.readings, JSON.stringify(index)).toHaveLength(0);
      expect(result.rejected.join(" ")).toMatch(/not a UV value/);
    }
  });

  it("still accepts a genuine zero", () => {
    const result = parseFeed(feed(station({ index: "0.0" })), FETCHED_AT);
    expect(result.readings).toHaveLength(1);
    expect(result.readings[0]?.uvi).toBe(0);
  });
});

describe("the live feed of 25 Oct 2026, with six stations running late", () => {
  // Captured straight from ARPANSA. Six of the thirteen published stations
  // reported "17x Mins Slow" simultaneously, which is what prompted the
  // <status> rule above.
  const SLOW = readFileSync(
    fileURLToPath(new URL("./fixtures/arpansa-uvvalues-slow-stations.xml", import.meta.url)),
    "utf8",
  );
  const result = parseFeed(SLOW, new Date("2026-10-25T15:55:00Z"));

  it("still publishes all thirteen cities", () => {
    expect(result.readings).toHaveLength(13);
  });

  it("notes the six late stations by name", () => {
    const noted = result.notes.join(" ");
    for (const code of ["adl", "bri", "can", "mel", "new", "syd"]) {
      expect(noted, code).toContain(`${code}: station reports`);
    }
    expect(result.notes).toHaveLength(6);
  });

  it("keeps each late reading at the instant the feed says it belongs to", () => {
    // Sydney's row is nearly three hours old; it must not inherit fetch time.
    const sydney = result.readings.find((r) => r.locationId === "au-syd");
    expect(sydney?.validAt).toBe("2026-10-25T12:59:00Z");
  });
});
