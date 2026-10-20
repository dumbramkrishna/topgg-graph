/**
 * Express example — topgg-graph
 *
 * Receives Top.gg vote webhooks, stores daily counts in a JSON file,
 * and exposes a /graph.svg endpoint.
 *
 * Usage:
 *   npm install express @dumbramkrishna/topgg-graph
 *   TOPGG_WEBHOOK_SECRET=your_secret node express.js
 */

import express from "express";
import { TopggGraph, JsonFileAdapter } from "@dumbramkrishna/topgg-graph";

const app = express();

const graph = new TopggGraph({
  storage: new JsonFileAdapter("./votes.json"),
  webhookAuth: process.env["TOPGG_WEBHOOK_SECRET"] ?? "",
});

const webhookHandler = graph.webhook({
  onVote(payload) {
    console.log(`Vote received from user ${payload.user} (weekend: ${payload.isWeekend})`);
  },
});

// express.raw captures the raw body for v1 HMAC verification.
// If you use the legacy v0 plain-secret, express.json() is enough.
app.post(
  "/webhook",
  express.raw({ type: "*/*" }),
  (req, res, next) => {
    // Expose rawBody for v1 signature verification
    (req as express.Request & { rawBody: Buffer }).rawBody = req.body as Buffer;
    next();
  },
  (req, res) => {
    void webhookHandler(
      req as Parameters<typeof webhookHandler>[0],
      res as Parameters<typeof webhookHandler>[1],
    );
  },
);

// Serve the heatmap as SVG
app.get("/graph.svg", async (_req, res) => {
  try {
    const svg = await graph.render({ theme: "dark" });
    res.setHeader("Content-Type", "image/svg+xml");
    res.send(svg);
  } catch (err) {
    console.error(err);
    res.status(500).send("Internal Server Error");
  }
});

// Serve the heatmap as PNG (requires @resvg/resvg-js)
app.get("/graph.png", async (_req, res) => {
  try {
    const png = await graph.renderPNG({ theme: "dark" });
    res.setHeader("Content-Type", "image/png");
    res.send(png);
  } catch (err) {
    console.error(err);
    res.status(500).send("Internal Server Error — is @resvg/resvg-js installed?");
  }
});

const PORT = process.env["PORT"] ? Number(process.env["PORT"]) : 3000;
app.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
});
