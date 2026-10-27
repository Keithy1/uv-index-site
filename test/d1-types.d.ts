/**
 * The slice of D1's types that store.ts uses, for the Node-side typecheck only.
 *
 * Tests run in Node and get Node's types, not the Workers types -- the two
 * disagree about built-ins such as URL (see tsconfig.test.json). That held
 * while no test imported store.ts. test/summary.test.ts now does, to run its
 * SQL against real SQLite, and store.ts names D1Database.
 *
 * Declared narrowly and only here. store.ts is still checked against the real
 * @cloudflare/workers-types by tsconfig.json, so a use of D1 this file does not
 * describe fails that check rather than slipping through this one.
 */
interface D1Meta {
  rows_read?: number;
  rows_written?: number;
}

interface D1Result<T = unknown> {
  results: T[];
  meta: D1Meta;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1Result>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}
