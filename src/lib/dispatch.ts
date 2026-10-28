/**
 * Ask GitHub Actions to run the EPA/CAMS fetch: on the clock, and when a
 * source has gone stale.
 *
 * Since 28 October 2026 this is the only clock. The workflow has no schedule
 * of its own: GitHub started 15 of about 72 hourly runs from 25 to 28 October,
 * while every run asked for through the API ran. GitHub is the runner only.
 *
 * The division of labour is forced: CAMS needs a GRIB reader and EPA needs a
 * hundred subrequests, so neither can run in a Worker. But GitHub's scheduler
 * is best-effort, and this project has now measured it twice -- 2.7% of a
 * five-minute schedule in October, and then sixteen hours with no CAMS run at
 * all, which emptied tomorrow's column for ten of thirteen Australian cities.
 *
 * Cloudflare's cron is reliable: the ARPANSA fetch has not missed. So the
 * reliable scheduler watches the clock and pokes the capable runner. The
 * Worker still does not fetch the data -- it only asks.
 *
 * Does nothing without GITHUB_DISPATCH_TOKEN, so the site runs unchanged until
 * the token exists.
 *
 * Policy and HTTP only. The D1 write that records an attempt lives in
 * store.ts: importing it here pulled the Worker runtime types into the Node
 * test run, which is the leak the split tsconfig exists to catch.
 */
/** Pseudo-source in `source_health` recording when we last asked. */
export const DISPATCH_SOURCE = "actions-dispatch";

const REPO = "Keithy1/uv-index-site";
const WORKFLOW = "fetch-epa-cams.yml";

/**
 * How stale EPA must be before we intervene: past its hourly schedule, so a
 * merely late run is left alone, but under the 3 h at which /api/health calls
 * it unhealthy. On 28 October 2026 the two were equal, GitHub skipped three
 * hourly runs, and the monitor alerted for the ten minutes the rescue run took.
 */
export const STALE_LIMITS_MS: Record<string, number> = {
  epa: 2 * 60 * 60 * 1000,
};

/**
 * When today's CAMS 00Z run can be relied on in the ADS, in minutes after
 * midnight UTC. Mirrored in fetch/cams.py as PUBLISHED_UTC.
 */
export const CAMS_PUBLISHED_UTC_MINUTES = 10 * 60 + 30;

/** Grace after publication before the Worker asks for a CAMS run. */
export const CAMS_DISPATCH_GRACE_MS = 90 * 60 * 1000;

/**
 * Whether CAMS is missing a run it should hold by now.
 *
 * Judged against the publication clock, not the age of the last fetch. The
 * fetcher only records success when it got the newest run there should be
 * (fetch/cams.py, check_newest_run), so a last_ok_at before the latest
 * publication time, `graceMs` ago, means that run never arrived. Measuring
 * the age of the last fetch instead is how a 07:40 UTC fetch -- before the
 * run existed -- kept health green from 26 to 28 October 2026 while every
 * forecast was a day older than it should have been.
 */
export function camsStale(lastOkAt: string | null, now: Date, graceMs: number): boolean {
  if (!lastOkAt) return true;
  const cutoff = new Date(now.getTime() - graceMs);
  const due = Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth(), cutoff.getUTCDate()) +
    CAMS_PUBLISHED_UTC_MINUTES * 60 * 1000;
  // Before today's publication, yesterday's is the one we should hold.
  const latest = due <= cutoff.getTime() ? due : due - 24 * 60 * 60 * 1000;
  return Date.parse(lastOkAt) < latest;
}

/**
 * Minimum gap between requests. Without it a fetch that fails for its own
 * reasons would be re-triggered every five minutes for as long as it kept
 * failing.
 */
export const DISPATCH_COOLDOWN_MS = 45 * 60 * 1000;

/** Which fetch to ask for; the workflow's `source` input. */
export type FetchSource = "epa" | "cams" | "all";

export interface DispatchDecision {
  readonly dispatch: boolean;
  readonly reason: string;
  readonly source?: FetchSource;
}

/**
 * The fetch timetable, as five-minute slots of the Worker's cron (which fires
 * at :00, :05, ...). Each slot holds exactly one tick, so each fetch is asked
 * for once.
 *
 * EPA publishes hourly: :20, off the top of the hour.
 * CAMS: 10:40 UTC, after today's 00Z run reaches the ADS (ECMWF delivers it at
 * 10:00; see CAMS_PUBLISHED_UTC_MINUTES), and 13:40 as a retry. A retry that
 * finds the run already held writes almost nothing.
 */
export function scheduledFetch(now: Date): FetchSource | null {
  const hour = now.getUTCHours();
  const slot = Math.floor(now.getUTCMinutes() / 5) * 5;
  if ((hour === 10 || hour === 13) && slot === 40) return "cams";
  if (slot === 20) return "epa";
  return null;
}

/**
 * Whether to ask for a run, given current health. Pure, so the policy can be
 * tested without a network or a clock.
 */
export function shouldDispatch(
  health: readonly { source: string; last_ok_at: string | null }[],
  now: Date,
): DispatchDecision {
  const at = (source: string) => health.find((h) => h.source === source)?.last_ok_at ?? null;

  // The timetable is not subject to the cooldown: a rescue run at 10:30 must
  // not cost the 10:40 CAMS fetch.
  const due = scheduledFetch(now);
  if (due) return { dispatch: true, reason: `scheduled: ${due}`, source: due };

  const lastAsk = at(DISPATCH_SOURCE);
  if (lastAsk && now.getTime() - Date.parse(lastAsk) < DISPATCH_COOLDOWN_MS) {
    return { dispatch: false, reason: "asked recently" };
  }

  const stale: string[] = [];
  for (const [source, limit] of Object.entries(STALE_LIMITS_MS)) {
    const ok = at(source);
    // A source that has never run is stale, not absent -- the same hole that
    // once let /api/health report "healthy" while ARPANSA had never fetched.
    if (!ok || now.getTime() - Date.parse(ok) > limit) stale.push(source);
  }
  if (camsStale(at("cams"), now, CAMS_DISPATCH_GRACE_MS)) stale.push("cams");

  return stale.length > 0
    ? {
        dispatch: true,
        reason: `stale: ${stale.join(", ")}`,
        source: stale.length === 1 ? (stale[0] as FetchSource) : "all",
      }
    : { dispatch: false, reason: "all sources current" };
}

/**
 * Fire the workflow. Returns true when GitHub accepted it (HTTP 204).
 *
 * Failure is reported, never thrown: an unavailable GitHub must not stop the
 * ARPANSA fetch that shares this cron.
 */
export async function requestFetch(token: string, source: FetchSource = "all"): Promise<boolean> {
  const response = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "uvatlas-worker",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main", inputs: { source } }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    // Deliberately not logging the body: a 401 from GitHub can echo request
    // details, and this runs with a token in scope.
    console.error(`actions dispatch refused: HTTP ${response.status}`);
  }
  return response.ok;
}
