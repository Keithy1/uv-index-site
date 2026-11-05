import { describe, expect, it } from "vitest";

import { PIXEL_GIF, visitPoint } from "../src/lib/visit";

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

function req(path: string | null, headers: Record<string, string> = {}): Request {
  const url = path === null ? "https://uvatlas.com/api/v" : `https://uvatlas.com/api/v?p=${encodeURIComponent(path)}`;
  return new Request(url, {
    headers: {
      "User-Agent": CHROME,
      "Accept-Language": "en-AU,en;q=0.9",
      "Sec-Fetch-Dest": "image",
      ...headers,
    },
  });
}

describe("visitPoint", () => {
  it("records a browser loading the pixel, with page, country and device", () => {
    expect(visitPoint(req("/au/perth/"), "AU")).toEqual({
      indexes: ["/au/perth/"],
      blobs: ["/au/perth/", "AU", "desktop", "uvatlas.com"],
      doubles: [1],
    });
    expect(visitPoint(req("/", { "User-Agent": IPHONE }), "US")?.blobs[2]).toBe("mobile");
  });

  it("drops anything that says it is a bot", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2)",
      "Mozilla/5.0 (compatible; bingbot/2.0)",
      "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0 Safari/537.36",
      "curl/8.5.0",
      "python-requests/2.32",
      "",
    ]) {
      expect(visitPoint(req("/", { "User-Agent": ua }), "US"), ua).toBeNull();
    }
  });

  it("drops requests no browser would send", () => {
    // Every browser sends Accept-Language; most scripted clients do not.
    expect(visitPoint(req("/", { "Accept-Language": "" }), "US")).toBeNull();
    // Opened directly, or fetched as a document, rather than drawn by a page.
    expect(visitPoint(req("/", { "Sec-Fetch-Dest": "document" }), "US")).toBeNull();
  });

  it("keeps a browser too old to send Sec-Fetch-Dest", () => {
    const r = new Request("https://uvatlas.com/api/v?p=%2F", {
      headers: { "User-Agent": CHROME, "Accept-Language": "en" },
    });
    expect(visitPoint(r, "US")).not.toBeNull();
  });

  it("records only paths shaped like this site's, so the table cannot be filled with junk", () => {
    expect(visitPoint(req(null), "US")).toBeNull();
    expect(visitPoint(req("https://evil.test/"), "US")).toBeNull();
    expect(visitPoint(req("/" + "a".repeat(200)), "US")).toBeNull();
    expect(visitPoint(req("/au/<script>/"), "US")).toBeNull();
  });

  it("records an unknown country as XX rather than leaving it blank", () => {
    expect(visitPoint(req("/"), undefined)?.blobs[1]).toBe("XX");
  });
});

describe("PIXEL_GIF", () => {
  it("is a real GIF", () => {
    expect(String.fromCharCode(...PIXEL_GIF.slice(0, 6))).toBe("GIF89a");
  });
});
