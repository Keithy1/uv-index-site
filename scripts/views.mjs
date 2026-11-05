// Page views counted by the /api/v pixel (src/lib/visit.ts), from Workers
// Analytics Engine.
//
//   npm run views          the last 7 days
//   npm run views -- 30    the last 30 (Analytics Engine keeps about 90)
//
// Needs CLOUDFLARE_ANALYTICS_TOKEN in .env: a custom token with one
// permission, Account Analytics: Read. It is read here and sent only to
// Cloudflare's API; it is never printed.
//
// Counts are SUM(_sample_interval), not count(): Analytics Engine samples
// when volume is high and records how many views each stored row stands for.
// Views from the workers.dev preview are left out; only uvatlas.com counts.

import { readFileSync } from "node:fs";

// Not a credential: the account id appears in every dashboard URL.
const DEFAULT_ACCOUNT = "d6244fd230ef5319219a46c9903a84e9";

function readEnv() {
  const env = {};
  let text = "";
  try {
    text = readFileSync(".env", "utf8");
  } catch {
    // No .env: fall through to the message below.
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = { ...readEnv(), ...process.env };
const token = env.CLOUDFLARE_ANALYTICS_TOKEN;
const account = env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_ACCOUNT;
if (!token) {
  console.error("No CLOUDFLARE_ANALYTICS_TOKEN in .env. See .env.example for how to make one.");
  process.exit(1);
}

const days = Math.min(Math.max(Number.parseInt(process.argv[2] ?? "7", 10) || 7, 1), 90);
const WHERE = `WHERE timestamp > NOW() - INTERVAL '${days}' DAY AND blob4 = 'uvatlas.com'`;

async function query(sql) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: `${sql} FORMAT JSON`,
  });
  const body = await res.text();
  if (!res.ok) {
    // Cloudflare's error text, which names the problem (bad token, no such
    // table before the first view lands) and never echoes the token.
    console.error(`Analytics Engine refused the query (HTTP ${res.status}): ${body.slice(0, 300)}`);
    process.exit(1);
  }
  return JSON.parse(body).data;
}

function table(title, rows, cols) {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log("  (none yet)");
    return;
  }
  const widths = cols.map(([key, label]) => Math.max(label.length, ...rows.map((r) => String(r[key]).length)));
  const line = (cells) => "  " + cells.map((c, i) => (i === 0 ? String(c).padEnd(widths[i]) : String(c).padStart(widths[i]))).join("   ");
  console.log(line(cols.map(([, label]) => label)));
  for (const r of rows) console.log(line(cols.map(([key]) => r[key])));
}

const [byDay, byPage, byCountry] = await Promise.all([
  query(
    `SELECT formatDateTime(toStartOfInterval(timestamp, INTERVAL '1' DAY), '%Y-%m-%d') AS day,
            SUM(_sample_interval) AS views,
            SUM(IF(blob3 = 'mobile', _sample_interval, 0)) AS phone
     FROM uvatlas_visits ${WHERE} GROUP BY day ORDER BY day`,
  ),
  query(
    `SELECT blob1 AS page, SUM(_sample_interval) AS views
     FROM uvatlas_visits ${WHERE} GROUP BY page ORDER BY views DESC LIMIT 15`,
  ),
  query(
    `SELECT blob2 AS country, SUM(_sample_interval) AS views
     FROM uvatlas_visits ${WHERE} GROUP BY country ORDER BY views DESC LIMIT 10`,
  ),
]);

const total = byDay.reduce((n, r) => n + Number(r.views), 0);
console.log(`uvatlas.com page views, last ${days} day${days === 1 ? "" : "s"} (UTC): ${total}`);
table("By day", byDay, [["day", "Day"], ["views", "Views"], ["phone", "On a phone"]]);
table("Top pages", byPage, [["page", "Page"], ["views", "Views"]]);
table("Countries", byCountry, [["country", "Country"], ["views", "Views"]]);
