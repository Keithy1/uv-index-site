// Deploys the Worker and tags the commit that went live, so a rollback names a
// tag instead of guessing from commit times. Standards §7: every deploy is
// tagged deploy-YYYY-MM-DD-HHMM (UTC), and the tag carries the Worker version
// id that `wrangler rollback` takes.
//
// `npm run deploy` by hand and .github/workflows/deploy.yml both run this, so
// no deploy can skip the tag. It refuses to deploy anything that is not on
// origin/main: an uncommitted or unpushed build has no commit to tag, and
// could not be rebuilt from the archive later.

import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";

import { schemaDifferences, shapeOf, shapeOfSql } from "./schema.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

function refuse(why) {
  console.error(`deploy refused: ${why}`);
  process.exit(1);
}

// Untracked files are ignored: they are not bundled, and .claude/ is always there.
if (git("status", "--porcelain", "--untracked-files=no")) {
  refuse("uncommitted changes. Commit them and merge to main first.");
}
git("fetch", "--quiet", "origin", "main", "--tags");
const head = git("rev-parse", "HEAD");
if (head !== git("rev-parse", "origin/main")) {
  refuse(`HEAD ${head.slice(0, 7)} is not origin/main. Deploy main, after it is pushed.`);
}

// Run wrangler, streaming its output as usual and keeping a copy.
// shell: true so Windows finds npx.cmd.
function wrangler(...args) {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn("npx", ["wrangler", ...args], { shell: true, stdio: ["inherit", "pipe", "inherit"] });
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      output += chunk;
    });
    child.on("close", (code) => resolve({ code, output }));
  });
}

// The database before the code, so new code never meets an old schema.
//
// 1. Apply any migration in migrations/ that production has not had. wrangler
//    records each by name in d1_migrations, so a migration runs exactly once.
//    The code still live runs against the result until step 3 replaces it, so
//    a migration must suit both: add a column or table, never drop or rename
//    one that live code reads (do that in a later deploy).
// 2. Refuse unless production now matches schema.sql. This catches a column
//    added to schema.sql without a migration -- the gap that let
//    source_health.newest_run reach production by hand, with no file saying so.
const migrated = await wrangler("d1", "migrations", "apply", "uvatlas", "--remote");
if (migrated.code !== 0) refuse(`migrations failed (exit ${migrated.code}); the code was not deployed.`);

const master = execFileSync(
  "npx wrangler d1 execute uvatlas --remote --json --command \"SELECT type, name, sql FROM sqlite_master\"",
  { encoding: "utf8", shell: true, stdio: ["inherit", "pipe", "inherit"] },
);
const differences = schemaDifferences(
  shapeOfSql(readFileSync("schema.sql", "utf8")),
  shapeOf(JSON.parse(master)[0].results),
);
if (differences.length > 0) {
  refuse(
    "production's schema does not match schema.sql, so the code was not deployed:\n  " +
      differences.join("\n  ") +
      "\nEvery schema change needs a file in migrations/ as well as the edit to schema.sql.",
  );
}
console.log("Production schema matches schema.sql.\n");

// 3. The code.
const { code, output } = await wrangler("deploy");
if (code !== 0) refuse(`wrangler deploy exited ${code}; nothing tagged.`);

const version = output.match(/Current Version ID:\s*([0-9a-f-]{36})/i)?.[1] ?? "unknown";

// Minute resolution; two deploys in one minute get a suffix rather than a clash.
const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
let tag = `deploy-${stamp}`;
for (let n = 2; git("tag", "--list", tag); n++) tag = `deploy-${stamp}-${n}`;

git("tag", "-a", tag, "-m", `Deployed ${head.slice(0, 7)}\n\nWorker version: ${version}`, head);
git("push", "--quiet", "origin", tag);
console.log(`\nTagged ${tag} (Worker version ${version}).`);
console.log("To roll back: `npx wrangler rollback` restores the previous Worker at once; then `git revert` the bad commit on main, push, and run this again.");
