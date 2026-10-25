/**
 * Whether a response may be indexed by search engines.
 *
 * Its own module, with no Worker types, so tests can import it without
 * dragging the whole Worker (and D1Database) into a Node test run.
 *
 * Two conditions, both required. The host check keeps preview deployments out
 * of the index; the launch flag keeps the REAL domain out of it until the site
 * is actually finished. The second matters more than it looks: Google forming
 * its first impression of uvatlas.com from a half-built site — missing home
 * page, missing guide, 404s where the internal links point — is worse than not
 * being indexed at all, and much slower to undo.
 */

/** The only hostnames whose pages may ever be indexed. */
const PRODUCTION_HOSTS = new Set(["uvatlas.com", "www.uvatlas.com"]);

/**
 * An exact match on the hostname, never a suffix check: "uvatlas.com.evil.test"
 * ends with nothing we trust, and a careless `endsWith` would wave it through.
 */
export function isProductionHost(host: string): boolean {
  return PRODUCTION_HOSTS.has((host.toLowerCase().split(":")[0] ?? "").trim());
}

/**
 * The launch switch, from the SITE_INDEXABLE var in wrangler.jsonc.
 *
 * Deliberately fails closed: anything other than the exact string "true" —
 * unset, empty, "1", "yes", a typo — means not indexable. A flag like this is
 * only ever read in anger once, and the expensive mistake is the one that
 * turns indexing on by accident.
 */
export function isIndexable(host: string, flag: string | undefined): boolean {
  return isProductionHost(host) && flag === "true";
}
