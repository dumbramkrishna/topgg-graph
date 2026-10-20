/**
 * Webhook handler for Top.gg vote events.
 *
 * Works with:
 *   - Express / Fastify  (req, res / reply) middleware style
 *   - Plain node:http    IncomingMessage + ServerResponse
 *
 * Top.gg authentication schemes:
 *   v0 (legacy) — `Authorization` header contains a plain shared secret and
 *                 the body is the flat `{ bot, user, type, isWeekend }` payload.
 *   v1 (current) — `x-topgg-signature: t=<unix>,v1=<hmac-sha256>` where the
 *                   signing string is `<t>.<rawBody>` and the secret starts
 *                   with `whs_`. The body is the `{ type, data }` event envelope.
 *
 * The handler auto-detects the auth scheme from the secret format and accepts
 * both payload shapes.
 *
 * Responses:
 *   204  — vote recorded (or test/duplicate vote intentionally ignored)
 *   400  — unreadable/invalid body or payload
 *   401  — bad or missing authentication
 *   405  — method is not POST
 *   413  — body exceeds `maxBodyBytes`
 *   500  — storage or unexpected handler failure
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { utcDateString } from "./storage/types.js";
import type { StorageAdapter } from "./storage/types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Normalized Top.gg vote payload.
 *
 * v0 fields are kept as-is. v1 events are flattened into the same shape and
 * additionally expose `id`, `createdAt`, `weight`, and `queryParams`.
 */
export interface TopggVotePayload {
  /** Snowflake ID of the bot that was voted for. */
  bot: string;
  /** Snowflake ID of the user who voted. */
  user: string;
  /** `"upvote"` for real votes; `"test"` from the dashboard test button. */
  type: "upvote" | "test";
  /** Whether the vote occurred during a double-vote weekend. */
  isWeekend: boolean;
  /** v0 only: optional query string from the vote URL. */
  query?: string;
  /** v1 only: parsed query parameters from the vote URL. */
  queryParams?: Record<string, string>;
  /** v1 only: Top.gg vote ID (useful for deduplication). */
  id?: string;
  /** v1 only: ISO 8601 timestamp for when the vote was cast. */
  createdAt?: string;
  /** Number of votes this event represents (1 normally, 2 on weekends). */
  weight?: number;
}

export interface WebhookOptions {
  /** Your Top.gg webhook authorization secret. */
  auth: string;
  /** Storage adapter that will receive the daily increment. */
  storage: StorageAdapter;
  /**
   * If `true`, votes with `type:"test"` (including v1 `webhook.test` events)
   * are recorded in storage. Defaults to `false`.
   */
  recordTestVotes?: boolean;
  /**
   * Called after a valid vote is recorded. Errors thrown here are swallowed —
   * they do not affect the response.
   */
  onVote?: (payload: TopggVotePayload) => void | Promise<void>;
  /**
   * Maximum accepted difference, in seconds, between the v1 signature
   * timestamp and the server clock. Defaults to 300 (5 minutes).
   */
  signatureToleranceSeconds?: number;
  /** Maximum accepted request body size in bytes. Defaults to 1 MiB. */
  maxBodyBytes?: number;
  /**
   * In-memory duplicate-delivery window, in seconds. Defaults to 1200
   * (20 minutes), which covers Top.gg's retry schedule. Set to `0` to disable.
   */
  dedupeWindowSeconds?: number;
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
   * Raw body before JSON parsing. Required for v1 signature verification.
   * If provided, the handler parses this value and ignores `body`.
   */
  rawBody?: Buffer | Uint8Array | string;
  body?: unknown;
  on?(event: string, listener: (...args: unknown[]) => void): this;
}

/**
 * Minimal response shape accepted by the handler.
 * Supports `node:http`/Express (`writeHead` + `end`), Fastify
 * (`status` + `send`), and simple `{ status, end }` objects.
 */
export interface WebhookResponse {
  writeHead?(statusCode: number): unknown;
  status?(statusCode: number): WebhookResponse;
  send?(body?: string): unknown;
  end?(body?: string): unknown;
  statusCode?: number;
}

export type WebhookHandler = (req: WebhookRequest, res: WebhookResponse) => Promise<void>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface NormalizedVote extends TopggVotePayload {
  weight: number;
}

interface BodyResult {
  raw: string;
  parsed: unknown;
}

const DEFAULT_MAX_BODY_BYTES = 1_048_576;
const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;
const DEFAULT_DEDUPE_WINDOW_SECONDS = 1200;

class BodyReadError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "BodyReadError";
    this.statusCode = statusCode;
  }
}

/** Small in-memory cache used to ignore webhook retries and duplicate deliveries. */
class SeenCache {
  private readonly entries = new Map<string, number>();
  private operations = 0;

  constructor(
    private readonly ttlSeconds: number,
    private readonly maxEntries = 10_000,
  ) {}

  claim(key: string): boolean {
    if (this.ttlSeconds <= 0) return true;
    const now = Date.now();
    this.operations += 1;
    if (this.operations % 256 === 0 || this.entries.size >= this.maxEntries) {
      this.prune(now);
    }
    if (this.entries.has(key)) return false;
    this.entries.set(key, now);
    return true;
  }

  release(key: string): void {
    this.entries.delete(key);
  }

  private prune(now: number): void {
    const cutoff = now - this.ttlSeconds * 1000;
    for (const [key, seenAt] of this.entries) {
      if (seenAt < cutoff) this.entries.delete(key);
    }
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }
}

function firstHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== target) continue;
    const value = headers[key];
    return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function timingSafeStringEqual(a: string, b: string): boolean {
  // Hash first: this gives fixed-length inputs and avoids the UTF-8 truncation
  // bug caused by allocating buffers from JavaScript string lengths.
  return timingSafeEqual(sha256(a), sha256(b));
}

/**
 * v1 verification.
 * Header: `t=<unix_seconds>,v1=<hex_hmac_sha256>`
 * Signing string: `<t>.<rawBody>`
 *
 * @returns the signed timestamp when the signature is valid and fresh, or
 *          `null` when it is invalid/expired.
 */
function verifyV1Signature(
  secret: string,
  rawBody: string,
  sigHeader: string,
  toleranceSeconds: number,
): number | null {
  let timestamp: string | undefined;
  let providedSig: string | undefined;

  for (const part of sigHeader.split(",")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") timestamp = value;
    if (key === "v1") providedSig = value;
  }

  if (!timestamp || !providedSig) return null;
  if (!/^\d+$/.test(timestamp)) return null;

  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds)) return null;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - seconds) > toleranceSeconds) return null;

  const signingString = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(signingString, "utf8").digest("hex");

  return timingSafeStringEqual(expected, providedSig) ? seconds : null;
}

function sendResponse(res: WebhookResponse, status: number, body = ""): void {
  const payload = body.length > 0 ? body : undefined;

  if (typeof res.writeHead === "function" && typeof res.end === "function") {
    res.writeHead(status);
    res.end(payload);
    return;
  }

  if (typeof res.status === "function") {
    const next = res.status(status);
    if (typeof next.end === "function") {
      next.end(payload);
      return;
    }
    if (typeof next.send === "function") {
      next.send(payload);
      return;
    }
  }

  if (typeof res.send === "function") {
    res.send(payload);
    return;
  }

  if (typeof res.end === "function") {
    res.statusCode = status;
    res.end(payload);
    return;
  }

  throw new Error(
    "[topgg-graph] Unsupported response object. Expected writeHead()/end(), " +
      "status()/end(), or status()/send().",
  );
}

// ---------------------------------------------------------------------------
// Body reading helpers
// ---------------------------------------------------------------------------

function toRawString(value: Buffer | Uint8Array | string): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return Buffer.from(value).toString("utf8");
}

function isRawBody(value: unknown): value is Buffer | Uint8Array | string {
  return typeof value === "string" || Buffer.isBuffer(value) || value instanceof Uint8Array;
}

function parseJsonBody(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new BodyReadError("Invalid JSON body", 400);
  }
}

function readBody(req: WebhookRequest, maxBodyBytes: number): Promise<BodyResult> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const finish = (raw: string): void => {
      if (settled) return;
      if (Buffer.byteLength(raw, "utf8") > maxBodyBytes) {
        fail(new BodyReadError("Request body too large", 413));
        return;
      }
      let parsed: unknown;
      try {
        parsed = parseJsonBody(raw);
      } catch (error) {
        fail(error);
        return;
      }
      settled = true;
      resolve({ raw, parsed });
    };

    // Raw body supplied by the framework (e.g. Express `express.raw`).
    // Always parse it ourselves so authentication covers exactly what we read.
    if (req.rawBody !== undefined) {
      const raw = toRawString(req.rawBody);
      // Some frameworks expose an empty rawBody alongside a parsed body for
      // requests without a body; preserve the legacy pre-parsed path for v0.
      if (raw.length === 0 && req.body !== undefined && !isRawBody(req.body)) {
        settled = true;
        resolve({ raw: "", parsed: req.body });
        return;
      }
      finish(raw);
      return;
    }

    // Pre-parsed body with no raw bytes (v0 only — v1 needs `rawBody`).
    if (req.body !== undefined) {
      if (isRawBody(req.body)) {
        finish(toRawString(req.body));
      } else {
        settled = true;
        resolve({ raw: "", parsed: req.body });
      }
      return;
    }

    // Stream the body ourselves, with a hard size limit and abort handling.
    if (typeof req.on === "function") {
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      req.on("data", (chunk: unknown) => {
        if (settled) return;
        let buffer: Buffer;
        if (Buffer.isBuffer(chunk)) {
          buffer = chunk;
        } else if (typeof chunk === "string") {
          buffer = Buffer.from(chunk, "utf8");
        } else if (chunk instanceof Uint8Array) {
          buffer = Buffer.from(chunk);
        } else {
          return;
        }

        totalBytes += buffer.length;
        if (totalBytes > maxBodyBytes) {
          fail(new BodyReadError("Request body too large", 413));
          return;
        }
        chunks.push(buffer);
      });

      req.on("end", () => {
        if (!settled) finish(Buffer.concat(chunks).toString("utf8"));
      });
      req.on("error", (error: unknown) => {
        fail(error instanceof Error ? error : new Error(String(error)));
      });
      req.on("aborted", () => {
        fail(new BodyReadError("Request aborted", 400));
      });
      req.on("close", () => {
        if (!settled) fail(new BodyReadError("Request closed before body was fully received", 400));
      });
    } else {
      fail(new BodyReadError("Cannot read request body: no stream and no pre-parsed body", 400));
    }
  });
}

// ---------------------------------------------------------------------------
// Payload normalization
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown> | null, key: string): string | undefined {
  if (record === null) return undefined;
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function queryParams(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  if (record === null) return undefined;

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "string") result[key] = entry;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeV1(record: Record<string, unknown>): NormalizedVote | null {
  const kind = record.type;
  if (kind !== "vote.create" && kind !== "webhook.test") return null;

  const data = asRecord(record.data);
  if (data === null) return null;

  const project = asRecord(data.project);
  const user = asRecord(data.user);
  const bot = stringField(project, "platform_id") ?? stringField(project, "id");
  const userId = stringField(user, "platform_id") ?? stringField(user, "id");
  if (bot === undefined || userId === undefined) return null;

  const rawWeight = data.weight;
  const weight =
    kind === "vote.create" &&
    typeof rawWeight === "number" &&
    Number.isFinite(rawWeight) &&
    rawWeight >= 1
      ? Math.floor(rawWeight)
      : 1;

  const payload: NormalizedVote = {
    bot,
    user: userId,
    type: kind === "vote.create" ? "upvote" : "test",
    isWeekend: weight === 2,
    weight,
  };

  const id = stringField(data, "id");
  if (id !== undefined) payload.id = id;

  const createdAt = stringField(data, "created_at");
  if (createdAt !== undefined && !Number.isNaN(Date.parse(createdAt))) {
    payload.createdAt = createdAt;
  }

  const params = queryParams(data.query);
  if (params !== undefined) payload.queryParams = params;

  return payload;
}

function normalizeV0(record: Record<string, unknown>): NormalizedVote | null {
  if (
    typeof record.bot !== "string" ||
    record.bot.length === 0 ||
    typeof record.user !== "string" ||
    record.user.length === 0 ||
    (record.type !== "upvote" && record.type !== "test") ||
    typeof record.isWeekend !== "boolean"
  ) {
    return null;
  }

  const payload: NormalizedVote = {
    bot: record.bot,
    user: record.user,
    type: record.type,
    isWeekend: record.isWeekend,
    weight: record.isWeekend ? 2 : 1,
  };

  if (typeof record.query === "string") payload.query = record.query;
  return payload;
}

function normalizeVotePayload(value: unknown): NormalizedVote | null {
  const record = asRecord(value);
  if (record === null) return null;
  if (record.type === "vote.create" || record.type === "webhook.test") {
    return normalizeV1(record);
  }
  return normalizeV0(record);
}

function dedupeKey(payload: NormalizedVote, raw: string): string {
  if (payload.id !== undefined) return `id:${payload.id}`;
  const material = raw.length > 0 ? raw : JSON.stringify(payload);
  return `body:${createHash("sha256").update(material, "utf8").digest("hex")}`;
}

function dateForVote(payload: NormalizedVote, signatureTimestamp: number | null): string {
  if (payload.createdAt !== undefined) {
    const milliseconds = Date.parse(payload.createdAt);
    if (!Number.isNaN(milliseconds)) return utcDateString(milliseconds);
  }
  if (signatureTimestamp !== null) return utcDateString(signatureTimestamp * 1000);
  return utcDateString();
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
export function createWebhookHandler(opts: WebhookOptions): WebhookHandler {
  const {
    auth,
    storage,
    recordTestVotes = false,
    onVote,
    signatureToleranceSeconds = DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
    dedupeWindowSeconds = DEFAULT_DEDUPE_WINDOW_SECONDS,
  } = opts;

  if (typeof auth !== "string" || auth.length === 0) {
    throw new Error("[topgg-graph] auth must be a non-empty webhook secret.");
  }
  if (!Number.isFinite(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new RangeError("[topgg-graph] maxBodyBytes must be a positive number.");
  }
  if (!Number.isFinite(signatureToleranceSeconds) || signatureToleranceSeconds < 0) {
    throw new RangeError("[topgg-graph] signatureToleranceSeconds must be >= 0.");
  }
  if (!Number.isFinite(dedupeWindowSeconds) || dedupeWindowSeconds < 0) {
    throw new RangeError("[topgg-graph] dedupeWindowSeconds must be >= 0.");
  }

  const isV1 = auth.startsWith("whs_");
  const seen = new SeenCache(dedupeWindowSeconds);

  return async function webhookHandler(req: WebhookRequest, res: WebhookResponse): Promise<void> {
    try {
      // Method check
      if (req.method !== undefined && req.method.toUpperCase() !== "POST") {
        sendResponse(res, 405);
        return;
      }

      let body: BodyResult;
      try {
        body = await readBody(req, maxBodyBytes);
      } catch (error) {
        if (error instanceof BodyReadError) {
          sendResponse(
            res,
            error.statusCode,
            error.statusCode === 413 ? "Payload too large" : "Bad request",
          );
        } else {
          sendResponse(res, 400, "Bad request");
        }
        return;
      }

      // ---- Authentication ----
      let signatureTimestamp: number | null = null;
      if (isV1) {
        if (body.raw.length === 0) {
          sendResponse(res, 400, "Raw request body is required for v1 verification");
          return;
        }
        const sigHeader = firstHeader(req.headers, "x-topgg-signature");
        if (sigHeader === undefined || sigHeader.length === 0) {
          sendResponse(res, 401, "Unauthorized");
          return;
        }
        signatureTimestamp = verifyV1Signature(
          auth,
          body.raw,
          sigHeader,
          signatureToleranceSeconds,
        );
        if (signatureTimestamp === null) {
          sendResponse(res, 401, "Unauthorized");
          return;
        }
      } else {
        const authHeader = firstHeader(req.headers, "authorization");
        if (
          authHeader === undefined ||
          authHeader.length === 0 ||
          !timingSafeStringEqual(auth, authHeader)
        ) {
          sendResponse(res, 401, "Unauthorized");
          return;
        }
      }

      // ---- Validate and normalize payload ----
      const payload = normalizeVotePayload(body.parsed);
      if (payload === null) {
        sendResponse(res, 400, "Bad request");
        return;
      }

      // ---- Test vote handling ----
      if (payload.type === "test" && !recordTestVotes) {
        sendResponse(res, 204);
        return;
      }

      // ---- Duplicate delivery handling ----
      const eventKey = dedupeKey(payload, body.raw);
      if (!seen.claim(eventKey)) {
        sendResponse(res, 204);
        return;
      }

      // ---- Record vote ----
      try {
        await storage.increment(dateForVote(payload, signatureTimestamp), payload.weight);
      } catch (error) {
        // Allow Top.gg's retry to be processed if the write failed.
        seen.release(eventKey);
        throw error;
      }

      // ---- onVote callback (non-blocking for response) ----
      if (onVote) {
        void Promise.resolve()
          .then(() => onVote(payload))
          .catch(() => undefined);
      }

      sendResponse(res, 204);
    } catch {
      // Ensure a failing storage adapter (or response object) never leaves the
      // request hanging. If headers were already sent, this is a best effort.
      try {
        sendResponse(res, 500, "Internal Server Error");
      } catch {
        // Response already sent or unsupported; nothing else we can do.
      }
    }
  };
}
