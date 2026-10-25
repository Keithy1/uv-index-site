import { describe, expect, it } from "vitest";

import { BANDS, bandFor, formatUvi, isPlausibleUvi, roundForBand } from "../src/lib/uv";

describe("roundForBand", () => {
  it("rounds halves up, not to even", () => {
    // The whole point: Math.round and Python's round() disagree here, and the
    // band shown to a visitor must not depend on which language ran.
    expect(roundForBand(2.5)).toBe(3);
    expect(roundForBand(10.5)).toBe(11);
    expect(roundForBand(3.5)).toBe(4);
  });

  it("leaves whole numbers alone", () => {
    expect(roundForBand(0)).toBe(0);
    expect(roundForBand(11)).toBe(11);
  });
});

describe("bandFor", () => {
  it("places the documented band edges", () => {
    expect(bandFor(0).name).toBe("Low");
    expect(bandFor(2.4).name).toBe("Low");
    expect(bandFor(2.5).name).toBe("Moderate");
    expect(bandFor(5.4).name).toBe("Moderate");
    expect(bandFor(5.5).name).toBe("High");
    expect(bandFor(7.4).name).toBe("High");
    expect(bandFor(7.5).name).toBe("Very High");
    expect(bandFor(10.4).name).toBe("Very High");
    expect(bandFor(10.5).name).toBe("Extreme");
    expect(bandFor(20).name).toBe("Extreme");
  });

  it("gives every band a colour pair and advice", () => {
    for (const band of BANDS) {
      expect(band.bg).toMatch(/^#[0-9a-f]{6}$/);
      expect(band.fg).toMatch(/^#[0-9a-f]{6}$/);
      expect(band.advice.length).toBeGreaterThan(10);
    }
  });
});

describe("isPlausibleUvi", () => {
  it("accepts the full real-world range including night zeros", () => {
    expect(isPlausibleUvi(0)).toBe(true);
    expect(isPlausibleUvi(17.2)).toBe(true);
    expect(isPlausibleUvi(20)).toBe(true);
  });

  it("rejects values that mean the source changed format or units", () => {
    expect(isPlausibleUvi(-1)).toBe(false);
    expect(isPlausibleUvi(20.1)).toBe(false);
    expect(isPlausibleUvi(Number.NaN)).toBe(false);
    expect(isPlausibleUvi(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("formatUvi", () => {
  it("always shows one decimal, as ARPANSA publishes it", () => {
    expect(formatUvi(0)).toBe("0.0");
    expect(formatUvi(7)).toBe("7.0");
    expect(formatUvi(11.25)).toBe("11.3");
  });
});
