/**
 * Webhook handler for Top.gg vote events.
 *
 * Works with:
 *   - Express / Fastify  (req, res) middleware style
 *   - Plain node:http    IncomingMessage + ServerResponse
 *
 * Top.gg authentication schemes:
 *   v0 (legacy) — `Authorization` header contains a plain shared secret.
 *   v1 (current) — `x-topgg-signature: t=<unix>,v1=<hmac-sha256>` where the
 *                   signing string is `<t>.<rawBody>` and the secret starts
 *                   with `whs_`.
 *
 * The handler auto-detects the scheme from the secret format.
 *
 * Responses:
 *   204  — vote recorded (or test vote intentionally ignored)
 *   401  — bad or missing authentication
 *   405  — method is not POST
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { utcDateString } from "./storage/types.js";
import type { StorageAdapter } from "./storage/types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Top.gg webhook payload (bot votes). */
export interface TopggVotePayload {
  /** Snowflake ID of the bot that was voted for. */
  bot: string;
  /** Snowflake ID of the user who voted. */
  user: string;
  /** `"upvote"` for real votes; `"test"` from the dashboard test button. */
  type: "upvote" | "test";
  /** Whether the vote occurred during a double-vote weekend. */
  isWeekend: boolean;
  /** Optional extra query parameters from the vote URL. */
  query?: string;
}

export interface WebhookOptions {
  /** Your Top.gg webhook authorization secret. */
  auth: string;
  /** Storage adapter that will receive the daily increment. */
  storage: StorageAdapter;
  /**
   * If `true`, votes with `type:"test"` are recorded in storage.
   * Defaults to `false` (test votes are silently accepted but not stored).
   */
  recordTestVotes?: boolean;
  /**
   * Called after a valid vote is recorded (or skipped if test).
   * Errors thrown here are swallowed — they do not affect the response.
   */
  onVote?: (payload: TopggVotePayload) => void | Promise<void>;
}

/**
 * Minimal request shape accepted by the handler.
 * Compatible with `node:http.IncomingMessage`, Express `Request`,
 * and Fastify `FastifyRequest.raw`.
 */
export interface WebhookRequest {
  method?: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  /**
   * For v1 auth the raw body must be available before JSON parsing.
   * Provide it here as a Buffer or string if your framework has already
   * consumed the readable stream (e.g. Express with bodyParser).
   */
  rawBody?: Buffer | string;
  body?: unknown;
  on?(event: string, listener: (...args: unknown[]) => void): this;
}

export interface WebhookResponse {
  writeHead?(statusCode: number): void;
  status?(statusCode: number): this;
  end(body?: string): void;
  statusCode?: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function firstHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function timingSafeStringEqual(a: string, b: string): boolean {
  // Pad to the same length before comparison to avoid length-based timing leaks.
  const maxLen = Math.max(a.length, b.length);
  const aBuf = Buffer.alloc(maxLen);
  const bBuf = Buffer.alloc(maxLen);
  aBuf.write(a, "utf8");
  bBuf.write(b, "utf8");
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * v1 verification.
 * Header: `t=<unix_seconds>,v1=<hex_hmac_sha256>`
 * Signing string: `<t>.<rawBody>`
 */
function verifyV1Signature(secret: string, rawBody: string, sigHeader: string): boolean {
  let timestamp: string | undefined;
  let providedSig: string | undefined;

  for (const part of sigHeader.split(",")) {
    const [key, val] = part.split("=", 2);
    if (key === "t") timestamp = val;
    if (key === "v1") providedSig = val;
  }

  if (!timestamp || !providedSig) return false;

  const signingString = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(signingString, "utf8").digest("hex");

  return timingSafeStringEqual(expected, providedSig);
}

function sendResponse(res: WebhookResponse, status: number, body = ""): void {
  if (typeof res.writeHead === "function") {
    res.writeHead(status);
    res.end(body || undefined);
  } else if (typeof res.status === "function") {
    res.status(status).end(body || undefined);
  } else {
    res.statusCode = status;
    res.end(body || undefined);
  }
}

// ---------------------------------------------------------------------------
// Body reading helpers
// ---------------------------------------------------------------------------

function readBody(req: WebhookRequest): Promise<{ raw: string; parsed: unknown }> {
  return new Promise((resolve, reject) => {
    // Already parsed (e.g. Express with json middleware) and rawBody available
    if (req.body !== undefined && req.rawBody !== undefined) {
      const rawBody = req.rawBody;
      const raw =
        rawBody instanceof Buffer
          ? rawBody.toString("utf8")
          : String(rawBody);
      resolve({ raw, parsed: req.body });
      return;
    }

    // Already parsed but no rawBody (v0 only — we won't need the raw body)
    if (req.body !== undefined) {
      resolve({ raw: "", parsed: req.body });
      return;
    }

    // Stream the body ourselves
    if (typeof req.on === "function") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: unknown) => {
        if (Buffer.isBuffer(chunk)) chunks.push(chunk);
        else if (typeof chunk === "string") chunks.push(Buffer.from(chunk, "utf8"));
      });
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          resolve({ raw, parsed: JSON.parse(raw) });
        } catch {
          reject(new Error("Invalid JSON body"));
        }
      });
      req.on("error", (err: unknown) => {
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    } else {
      reject(new Error("Cannot read request body: no stream and no pre-parsed body"));
    }
  });
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

/**
 * Create a webhook handler for Top.gg vote events.
 *
 * @example
 * // Express
 * app.post("/webhook", createWebhookHandler({ auth: process.env.TOPGG_AUTH!, storage }));
 */
export function createWebhookHandler(opts: WebhookOptions) {
  const { auth, storage, recordTestVotes = false, onVote } = opts;
  const isV1 = auth.startsWith("whs_");

  return async function webhookHandler(
    req: WebhookRequest,
    res: WebhookResponse,
  ): Promise<void> {
    // Method check
    if (req.method && req.method.toUpperCase() !== "POST") {
      sendResponse(res, 405);
      return;
    }

    let raw = "";
    let parsed: unknown;

    try {
      ({ raw, parsed } = await readBody(req));
    } catch {
      sendResponse(res, 400, "Bad request");
      return;
    }

    // ---- Authentication ----
    if (isV1) {
      const sigHeader = firstHeader(req.headers, "x-topgg-signature");
      if (!sigHeader || !verifyV1Signature(auth, raw, sigHeader)) {
        sendResponse(res, 401, "Unauthorized");
        return;
      }
    } else {
      const authHeader = firstHeader(req.headers, "authorization");
      if (!authHeader || !timingSafeStringEqual(auth, authHeader)) {
        sendResponse(res, 401, "Unauthorized");
        return;
      }
    }

    // ---- Validate payload ----
    if (!isVotePayload(parsed)) {
      sendResponse(res, 400, "Bad request");
      return;
    }

    const payload = parsed;

    // ---- Test vote handling ----
    if (payload.type === "test" && !recordTestVotes) {
      sendResponse(res, 204);
      return;
    }

    // ---- Record vote ----
    const date = utcDateString();
    const increment = payload.isWeekend ? 2 : 1;
    await storage.increment(date, increment);

    // ---- onVote callback (non-blocking for response) ----
    if (onVote) {
      void Promise.resolve(onVote(payload)).catch(() => undefined);
    }

    sendResponse(res, 204);
  };
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

function isVotePayload(val: unknown): val is TopggVotePayload {
  if (typeof val !== "object" || val === null) return false;
  const v = val as Record<string, unknown>;
  return (
    typeof v["user"] === "string" &&
    (v["type"] === "upvote" || v["type"] === "test") &&
    typeof v["isWeekend"] === "boolean"
  );
}
