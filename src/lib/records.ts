/**
 * The one record shape every source is converted to.
 *
 * Keeping this narrow is what makes "replace ARPANSA with a forecast feed" a
 * settings change: a source is a function that returns these, nothing more.
 * Timestamps are ISO 8601 UTC strings rather than Date objects because that is
 * what goes into D1 and comes back out of it, and a string cannot silently
 * acquire a local offset on the way.
 */

export type Kind = "measured" | "forecast";

export interface Reading {
  readonly locationId: string;
  readonly source: string;
  readonly kind: Kind;
  /** The instant this value describes, ISO 8601 UTC. */
  readonly validAt: string;
  readonly uvi: number;
  /** When the source issued it; forecasts have one, measurements do not. */
  readonly issuedAt?: string;
  readonly fetchedAt: string;
}

/** What a source run reports back, so the caller can record health without throwing. */
export interface SourceResult {
  readonly source: string;
  readonly readings: readonly Reading[];
  /** Rows the source offered that failed a check, and why. Never shown to visitors. */
  readonly rejected: readonly string[];
  /**
   * Rows that were kept but that the source flagged as imperfect — most often an
   * ARPANSA station reporting itself hours behind. Diagnostics only: whether such
   * a reading is presented as current is decided by its age, not by this note.
   */
  readonly notes: readonly string[];
}

/** `new Date()` formatted the only way we ever store a time. */
export function toIsoUtc(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}
