/**
 * In-memory StorageAdapter.
 * All data is lost when the process restarts.
 * Useful for development, testing, and ephemeral use cases.
 */

import type { StorageAdapter } from "./types.js";
import { dateRange } from "./types.js";

export class MemoryAdapter implements StorageAdapter {
  private readonly counts = new Map<string, number>();

  increment(date: string, by = 1): Promise<void> {
    this.counts.set(date, (this.counts.get(date) ?? 0) + by);
    return Promise.resolve();
  }

  getRange(from: string, to: string): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const date of dateRange(from, to)) {
      const n = this.counts.get(date);
      if (n !== undefined && n > 0) {
        result[date] = n;
      }
    }
    return Promise.resolve(result);
  }

  /** Reset all counts (useful in tests). */
  clear(): void {
    this.counts.clear();
  }
}
