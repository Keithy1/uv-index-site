/**
 * Facts about the site itself that more than one page needs to state.
 *
 * Kept in one place because several are legal or factual claims — who runs the
 * site, how to reach them, how accurate the forecast is — and the failure mode
 * for those is two pages quietly disagreeing.
 */

/**
 * Contact address for the About page and the privacy notice.
 *
 * Live since 25 October 2026: Cloudflare Email Routing forwards it to a
 * verified inbox, and a test was confirmed delivered in the routing activity
 * log. Kept non-null only while that is true — an address nobody reads is
 * worse than none, and AdSense reviewers check that contact details work.
 *
 * Note for testing: mail sent FROM the destination inbox to this address
 * forwards straight back to it, and Gmail dedupes a message it sent to
 * itself. Use a different account, or read Cloudflare's activity log, rather
 * than concluding the forward is broken.
 */
export const CONTACT_EMAIL: string | null = "contact@uvatlas.com";

/** Who is responsible for the site. Shown on About and in the terms. */
export const PUBLISHER = "Keith Chester";

/** The country the publisher operates from, which the privacy notice needs. */
export const PUBLISHER_COUNTRY = "the United Kingdom";

/**
 * Measured forecast accuracy, from the cams-validate workflow on 25 October
 * 2026: 13 ARPANSA stations, two seasons of 2025, 3,516 paired daylight hours.
 *
 * On the methods page because a site that publishes a forecast should publish
 * how wrong it usually is. These are the real figures, not rounded for
 * flattery — see docs/architecture.md for the full table.
 */
export const FORECAST_ACCURACY = {
  stations: 13,
  hours: 3516,
  meanAbsoluteError: 1.2,
  bias: 0.39,
  withinOne: 57,
  period: "October 2025 and January 2025",
} as const;

/** How often each source is refreshed, for the methods page. */
export const REFRESH = {
  arpansa: "every 5 minutes",
  epa: "every hour",
  cams: "twice a day",
} as const;
