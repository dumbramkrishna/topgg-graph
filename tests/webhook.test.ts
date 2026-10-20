import { describe, it, expect, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { createHmac } from "node:crypto";
import { createWebhookHandler } from "../src/webhook.js";
import type { WebhookResponse } from "../src/webhook.js";
import { MemoryAdapter } from "../src/storage/memory.js";
import { utcDateString } from "../src/storage/types.js";

// ---------------------------------------------------------------------------
// Minimal request / response mocks
// ---------------------------------------------------------------------------

interface MockReq {
  method: string;
  headers: Record<string, string>;
  rawBody?: Buffer;
  body?: unknown;
  on?(event: string, listener: (...args: unknown[]) => void): MockReq;
}

interface MockRes {
  statusCode: number;
  body: string;
  writeHead(code: number): void;
  end(body?: string): void;
}

function makeRes(): MockRes {
  const res: MockRes = {
    statusCode: 0,
    body: "",
    writeHead(code: number) {
      res.statusCode = code;
    },
    end(body = "") {
      res.body = body;
    },
  };
  return res;
}

interface FastifyLikeRes {
  code: number;
  body: string;
  status(code: number): FastifyLikeRes;
  send(body?: string): void;
}

function makeFastifyRes(): FastifyLikeRes {
  const reply: FastifyLikeRes = {
    code: 0,
    body: "",
    status(code: number) {
      reply.code = code;
      return reply;
    },
    send(body = "") {
      reply.body = body;
    },
  };
  return reply;
}

function makePayload(
  overrides: Partial<{
    bot: string;
    user: string;
    type: "upvote" | "test";
    isWeekend: boolean;
  }> = {},
): Record<string, unknown> {
  return {
    bot: "111111111111111111",
    user: "222222222222222222",
    type: "upvote",
    isWeekend: false,
    ...overrides,
  };
}

function makeV1Vote(
  overrides: Partial<{
    id: string;
    weight: number;
    createdAt: string;
    query: Record<string, string>;
  }> = {},
): Record<string, unknown> {
  return {
    type: "vote.create",
    data: {
      id: overrides.id ?? "vote-123",
      weight: overrides.weight ?? 1,
      created_at: overrides.createdAt ?? new Date().toISOString(),
      expires_at: new Date(Date.now() + 43_200_000).toISOString(),
      project: {
        id: "project-1",
        type: "bot",
        platform: "discord",
        platform_id: "111111111111111111",
      },
      query: overrides.query ?? {},
      user: {
        id: "topgg-user-1",
        platform_id: "222222222222222222",
        name: "voter",
        avatar_url: "https://example.com/avatar.png",
      },
    },
  };
}

function makeV1TestEvent(): Record<string, unknown> {
  return {
    type: "webhook.test",
    data: {
      project: {
        id: "project-1",
        type: "bot",
        platform: "discord",
        platform_id: "111111111111111111",
      },
      user: {
        id: "topgg-user-1",
        platform_id: "222222222222222222",
        name: "tester",
        avatar_url: "https://example.com/avatar.png",
      },
    },
  };
}

function makeJsonReq(body: unknown, headers: Record<string, string> = {}): MockReq {
  const raw = Buffer.from(JSON.stringify(body), "utf8");
  return {
    method: "POST",
    headers,
    rawBody: raw,
    body,
  };
}

function makeStreamReq(
  body: unknown,
  headers: Record<string, string>,
  mode: "end" | "close" = "end",
): MockReq {
  const emitter = new EventEmitter();
  const req: MockReq = {
    method: "POST",
    headers,
    on(event: string, listener: (...args: unknown[]) => void) {
      emitter.on(event, listener);
      return req;
    },
  };

  setImmediate(() => {
    if (mode === "end") {
      emitter.emit("data", Buffer.from(JSON.stringify(body), "utf8"));
      emitter.emit("end");
    } else {
      emitter.emit("close");
    }
  });

  return req;
}

function makeV1Sig(secret: string, rawBody: string, timestamp: string): string {
  const signingString = `${timestamp}.${rawBody}`;
  const sig = createHmac("sha256", secret).update(signingString, "utf8").digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

function makeV1Req(
  payload: unknown,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
): MockReq {
  const raw = JSON.stringify(payload);
  return {
    method: "POST",
    headers: { "x-topgg-signature": makeV1Sig(secret, raw, String(timestamp)) },
    rawBody: Buffer.from(raw, "utf8"),
    body: payload,
  };
}

async function todayCount(storage: MemoryAdapter): Promise<number | undefined> {
  const today = utcDateString();
  const counts = await storage.getRange(today, today);
  return counts[today];
}

// ---------------------------------------------------------------------------
// v0 tests (plain Authorization header)
// ---------------------------------------------------------------------------

describe("webhook — v0 auth (plain Authorization header)", () => {
  const AUTH = "my-secret-token";
  let storage: MemoryAdapter;
  let handler: ReturnType<typeof createWebhookHandler>;

  beforeEach(() => {
    storage = new MemoryAdapter();
    handler = createWebhookHandler({ auth: AUTH, storage });
  });

  it("returns 204 on valid auth and records vote", async () => {
    const req = makeJsonReq(makePayload(), { authorization: AUTH });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(204);
    expect(await todayCount(storage)).toBe(1);
  });

  it("returns 401 on wrong auth header", async () => {
    const req = makeJsonReq(makePayload(), { authorization: "wrong-token" });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 on missing auth header", async () => {
    const req = makeJsonReq(makePayload(), {});
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it("matches header names case-insensitively", async () => {
    const req = makeJsonReq(makePayload(), { Authorization: AUTH });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(204);
  });

  it("does not leak auth through Unicode truncation", async () => {
    const unicodeHandler = createWebhookHandler({ auth: "\u00e9", storage });
    const req = makeJsonReq(makePayload(), { authorization: "\u00c3" });
    const res = makeRes();
    await unicodeHandler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it("ignores test votes by default (204, no storage write)", async () => {
    const req = makeJsonReq(makePayload({ type: "test" }), { authorization: AUTH });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(204);
    expect(await todayCount(storage)).toBeUndefined();
  });

  it("records test votes when recordTestVotes is true", async () => {
    const h = createWebhookHandler({ auth: AUTH, storage, recordTestVotes: true });
    const req = makeJsonReq(makePayload({ type: "test" }), { authorization: AUTH });
    const res = makeRes();
    await h(req, res);
    expect(res.statusCode).toBe(204);
    expect(await todayCount(storage)).toBe(1);
  });

  it("adds 2 votes on weekend", async () => {
    const req = makeJsonReq(makePayload({ isWeekend: true }), { authorization: AUTH });
    const res = makeRes();
    await handler(req, res);
    expect(await todayCount(storage)).toBe(2);
  });

  it("returns 405 for non-POST method", async () => {
    const req = { ...makeJsonReq(makePayload(), { authorization: AUTH }), method: "GET" };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });

  it("calls onVote callback after a valid vote", async () => {
    let called: unknown = null;
    const h = createWebhookHandler({
      auth: AUTH,
      storage,
      onVote: (p) => {
        called = p;
      },
    });
    const payload = makePayload();
    const req = makeJsonReq(payload, { authorization: AUTH });
    const res = makeRes();
    await h(req, res);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(called).toMatchObject({ user: payload["user"], type: "upvote" });
  });

  it("swallows synchronous onVote errors and still replies", async () => {
    const h = createWebhookHandler({
      auth: AUTH,
      storage,
      onVote() {
        throw new Error("callback boom");
      },
    });
    const req = makeJsonReq(makePayload(), { authorization: AUTH });
    const res = makeRes();
    await expect(h(req, res)).resolves.toBeUndefined();
    expect(res.statusCode).toBe(204);
    expect(await todayCount(storage)).toBe(1);
  });

  it("accepts a raw Buffer body (express.raw shape)", async () => {
    const raw = Buffer.from(JSON.stringify(makePayload()), "utf8");
    const req: MockReq = {
      method: "POST",
      headers: { authorization: AUTH },
      rawBody: raw,
      body: raw,
    };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(204);
    expect(await todayCount(storage)).toBe(1);
  });

  it("accepts rawBody without a body property", async () => {
    const raw = Buffer.from(JSON.stringify(makePayload()), "utf8");
    const req: MockReq = {
      method: "POST",
      headers: { authorization: AUTH },
      rawBody: raw,
    };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(204);
    expect(await todayCount(storage)).toBe(1);
  });

  it("accepts an already parsed body without raw bytes", async () => {
    const req: MockReq = {
      method: "POST",
      headers: { authorization: AUTH },
      body: makePayload(),
    };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(204);
  });

  it("reads a streamed node:http-style body", async () => {
    const req = makeStreamReq(makePayload(), { authorization: AUTH });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(204);
    expect(await todayCount(storage)).toBe(1);
  });

  it("returns 400 when the client closes before the body is complete", async () => {
    const req = makeStreamReq(makePayload(), { authorization: AUTH }, "close");
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid JSON in rawBody", async () => {
    const req: MockReq = {
      method: "POST",
      headers: { authorization: AUTH },
      rawBody: Buffer.from("NOT JSON", "utf8"),
    };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("returns 413 when the body exceeds maxBodyBytes", async () => {
    const h = createWebhookHandler({ auth: AUTH, storage, maxBodyBytes: 10 });
    const req = makeJsonReq(makePayload(), { authorization: AUTH });
    const res = makeRes();
    await h(req, res);
    expect(res.statusCode).toBe(413);
  });

  it("deduplicates retried deliveries", async () => {
    const req = makeJsonReq(makePayload(), { authorization: AUTH });
    await handler(req, makeRes());
    await handler(req, makeRes());
    expect(await todayCount(storage)).toBe(1);
  });

  it("returns 500 instead of hanging when storage fails", async () => {
    const failing = createWebhookHandler({
      auth: AUTH,
      storage: {
        increment: () => Promise.reject(new Error("database down")),
        getRange: () => Promise.resolve({}),
      },
    });
    const req = makeJsonReq(makePayload(), { authorization: AUTH });
    const res = makeRes();
    await expect(failing(req, res)).resolves.toBeUndefined();
    expect(res.statusCode).toBe(500);
  });

  it("allows a retry after a storage failure", async () => {
    let attempts = 0;
    const retrying = createWebhookHandler({
      auth: AUTH,
      storage: {
        increment: () => {
          attempts += 1;
          return attempts === 1 ? Promise.reject(new Error("database down")) : Promise.resolve();
        },
        getRange: () => Promise.resolve({}),
      },
    });
    const req = makeJsonReq(makePayload(), { authorization: AUTH });

    await retrying(req, makeRes());
    const retry = makeRes();
    await retrying(req, retry);

    expect(retry.statusCode).toBe(204);
    expect(attempts).toBe(2);
  });

  it("supports Fastify-style status()/send() responses", async () => {
    const req = makeJsonReq(makePayload(), { authorization: AUTH });
    const reply = makeFastifyRes();
    await handler(req, reply as unknown as WebhookResponse);
    expect(reply.code).toBe(204);
    expect(reply.body).toBe("");
  });

  it("throws when constructed with an empty auth secret", () => {
    expect(() => createWebhookHandler({ auth: "", storage })).toThrow(/auth/);
  });

  it("rejects invalid payloads", async () => {
    const req = makeJsonReq({ nonsense: true }, { authorization: AUTH });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// v1 tests (HMAC-SHA256, whs_ prefix)
// ---------------------------------------------------------------------------

describe("webhook — v1 auth (x-topgg-signature)", () => {
  const AUTH = "whs_supersecretkey";
  let storage: MemoryAdapter;
  let handler: ReturnType<typeof createWebhookHandler>;

  beforeEach(() => {
    storage = new MemoryAdapter();
    handler = createWebhookHandler({ auth: AUTH, storage });
  });

  it("records a vote.create event using its weight", async () => {
    const req = makeV1Req(makeV1Vote(), AUTH);
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(204);
    expect(await todayCount(storage)).toBe(1);
  });

  it("records weight 2 on double-vote weekends", async () => {
    const req = makeV1Req(makeV1Vote({ weight: 2 }), AUTH);
    const res = makeRes();
    await handler(req, res);
    expect(await todayCount(storage)).toBe(2);
  });

  it("acks webhook.test without recording by default", async () => {
    const req = makeV1Req(makeV1TestEvent(), AUTH);
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(204);
    expect(await todayCount(storage)).toBeUndefined();
  });

  it("records webhook.test when recordTestVotes is true", async () => {
    const h = createWebhookHandler({ auth: AUTH, storage, recordTestVotes: true });
    const req = makeV1Req(makeV1TestEvent(), AUTH);
    const res = makeRes();
    await h(req, res);
    expect(res.statusCode).toBe(204);
    expect(await todayCount(storage)).toBe(1);
  });

  it("buckets v1 votes by created_at rather than receipt time", async () => {
    const yesterday = utcDateString(Date.now() - 86_400_000);
    const req = makeV1Req(makeV1Vote({ createdAt: `${yesterday}T23:59:00.000Z` }), AUTH);
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(204);
    const counts = await storage.getRange(yesterday, yesterday);
    expect(counts[yesterday]).toBe(1);
  });

  it("deduplicates the same v1 event id", async () => {
    const req = makeV1Req(makeV1Vote({ id: "same-id" }), AUTH);
    await handler(req, makeRes());
    await handler(req, makeRes());
    expect(await todayCount(storage)).toBe(1);
  });

  it("still accepts legacy flat payloads signed with v1", async () => {
    const req = makeV1Req(makePayload(), AUTH);
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(204);
    expect(await todayCount(storage)).toBe(1);
  });

  it("returns 401 on tampered body", async () => {
    const payload = makeV1Vote();
    const raw = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sig = makeV1Sig(AUTH, raw, timestamp);
    const tampered = { ...payload, data: { ...(payload["data"] as object), weight: 2 } };
    const req = makeJsonReq(tampered, { "x-topgg-signature": sig });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 on missing x-topgg-signature header", async () => {
    const req = makeJsonReq(makeV1Vote(), {});
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when v1 has no raw body to verify", async () => {
    const req: MockReq = {
      method: "POST",
      headers: {},
      body: makeV1Vote(),
    };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 on wrong secret", async () => {
    const req = makeV1Req(makeV1Vote(), "whs_wrong_secret");
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it("rejects stale signatures outside the tolerance window", async () => {
    const req = makeV1Req(makeV1Vote(), AUTH, Math.floor(Date.now() / 1000) - 1000);
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it("accepts stale signatures when tolerance is configured explicitly", async () => {
    const h = createWebhookHandler({
      auth: AUTH,
      storage,
      signatureToleranceSeconds: 5000,
    });
    const req = makeV1Req(makeV1Vote(), AUTH, Math.floor(Date.now() / 1000) - 1000);
    const res = makeRes();
    await h(req, res);
    expect(res.statusCode).toBe(204);
  });

  it("returns 400 for malformed v1 payloads", async () => {
    const req = makeV1Req({ type: "vote.create", data: {} }, AUTH);
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });
});
