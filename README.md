<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.svg">
  <img src="assets/banner-light.svg" width="100%" alt="topgg-graph">
</picture>

### See your bot's votes at a glance

[npm](#install) · [Quick start](#quick-start) · [API](#api-reference) · [Storage adapters](#storage-adapters)

[![npm version](https://img.shields.io/npm/v/topgg-graph?style=flat-square&labelColor=%231f1f1f&color=%23ff3366)](https://www.npmjs.com/package/topgg-graph)
[![node version](https://img.shields.io/node/v/topgg-graph?style=flat-square&labelColor=%231f1f1f)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/topgg-graph?style=flat-square&labelColor=%231f1f1f)](LICENSE)

</div>

`topgg-graph` records votes as they arrive from the Top.gg webhook and stores a daily count. Those counts are rendered as a themeable SVG (or PNG) heatmap you can embed anywhere.

## Install

```sh
npm i topgg-graph
```

PNG output requires the optional peer dependency:

```sh
npm i @resvg/resvg-js
```

## Quick start

### Express

```ts
import express from "express";
import { TopggGraph, JsonFileAdapter } from "topgg-graph";

const app = express();

const graph = new TopggGraph({
  storage: new JsonFileAdapter("./votes.json"),
  webhookAuth: process.env.TOPGG_WEBHOOK_SECRET,
});

// Receive votes
app.post(
  "/webhook",
  express.raw({ type: "*/*" }),
  (req, res, next) => { req.rawBody = req.body; next(); },
  (req, res) => graph.webhook()(req, res),
);

// Serve the graph
app.get("/graph.svg", async (_req, res) => {
  res.setHeader("Content-Type", "image/svg+xml");
  res.send(await graph.render({ theme: "dark" }));
});

app.listen(3000);
```

### discord.js

```ts
import { Client, GatewayIntentBits, AttachmentBuilder } from "discord.js";
import http from "node:http";
import { TopggGraph, JsonFileAdapter } from "topgg-graph";

const graph = new TopggGraph({
  storage: new JsonFileAdapter("./votes.json"),
  webhookAuth: process.env.TOPGG_WEBHOOK_SECRET,
});

// Webhook receiver (plain node:http)
http.createServer(async (req, res) => {
  if (req.url === "/webhook") await graph.webhook()(req, res);
  else res.writeHead(404).end();
}).listen(3000);

// Slash command handler
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "votes") return;
  await interaction.deferReply();
  const png = await graph.renderPNG({ theme: "dark" });
  await interaction.editReply({ files: [new AttachmentBuilder(png, { name: "votes.png" })] });
});
client.login(process.env.DISCORD_TOKEN);
```

## Why a webhook?

Top.gg's API does not expose per-day vote history. To build an accurate daily breakdown, votes must be recorded as they arrive. `topgg-graph` handles this by verifying each incoming webhook request and writing a daily count to your chosen storage backend.

Top.gg sends vote events to a URL you configure in your bot's dashboard. The package supports both auth schemes:

- **v0 (legacy)** — plain `Authorization` header matched with a timing-safe comparison.
- **v1 (current)** — `x-topgg-signature: t=…,v1=…` HMAC-SHA256. Your secret starts with `whs_`. The scheme is auto-detected from the secret prefix.

## Exports

| Name | What it does |
|------|--------------|
| `TopggGraph` | Convenience class — wraps storage, webhook, and render |
| `createWebhookHandler(opts)` | Returns a `(req, res) => Promise<void>` handler |
| `renderSVG(counts, opts?)` | Render counts to an SVG string |
| `renderPNG(svg)` | Render an SVG string to a PNG `Buffer` (requires `@resvg/resvg-js`) |
| `MemoryAdapter` | In-memory storage (resets on restart) |
| `JsonFileAdapter` | Atomic JSON file storage |
| `utcDateString(ts?)` | Current UTC date as `YYYY-MM-DD` |
| `dateRange(from, to)` | All `YYYY-MM-DD` strings in an inclusive range |
| `colorLevel(count, nonzero)` | Map a count to a 0–5 color level |
| `StorageAdapter` | Interface for custom storage backends |
| `RenderOptions` | Options type for `renderSVG` |
| `Theme` | `"light" \| "dark" \| CustomTheme` |
| `TopggVotePayload` | Shape of the Top.gg webhook payload |

## Storage adapters

### Interface

```ts
interface StorageAdapter {
  increment(date: string, by?: number): Promise<void>;
  getRange(from: string, to: string): Promise<Record<string, number>>;
}
```

All dates are `YYYY-MM-DD` strings in UTC.

### Built-ins

| Adapter | When to use |
|---------|-------------|
| `MemoryAdapter` | Development, testing, or stateless environments |
| `JsonFileAdapter("./votes.json")` | Single-process bots that want zero external dependencies |

### Custom adapter (SQLite example)

See [`examples/custom-sqlite-adapter.ts`](examples/custom-sqlite-adapter.ts) for a full `better-sqlite3` implementation.

```ts
import { SqliteAdapter } from "./my-sqlite-adapter.js";
const graph = new TopggGraph({
  storage: new SqliteAdapter("./votes.db"),
  webhookAuth: process.env.TOPGG_WEBHOOK_SECRET,
});
```

## Theming

### Built-in themes

| Theme | Background | Accent |
|-------|------------|--------|
| `"light"` | `#ffffff` | `#ff3366` |
| `"dark"` | `#0d1117` | `#ff3366` |

### Custom theme

```ts
const svg = renderSVG(counts, {
  theme: {
    background: "#1a1a2e",
    text: "#eaeaea",
    levels: ["#aaaaff", "#8888ff", "#6666ff", "#4444ff", "#2222ff"],
  },
});
```

`levels` is an array of exactly 5 colors from least active (index 0) to most active (index 4). Cells with zero votes use a separate empty color derived from the theme.

## API reference

### `new TopggGraph(options?)`

| Option | Type | Description |
|--------|------|-------------|
| `storage` | `StorageAdapter` | Defaults to `MemoryAdapter` |
| `webhookAuth` | `string` | Required to call `webhook()` |

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `webhook(opts?)` | `(req, res) => Promise<void>` | Webhook handler |
| `record(date?, by?)` | `Promise<void>` | Manually add votes for a date |
| `getCounts(from?, to?)` | `Promise<Record<string, number>>` | Raw daily counts |
| `render(opts?)` | `Promise<string>` | SVG string |
| `renderPNG(opts?)` | `Promise<Buffer>` | PNG Buffer |

### `createWebhookHandler(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `auth` | `string` | — | Webhook secret |
| `storage` | `StorageAdapter` | — | Where votes are stored |
| `recordTestVotes` | `boolean` | `false` | Store votes with `type:"test"` |
| `onVote` | `(payload) => void \| Promise<void>` | — | Called after a valid vote |

### `renderSVG(counts, options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `weeks` | `number` | `52` | Number of columns |
| `cellSize` | `number` | `11` | Cell size in px |
| `gap` | `number` | `2` | Gap between cells in px |
| `radius` | `number` | `2` | Cell corner radius in px |
| `theme` | `Theme` | `"light"` | `"light"`, `"dark"`, or custom object |
| `title` | `string` | `"Vote activity"` | Title above the grid |
| `today` | `string` | Today UTC | Override end date (for tests) |

---

[Contributing](CONTRIBUTING.md) · Built by [dumbramkrishna](https://github.com/dumbramkrishna) · [MIT](LICENSE)

