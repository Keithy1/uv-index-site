/**
 * Which hostnames are the real site.
 *
 * Its own module, with no Worker types, so tests can import it without
 * dragging the whole Worker (and D1Database) into a Node test run.
 */

/** The only hostnames whose pages may be indexed. */
const PRODUCTION_HOSTS = new Set(["uvatlas.com", "www.uvatlas.com"]);

/**
 * An exact match on the hostname, never a suffix check: "uvatlas.com.evil.test"
 * ends with nothing we trust, and a careless `endsWith` would wave it through.
 */
export function isProductionHost(host: string): boolean {
  return PRODUCTION_HOSTS.has((host.toLowerCase().split(":")[0] ?? "").trim());
}
