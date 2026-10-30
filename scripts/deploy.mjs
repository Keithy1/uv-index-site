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

// Stream wrangler's output as usual, and keep a copy to read the version id from.
// shell: true so Windows finds npx.cmd.
let output = "";
const code = await new Promise((resolve) => {
  const child = spawn("npx", ["wrangler", "deploy"], { shell: true, stdio: ["inherit", "pipe", "inherit"] });
  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    output += chunk;
  });
  child.on("close", resolve);
});
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
