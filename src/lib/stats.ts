/**
 * The private views page: what the /api/v pixel counted (lib/visit.ts), read
 * back from Workers Analytics Engine.
 *
 * Analytics Engine is queried over Cloudflare's SQL API, with a token that can
 * only read account analytics, held as a Worker secret. Three queries a view
 * of the page, against 10,000 a day on Workers Free.
 */

/** The day the pixel shipped. Earlier days were not counted, not empty. */
export const COUNTING_SINCE = "2026-11-05";

const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];

/** Only the offered ranges, because the number is written into SQL. */
export function rangeDays(param: string | undefined): Range {
  return RANGES.find((r) => String(r) === param) ?? 7;
}

export function statsQueries(days: Range) {
  // Views from the workers.dev preview are someone checking a deploy.
  const where = `WHERE timestamp > NOW() - INTERVAL '${days}' DAY AND blob4 = 'uvatlas.com'`;
  // SUM(_sample_interval), not count(): at volume Analytics Engine samples,
  // and each stored row then stands for several views.
  return {
    byDay: `SELECT formatDateTime(toStartOfInterval(timestamp, INTERVAL '1' DAY), '%Y-%m-%d') AS day,
      SUM(_sample_interval) AS views, SUM(IF(blob3 = 'mobile', _sample_interval, 0)) AS phone
      FROM uvatlas_visits ${where} GROUP BY day ORDER BY day`,
    byPage: `SELECT blob1 AS label, SUM(_sample_interval) AS views
      FROM uvatlas_visits ${where} GROUP BY label ORDER BY views DESC LIMIT 15`,
    byCountry: `SELECT blob2 AS label, SUM(_sample_interval) AS views
      FROM uvatlas_visits ${where} GROUP BY label ORDER BY views DESC LIMIT 10`,
  };
}

export interface Day {
  readonly day: string;
  /** null before counting began: unknown, which is not the same as none. */
  readonly views: number | null;
  readonly phone: number;
  /** Today, still filling up. */
  readonly partial: boolean;
}

export interface Tally {
  readonly label: string;
  readonly views: number;
}

interface DayRow {
  day: string;
  views: string | number;
  phone: string | number;
}

/**
 * One row per UTC day in the range, oldest first. Analytics Engine returns
 * only days that had views; a missing day is a real zero once counting began.
 */
export function fillDays(rows: readonly DayRow[], days: number, now: Date): Day[] {
  const found = new Map(rows.map((r) => [r.day, r]));
  const today = now.toISOString().slice(0, 10);
  const out: Day[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    const row = found.get(day);
    out.push({
      day,
      views: day < COUNTING_SINCE ? null : Number(row?.views ?? 0),
      phone: Number(row?.phone ?? 0),
      partial: day === today,
    });
  }
  return out;
}

export function headline(total: number, phone: number, days: number): string {
  if (total === 0) return `No views in the last ${days} days.`;
  const share = Math.round((phone / total) * 100);
  return `${total} view${total === 1 ? "" : "s"} in the last ${days} days, ${share}% on a phone.`;
}

/**
 * Whether the key in the URL is the configured one. Both are hashed first, so
 * the comparison takes the same time whatever the input and leaks no length.
 * No key configured means the page does not exist.
 */
export async function keyMatches(given: string, configured: string | undefined): Promise<boolean> {
  if (!configured) return false;
  const hash = async (s: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([hash(given), hash(configured)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export interface StatsData {
  readonly days: Day[];
  readonly pages: Tally[];
  readonly countries: Tally[];
  readonly error: string | null;
}

/** Runs the three queries. Any failure comes back as `error`, never as zeros. */
export async function readStats(
  account: string,
  token: string,
  range: Range,
  now: Date,
): Promise<StatsData> {
  const q = statsQueries(range);
  const run = async <T>(sql: string): Promise<T[]> => {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: `${sql} FORMAT JSON`,
    });
    if (!res.ok) throw new Error(`Analytics Engine answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return ((await res.json()) as { data: T[] }).data;
  };
  try {
    const [byDay, byPage, byCountry] = await Promise.all([
      run<DayRow>(q.byDay),
      run<{ label: string; views: string }>(q.byPage),
      run<{ label: string; views: string }>(q.byCountry),
    ]);
    const tally = (rows: { label: string; views: string }[]) =>
      rows.map((r) => ({ label: r.label, views: Number(r.views) }));
    return { days: fillDays(byDay, range, now), pages: tally(byPage), countries: tally(byCountry), error: null };
  } catch (error) {
    return { days: [], pages: [], countries: [], error: error instanceof Error ? error.message : String(error) };
  }
}
