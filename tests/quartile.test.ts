import { describe, it, expect } from "vitest";
import { colorLevel, sortedNonzero } from "../src/render.js";

describe("sortedNonzero", () => {
  it("returns empty array for no data", () => {
    expect(sortedNonzero({})).toEqual([]);
  });

  it("filters out zero values", () => {
    expect(sortedNonzero({ "2024-01-01": 0, "2024-01-02": 5 })).toEqual([5]);
  });

  it("returns sorted ascending", () => {
    const counts = { a: 10, b: 3, c: 7, d: 1 };
    expect(sortedNonzero(counts)).toEqual([1, 3, 7, 10]);
  });

  it("includes duplicates", () => {
    const counts = { a: 5, b: 5, c: 5 };
    expect(sortedNonzero(counts)).toEqual([5, 5, 5]);
  });
});

describe("colorLevel", () => {
  it("returns 0 for zero count", () => {
    expect(colorLevel(0, [1, 2, 3, 4])).toBe(0);
  });

  it("returns 0 when nonzero list is empty", () => {
    expect(colorLevel(5, [])).toBe(0);
  });

  it("returns 5 for the maximum value", () => {
    const nz = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(colorLevel(10, nz)).toBe(5);
  });

  it("returns 1 for the minimum nonzero value in a spread set", () => {
    const nz = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(colorLevel(1, nz)).toBe(1);
  });

  it("assigns levels correctly across quintile boundaries", () => {
    // With 8 values: [1..8], the 20/40/60/80% boundaries are 2, 4, 5, 7.
    const nz = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(colorLevel(1, nz)).toBe(1);
    expect(colorLevel(2, nz)).toBe(1);
    expect(colorLevel(3, nz)).toBe(2);
    expect(colorLevel(4, nz)).toBe(2);
    expect(colorLevel(5, nz)).toBe(3);
    expect(colorLevel(6, nz)).toBe(4);
    expect(colorLevel(7, nz)).toBe(4);
    expect(colorLevel(8, nz)).toBe(5);
  });

  it("uses every level 1–5 for at least five distinct values", () => {
    const nz = [1, 2, 3, 4, 5];
    expect(nz.map((count) => colorLevel(count, nz))).toEqual([1, 2, 3, 4, 5]);
  });

  it("handles a single-value nonzero list", () => {
    // Only one unique value; it is max → level 5
    expect(colorLevel(42, [42])).toBe(5);
  });

  it("handles all-same values", () => {
    const nz = [5, 5, 5, 5];
    // All quartile boundaries point to 5, and 5 is the max → level 5
    expect(colorLevel(5, nz)).toBe(5);
  });

  it("returns 0 for negative count", () => {
    expect(colorLevel(-1, [1, 2, 3])).toBe(0);
  });
});
