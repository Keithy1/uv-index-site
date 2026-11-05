// Rebuild the local D1 (the one `npm run dev` reads) from what is in git.
//
// The local copy is disposable: it is for previewing pages on this machine and
// holds nothing that is not in schema.sql and dev-seed.sql. It used to be
// created once with schema.sql and then left, so it drifted -- a copy built in
// October lacked two columns production had, and every page that reads the
// database failed locally. Rebuilding is the fix, never editing it by hand.
//
//   npm run db:reset:local     (stop `npm run dev` first; it holds the files open)
//
// Afterwards `npx wrangler d1 migrations apply uvatlas --local` keeps it current
// as new migrations arrive, the same step the deploy runs against production.

import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

import { migrationNames } from "./schema.mjs";

const run = (cmd) => execFileSync(cmd, { stdio: "inherit", shell: true });

// Only the local D1 state; .wrangler holds nothing else this project needs kept.
try {
  rmSync(".wrangler/state/v3/d1", { recursive: true, force: true });
} catch (error) {
  console.error(`Could not remove the local database (${error.code}). Stop \`npm run dev\` and try again.`);
  process.exit(1);
}

// The finished shape in one step, then record every migration as applied, since
// schema.sql already includes them all (test/migrations.test.ts checks that).
run("npx wrangler d1 execute uvatlas --local --file=./schema.sql");
run("npx wrangler d1 migrations list uvatlas --local");
const values = migrationNames().map((n) => `('${n}')`).join(", ");
run(`npx wrangler d1 execute uvatlas --local --command "INSERT INTO d1_migrations (name) VALUES ${values}"`);
run("npx wrangler d1 execute uvatlas --local --file=./dev-seed.sql");
console.log("\nLocal database rebuilt from schema.sql and dev-seed.sql.");
