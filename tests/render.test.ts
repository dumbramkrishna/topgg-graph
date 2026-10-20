import { describe, it, expect } from "vitest";
import { getRenderWindow, renderSVG } from "../src/render.js";

// Fixed "today" for deterministic snapshots
const TODAY = "2024-03-15";

const SAMPLE_COUNTS: Record<string, number> = {
  "2024-03-15": 10,
  "2024-03-14": 3,
  "2024-03-13": 7,
  "2024-03-10": 1,
  "2024-03-01": 20,
  "2024-02-14": 5,
  "2024-01-01": 2,
};

describe("renderSVG", () => {
  it("returns a string starting with <svg", () => {
    const svg = renderSVG({}, { today: TODAY });
    expect(svg).toMatch(/^<svg /);
  });

  it("closes the svg tag", () => {
    const svg = renderSVG({}, { today: TODAY });
    expect(svg.trimEnd()).toMatch(/<\/svg>$/);
  });

  it("is deterministic — identical inputs produce identical output", () => {
    const a = renderSVG(SAMPLE_COUNTS, { today: TODAY, theme: "light" });
    const b = renderSVG(SAMPLE_COUNTS, { today: TODAY, theme: "light" });
    expect(a).toBe(b);
  });

  it("includes the total vote count in the title", () => {
    const svg = renderSVG(SAMPLE_COUNTS, { today: TODAY });
    const total = Object.values(SAMPLE_COUNTS).reduce((sum, value) => sum + value, 0);
    expect(svg).toContain(`${total.toLocaleString("en-US")} total`);
  });

  it("ignores counts outside the displayed window in the title and colors", () => {
    const svg = renderSVG({ "2020-01-01": 999, "2024-03-15": 1 }, { today: TODAY, weeks: 52 });
    expect(svg).toContain("1 total");
    expect(svg).not.toContain("1,000 total");
  });

  it("escapes special characters in custom title", () => {
    const svg = renderSVG({}, { today: TODAY, title: 'Votes & <fun> "here"' });
    expect(svg).toContain("Votes &amp; &lt;fun&gt; &quot;here&quot;");
    expect(svg).not.toContain("<fun>");
  });

  it("renders with dark theme — uses dark background color", () => {
    const svg = renderSVG(SAMPLE_COUNTS, { today: TODAY, theme: "dark" });
    expect(svg).toContain("#0d1117");
  });

  it("renders with light theme — uses light background color", () => {
    const svg = renderSVG(SAMPLE_COUNTS, { today: TODAY, theme: "light" });
    expect(svg).toContain("#ffffff");
  });

  it("renders with a custom theme", () => {
    const svg = renderSVG(SAMPLE_COUNTS, {
      today: TODAY,
      theme: {
        background: "#1a1a2e",
        text: "#eaeaea",
        levels: ["#aaaaff", "#8888ff", "#6666ff", "#4444ff", "#2222ff"],
      },
    });
    expect(svg).toContain("#1a1a2e");
    expect(svg).toContain("#2222ff");
  });

  it("uses the custom theme empty-cell color", () => {
    const svg = renderSVG(
      {},
      {
        today: TODAY,
        theme: {
          background: "#1a1a2e",
          text: "#eaeaea",
          empty: "#123456",
          levels: ["#aaaaff", "#8888ff", "#6666ff", "#4444ff", "#2222ff"],
        },
      },
    );
    expect(svg).toContain("#123456");
  });

  it("renders zero-data grid without errors", () => {
    const svg = renderSVG({}, { today: TODAY });
    expect(svg).toMatch(/<svg /);
    expect(svg).toContain("0"); // total votes = 0
  });

  it("respects the weeks option (fewer columns)", () => {
    const svgFull = renderSVG(SAMPLE_COUNTS, { today: TODAY, weeks: 52 });
    const svgSmall = renderSVG(SAMPLE_COUNTS, { today: TODAY, weeks: 12 });
    // Smaller grid means smaller SVG width → fewer rect elements
    const countRects = (s: string) => (s.match(/<rect/g) ?? []).length;
    expect(countRects(svgSmall)).toBeLessThan(countRects(svgFull));
  });

  it("includes Mon, Wed, Fri day labels", () => {
    const svg = renderSVG({}, { today: TODAY });
    expect(svg).toContain("Mon");
    expect(svg).toContain("Wed");
    expect(svg).toContain("Fri");
  });

  it("includes a Less/More legend", () => {
    const svg = renderSVG({}, { today: TODAY });
    expect(svg).toContain("Less");
    expect(svg).toContain("More");
  });

  it("computes an inclusive 52-week window ending on Saturday", () => {
    expect(getRenderWindow(TODAY, 52)).toEqual({
      start: "2023-03-19",
      end: "2024-03-16",
    });
  });

  it("rejects invalid weeks and impossible today values", () => {
    expect(() => renderSVG({}, { weeks: 0 })).toThrow(RangeError);
    expect(() => renderSVG({}, { weeks: Number.NaN })).toThrow(RangeError);
    expect(() => renderSVG({}, { today: "2024-02-30" })).toThrow(RangeError);
  });

  it("matches light theme snapshot", () => {
    const svg = renderSVG(SAMPLE_COUNTS, { today: TODAY, theme: "light" });
    expect(svg).toMatchSnapshot();
  });

  it("matches dark theme snapshot", () => {
    const svg = renderSVG(SAMPLE_COUNTS, { today: TODAY, theme: "dark" });
    expect(svg).toMatchSnapshot();
  });
});
