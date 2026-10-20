import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { JsonFileAdapter } from "../src/storage/jsonFile.js";

let tmpDir: string;
let filePath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "topgg-graph-test-"));
  filePath = path.join(tmpDir, "votes.json");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("JsonFileAdapter", () => {
  it("creates the file on first increment", async () => {
    const adapter = new JsonFileAdapter(filePath);
    await adapter.increment("2024-01-01");
    const data = JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, number>;
    expect(data["2024-01-01"]).toBe(1);
  });

  it("accumulates votes for the same day", async () => {
    const adapter = new JsonFileAdapter(filePath);
    await adapter.increment("2024-01-01");
    await adapter.increment("2024-01-01");
    await adapter.increment("2024-01-01", 3);
    const counts = await adapter.getRange("2024-01-01", "2024-01-01");
    expect(counts["2024-01-01"]).toBe(5);
  });

  it("returns only dates with nonzero counts from getRange", async () => {
    const adapter = new JsonFileAdapter(filePath);
    await adapter.increment("2024-01-03", 7);
    const counts = await adapter.getRange("2024-01-01", "2024-01-05");
    expect(Object.keys(counts)).toEqual(["2024-01-03"]);
    expect(counts["2024-01-03"]).toBe(7);
  });

  it("returns empty object for a range with no votes", async () => {
    const adapter = new JsonFileAdapter(filePath);
    const counts = await adapter.getRange("2024-01-01", "2024-01-05");
    expect(counts).toEqual({});
  });

  it("handles a missing file gracefully (no error)", async () => {
    const adapter = new JsonFileAdapter(filePath);
    // File doesn't exist yet
    const counts = await adapter.getRange("2024-01-01", "2024-01-01");
    expect(counts).toEqual({});
  });

  it("recovers from a corrupt JSON file (warns to stderr, starts fresh)", async () => {
    await fs.writeFile(filePath, "NOT VALID JSON }{{{", "utf8");
    const stderrWrites: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array) => {
      stderrWrites.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    };

    try {
      const adapter = new JsonFileAdapter(filePath);
      // Should not throw
      await adapter.increment("2024-01-01");
      const counts = await adapter.getRange("2024-01-01", "2024-01-01");
      expect(counts["2024-01-01"]).toBe(1);
      // A warning should have been emitted
      expect(stderrWrites.some((w) => w.includes("[topgg-graph]"))).toBe(true);
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  it("recovers from a file with wrong JSON shape", async () => {
    // Valid JSON but not an object of numbers
    await fs.writeFile(filePath, JSON.stringify([1, 2, 3]), "utf8");
    const adapter = new JsonFileAdapter(filePath);
    await adapter.increment("2024-06-01", 4);
    const counts = await adapter.getRange("2024-06-01", "2024-06-01");
    expect(counts["2024-06-01"]).toBe(4);
  });

  it("writes atomically (no partial reads)", async () => {
    const adapter = new JsonFileAdapter(filePath);
    // Fire many concurrent increments
    const promises = Array.from({ length: 20 }, (_, i) =>
      adapter.increment(`2024-01-${String((i % 5) + 1).padStart(2, "0")}`, 1),
    );
    await Promise.all(promises);
    // Verify the file is valid JSON
    const raw = await fs.readFile(filePath, "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("does not leave behind .tmp files after write", async () => {
    const adapter = new JsonFileAdapter(filePath);
    await adapter.increment("2024-01-01");
    const files = await fs.readdir(tmpDir);
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
  });
});

