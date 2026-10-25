import { describe, expect, it } from "vitest";

import { canonicalPath, canonicalRedirect } from "../src/lib/urls";

describe("canonicalPath", () => {
  it("leaves a canonical path alone", () => {
    for (const path of ["/", "/au/", "/au/perth/", "/uv-index-explained/"]) {
      expect(canonicalPath(path), path).toBeNull();
    }
  });

  it("adds the missing trailing slash", () => {
    expect(canonicalPath("/au")).toBe("/au/");
    expect(canonicalPath("/au/perth")).toBe("/au/perth/");
  });

  it("lower-cases the path", () => {
    expect(canonicalPath("/AU/Perth/")).toBe("/au/perth/");
  });

  it("collapses repeated slashes", () => {
    expect(canonicalPath("//au//perth//")).toBe("/au/perth/");
  });

  it("fixes everything in one hop, never a chain", () => {
    // "/AU/Perth" is wrong in two ways; it must reach the canonical form in a
    // single redirect, not bounce through an intermediate.
    const once = canonicalPath("/AU/Perth");
    expect(once).toBe("/au/perth/");
    expect(canonicalPath(once!)).toBeNull();
  });

  it("leaves file paths without a trailing slash", () => {
    for (const path of ["/robots.txt", "/sitemap.xml", "/sitemap-au.xml"]) {
      expect(canonicalPath(path), path).toBeNull();
    }
  });

  it("does not touch the API", () => {
    // /api/where is called by a script with an exact path; rewriting it would
    // turn a cheap fetch into a redirect on every home page view.
    expect(canonicalPath("/api/where")).toBeNull();
    expect(canonicalPath("/api/health")).toBeNull();
  });
});

describe("canonicalRedirect", () => {
  it("sends www to the bare domain", () => {
    expect(canonicalRedirect("https://www.uvatlas.com/au/")).toBe("https://uvatlas.com/au/");
  });

  it("leaves http on the canonical host to Cloudflare", () => {
    // "Always Use HTTPS" runs at the edge before the Worker. Redirecting here
    // too is a loop waiting to happen, because the Worker does not reliably
    // see the scheme the visitor used -- an earlier version sent a plain-http
    // LOCAL request to https://uvatlas.com for exactly that reason.
    expect(canonicalRedirect("http://uvatlas.com/au/")).toBeNull();
  });

  it("fixes host and path together, in one hop", () => {
    const target = canonicalRedirect("http://www.uvatlas.com/AU/Perth");
    expect(target).toBe("https://uvatlas.com/au/perth/");
    expect(canonicalRedirect(target!)).toBeNull();
  });

  it("keeps the query string", () => {
    // Campaign parameters on an inbound link must survive the redirect.
    expect(canonicalRedirect("https://www.uvatlas.com/au?utm_source=x")).toBe(
      "https://uvatlas.com/au/?utm_source=x",
    );
  });

  it("leaves a canonical request alone", () => {
    expect(canonicalRedirect("https://uvatlas.com/au/perth/")).toBeNull();
  });

  it("does not drag preview hosts to production", () => {
    // Otherwise every request to the workers.dev preview would bounce to the
    // live site, and the preview would be untestable.
    expect(canonicalRedirect("https://uvatlas.keithchester1.workers.dev/au/")).toBeNull();
    expect(canonicalRedirect("http://127.0.0.1:8787/au/")).toBeNull();
    // And a local path fix must stay local.
    expect(canonicalRedirect("http://127.0.0.1:8787/AU")).toBe("http://127.0.0.1:8787/au/");
  });

  it("still fixes the path on a preview host", () => {
    expect(canonicalRedirect("https://uvatlas.keithchester1.workers.dev/AU")).toBe(
      "https://uvatlas.keithchester1.workers.dev/au/",
    );
  });
});
