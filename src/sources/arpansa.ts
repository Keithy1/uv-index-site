/**
 * ARPANSA real-time UV feed — Australia's measured readings.
 *
 * Feed: https://uvdata.arpansa.gov.au/xml/uvvalues.xml (~4.4 KB, updated about
 * every minute). Shape, confirmed against the live feed:
 *
 *   <stations>
 *     <location id="Adelaide">
 *       <name>adl</name><index>0.0</index>
 *       <time>10:18 PM</time><date>23/10/2026</date>
 *       <utcdatetime>2026/10/23 12:48</utcdatetime><status>ok</status>
 *     </location>
 *     ...
 *
 * Licence obligations (see docs/licences.md): display readings unmodified,
 * credit "UV observations courtesy of ARPANSA" wherever a reading appears, and
 * obtain written authorisation before running advertising alongside them.
 */
import { XMLParser } from "fast-xml-parser";

import { locationByArpansaCode } from "../lib/locations";
import type { Reading, SourceResult } from "../lib/records";
import { toIsoUtc } from "../lib/records";
import { isPlausibleUvi } from "../lib/uv";

export const SOURCE = "arpansa";

/**
 * The primary feed, then the website mirror. Both have been observed live; the
 * mirror exists because the primary host has had short outages.
 */
export const FEED_URLS = [
  "https://uvdata.arpansa.gov.au/xml/uvvalues.xml",
  "https://www.arpansa.gov.au/uvindex/realtime/xml/uvvalues.xml",
] as const;

/**
 * ARPANSA 403s a bare fetch, so a browser-like User-Agent is required. It also
 * identifies us, which is what ARPANSA's developer notes ask for.
 */
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; uvatlas/1.0; +https://uvatlas.com/methods/)",
  Accept: "application/xml, text/xml",
} as const;

const FETCH_TIMEOUT_MS = 10_000;

/** Fetch the feed, falling back to the mirror. Throws only if every URL fails. */
export async function fetchFeed(urls: readonly string[] = FEED_URLS): Promise<string> {
  const failures: string[] = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        failures.push(`${url}: HTTP ${response.status}`);
        continue;
      }
      return await response.text();
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`ARPANSA feed unavailable — ${failures.join("; ")}`);
}

/**
 * Parse ARPANSA's `<utcdatetime>` ("2026/10/23 12:48") into an ISO UTC string.
 *
 * Done by hand rather than with `new Date(...)`: JavaScript reads
 * "2026/10/23 12:48" as *local* time, which would shift every reading by the
 * server's offset and silently corrupt the whole feed.
 */
export function parseUtcDateTime(raw: string): string | null {
  const match = /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const ms = Date.UTC(+year!, +month! - 1, +day!, +hour!, +minute!);
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  // Reject impossible dates that Date.UTC would otherwise roll over
  // (e.g. "2026/02/31" becoming 3 March).
  if (date.getUTCMonth() !== +month! - 1 || date.getUTCDate() !== +day!) return null;
  return toIsoUtc(date);
}

interface RawLocation {
  name?: string | number;
  index?: string | number;
  utcdatetime?: string | number;
  status?: string;
}

const parser = new XMLParser({
  // Station codes like "new" and indexes like "0.0" must stay strings until we
  // convert them ourselves; the parser's own coercion would turn "new" into a
  // keyword-ish value and drop the trailing zero from "10.0".
  parseTagValue: false,
  trimValues: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

/**
 * Convert the feed into readings, dropping anything that fails a check.
 *
 * A row is dropped — never guessed at — when the station is unpublished
 * (Antarctic), the index is not a plausible UV value, or the timestamp is
 * malformed. Keeping the reasons lets /api/health show that a format change
 * happened rather than quietly serving fewer cities.
 *
 * A station that flags itself as running late is kept and noted, not dropped:
 * see the <status> handling below for why.
 */
export function parseFeed(xml: string, fetchedAt: Date): SourceResult {
  // The live feed is served with a UTF-8 BOM, which is not valid XML content.
  const clean = xml.replace(/^\uFEFF/, "");
  const fetched = toIsoUtc(fetchedAt);

  const readings: Reading[] = [];
  const rejected: string[] = [];
  const notes: string[] = [];

  let locations: RawLocation[];
  try {
    const doc = parser.parse(clean) as { stations?: { location?: RawLocation | RawLocation[] } };
    const raw = doc.stations?.location;
    if (!raw) throw new Error("no <stations><location> elements");
    locations = Array.isArray(raw) ? raw : [raw];
  } catch (error) {
    throw new Error(
      `ARPANSA feed did not parse as the expected XML: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  for (const row of locations) {
    const code = String(row.name ?? "").trim().toLowerCase();
    if (!code) {
      rejected.push("row with no <name> station code");
      continue;
    }

    const location = locationByArpansaCode(code);
    if (!location) {
      // Expected for the three Antarctic stations; noisy but harmless otherwise.
      rejected.push(`${code}: station not published`);
      continue;
    }

    // ARPANSA's <status> is not a pass/fail flag. Besides "ok" it carries
    // self-reported lateness, e.g. "174 Mins Slow", and on 25 Oct 2026 six of
    // the thirteen published stations — Sydney, Melbourne, Brisbane, Adelaide,
    // Canberra and Newcastle — said exactly that at the same time.
    //
    // Dropping those rows would cost the site its four largest cities on an
    // ordinary day. A late reading is still a real measurement, and its
    // <utcdatetime> states the instant it belongs to, so it is stored as-is and
    // the staleness rule in lib/store.ts decides whether it may be shown as the
    // reading *now*. Only a missing status means the feed itself is malformed.
    const status = String(row.status ?? "").trim();
    if (!status) {
      rejected.push(`${code}: no status field`);
      continue;
    }
    if (status.toLowerCase() !== "ok") {
      notes.push(`${code}: station reports "${status}"`);
    }

    // Number("") is 0 in JavaScript, and 0 is a legitimate night-time reading,
    // so an empty <index> would otherwise be published as a real 0.0 and be
    // indistinguishable from darkness. Require digits before converting.
    const rawIndex = String(row.index ?? "").trim();
    const uvi = /^-?\d+(\.\d+)?$/.test(rawIndex) ? Number(rawIndex) : Number.NaN;
    if (!isPlausibleUvi(uvi)) {
      rejected.push(`${code}: index "${rawIndex}" is not a UV value in 0..20`);
      continue;
    }

    const validAt = parseUtcDateTime(String(row.utcdatetime ?? ""));
    if (!validAt) {
      rejected.push(`${code}: unreadable utcdatetime "${row.utcdatetime}"`);
      continue;
    }

    readings.push({
      locationId: location.id,
      source: SOURCE,
      kind: "measured",
      validAt,
      uvi,
      fetchedAt: fetched,
    });
  }

  return { source: SOURCE, readings, rejected, notes };
}

/** Fetch and parse in one call. Used by the scheduled handler. */
export async function run(): Promise<SourceResult> {
  const fetchedAt = new Date();
  return parseFeed(await fetchFeed(), fetchedAt);
}
