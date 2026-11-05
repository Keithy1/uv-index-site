// Types for scripts/schema.mjs, so the tests that import it typecheck.
export interface MasterRow {
  type: string;
  name: string;
  sql: string | null;
}
export function shapeOf(rows: readonly MasterRow[]): Map<string, string>;
export function shapeOfSql(sql: string): Map<string, string>;
export function schemaDifferences(expected: Map<string, string>, actual: Map<string, string>): string[];
export function migrationNames(dir?: string): string[];
