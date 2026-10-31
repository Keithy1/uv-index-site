import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import type { Reading } from "../src/lib/records";
import {
  cityData,
  countryData,
  forecastsStale,
  type HealthRow,
  noteMeasured,
  pruneReadings,
  rebuildForecasts,
  RETENTION_DAYS,
  saveReadings,
  SERIES_BEFORE_MS,
  STALE_AFTER_MS,
} from "../src/lib/store";

/**
 * The summary table, end to end, against real SQLite and the real schema.
 *
 * The page read path was rebuilt so it never computes from raw readings, and
 * the risk in that is not the idea but the SQL: an upsert with a WHERE clause,
 * a series that must survive a JSON round trip, a staleness rule that has to
 * come out the same as before. A mocked database would agree with whatever the
 * code expected. This runs the statements.
 */

const SCHEMA = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");

/** Just enough of D1's API over node:sqlite to run store.ts unchanged. */
function d1(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    all: async () => ({
      results: db.prepare(sql).all(...(args as never[])),
      meta: { rows_read: 0 },
    }),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    run: async () => {
      const r = db.prepare(sql).run(...(args as never[]));
      return { meta: { changes: Number(r.changes) } };
    },
    exec: () => db.prepare(sql).run(...(args as never[])),
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (stmts: { exec: () => unknown }[]) => stmts.map((s) => s.exec()),
    raw: db,
  } as unknown as D1Database;
}

const NOW = new Date("2026-10-27T03:00:00Z");
const iso = (offsetHours: number) =>
  new Date(NOW.getTime() + offsetHours * 3600_000).toISOString().slice(0, 19) + "Z";

const measured = (id: string, at: string, uvi: number): Reading => ({
  locationId: id,
  source: "arpansa",
  kind: "measured",
  validAt: at,
  uvi,
  fetchedAt: at,
});

const forecast = (id: string, source: string, at: string, uvi: number): Reading => ({
  locationId: id,
  source,
  kind: "forecast",
  validAt: at,
  uvi,
  issuedAt: iso(-6),
  fetchedAt: iso(-1),
});

const health = (source: string, lastOk: string | null): HealthRow => ({
  source,
  last_ok_at: lastOk,
  last_attempt_at: lastOk,
  last_error: null,
  records_last_run: 1,
});

describe("noteMeasured", () => {
  it("keeps the newest reading per city from a batch", async () => {
    const db = d1();
    await noteMeasured(db, [
      measured("au-per", iso(-0.2), 4.1),
      measured("au-per", iso(-0.1), 4.6),
      measured("au-syd", iso(-0.1), 7.0),
    ]);
    const rows = await countryData(db, ["au-per", "au-syd"], NOW);
    expect(rows.get("au-per")!.latest!.uvi).toBe(4.6);
    expect(rows.get("au-syd")!.latest!.uvi).toBe(7.0);
  });

  it("never lets a late report overwrite a newer one", async () => {
    // ARPANSA stations routinely report "174 Mins Slow". A late batch must not
    // roll the city back to an older level.
    const db = d1();
    await noteMeasured(db, [measured("au-per", iso(-0.1), 6.0)]);
    await noteMeasured(db, [measured("au-per", iso(-3), 2.0)]);
    expect((await countryData(db, ["au-per"], NOW)).get("au-per")!.latest!.uvi).toBe(6.0);
  });

  it("keeps a genuine zero, which is a real night-time reading", async () => {
    const db = d1();
    await noteMeasured(db, [measured("au-per", iso(-0.1), 0)]);
    const latest = (await countryData(db, ["au-per"], NOW)).get("au-per")!.latest;
    expect(latest).not.toBeNull();
    expect(latest!.uvi).toBe(0);
  });

  it("judges staleness at render, by the same rule as before", async () => {
    const db = d1();
    const old = new Date(NOW.getTime() - STALE_AFTER_MS - 60_000).toISOString().slice(0, 19) + "Z";
    await noteMeasured(db, [measured("au-per", old, 5)]);
    expect((await countryData(db, ["au-per"], NOW)).get("au-per")!.latest!.stale).toBe(true);
    expect((await countryData(db, ["au-per"], new Date(Date.parse(old) + 60_000))).get("au-per")!.latest!.stale).toBe(false);
  });

  it("ignores forecasts, which are not measurements", async () => {
    const db = d1();
    expect(await noteMeasured(db, [forecast("au-per", "cams", iso(0), 9)])).toBe(0);
  });
});

describe("rebuildForecasts", () => {
  it("stores each city's series and reads it back unchanged", async () => {
    const db = d1();
    await saveReadings(db, [
      forecast("us-miami-fl", "cams", iso(0), 3.8),
      forecast("us-miami-fl", "cams", iso(1), 5.1),
      forecast("us-miami-fl", "cams", iso(2), 6.5),
    ]);
    await rebuildForecasts(db, ["us-miami-fl"], NOW);
    const series = (await countryData(db, ["us-miami-fl"], NOW)).get("us-miami-fl")!.forecast;
    expect(series).toEqual([
      { validAt: iso(0), uvi: 3.8 },
      { validAt: iso(1), uvi: 5.1 },
      { validAt: iso(2), uvi: 6.5 },
    ]);
  });

  it("keeps one point per hour, the higher of two sources", async () => {
    // Two at one instant made the city chart's line drop vertically every
    // hour. The higher, so today's peak is unchanged and the chart agrees.
    const db = d1();
    await saveReadings(db, [
      forecast("us-miami-fl", "cams", iso(1), 5.1),
      forecast("us-miami-fl", "epa", iso(1), 7.0),
      forecast("us-miami-fl", "epa", iso(2), 4.0),
      forecast("us-miami-fl", "cams", iso(2), 4.6),
    ]);
    await rebuildForecasts(db, ["us-miami-fl"], NOW);
    expect((await countryData(db, ["us-miami-fl"], NOW)).get("us-miami-fl")!.forecast).toEqual([
      { validAt: iso(1), uvi: 7.0 },
      { validAt: iso(2), uvi: 4.6 },
    ]);
  });

  it("gives the city chart one point per hour too", async () => {
    // The sawtooth itself: El Paso, 26 October, EPA and CAMS at every hour.
    const db = d1();
    await saveReadings(db, [
      forecast("us-el-paso-tx", "cams", iso(0), 5.79),
      forecast("us-el-paso-tx", "epa", iso(0), 5),
      forecast("us-el-paso-tx", "cams", iso(1), 3.45),
      forecast("us-el-paso-tx", "epa", iso(1), 4),
    ]);
    const city = await cityData(db, "us-el-paso-tx", iso(-24), iso(24), NOW);
    expect(city.forecastToday.map((p) => [p.validAt, p.uvi])).toEqual([
      [iso(0), 5.79],
      [iso(1), 4],
    ]);
  });

  it("writes nothing when a reading arrives again unchanged", async () => {
    // 27 October 2026: re-saving values already held, every five minutes and
    // every hour, took the account past D1's 100,000 rows written a day.
    const db = d1();
    const raw = (db as unknown as { raw: DatabaseSync }).raw;
    const changes = () => Number(raw.prepare("SELECT total_changes() AS n").get()!.n);
    await saveReadings(db, [measured("au-per", iso(0), 4.6)]);
    const before = changes();
    await saveReadings(db, [{ ...measured("au-per", iso(0), 4.6), fetchedAt: iso(1) }]);
    expect(changes()).toBe(before);
    await saveReadings(db, [measured("au-per", iso(0), 4.7)]);
    expect(changes()).toBe(before + 1);
  });

  it("does not let a forecast rebuild disturb the measured reading", async () => {
    const db = d1();
    await noteMeasured(db, [measured("au-per", iso(-0.1), 4.6)]);
    await saveReadings(db, [forecast("au-per", "cams", iso(1), 8)]);
    await rebuildForecasts(db, ["au-per"], NOW);
    const row = (await countryData(db, ["au-per"], NOW)).get("au-per")!;
    expect(row.latest!.uvi).toBe(4.6);
    expect(row.forecast).toHaveLength(1);
  });

  it("leaves measurements and clear-sky out of the series", async () => {
    const db = d1();
    await saveReadings(db, [
      measured("au-per", iso(0), 4),
      // Written only by fetch/d1.py, so the TypeScript Kind rightly excludes it;
      // the row still lands in the same table and must stay out of the series.
      { ...forecast("au-per", "cams", iso(0), 9), kind: "forecast_clear" as Reading["kind"] },
      forecast("au-per", "cams", iso(0), 6),
    ]);
    await rebuildForecasts(db, ["au-per"], NOW);
    expect((await countryData(db, ["au-per"], NOW)).get("au-per")!.forecast).toEqual([
      { validAt: iso(0), uvi: 6 },
    ]);
  });

  it("reaches a day and more ahead, so a dropped run does not empty tomorrow", async () => {
    const db = d1();
    await saveReadings(db, [forecast("au-per", "cams", iso(72), 11)]);
    await rebuildForecasts(db, ["au-per"], NOW);
    expect((await countryData(db, ["au-per"], NOW)).get("au-per")!.forecast).toHaveLength(1);
  });
});

describe("forecastsStale", () => {
  const ids = ["au-per", "au-syd"];

  it("is stale before anything has been built, so a fresh database fills itself", async () => {
    expect(await forecastsStale(d1(), [health("cams", iso(-1))], ids.length)).toBe(true);
  });

  it("is current once every city is built after the newest forecast", async () => {
    const db = d1();
    await rebuildForecasts(db, ids, NOW);
    expect(await forecastsStale(db, [health("cams", iso(-1)), health("epa", iso(-0.5))], ids.length)).toBe(false);
  });

  it("goes stale when a forecast lands after the last build", async () => {
    const db = d1();
    await rebuildForecasts(db, ids, NOW);
    expect(await forecastsStale(db, [health("epa", iso(0.1))], ids.length)).toBe(true);
  });

  it("goes stale when a city is added that was never built", async () => {
    const db = d1();
    await rebuildForecasts(db, ids, NOW);
    expect(await forecastsStale(db, [health("cams", iso(-1))], ids.length + 1)).toBe(true);
  });

  it("ignores ARPANSA, whose arrival every five minutes is not a forecast", async () => {
    const db = d1();
    await rebuildForecasts(db, ids, NOW);
    expect(await forecastsStale(db, [health("arpansa", iso(1))], ids.length)).toBe(false);
  });
});

describe("countryData", () => {
  it("returns a row for every city asked for, data or not", async () => {
    const rows = await countryData(d1(), ["au-per", "us-miami-fl"], NOW);
    expect([...rows.keys()]).toEqual(["au-per", "us-miami-fl"]);
    expect(rows.get("au-per")).toEqual({ locationId: "au-per", latest: null, forecast: [], alerts: [], measuredDay: null });
  });
});

describe("retention", () => {
  /** Every valid_at still in the table, oldest first. */
  async function remaining(db: D1Database): Promise<string[]> {
    const { results } = await db
      .prepare("SELECT valid_at FROM readings ORDER BY valid_at")
      .all<{ valid_at: string }>();
    return results.map((r) => r.valid_at);
  }

  it("keeps a full day more than anything looks back", () => {
    // The forecast rebuild and a city's chart both reach 36 hours back. Three
    // days leaves a whole missed prune, or a day-late fetch, of margin. If
    // either window grows, this is the test that says retention must too.
    expect(RETENTION_DAYS * 86_400_000).toBeGreaterThanOrEqual(SERIES_BEFORE_MS + 86_400_000);
  });

  it("removes what is past retention and nothing the site still reads", async () => {
    const db = d1();
    await saveReadings(db, [
      measured("au-per", iso(-24 * RETENTION_DAYS - 1), 3), // past retention
      measured("au-per", iso(-36), 4), // the oldest anything reads
      measured("au-per", iso(-1), 5),
      forecast("au-per", "cams", iso(90), 11), // days ahead: never pruned
    ]);
    expect(await pruneReadings(db, NOW)).toBe(1);
    expect(await remaining(db)).toEqual([iso(-36), iso(-1), iso(90)]);
  });

  it("leaves the summaries alone, which pages read instead", async () => {
    const db = d1();
    await noteMeasured(db, [measured("au-per", iso(-24 * RETENTION_DAYS - 5), 2)]);
    await pruneReadings(db, NOW);
    expect((await countryData(db, ["au-per"], NOW)).get("au-per")!.latest).not.toBeNull();
  });
});

describe("EPA UV Alerts", () => {
  /** A daily row as fetch/d1.py writes it. */
  async function daily(db: D1Database, id: string, date: string, alert: 0 | 1, source = "epa") {
    await db
      .prepare(
        `INSERT INTO daily (location_id, local_date, source, peak_uvi, alert, fetched_at)
         VALUES (?1, ?2, ?3, 9, ?4, ?5)`,
      )
      .bind(id, date, source, alert, iso(0))
      .run();
  }

  it("carries the dates EPA flagged into the summary, and only those", async () => {
    const db = d1();
    await daily(db, "us-phoenix-az", "2026-10-27", 1);
    await daily(db, "us-phoenix-az", "2026-10-28", 0);
    await daily(db, "us-miami-fl", "2026-10-27", 0);
    await rebuildForecasts(db, ["us-phoenix-az", "us-miami-fl"], NOW);
    const rows = await countryData(db, ["us-phoenix-az", "us-miami-fl"], NOW);
    expect(rows.get("us-phoenix-az")!.alerts).toEqual(["2026-10-27"]);
    expect(rows.get("us-miami-fl")!.alerts).toEqual([]);
  });

  it("clears an alert EPA has withdrawn, at the next rebuild", async () => {
    const db = d1();
    await daily(db, "us-phoenix-az", "2026-10-27", 1);
    await rebuildForecasts(db, ["us-phoenix-az"], NOW);
    await db.prepare("UPDATE daily SET alert = 0").run();
    await rebuildForecasts(db, ["us-phoenix-az"], NOW);
    expect((await countryData(db, ["us-phoenix-az"], NOW)).get("us-phoenix-az")!.alerts).toEqual([]);
  });

  it("ignores alerts from anything but EPA", async () => {
    const db = d1();
    await daily(db, "us-phoenix-az", "2026-10-27", 1, "cams");
    await rebuildForecasts(db, ["us-phoenix-az"], NOW);
    expect((await countryData(db, ["us-phoenix-az"], NOW)).get("us-phoenix-az")!.alerts).toEqual([]);
  });
});

describe("the day of measurements in city_now", () => {
  it("keeps the reading nearest each hour and the day's highest", async () => {
    // Perth is UTC+8: 03:00Z is 11 am. Runs every five minutes, a batch each.
    const db = d1();
    for (const [at, uvi] of [
      ["2026-10-27T01:58:00Z", 5.0],
      ["2026-10-27T02:03:00Z", 5.4],
      ["2026-10-27T02:27:00Z", 9.1],
      ["2026-10-27T02:58:00Z", 7.2],
      ["2026-10-27T03:01:00Z", 7.3],
    ] as const) {
      await noteMeasured(db, [measured("au-per", at, uvi)]);
    }
    const day = (await countryData(db, ["au-per"], NOW)).get("au-per")!.measuredDay!;
    expect(day.day).toBe("2026-10-27");
    expect(day.max).toEqual({ validAt: "2026-10-27T02:27:00Z", uvi: 9.1 });
    expect(day.hours).toEqual([
      { validAt: "2026-10-27T01:58:00Z", uvi: 5.0 },
      { validAt: "2026-10-27T03:01:00Z", uvi: 7.3 },
    ]);
  });

  it("starts again on a new local day", async () => {
    const db = d1();
    await noteMeasured(db, [measured("au-per", "2026-10-26T06:00:00Z", 3.0)]);
    // 16:00Z on the 26th is midnight on the 27th in Perth.
    await noteMeasured(db, [measured("au-per", "2026-10-26T16:05:00Z", 0)]);
    const day = (await countryData(db, ["au-per"], NOW)).get("au-per")!.measuredDay!;
    expect(day.day).toBe("2026-10-27");
    expect(day.max.uvi).toBe(0);
    expect(day.hours).toHaveLength(1);
  });
});
