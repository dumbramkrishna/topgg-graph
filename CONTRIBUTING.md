# Contributing to topgg-graph

Thanks for your interest in contributing.

## Before you start

- Open an issue to discuss large changes before writing code.
- Check existing issues and pull requests first.

## Development setup

```sh
git clone https://github.com/dumbramkrishna/topgg-graph.git
cd topgg-graph
npm install
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile to `dist/` |
| `npm run dev` | Watch mode |
| `npm test` | Run tests |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm run typecheck` | `tsc --noEmit` |

## Code style

- TypeScript strict mode throughout.
- All public functions must have JSDoc.
- Run `npm run format` before committing. A Prettier config is in `.prettierrc`.
- Run `npm run lint` and fix all warnings before opening a PR.

## Tests

- Tests live in `tests/`. Use Vitest.
- Add tests for any new behaviour and for any bug you fix.
- Snapshot files in `tests/__snapshots__/` are committed to the repo. Update them with `npx vitest run --update-snapshots` when the SVG output intentionally changes.

## Pull requests

- Use the pull request template.
- Keep PRs focused — one feature or fix per PR.
- Update `CHANGELOG.md` under `[Unreleased]` for any user-facing change.

## Commit style

Plain imperative sentences: `Add dark theme`, `Fix corrupt JSON recovery`.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be kind.

