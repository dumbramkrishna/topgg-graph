import { describe, it, expect } from "vitest";
import { TopggGraph } from "../src/index.js";
import { getRenderWindow } from "../src/render.js";
import { MemoryAdapter } from "../src/storage/memory.js";

const TODAY = "2024-03-15";

describe("TopggGraph", () => {
  it("exposes the storage adapter", () => {
    const storage = new MemoryAdapter();
    const graph = new TopggGraph({ storage });
    expect(graph.storage).toBe(storage);
  });

  it("defaults getCounts' start to 364 days before the requested end", async () => {
    const storage = new MemoryAdapter();
    const graph = new TopggGraph({ storage });
    await graph.record("2024-03-15", 7);

    expect(await graph.getCounts(undefined, "2024-03-15")).toEqual({
      "2024-03-15": 7,
    });
  });

  it("rejects impossible record dates", async () => {
    const graph = new TopggGraph({ storage: new MemoryAdapter() });
    await expect(graph.record("2024-02-30", 1)).rejects.toThrow(RangeError);
  });

  it("renders only the data inside the grid window when today is overridden", async () => {
    const storage = new MemoryAdapter();
    const graph = new TopggGraph({ storage });
    await graph.record("2020-01-01", 50);
    await graph.record(TODAY, 5);

    const svg = await graph.render({ today: TODAY });
    expect(svg).toContain("5 total");
    expect(svg).not.toContain("55 total");
  });

  it("does not include data before the 52-week grid in the title", async () => {
    const storage = new MemoryAdapter();
    const graph = new TopggGraph({ storage });
    const { start } = getRenderWindow(TODAY, 52);
    const dayBeforeStart = new Date(`${start}T00:00:00.000Z`);
    dayBeforeStart.setUTCDate(dayBeforeStart.getUTCDate() - 1);
    const outside = dayBeforeStart.toISOString().slice(0, 10);

    await graph.record(outside, 100);
    const svg = await graph.render({ today: TODAY });
    expect(svg).toContain("0 total");
  });

  it("fetches enough data for a weeks override larger than 52", async () => {
    const storage = new MemoryAdapter();
    const graph = new TopggGraph({ storage });
    const sixtyWeekStart = getRenderWindow(TODAY, 60).start;
    await graph.record(sixtyWeekStart, 4);

    const svg60 = await graph.render({ today: TODAY, weeks: 60 });
    expect(svg60).toContain("4 total");

    const svg52 = await graph.render({ today: TODAY, weeks: 52 });
    expect(svg52).toContain("0 total");
  });

  it("renders a PNG through the optional peer dependency", async () => {
    const graph = new TopggGraph({ storage: new MemoryAdapter() });
    const png = await graph.renderPNG({ today: TODAY });
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  it("requires webhookAuth to create a webhook handler", () => {
    const graph = new TopggGraph({ storage: new MemoryAdapter() });
    expect(() => graph.webhook()).toThrow(/webhookAuth/);
  });
});
