import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { createWebhookHandler } from "../src/webhook.js";
import { MemoryAdapter } from "../src/storage/memory.js";

// ---------------------------------------------------------------------------
// Minimal request / response mocks
// ---------------------------------------------------------------------------

interface MockReq {
  method: string;
  headers: Record<string, string>;
  rawBody?: Buffer;
  body?: unknown;
}

interface MockRes {
  statusCode: number;
  body: string;
  writeHead(code: number): void;
  end(b?: string): void;
}

function makeRes(): MockRes {
  const res = {
    statusCode: 0,
    body: "",
    writeHead(code: number) {
      res.statusCode = code;
    },
    end(b = "") {
      res.body = b;
    },
  };
  return res;
}

function makePayload(overrides: Partial<{
  bot: string;
  user: string;
  type: "upvote" | "test";
  isWeekend: boolean;
}> = {}) {
  return {
    bot: "111111111111111111",
    user: "222222222222222222",
    type: "upvote" as const,
    isWeekend: false,
    ...overrides,
  };
}

function makeJsonReq(
  body: unknown,
  headers: Record<string, string> = {},
): MockReq {
  const raw = Buffer.from(JSON.stringify(body), "utf8");
  return {
    method: "POST",
    headers,
    rawBody: raw,
    body,
  };
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
    // Check storage has a record for today
    const today = new Date().toISOString().slice(0, 10);
    const counts = await storage.getRange(today, today);
    expect(counts[today]).toBe(1);
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

  it("ignores test votes by default (204, no storage write)", async () => {
    const req = makeJsonReq(makePayload({ type: "test" }), { authorization: AUTH });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(204);
    const today = new Date().toISOString().slice(0, 10);
    const counts = await storage.getRange(today, today);
    expect(counts[today]).toBeUndefined();
  });

  it("records test votes when recordTestVotes is true", async () => {
    const h = createWebhookHandler({ auth: AUTH, storage, recordTestVotes: true });
    const req = makeJsonReq(makePayload({ type: "test" }), { authorization: AUTH });
    const res = makeRes();
    await h(req, res);
    expect(res.statusCode).toBe(204);
    const today = new Date().toISOString().slice(0, 10);
    const counts = await storage.getRange(today, today);
    expect(counts[today]).toBe(1);
  });

  it("adds 2 votes on weekend", async () => {
    const req = makeJsonReq(makePayload({ isWeekend: true }), { authorization: AUTH });
    const res = makeRes();
    await handler(req, res);
    const today = new Date().toISOString().slice(0, 10);
    const counts = await storage.getRange(today, today);
    expect(counts[today]).toBe(2);
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
      onVote: (p) => { called = p; },
    });
    const payload = makePayload();
    const req = makeJsonReq(payload, { authorization: AUTH });
    const res = makeRes();
    await h(req, res);
    // Wait a tick for the async callback
    await new Promise((r) => setTimeout(r, 10));
    expect(called).toMatchObject({ user: payload.user, type: "upvote" });
  });
});

// ---------------------------------------------------------------------------
// v1 tests (HMAC-SHA256, whs_ prefix)
// ---------------------------------------------------------------------------

function makeV1Sig(secret: string, rawBody: string, timestamp: string): string {
  const signingString = `${timestamp}.${rawBody}`;
  const sig = createHmac("sha256", secret).update(signingString, "utf8").digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

describe("webhook — v1 auth (x-topgg-signature)", () => {
  const AUTH = "whs_supersecretkey";
  let storage: MemoryAdapter;
  let handler: ReturnType<typeof createWebhookHandler>;

  beforeEach(() => {
    storage = new MemoryAdapter();
    handler = createWebhookHandler({ auth: AUTH, storage });
  });

  it("returns 204 on valid v1 signature", async () => {
    const payload = makePayload();
    const raw = JSON.stringify(payload);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = makeV1Sig(AUTH, raw, ts);
    const req = makeJsonReq(payload, { "x-topgg-signature": sig });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(204);
  });

  it("returns 401 on tampered body", async () => {
    const payload = makePayload();
    const raw = JSON.stringify(payload);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = makeV1Sig(AUTH, raw, ts);
    // Tamper: change the actual body sent
    const tamperedPayload = { ...payload, user: "HACKER" };
    const req = makeJsonReq(tamperedPayload, { "x-topgg-signature": sig });
    // But override rawBody to simulate the tampered content arriving
    req.rawBody = Buffer.from(JSON.stringify(tamperedPayload), "utf8");
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 on missing x-topgg-signature header", async () => {
    const req = makeJsonReq(makePayload(), {});
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 on wrong secret", async () => {
    const payload = makePayload();
    const raw = JSON.stringify(payload);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = makeV1Sig("whs_wrong_secret", raw, ts);
    const req = makeJsonReq(payload, { "x-topgg-signature": sig });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });
});

