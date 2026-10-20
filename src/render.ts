/**
 * SVG heatmap renderer for topgg-graph.
 *
 * renderSVG(counts, options?) → deterministic SVG string.
 *
 * Layout: 7 rows (Sun–Sat, top→bottom) × N weeks (left→right, oldest→newest).
 * Default 52 weeks.  Month labels appear above the grid.  Day labels (Mon,
 * Wed, Fri) appear to the left.  A "Less … More" legend sits below.  A title
 * showing total votes appears above everything.
 *
 * Color levels: 0 = empty, 1–5 derived from quintiles of nonzero counts.
 * Default accent: Top.gg pink-red #ff3366.
 */

import { parseDateString, utcDateString } from "./storage/types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CustomTheme {
  background: string;
  text: string;
  /** Optional color for zero-vote cells. Defaults to #cccccc. */
  empty?: string;
  /** Exactly 5 colors, index 0 = lowest nonzero, index 4 = highest. */
  levels: [string, string, string, string, string];
}

export type Theme = "light" | "dark" | CustomTheme;

export interface RenderOptions {
  /**
   * Number of weeks to display. Default 52.
   * The grid always ends with the most recent week and extends back in time.
   */
  weeks?: number;
  /** Cell size in px. Default 11. */
  cellSize?: number;
  /** Gap between cells in px. Default 2. */
  gap?: number;
  /** Cell corner radius in px. Default 2. */
  radius?: number;
  /** Theme. Default "light". */
  theme?: Theme;
  /** Title displayed above the grid. Default "Vote activity". */
  title?: string;
  /**
   * Override today's date (YYYY-MM-DD UTC) for deterministic renders in tests.
   */
  today?: string;
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

const THEMES = {
  light: {
    background: "#ffffff",
    text: "#24292f",
    empty: "#ebedf0",
    levels: [
      "#ffc0cc", // level 1 — lightest pink
      "#ff8fa3",
      "#ff5577",
      "#ff3366", // level 4 — brand accent
      "#cc0044", // level 5 — darkest
    ] as [string, string, string, string, string],
  },
  dark: {
    background: "#0d1117",
    text: "#e6edf3",
    empty: "#161b22",
    levels: [
      "#4d0019",
      "#800033",
      "#cc0044",
      "#ff3366", // level 4 — brand accent
      "#ff6699", // level 5 — brightest
    ] as [string, string, string, string, string],
  },
};

interface ResolvedTheme {
  background: string;
  text: string;
  empty: string;
  levels: [string, string, string, string, string];
}

function resolveTheme(theme: Theme | undefined): ResolvedTheme {
  if (!theme || theme === "light") return THEMES.light;
  if (theme === "dark") return THEMES.dark;
  return {
    background: theme.background,
    text: theme.text,
    empty: theme.empty ?? "#cccccc",
    levels: theme.levels,
  };
}

// ---------------------------------------------------------------------------
// Color level logic — quintile-based
// ---------------------------------------------------------------------------

/** Index of the value at the given quantile in a sorted array. */
function quantileIndex(length: number, fraction: number): number {
  return Math.min(length - 1, Math.max(0, Math.ceil(length * fraction) - 1));
}

/**
 * Assign a color level (0–5) to a count.
 * 0 = no votes.  1–5 derived from sorted nonzero quintile boundaries.
 *
 * The quintile boundaries deliberately leave the maximum value in level 5
 * while ensuring level 4 is reachable for datasets with at least five distinct
 * nonzero values.
 *
 * @param count   - the day's count (0 means empty)
 * @param nonzero - sorted ascending list of all nonzero values in the dataset
 */
export function colorLevel(count: number, nonzero: readonly number[]): 0 | 1 | 2 | 3 | 4 | 5 {
  if (count <= 0 || nonzero.length === 0) return 0;
  const n = nonzero.length;
  // Last element is always defined because we checked length > 0 above.
  // Using a fallback of 0 to avoid non-null assertions; it can never be reached.
  const last = nonzero[n - 1] ?? 0;
  const q1 = nonzero[quantileIndex(n, 0.2)] ?? last;
  const q2 = nonzero[quantileIndex(n, 0.4)] ?? last;
  const q3 = nonzero[quantileIndex(n, 0.6)] ?? last;
  const q4 = nonzero[quantileIndex(n, 0.8)] ?? last;

  // The top quintile and every equal-to-max value map to level 5.
  if (count > q4 || count >= last) return 5;
  if (count <= q1) return 1;
  if (count <= q2) return 2;
  if (count <= q3) return 3;
  return 4;
}

/** Sort and return only nonzero values from a counts record. */
export function sortedNonzero(counts: Readonly<Record<string, number>>): number[] {
  return Object.values(counts)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Date helpers (local to renderer)
// ---------------------------------------------------------------------------

function startOfWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  const dow = d.getUTCDay(); // 0 = Sun
  d.setUTCDate(d.getUTCDate() - dow);
  return isoDate(d);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

/** Default number of weeks rendered by `renderSVG`. */
export const DEFAULT_WEEKS = 52;

export interface RenderWindow {
  /** First date shown in the grid (a Sunday). */
  start: string;
  /** Last date shown in the grid (a Saturday). */
  end: string;
}

/**
 * Compute the inclusive date window displayed by a heatmap.
 *
 * The window always ends on the Saturday of the week containing `todayStr`
 * and spans exactly `weeks` columns.
 */
export function getRenderWindow(todayStr: string, weeks: number): RenderWindow {
  if (!Number.isInteger(weeks) || weeks < 1) {
    throw new RangeError("[topgg-graph] weeks must be a positive integer.");
  }

  // Validates both the format and that the calendar date actually exists.
  const today = parseDateString(todayStr);
  const normalizedToday = utcDateString(today.getTime());
  const weekStart = startOfWeek(normalizedToday);

  return {
    start: addDays(weekStart, -(weeks - 1) * 7),
    end: addDays(weekStart, 6),
  };
}

/** YYYY-MM-DD → short month name */
function monthName(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00.000Z`).toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
}

// ---------------------------------------------------------------------------
// SVG helpers
// ---------------------------------------------------------------------------

/** Convert a number to a string for safe use in SVG attribute template literals. */
function n(v: number): string {
  return String(v);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function rect(
  x: number,
  y: number,
  size: number,
  fill: string,
  rx: number,
  title?: string,
): string {
  const t = title ? `<title>${escapeXml(title)}</title>` : "";
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(size)}" height="${n(size)}" fill="${escapeXml(fill)}" rx="${n(rx)}" ry="${n(rx)}">${t}</rect>`;
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

const DAY_LABELS: { row: number; label: string }[] = [
  { row: 1, label: "Mon" },
  { row: 3, label: "Wed" },
  { row: 5, label: "Fri" },
];

/**
 * Render a daily vote heatmap as an SVG string.
 *
 * @param counts - map of YYYY-MM-DD → vote count (dates outside the display
 *                 window are silently ignored)
 * @param options - optional display / theme overrides
 * @returns Deterministic SVG string (no random IDs, no Date.now())
 */
export function renderSVG(
  counts: Readonly<Record<string, number>>,
  options: RenderOptions = {},
): string {
  const { weeks = DEFAULT_WEEKS, cellSize = 11, gap = 2, radius = 2, theme, today } = options;

  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new RangeError("[topgg-graph] cellSize must be a positive number.");
  }
  if (!Number.isFinite(gap) || gap < 0) {
    throw new RangeError("[topgg-graph] gap must be a non-negative number.");
  }
  if (!Number.isFinite(radius) || radius < 0) {
    throw new RangeError("[topgg-graph] radius must be a non-negative number.");
  }

  const title = options.title ?? "Vote activity";
  const resolved = resolveTheme(theme);

  // ---- Compute grid start/end ----
  const todayStr = today ?? utcDateString();
  const { start: gridStart, end: gridEnd } = getRenderWindow(todayStr, weeks);

  // Only counts inside the displayed window affect totals, colors, and cells.
  const visibleCounts: Record<string, number> = {};
  for (const [date, count] of Object.entries(counts)) {
    if (date >= gridStart && date <= gridEnd) visibleCounts[date] = count;
  }

  const nonzero = sortedNonzero(visibleCounts);
  const totalVotes = Object.values(visibleCounts).reduce((sum, value) => sum + value, 0);

  // ---- Layout constants ----
  const step = cellSize + gap;
  const leftPad = 28; // space for day labels
  const topPad = 36; // space for title + month labels
  const legendHeight = 20;
  const gridW = weeks * step - gap;
  const gridH = 7 * step - gap;
  const svgW = leftPad + gridW + 20;
  const svgH = topPad + gridH + legendHeight + 16;

  const parts: string[] = [];

  // ---- SVG header ----
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(svgW)}" height="${n(svgH)}" viewBox="0 0 ${n(svgW)} ${n(svgH)}" role="img" aria-label="${escapeXml(title)}">`,
  );
  parts.push(
    `<rect width="${n(svgW)}" height="${n(svgH)}" fill="${escapeXml(resolved.background)}" rx="6"/>`,
  );

  // ---- Title ----
  const titleText = `${escapeXml(title)} — ${totalVotes.toLocaleString("en-US")} total`;
  parts.push(
    `<text x="${n(leftPad)}" y="14" font-family="system-ui,-apple-system,sans-serif" font-size="11" font-weight="600" fill="${escapeXml(resolved.text)}">${titleText}</text>`,
  );

  // ---- Month labels ----
  let lastMonth = "";
  for (let w = 0; w < weeks; w++) {
    const weekStart = addDays(gridStart, w * 7);
    const mon = monthName(weekStart);
    if (mon !== lastMonth) {
      lastMonth = mon;
      const x = leftPad + w * step;
      parts.push(
        `<text x="${n(x)}" y="27" font-family="system-ui,-apple-system,sans-serif" font-size="9" fill="${escapeXml(resolved.text)}">${escapeXml(mon)}</text>`,
      );
    }
  }

  // ---- Day labels (Mon, Wed, Fri) ----
  for (const { row, label } of DAY_LABELS) {
    const y = topPad + row * step + cellSize - 1;
    parts.push(
      `<text x="0" y="${n(y)}" font-family="system-ui,-apple-system,sans-serif" font-size="9" fill="${escapeXml(resolved.text)}">${escapeXml(label)}</text>`,
    );
  }

  // ---- Cells ----
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const dateStr = addDays(gridStart, w * 7 + d);
      if (dateStr > gridEnd) continue;
      const count = visibleCounts[dateStr] ?? 0;
      const level = colorLevel(count, nonzero);
      // levels[0..4] maps to level 1..5; fall back to empty color if out of range.
      const fill = level === 0 ? resolved.empty : (resolved.levels[level - 1] ?? resolved.empty);
      const x = leftPad + w * step;
      const y = topPad + d * step;
      const tooltipLabel =
        count > 0
          ? `${String(count)} vote${count === 1 ? "" : "s"} on ${dateStr}`
          : `No votes on ${dateStr}`;
      parts.push(rect(x, y, cellSize, fill, radius, tooltipLabel));
    }
  }

  // ---- Legend ----
  const legendY = topPad + gridH + 8;
  const legendX = leftPad;
  parts.push(
    `<text x="${n(legendX)}" y="${n(legendY + 9)}" font-family="system-ui,-apple-system,sans-serif" font-size="9" fill="${escapeXml(resolved.text)}">Less</text>`,
  );

  // Empty cell
  parts.push(rect(legendX + 22, legendY, cellSize, resolved.empty, radius));

  // 5 color levels
  for (let i = 0; i < 5; i++) {
    const fill = resolved.levels[i] ?? resolved.empty;
    parts.push(rect(legendX + 22 + (i + 1) * step, legendY, cellSize, fill, radius));
  }

  parts.push(
    `<text x="${n(legendX + 22 + 6 * step + 4)}" y="${n(legendY + 9)}" font-family="system-ui,-apple-system,sans-serif" font-size="9" fill="${escapeXml(resolved.text)}">More</text>`,
  );

  parts.push("</svg>");

  return parts.join("\n");
}
