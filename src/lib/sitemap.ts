/**
 * Sitemaps.
 *
 * One index pointing at a sitemap per country plus one for the text pages, as
 * the design sets out.
 *
 * The important decision here is `lastmod`. These pages change every five
 * minutes, and saying so would be both true and useless: a sitemap whose dates
 * churn constantly is one Google learns to discount, and it would invite
 * crawling far more often than the content justifies. So data pages report the
 * current UTC date and nothing finer — it moves once a day — and the text
 * pages report the date they were actually last edited.
 */
import { COUNTRIES, locationsIn } from "./locations";
import type { CountryCode } from "./locations";
import { ORIGIN } from "./urls";

/** When the text pages were last meaningfully edited. Update when they change. */
export const STATIC_PAGES_UPDATED = "2026-10-25";

export const STATIC_PATHS = [
  "/uv-index-explained/",
  "/methods/",
  "/about/",
  "/privacy/",
  "/terms/",
] as const;

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** YYYY-MM-DD in UTC: coarse on purpose, so the value moves once a day. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

interface Entry {
  readonly path: string;
  readonly lastmod: string;
  /** Omitted entirely when undefined; a made-up priority is noise. */
  readonly changefreq?: string;
}

function urlset(entries: readonly Entry[]): string {
  const urls = entries
    .map(
      (e) =>
        `<url><loc>${xmlEscape(ORIGIN + e.path)}</loc>` +
        `<lastmod>${e.lastmod}</lastmod>` +
        (e.changefreq ? `<changefreq>${e.changefreq}</changefreq>` : "") +
        `</url>`,
    )
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`
  );
}

/** The live countries, which are the ones with their own sitemap. */
export function sitemapCountries(): readonly CountryCode[] {
  return COUNTRIES.filter((c) => c.status === "live").map((c) => c.code);
}

export function sitemapIndex(now: Date = new Date()): string {
  const today = todayUtc(now);
  const maps = [
    ...sitemapCountries().map((code) => ({ loc: `/sitemap-${code}.xml`, lastmod: today })),
    { loc: "/sitemap-pages.xml", lastmod: STATIC_PAGES_UPDATED },
  ];
  const body = maps
    .map(
      (m) =>
        `<sitemap><loc>${xmlEscape(ORIGIN + m.loc)}</loc>` +
        `<lastmod>${m.lastmod}</lastmod></sitemap>`,
    )
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</sitemapindex>`
  );
}

/**
 * One country's pages: the country page and every city page that is actually
 * published. A city whose page 404s must never appear here.
 */
export function countrySitemap(country: CountryCode, now: Date = new Date()): string {
  const today = todayUtc(now);
  const entries: Entry[] = [
    { path: `/${country}/`, lastmod: today, changefreq: "hourly" },
    ...locationsIn(country)
      .filter((l) => l.status === "live")
      .map((l) => ({
        path: `/${l.country}/${l.slug}/`,
        lastmod: today,
        changefreq: "hourly",
      })),
  ];
  return urlset(entries);
}

export function pagesSitemap(now: Date = new Date()): string {
  return urlset([
    { path: "/", lastmod: todayUtc(now), changefreq: "hourly" },
    ...STATIC_PATHS.map((path) => ({
      path,
      lastmod: STATIC_PAGES_UPDATED,
      changefreq: "monthly",
    })),
  ]);
}
