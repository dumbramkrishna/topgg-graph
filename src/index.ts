/**
 * topgg-graph — public API surface.
 *
 * Main class: `TopggGraph`
 * Named exports: everything consumers might need individually.
 */

import { utcDateString } from "./storage/types.js";
import type { StorageAdapter } from "./storage/types.js";
import { MemoryAdapter } from "./storage/memory.js";
import { createWebhookHandler } from "./webhook.js";
import type { WebhookOptions, WebhookRequest, WebhookResponse, TopggVotePayload } from "./webhook.js";
import { renderSVG } from "./render.js";
import type { RenderOptions, Theme, CustomTheme } from "./render.js";
import { renderPNG } from "./png.js";

export { MemoryAdapter } from "./storage/memory.js";
export { JsonFileAdapter } from "./storage/jsonFile.js";
export { createWebhookHandler } from "./webhook.js";
export { renderSVG, colorLevel, sortedNonzero } from "./render.js";
export { renderPNG } from "./png.js";
export { utcDateString, parseDateString, nextDateString, dateRange } from "./storage/types.js";
export type {
  StorageAdapter,
  WebhookOptions,
  WebhookRequest,
  WebhookResponse,
  TopggVotePayload,
  RenderOptions,
  Theme,
  CustomTheme,
};

// ---------------------------------------------------------------------------
// TopggGraph — convenience class
// ---------------------------------------------------------------------------

export interface TopggGraphOptions {
  /** Storage adapter. Defaults to `MemoryAdapter` if not provided. */
  storage?: StorageAdapter;
  /** Top.gg webhook authorization secret (required for `webhook()`). */
  webhookAuth?: string;
}

/**
 * All-in-one convenience class.
 *
 * @example
 * const graph = new TopggGraph({
 *   storage: new JsonFileAdapter("./votes.json"),
 *   webhookAuth: process.env.TOPGG_WEBHOOK_SECRET,
 * });
 *
 * // In Express:
 * app.post("/webhook", express.raw({ type: "*\/*" }), (req, res) => {
 *   req.rawBody = req.body;
 *   void graph.webhook()(req, res);
 * });
 *
 * // Render:
 * const svg = await graph.render({ theme: "dark" });
 */
export class TopggGraph {
  private readonly _storage: StorageAdapter;
  private readonly _auth: string | undefined;

  constructor(options: TopggGraphOptions = {}) {
    // Lazy import to avoid circular-dep warnings in bundlers
    if (options.storage) {
      this._storage = options.storage;
    } else {
      this._storage = new MemoryAdapter();
    }
    this._auth = options.webhookAuth;
  }

  /**
   * Returns the underlying storage adapter.
   */
  get storage(): StorageAdapter {
    return this._storage;
  }

  /**
   * Create a webhook handler.
   * Requires `webhookAuth` to be set in the constructor options.
   */
  webhook(opts: Omit<WebhookOptions, "auth" | "storage"> = {}): (req: WebhookRequest, res: WebhookResponse) => Promise<void> {
    if (!this._auth) {
      throw new Error(
        "[topgg-graph] webhookAuth is required to use webhook(). " +
          "Pass it as TopggGraph({ webhookAuth: '...' }).",
      );
    }
    return createWebhookHandler({ ...opts, auth: this._auth, storage: this._storage });
  }

  /**
   * Manually record a vote for a given UTC date (defaults to today).
   *
   * @param date - YYYY-MM-DD in UTC (default: today)
   * @param by   - number of votes to add (default: 1)
   */
  async record(date?: string, by = 1): Promise<void> {
    await this._storage.increment(date ?? utcDateString(), by);
  }

  /**
   * Retrieve raw daily counts for a UTC date range.
   *
   * @param from - YYYY-MM-DD (default: 364 days ago)
   * @param to   - YYYY-MM-DD (default: today)
   */
  async getCounts(from?: string, to?: string): Promise<Record<string, number>> {
    const toDate = to ?? utcDateString();
    const fromDate = from ?? (() => {
      const d = new Date(Date.now() - 364 * 24 * 60 * 60 * 1000);
      return utcDateString(d.getTime());
    })();
    return this._storage.getRange(fromDate, toDate);
  }

  /**
   * Render the vote heatmap as an SVG string.
   */
  async render(opts: RenderOptions = {}): Promise<string> {
    const counts = await this.getCounts(opts.today ? undefined : undefined);
    return renderSVG(counts, opts);
  }

  /**
   * Render the vote heatmap as a PNG Buffer.
   * Requires the optional peer dependency `@resvg/resvg-js`.
   */
  async renderPNG(opts: RenderOptions = {}): Promise<Buffer> {
    const svg = await this.render(opts);
    return renderPNG(svg);
  }
}
