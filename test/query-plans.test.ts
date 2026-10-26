import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

/**
 * No page query may scan a table.
 *
 * This is a cost test, not a speed test. D1's free plan allows a fixed number of
 * row *reads* a day, and a read is a row examined, not a row returned. The
 * readings table is WITHOUT ROWID, so its primary key
 * (location_id, source, kind, valid_at) is the table -- and every page query
 * filters on location_id and a range of valid_at while saying nothing about
 * source or kind, which sit between them. SQLite seeked to the location and then
 * read its entire history, 400 days of it. One home-page render covered all 63
 * cities. The allowance went in an afternoon and the whole site answered 500
 * until midnight UTC.
 *
 * So the rule is enforced here rather than remembered: the SQL is read out of
 * store.ts itself -- not copied, so a new query is covered the day it is written
 * -- and planned by real SQLite against the real schema.sql. "SCAN" in a plan
 * fails the build. CI runs this, so the deploy fails before the bill does.
 */

const STORE = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");
const SCHEMA = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");

/**
 * Every SQL statement in the store, taken from its template literals.
 *
 * Reading the source rather than listing the queries is the point: a copy here
 * would drift from the code, which is exactly how the site ended up with an
 * index nothing could use.
 */
function queriesInStore(): { sql: string; line: number }[] {
  const out: { sql: string; line: number }[] = [];
  for (const m of STORE.matchAll(/`([^`]*?\b(?:SELECT|DELETE)\b[^`]*?)`/g)) {
    const sql = m[1]!;
    if (!/^\s*(SELECT|DELETE)/i.test(sql)) continue; // e.g. an INSERT ... SELECT
    out.push({ sql, line: STORE.slice(0, m.index).split("\n").length });
  }
  return out;
}

/** The interpolated IN list, which is built from the number of locations. */
const bindable = (sql: string) => sql.replace(/\$\{placeholders\}/g, "?3, ?4, ?5");

function plan(db: DatabaseSync, sql: string): string[] {
  return db
    .prepare(`EXPLAIN QUERY PLAN ${bindable(sql)}`)
    .all()
    .map((row) => String((row as { detail: string }).detail));
}

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  return db;
}

/**
 * The tables where a scan actually costs something.
 *
 * These are the two that grow with time: a row per place per instant, kept for
 * 400 days. `source_health` holds one row per source and `monthly_normals`
 * twelve per city, so reading either whole is both cheap and the point -- an
 * index would never be used and would only cost a write.
 */
const GROWING = ["readings", "daily"];

/**
 * The one statement allowed to scan a growing table.
 *
 * Retention runs once a day from the scheduled handler and has to find rows by
 * valid_at alone across every location. An index for it would be paid for on
 * every insert, all day, to save one scan a day -- the wrong trade. It is named
 * here so the exemption is a decision and not an oversight.
 */
const MAY_SCAN = [/^\s*DELETE FROM readings WHERE valid_at/i];

describe("no page query scans a table", () => {
  const db = freshDb();
  const queries = queriesInStore();

  it("finds the store's queries at all", () => {
    // A regex that silently matched nothing would make every test below pass.
    expect(queries.length).toBeGreaterThanOrEqual(4);
    expect(queries.some((q) => /FROM readings/i.test(q.sql))).toBe(true);
  });

  for (const { sql, line } of queriesInStore()) {
    const exempt = MAY_SCAN.some((rx) => rx.test(sql));
    const name = sql.replace(/\s+/g, " ").trim().slice(0, 60);

    it(`${exempt ? "[retention, may scan] " : ""}store.ts:${line} ${name}`, () => {
      const steps = plan(db, sql);
      const scans = steps.filter((s) =>
        GROWING.some((t) => new RegExp(`^SCAN ${t}\\b`).test(s)),
      );
      if (exempt) {
        expect(steps.length).toBeGreaterThan(0);
        return;
      }
      expect(scans, `plan was:\n  ${steps.join("\n  ")}`).toEqual([]);

      // The assertion that actually catches the bug this file exists for.
      // SQLite called the broken plan a SEARCH, not a SCAN:
      //
      //   SEARCH readings USING PRIMARY KEY (location_id=?)
      //
      // It seeked to the city and then read every row that city had ever had,
      // because valid_at sits behind source and kind in the key and the range
      // could not be applied. A rule that only forbids SCAN passes that
      // happily -- it was a seek, and it read 400 days. So where the SQL bounds
      // a column, the plan has to show the index bounding it too.
      if (/\bvalid_at\s*[<>]=?\s*\?/.test(sql) && /FROM readings/i.test(sql)) {
        expect(
          steps.join(" "),
          `the valid_at range never reaches the index, so this reads every row ` +
            `for each location it seeks. Plan was:\n  ${steps.join("\n  ")}`,
        ).toMatch(/valid_at[<>]/);
      }
    });
  }
});

describe("the indexes the page queries depend on", () => {
  it("covers the window query, bounded on kind AND on time", () => {
    const steps = plan(
      freshDb(),
      `SELECT location_id, source, kind, valid_at, uvi, issued_at FROM readings
       WHERE location_id IN (?3, ?4) AND kind = 'forecast'
         AND valid_at >= ?1 AND valid_at <= ?2`,
    );
    // COVERING means it answers from the index and never looks the row up.
    expect(steps.join(" ")).toContain("COVERING INDEX readings_window");
    // And all three predicates have to reach the index. This assertion was
    // first written against a query with no kind filter, and it passed while
    // describing the broken plan: SQLite reported
    // "COVERING INDEX readings_window (location_id=?)" -- covering, indexed,
    // and still reading every row the city had. Asserting the index by name
    // proves nothing about how much of it is read.
    expect(steps.join(" ")).toMatch(/location_id=\? AND kind=\? AND valid_at[<>]/);
  });

  it("will not bound the range if a query forgets to name its kinds", () => {
    // Why every window query names its kinds, kept as a live demonstration
    // rather than a comment: drop the kind filter and the time range stops
    // reaching the index, because kind sits in front of valid_at.
    const steps = plan(
      freshDb(),
      `SELECT location_id, uvi FROM readings
       WHERE location_id IN (?3, ?4) AND valid_at >= ?1 AND valid_at <= ?2`,
    );
    expect(steps.join(" ")).not.toMatch(/valid_at[<>]/);
  });

  it("answers the latest-measured query from its own index", () => {
    const steps = plan(
      freshDb(),
      `SELECT location_id, MAX(valid_at) FROM readings WHERE kind = 'measured' GROUP BY location_id`,
    );
    expect(steps.join(" ")).toContain("readings_measured");
    expect(steps.filter((s) => /^SCAN readings\b/.test(s))).toEqual([]);
  });

  it("keeps no index that no query can use", () => {
    // readings_recent (location_id, kind, valid_at) was dead: nothing filters on
    // kind together with a location, so it was only ever a write cost.
    expect(SCHEMA).not.toMatch(/CREATE INDEX[^;]*readings_recent/i);
  });
});
