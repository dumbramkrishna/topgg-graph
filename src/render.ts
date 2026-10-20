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
 * Color levels: 0 = empty, 1–5 derived from quartiles of nonzero counts.
 * Default accent: Top.gg pink-red #ff3366.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CustomTheme {
  background: string;
  text: string;
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
    empty: "#cccccc",
    levels: theme.levels,
  };
}

// ---------------------------------------------------------------------------
// Color level logic — quartile-based
// ---------------------------------------------------------------------------

/**
 * Assign a color level (0–5) to a count.
 * 0 = no votes.  1–5 derived from sorted nonzero quartile boundaries.
 *
 * @param count  - the day's count (0 means empty)
 * @param nonzero - sorted list of all nonzero values in the dataset
 */
export function colorLevel(count: number, nonzero: readonly number[]): 0 | 1 | 2 | 3 | 4 | 5 {
  if (count <= 0 || nonzero.length === 0) return 0;
  const n = nonzero.length;
  // Quartile boundaries (inclusive upper bound of each quarter)
  const q1 = nonzero[Math.floor(n * 0.25)] ?? nonzero[n - 1]!;
  const q2 = nonzero[Math.floor(n * 0.5)] ?? nonzero[n - 1]!;
  const q3 = nonzero[Math.floor(n * 0.75)] ?? nonzero[n - 1]!;
  const max = nonzero[n - 1]!;

  if (count >= max) return 5;
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
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${escapeXml(fill)}" rx="${rx}" ry="${rx}">${t}</rect>`;
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

const DAY_LABELS: Array<{ row: number; label: string }> = [
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
  const {
    weeks = 52,
    cellSize = 11,
    gap = 2,
    radius = 2,
    theme,
    today,
  } = options;

  const title = options.title ?? "Vote activity";

  const resolved = resolveTheme(theme);
  const nonzero = sortedNonzero(counts);
  const totalVotes = Object.values(counts).reduce((s, v) => s + v, 0);

  // ---- Compute grid start/end ----
  const todayStr = today ?? isoDate(new Date());
  const gridEndSunday = startOfWeek(todayStr); // start of this week (Sunday)
  const gridEnd = addDays(gridEndSunday, 6); // Saturday of this week
  const gridStart = addDays(gridEndSunday, -(weeks - 1) * 7); // Sunday N-1 weeks ago

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
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" role="img" aria-label="${escapeXml(title)}">`,
  );
  parts.push(
    `<rect width="${svgW}" height="${svgH}" fill="${escapeXml(resolved.background)}" rx="6"/>`,
  );

  // ---- Title ----
  const titleText = `${escapeXml(title)} — ${totalVotes.toLocaleString("en-US")} total`;
  parts.push(
    `<text x="${leftPad}" y="14" font-family="system-ui,-apple-system,sans-serif" font-size="11" font-weight="600" fill="${escapeXml(resolved.text)}">${titleText}</text>`,
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
        `<text x="${x}" y="27" font-family="system-ui,-apple-system,sans-serif" font-size="9" fill="${escapeXml(resolved.text)}">${escapeXml(mon)}</text>`,
      );
    }
  }

  // ---- Day labels (Mon, Wed, Fri) ----
  for (const { row, label } of DAY_LABELS) {
    const y = topPad + row * step + cellSize - 1;
    parts.push(
      `<text x="0" y="${y}" font-family="system-ui,-apple-system,sans-serif" font-size="9" fill="${escapeXml(resolved.text)}">${escapeXml(label)}</text>`,
    );
  }

  // ---- Cells ----
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const dateStr = addDays(gridStart, w * 7 + d);
      if (dateStr > gridEnd) continue;
      const count = counts[dateStr] ?? 0;
      const level = colorLevel(count, nonzero);
      const fill = level === 0 ? resolved.empty : resolved.levels[level - 1];
      const x = leftPad + w * step;
      const y = topPad + d * step;
      const tooltipLabel = count > 0 ? `${count} vote${count === 1 ? "" : "s"} on ${dateStr}` : `No votes on ${dateStr}`;
      parts.push(rect(x, y, cellSize, fill!, radius, tooltipLabel));
    }
  }

  // ---- Legend ----
  const legendY = topPad + gridH + 8;
  const legendX = leftPad;
  parts.push(
    `<text x="${legendX}" y="${legendY + 9}" font-family="system-ui,-apple-system,sans-serif" font-size="9" fill="${escapeXml(resolved.text)}">Less</text>`,
  );

  // Empty cell
  parts.push(rect(legendX + 22, legendY, cellSize, resolved.empty, radius));

  // 5 color levels
  for (let i = 0; i < 5; i++) {
    const fill = resolved.levels[i]!;
    parts.push(rect(legendX + 22 + (i + 1) * step, legendY, cellSize, fill, radius));
  }

  parts.push(
    `<text x="${legendX + 22 + 6 * step + 4}" y="${legendY + 9}" font-family="system-ui,-apple-system,sans-serif" font-size="9" fill="${escapeXml(resolved.text)}">More</text>`,
  );

  parts.push("</svg>");

  return parts.join("\n");
}
