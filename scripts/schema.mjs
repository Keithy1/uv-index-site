// What the database should look like, compared with what it does look like.
//
// GitHub is the source of truth for the D1 schema: `schema.sql` describes the
// finished shape and `migrations/` holds every step that gets a live database
// there. Until November 2026 those steps were run by hand, wrangler recorded
// none of them, and one column (source_health.newest_run) reached production
// with no migration file at all. A local copy built from an older schema.sql
// then failed on every page. scripts/deploy.mjs uses this to refuse to ship
// code against a production database that does not match schema.sql.
//
// Shapes are compared, not SQL text: a column added by ALTER sits at the end
// of the table and keeps no comment, so production's CREATE TABLE never reads
// like schema.sql's even when the two hold exactly the same columns.

import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";

/** wrangler's own bookkeeping, and SQLite's and Cloudflare's internals. */
const IGNORED = /^(d1_migrations|sqlite_.*|_cf_.*)$/;

/**
 * Every table's columns (name, type, not-null, primary-key position) and every
 * index's definition, keyed "table name" / "index name".
 *
 * @param {{ type: string, name: string, sql: string | null }[]} rows sqlite_master rows
 * @returns {Map<string, string>}
 */
export function shapeOf(rows) {
  const db = new DatabaseSync(":memory:");
  const wanted = rows.filter((r) => r.sql && !IGNORED.test(r.name));
  // Tables first: an index cannot be created before its table.
  for (const r of wanted.filter((r) => r.type === "table")) db.exec(r.sql);
  for (const r of wanted.filter((r) => r.type !== "table")) db.exec(r.sql);
  return shapeOfDb(db);
}

/** @param {string} sql a schema script, such as schema.sql */
export function shapeOfSql(sql) {
  const db = new DatabaseSync(":memory:");
  db.exec(sql);
  return shapeOfDb(db);
}

function shapeOfDb(db) {
  const shape = new Map();
  const objects = db
    .prepare("SELECT type, name, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY name")
    .all();
  for (const o of objects) {
    if (IGNORED.test(o.name)) continue;
    if (o.type === "table") {
      const cols = db
        .prepare(`SELECT name, type, "notnull" AS nn, pk FROM pragma_table_info(?)`)
        .all(o.name)
        .map((c) => `${c.name} ${c.type}${c.nn ? " NOT NULL" : ""}${c.pk ? ` PK${c.pk}` : ""}`)
        .sort();
      shape.set(`table ${o.name}`, cols.join(", "));
    } else if (o.sql) {
      // Automatic indexes (PRIMARY KEY, UNIQUE) have no SQL and follow the table.
      shape.set(`index ${o.name}`, o.sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim());
    }
  }
  return shape;
}

/**
 * Plain-English differences, empty when the two match.
 *
 * @param {Map<string, string>} expected from schema.sql
 * @param {Map<string, string>} actual from the live database
 * @returns {string[]}
 */
export function schemaDifferences(expected, actual) {
  const out = [];
  for (const key of new Set([...expected.keys(), ...actual.keys()])) {
    const want = expected.get(key);
    const have = actual.get(key);
    if (want === have) continue;
    if (have === undefined) out.push(`${key}: in schema.sql, missing from the database`);
    else if (want === undefined) out.push(`${key}: in the database, not in schema.sql`);
    else out.push(`${key}:\n    schema.sql: ${want}\n    database:   ${have}`);
  }
  return out.sort();
}

/** Migration file names in the order wrangler applies them. */
export function migrationNames(dir = "migrations") {
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
}
