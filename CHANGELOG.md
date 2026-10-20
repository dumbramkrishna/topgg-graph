# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-20

### Changed

- Published to GitHub Packages as `@dumbramkrishna/topgg-graph`; install/auth instructions are in the README.
- Webhook handler now accepts both the legacy v0 flat payload and the v1 `{ type, data }` event envelope, including `vote.create` and `webhook.test`.
- Color levels now use quintile boundaries so all five levels are reachable.
- `TopggGraph.render()` now fetches exactly the data window shown by the grid, honoring `today` and `weeks`.
- `getCounts(from?, to?)` now defaults `from` to 364 days before `to`, not before the current date.

### Fixed

- Valid v1 webhooks no longer return `400`; v1 `weight`, `created_at`, `id`, and parsed query parameters are used.
- `express.raw`/Buffer bodies and `rawBody`-only requests are parsed correctly, fixing the documented Express setup and a request hang.
- Storage and synchronous `onVote` failures now return `500` instead of leaving the request unanswered.
- Webhook deliveries are deduplicated for Top.gg's retry window, and v1 signatures are rejected when stale.
- `JsonFileAdapter` recovers after a transient write failure and creates missing parent directories.
- Unicode secrets are compared by fixed-length digests instead of truncated UTF-8 buffers.
- Fastify `reply` responses (`status()` + `send()`) are supported.
- Request bodies are capped (`maxBodyBytes`, default 1 MiB) and aborted/closed streams no longer hang.
- `parseDateString` rejects impossible dates such as `2024-02-30`; `record()` validates its date.
- `utcDateString` zero-pads years below 1000; `weeks`, `cellSize`, `gap`, and `radius` are validated.
- Custom themes can set an `empty` cell color.

### Added

- `StorageAdapter` interface with `increment` and `getRange` methods.
- `MemoryAdapter` — in-memory storage for development and testing.
- `JsonFileAdapter` — atomic JSON file storage with corrupt-file recovery.
- `createWebhookHandler` — Top.gg webhook handler supporting v0 (plain `Authorization`) and v1 (`x-topgg-signature` HMAC-SHA256) auth schemes. Works with Express, Fastify, and plain `node:http`.
- `renderSVG` — deterministic SVG heatmap renderer with 7 rows × N weeks grid, month labels, day labels (Mon/Wed/Fri), quintile-based color levels, "Less … More" legend, and a vote total title.
- `renderPNG` — PNG output via optional peer dependency `@resvg/resvg-js`.
- `TopggGraph` class — convenience wrapper exposing `webhook()`, `record()`, `getCounts()`, `render()`, and `renderPNG()`.
- Light and dark built-in themes; custom theme support.
- ESM + CJS dual build via `tsup`.
- TypeScript strict mode, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`.
- Vitest test suite covering date utilities, quintile logic, v0/v1 webhook payloads, raw-body handling, deduplication, JSON adapter recovery, `TopggGraph`, and SVG snapshot tests.
- Express, discord.js, and custom SQLite adapter examples.
- GitHub Actions CI (Node 18/20/22) and a tag-triggered GitHub Packages release workflow.

[Unreleased]: https://github.com/dumbramkrishna/topgg-graph/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/dumbramkrishna/topgg-graph/releases/tag/v0.1.0
