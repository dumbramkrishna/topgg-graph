/**
 * Custom SQLite StorageAdapter example — topgg-graph
 *
 * Shows how to implement the StorageAdapter interface with a SQLite database
 * using the `better-sqlite3` package.
 *
 * Usage:
 *   npm install better-sqlite3 @types/better-sqlite3 @dumbramkrishna/topgg-graph
 */

import Database from "better-sqlite3";
import type { StorageAdapter } from "@dumbramkrishna/topgg-graph";

export class SqliteAdapter implements StorageAdapter {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS votes (
           date TEXT PRIMARY KEY,
           count INTEGER NOT NULL DEFAULT 0
         )`,
      )
      .run();
  }

  async increment(date: string, by = 1): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO votes (date, count) VALUES (?, ?)
         ON CONFLICT(date) DO UPDATE SET count = count + excluded.count`,
      )
      .run(date, by);
  }

  async getRange(from: string, to: string): Promise<Record<string, number>> {
    const rows = this.db
      .prepare(
        `SELECT date, count FROM votes
         WHERE date >= ? AND date <= ? AND count > 0
         ORDER BY date`,
      )
      .all(from, to) as Array<{ date: string; count: number }>;

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.date] = row.count;
    }
    return result;
  }

  /** Close the underlying database connection. */
  close(): void {
    this.db.close();
  }
}

// ---- Example usage --------------------------------------------------------

import { TopggGraph } from "@dumbramkrishna/topgg-graph";

const graph = new TopggGraph({
  storage: new SqliteAdapter("./votes.db"),
  webhookAuth: process.env["TOPGG_WEBHOOK_SECRET"] ?? "",
});

// Record a manual vote
await graph.record("2024-03-15", 5);

// Render the heatmap
const svg = await graph.render({ theme: "dark" });
console.log(svg.slice(0, 80) + "…");
