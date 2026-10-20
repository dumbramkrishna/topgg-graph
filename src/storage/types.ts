/**
 * StorageAdapter interface and date utilities for topgg-graph.
 * All dates are YYYY-MM-DD strings in UTC.
 */

/** A storage backend that persists daily vote counts. */
export interface StorageAdapter {
  /**
   * Increment the vote count for a given UTC date.
   * @param date - YYYY-MM-DD in UTC
   * @param by - amount to add (default: 1)
   */
  increment(date: string, by?: number): Promise<void>;

  /**
   * Retrieve vote counts for an inclusive date range.
   * @param from - YYYY-MM-DD in UTC (inclusive)
   * @param to   - YYYY-MM-DD in UTC (inclusive)
   * @returns A record mapping each date with ≥1 vote to its count.
   *          Dates with zero votes are omitted.
   */
  getRange(from: string, to: string): Promise<Record<string, number>>;
}

/**
 * Convert a timestamp (or the current time if omitted) to a
 * UTC YYYY-MM-DD string.
 *
 * @param ts - Unix timestamp in milliseconds (default: Date.now())
 */
export function utcDateString(ts?: number): string {
  const d = new Date(ts ?? Date.now());
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parse a YYYY-MM-DD string into a UTC midnight Date.
 * Throws on malformed input.
 */
export function parseDateString(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new RangeError(`Invalid date string: "${date}". Expected YYYY-MM-DD.`);
  }
  const d = new Date(`${date}T00:00:00.000Z`);
  if (isNaN(d.getTime())) {
    throw new RangeError(`Invalid date: "${date}".`);
  }
  return d;
}

/**
 * Advance a YYYY-MM-DD date string by one day (UTC).
 */
export function nextDateString(date: string): string {
  const d = parseDateString(date);
  d.setUTCDate(d.getUTCDate() + 1);
  return utcDateString(d.getTime());
}

/**
 * Return every YYYY-MM-DD string in the inclusive range [from, to].
 */
export function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  let cur = from;
  while (cur <= to) {
    dates.push(cur);
    cur = nextDateString(cur);
  }
  return dates;
}

