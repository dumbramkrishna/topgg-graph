/**
 * PNG renderer for topgg-graph.
 *
 * @resvg/resvg-js is an optional peer dependency. This module lazy-loads it
 * at call time and throws a descriptive error if it is not installed.
 */

/**
 * Render an SVG string to a PNG Buffer.
 *
 * Requires the optional peer dependency `@resvg/resvg-js`:
 * ```
 * npm install @resvg/resvg-js
 * ```
 *
 * @param svg - SVG string (e.g. from `renderSVG`)
 * @returns PNG as a `Buffer`
 */
export async function renderPNG(svg: string): Promise<Buffer> {
  let ResvgClass: typeof import("@resvg/resvg-js").Resvg;

  try {
    const mod = await import("@resvg/resvg-js");
    ResvgClass = mod.Resvg;
  } catch {
    throw new Error(
      "[topgg-graph] renderPNG requires the optional peer dependency @resvg/resvg-js.\n" +
        "Install it with:  npm install @resvg/resvg-js",
    );
  }

  const resvg = new ResvgClass(svg, {
    fitTo: { mode: "original" },
  });

  return resvg.render().asPng();
}

