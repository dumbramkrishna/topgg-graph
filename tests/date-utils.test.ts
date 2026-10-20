import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { utcDateString, parseDateString, nextDateString, dateRange } from "../src/storage/types.js";

describe("utcDateString", () => {
  it("returns YYYY-MM-DD in UTC", () => {
    // 2024-03-15 00:00:00 UTC
    const ts = Date.UTC(2024, 2, 15, 0, 0, 0);
    expect(utcDateString(ts)).toBe("2024-03-15");
  });

  it("uses the UTC day, not local day", () => {
    // 2024-03-14 23:00:00 UTC — could be March 15 in UTC+1
    const ts = Date.UTC(2024, 2, 14, 23, 0, 0);
    expect(utcDateString(ts)).toBe("2024-03-14");
  });

  it("handles UTC midnight (start of day)", () => {
    const ts = Date.UTC(2024, 0, 1, 0, 0, 0, 0);
    expect(utcDateString(ts)).toBe("2024-01-01");
  });

  it("handles one millisecond before midnight (end of day)", () => {
    const ts = Date.UTC(2024, 0, 1, 23, 59, 59, 999);
    expect(utcDateString(ts)).toBe("2024-01-01");
  });

  it("pads month and day with leading zeros", () => {
    const ts = Date.UTC(2024, 0, 9); // Jan 9
    expect(utcDateString(ts)).toBe("2024-01-09");
  });

  it("uses Date.now() when no argument is given", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00.000Z"));
    expect(utcDateString()).toBe("2025-06-15");
    vi.useRealTimers();
  });

  it("crosses a DST boundary correctly (UTC is unaffected)", () => {
    // US DST spring-forward: 2024-03-10 02:00 local → 03:00
    // At UTC 07:00 it is still March 10 in UTC
    const ts = Date.UTC(2024, 2, 10, 7, 0, 0);
    expect(utcDateString(ts)).toBe("2024-03-10");
  });

  it("correctly labels a new UTC day at 00:00:00.000Z", () => {
    const ts = Date.UTC(2024, 11, 31, 23, 59, 59, 999); // Dec 31 still
    expect(utcDateString(ts)).toBe("2024-12-31");
    const ts2 = Date.UTC(2025, 0, 1, 0, 0, 0, 0); // Jan 1
    expect(utcDateString(ts2)).toBe("2025-01-01");
  });
});

describe("parseDateString", () => {
  it("parses a valid date", () => {
    const d = parseDateString("2024-06-01");
    expect(d.getUTCFullYear()).toBe(2024);
    expect(d.getUTCMonth()).toBe(5); // June
    expect(d.getUTCDate()).toBe(1);
  });

  it("throws on invalid format", () => {
    expect(() => parseDateString("2024/06/01")).toThrow(RangeError);
    expect(() => parseDateString("not-a-date")).toThrow(RangeError);
    expect(() => parseDateString("")).toThrow(RangeError);
  });

  it("throws on invalid date values", () => {
    expect(() => parseDateString("2024-13-01")).toThrow();
  });
});

describe("nextDateString", () => {
  it("advances by one day", () => {
    expect(nextDateString("2024-01-31")).toBe("2024-02-01");
  });

  it("handles leap year", () => {
    expect(nextDateString("2024-02-28")).toBe("2024-02-29");
    expect(nextDateString("2024-02-29")).toBe("2024-03-01");
  });

  it("handles non-leap year", () => {
    expect(nextDateString("2023-02-28")).toBe("2023-03-01");
  });

  it("rolls over year", () => {
    expect(nextDateString("2023-12-31")).toBe("2024-01-01");
  });
});

describe("dateRange", () => {
  it("returns a single date when from === to", () => {
    expect(dateRange("2024-01-01", "2024-01-01")).toEqual(["2024-01-01"]);
  });

  it("returns all dates in a small range", () => {
    expect(dateRange("2024-01-01", "2024-01-05")).toEqual([
      "2024-01-01",
      "2024-01-02",
      "2024-01-03",
      "2024-01-04",
      "2024-01-05",
    ]);
  });

  it("returns empty when from > to", () => {
    expect(dateRange("2024-01-05", "2024-01-01")).toEqual([]);
  });

  it("crosses a month boundary", () => {
    const range = dateRange("2024-01-30", "2024-02-02");
    expect(range).toEqual(["2024-01-30", "2024-01-31", "2024-02-01", "2024-02-02"]);
  });
});

