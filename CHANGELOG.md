# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-20

### Added

- `StorageAdapter` interface with `increment` and `getRange` methods.
- `MemoryAdapter` — in-memory storage for development and testing.
- `JsonFileAdapter` — atomic JSON file storage with corrupt-file recovery.
- `createWebhookHandler` — Top.gg webhook handler supporting v0 (plain `Authorization`) and v1 (`x-topgg-signature` HMAC-SHA256) auth schemes. Works with Express, Fastify, and plain `node:http`.
- `renderSVG` — deterministic SVG heatmap renderer with 7 rows × N weeks grid, month labels, day labels (Mon/Wed/Fri), quartile-based color levels, "Less … More" legend, and a vote total title.
- `renderPNG` — PNG output via optional peer dependency `@resvg/resvg-js`.
- `TopggGraph` class — convenience wrapper exposing `webhook()`, `record()`, `getCounts()`, `render()`, and `renderPNG()`.
- Light and dark built-in themes; custom theme support.
- ESM + CJS dual build via `tsup`.
- TypeScript strict mode, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`.
- Vitest test suite covering date utilities, quartile logic, webhook auth, JSON adapter corruption recovery, and SVG snapshot tests.
- Express, discord.js, and custom SQLite adapter examples.
- GitHub Actions CI (Node 18/20/22) and npm publish workflow with provenance.

[Unreleased]: https://github.com/dumbramkrishna/topgg-graph/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/dumbramkrishna/topgg-graph/releases/tag/v0.1.0

