import { describe, expect, it } from "vitest";

import { isProductionHost } from "../src/lib/host";

/**
 * A preview deployment serves the same pages as production from a public URL.
 * Indexed, it becomes a duplicate competing with the site it exists to
 * rehearse — and this project's entire plan is to rank a small number of
 * pages, so that is the worst place to take the damage.
 */
describe("isProductionHost", () => {
  it("accepts the real site, with or without www or a port", () => {
    expect(isProductionHost("uvatlas.com")).toBe(true);
    expect(isProductionHost("www.uvatlas.com")).toBe(true);
    expect(isProductionHost("UVATLAS.COM")).toBe(true);
    expect(isProductionHost("uvatlas.com:443")).toBe(true);
  });

  it("rejects preview and development hosts", () => {
    expect(isProductionHost("uvatlas.keithchester.workers.dev")).toBe(false);
    expect(isProductionHost("uvatlas-preview.workers.dev")).toBe(false);
    expect(isProductionHost("127.0.0.1:8787")).toBe(false);
    expect(isProductionHost("localhost:8787")).toBe(false);
  });

  it("is not fooled by a lookalike hostname", () => {
    // A suffix check rather than an exact match would wave these through.
    expect(isProductionHost("uvatlas.com.evil.test")).toBe(false);
    expect(isProductionHost("notuvatlas.com")).toBe(false);
    expect(isProductionHost("uvatlas.co")).toBe(false);
    expect(isProductionHost("")).toBe(false);
  });
});
