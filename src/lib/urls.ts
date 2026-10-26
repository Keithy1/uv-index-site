/**
 * One canonical URL per page, and the redirects that enforce it.
 *
 * The design's rule is that every page has exactly one address: lower case,
 * hyphenated, with a trailing slash, on the bare domain. Anything else is a
 * 301 to the canonical form rather than a second copy of the page — duplicate
 * URLs split ranking signals and waste crawl budget on a site whose whole plan
 * is to rank a small number of pages.
 *
 * Query strings are deliberately NOT part of this. A query string never
 * creates a different page here, and redirecting to strip one would break
 * ordinary inbound links that carry campaign parameters.
 */

export const SITE = "uvatlas";
export const ORIGIN = "https://uvatlas.com";
export const CANONICAL_HOST = "uvatlas.com";

/** Paths served as files rather than pages; these take no trailing slash. */
const FILE_PATHS = new Set([
  "/robots.txt",
  "/sitemap.xml",
  "/favicon.ico",
  // An allowlist, not a "has a dot" rule, so a city called St. Kilda could
  // never lose its trailing slash. The cost is that a new file has to be added
  // here: /og-image.png was served, then 301'd to /og-image.png/, which is not
  // a route -- so every share preview would have had a broken picture.
  "/og-image.png",
]);

function isFilePath(path: string): boolean {
  return FILE_PATHS.has(path) || /^\/sitemap-[a-z-]+\.xml$/.test(path);
}

/**
 * The canonical path for a request path, or null if it is already canonical.
 *
 * Applied in order: collapse repeated slashes, lower-case, then add the
 * trailing slash. Doing it in one pass avoids a redirect chain — "/AU" should
 * reach "/au/" in a single hop, not two.
 */
export function canonicalPath(path: string): string | null {
  if (path.startsWith("/api/")) return null; // not pages; left exactly as asked

  let next = path.replace(/\/{2,}/g, "/");
  if (/[A-Z]/.test(next)) next = next.toLowerCase();

  if (!isFilePath(next) && !next.endsWith("/")) next = `${next}/`;

  return next === path ? null : next;
}

/**
 * Where a request should be redirected, or null to serve it.
 *
 * Handles the host and the path together so that
 * "http://www.uvatlas.com/AU" becomes "https://uvatlas.com/au/" in one hop.
 */
export function canonicalRedirect(rawUrl: string): string | null {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();

  // Only www is rewritten. A workers.dev preview and localhost keep their own
  // host, or every preview request would bounce to production.
  //
  // Deliberately NOT handling http -> https here. Cloudflare's "Always Use
  // HTTPS" does that at the edge, before the Worker runs. Doing it here as
  // well is a redirect loop waiting to happen: the Worker does not reliably
  // see the scheme the visitor used, and this very code sent a plain-http
  // local request to https://uvatlas.com because it believed it was on the
  // canonical host.
  const wrongHost = host === `www.${CANONICAL_HOST}`;
  const path = canonicalPath(url.pathname);

  if (!wrongHost && path === null) return null;

  const target = new URL(url.toString());
  if (wrongHost) {
    target.protocol = "https:";
    target.hostname = CANONICAL_HOST;
  }
  if (path !== null) target.pathname = path;
  return target.toString();
}
