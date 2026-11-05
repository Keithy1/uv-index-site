import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { migrationNames, schemaDifferences, shapeOf, shapeOfSql } from "../scripts/schema.mjs";

/**
 * GitHub is the source of truth for the database: schema.sql is the finished
 * shape, migrations/ the steps that get a live database there, and the deploy
 * applies the steps and then refuses to ship unless production matches
 * schema.sql. These tests keep the two files telling the same story.
 */

const SCHEMA = readFileSync("schema.sql", "utf8");
const MIGRATIONS = migrationNames();

function masterRows(db: DatabaseSync) {
  return db.prepare("SELECT type, name, sql FROM sqlite_master").all() as {
    type: string;
    name: string;
    sql: string | null;
  }[];
}

describe("migrations/", () => {
  it("are numbered 0001, 0002, ... with no gap or repeat", () => {
    // wrangler applies in name order and records by name: a renumbered or
    // renamed file is a new migration to it, and would run a second time.
    expect(MIGRATIONS.map((n) => n.slice(0, 4))).toEqual(
      MIGRATIONS.map((_, i) => String(i + 1).padStart(4, "0")),
    );
  });

  it("all end up in schema.sql: nothing a migration adds is missing, nothing it drops remains", () => {
    const shape = shapeOfSql(SCHEMA);
    const columns = (table: string) => shape.get(`table ${table}`) ?? "";
    // The net effect, in order: 0001 creates an index that 0003 drops.
    const present = new Map<string, boolean>();
    const added: [string, string][] = [];
    for (const name of MIGRATIONS) {
      const sql = readFileSync(`migrations/${name}`, "utf8").replace(/--[^\n]*/g, "");
      // Statement by statement: 0002 drops an index and recreates it.
      for (const stmt of sql.split(";")) {
        const create = stmt.match(/CREATE\s+(TABLE|INDEX)\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i);
        if (create) present.set(`${create[1]!.toLowerCase()} ${create[2]}`, true);
        const drop = stmt.match(/DROP\s+(TABLE|INDEX)\s+(?:IF\s+EXISTS\s+)?(\w+)/i);
        if (drop) present.set(`${drop[1]!.toLowerCase()} ${drop[2]}`, false);
        const alter = stmt.match(/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/i);
        if (alter) added.push([alter[1]!, alter[2]!]);
      }
    }
    for (const [key, exists] of present) expect(shape.has(key), key).toBe(exists);
    for (const [table, column] of added) {
      expect(columns(table), `${table}.${column}`).toMatch(new RegExp(`(^|, )${column} `));
    }
  });
});

describe("schemaDifferences", () => {
  it("finds nothing when a database matches schema.sql", () => {
    expect(schemaDifferences(shapeOfSql(SCHEMA), shapeOfSql(SCHEMA))).toEqual([]);
  });

  it("treats a column added later by ALTER the same as one in CREATE TABLE", () => {
    // Production's city_now has its columns in the order they were added, and
    // none of schema.sql's comments.
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (a TEXT PRIMARY KEY, b REAL) WITHOUT ROWID");
    db.exec("ALTER TABLE t ADD COLUMN c TEXT");
    const live = shapeOf(masterRows(db));
    const wanted = shapeOfSql("CREATE TABLE t (\n  a TEXT PRIMARY KEY, -- key\n  c TEXT,\n  b REAL\n) WITHOUT ROWID;");
    expect(schemaDifferences(wanted, live)).toEqual([]);
  });

  it("names a column the database is missing, the failure that broke the local copy", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(SCHEMA);
    db.exec("ALTER TABLE city_now DROP COLUMN measured_day_json");
    const diffs = schemaDifferences(shapeOfSql(SCHEMA), shapeOf(masterRows(db)));
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain("table city_now");
    expect(diffs[0]).toContain("measured_day_json");
  });

  it("names an index or table on only one side", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(SCHEMA);
    db.exec("CREATE TABLE extra (x TEXT)");
    db.exec("DROP INDEX readings_window");
    expect(schemaDifferences(shapeOfSql(SCHEMA), shapeOf(masterRows(db)))).toEqual([
      "index readings_window: in schema.sql, missing from the database",
      "table extra: in the database, not in schema.sql",
    ]);
  });

  it("ignores wrangler's d1_migrations table", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(SCHEMA);
    db.exec("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE)");
    expect(schemaDifferences(shapeOfSql(SCHEMA), shapeOf(masterRows(db)))).toEqual([]);
  });
});
