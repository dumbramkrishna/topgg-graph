/**
 * JSON file StorageAdapter.
 *
 * Writes are atomic: data is first written to a sibling `.tmp` file,
 * then renamed over the target. This avoids corrupt files on crash
 * mid-write.
 *
 * If the target file is missing or contains invalid JSON it is treated
 * as an empty store (no data is silently lost — if the file exists but
 * is corrupt a warning is emitted to stderr).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { StorageAdapter } from "./types.js";
import { dateRange } from "./types.js";

// We need `fs.rename` which is available in node:fs/promises.
// The file is written via writeFile → rename (atomic on POSIX; best-effort on Windows).

type StoreData = Record<string, number>;

export class JsonFileAdapter implements StorageAdapter {
  private readonly filePath: string;
  private readonly tmpPath: string;
  /** Serialized write queue — prevents interleaved writes. */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
    this.tmpPath = `${this.filePath}.tmp`;
  }

  async increment(date: string, by = 1): Promise<void> {
    // Serialize to avoid TOCTOU race
    this.writeQueue = this.writeQueue.then(() => this._increment(date, by));
    await this.writeQueue;
  }

  private async _increment(date: string, by: number): Promise<void> {
    const data = await this._read();
    data[date] = (data[date] ?? 0) + by;
    await this._write(data);
  }

  async getRange(from: string, to: string): Promise<Record<string, number>> {
    const data = await this._read();
    const result: Record<string, number> = {};
    for (const date of dateRange(from, to)) {
      const n = data[date];
      if (n !== undefined && n > 0) {
        result[date] = n;
      }
    }
    return result;
  }

  private async _read(): Promise<StoreData> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (err: unknown) {
      // File does not exist yet — start fresh
      if (isNodeError(err) && err.code === "ENOENT") {
        return {};
      }
      throw err;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (isStoreData(parsed)) {
        return parsed;
      }
      process.stderr.write(
        `[topgg-graph] Warning: ${this.filePath} has unexpected shape; starting fresh.\n`,
      );
      return {};
    } catch {
      process.stderr.write(
        `[topgg-graph] Warning: ${this.filePath} contains invalid JSON; starting fresh.\n`,
      );
      return {};
    }
  }

  private async _write(data: StoreData): Promise<void> {
    const json = JSON.stringify(data, null, 2);
    await fs.writeFile(this.tmpPath, json, "utf8");
    await fs.rename(this.tmpPath, this.filePath);
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

function isStoreData(val: unknown): val is StoreData {
  if (typeof val !== "object" || val === null || Array.isArray(val)) return false;
  for (const [k, v] of Object.entries(val)) {
    if (typeof k !== "string" || typeof v !== "number") return false;
  }
  return true;
}
