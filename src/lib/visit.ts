/**
 * Counting people, not crawlers, without shipping any JavaScript.
 *
 * Cloudflare's own "visits" counted 1.13k in a week when Google had sent one
 * click: zone analytics on the free plan cannot tell a bot from a reader. Its
 * Web Analytics can, but only through a ~5 KB beacon script, which is the whole
 * JavaScript budget held for the ad script to come.
 *
 * So every page carries a 1x1 image at /api/v. Most bots fetch the HTML and
 * never the images on it, robots.txt disallows /api/ for the polite ones that
 * render, and what still arrives is filtered here on what it says about itself.
 * It undercounts readers who block images; every method misses someone.
 *
 * Nothing that identifies a person is stored: page, country, phone or desktop,
 * host. That is page views, not unique visitors, on purpose.
 */

/** Declared names, not behaviour: a bot that lies about itself gets through. */
const BOT_UA =
  /bot|crawl|spider|slurp|headless|lighthouse|preview|fetch|monitor|python|curl|wget|httpclient|java\/|go-http|node|axios|scrapy|facebookexternalhit|embedly|whatsapp/i;

/** This site's paths: lower-case letters, digits, hyphens, slashes. */
const PATH = /^\/[a-z0-9\-/]{0,99}$/;

export interface VisitPoint {
  readonly indexes: [string];
  readonly blobs: [path: string, country: string, device: string, host: string];
  readonly doubles: [number];
}

/** The data point for one pixel request, or null if it should not count. */
export function visitPoint(request: Request, country: string | undefined): VisitPoint | null {
  const h = request.headers;
  const ua = h.get("User-Agent") ?? "";
  if (ua === "" || BOT_UA.test(ua)) return null;
  if (!h.get("Accept-Language")) return null;
  // Absent on older browsers, so only a wrong value disqualifies.
  const dest = h.get("Sec-Fetch-Dest");
  if (dest !== null && dest !== "image") return null;

  const url = new URL(request.url);
  const path = url.searchParams.get("p");
  if (path === null || !PATH.test(path)) return null;

  const device = /Mobi|Android|iPhone|iPad/.test(ua) ? "mobile" : "desktop";
  return {
    indexes: [path],
    blobs: [path, country || "XX", device, url.hostname],
    doubles: [1],
  };
}

/** The smallest transparent GIF: 43 bytes. */
export const PIXEL_GIF = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
  (ch) => ch.charCodeAt(0),
);
