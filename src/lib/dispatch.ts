/**
 * Ask GitHub Actions to run the EPA/CAMS fetch, when GitHub has forgotten to.
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
 * How stale a source must be before we intervene, comfortably past its own
 * schedule so a merely late run is left alone.
 */
export const STALE_LIMITS_MS: Record<string, number> = {
  epa: 3 * 60 * 60 * 1000,
  cams: 9 * 60 * 60 * 1000,
};

/**
 * Minimum gap between requests. Without it a fetch that fails for its own
 * reasons would be re-triggered every five minutes for as long as it kept
 * failing.
 */
export const DISPATCH_COOLDOWN_MS = 45 * 60 * 1000;

export interface DispatchDecision {
  readonly dispatch: boolean;
  readonly reason: string;
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

  return stale.length > 0
    ? { dispatch: true, reason: `stale: ${stale.join(", ")}` }
    : { dispatch: false, reason: "all sources current" };
}

/**
 * Fire the workflow. Returns true when GitHub accepted it (HTTP 204).
 *
 * Failure is reported, never thrown: an unavailable GitHub must not stop the
 * ARPANSA fetch that shares this cron.
 */
export async function requestFetch(token: string): Promise<boolean> {
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
      body: JSON.stringify({ ref: "main" }),
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
