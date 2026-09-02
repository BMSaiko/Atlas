# Orphans Clear Orphan

> Test file: `test/orphans-clear-orphan.test.mjs` (140 lines)  
> Helper: `_atlas-runtime.mjs` (spinAtlas — Vite middleware + atlas-api in-process)  
> Source under test: inline / multiple

## Purpose
Cobre POST /api/w/:slug/cards/:cardId/clear-orphan (card h1y3yfsy). 1 caller: kanban.ts viewModal "Limpar worktree o'rf~a'" -> api.run.clearOrphan (src/api.ts). Estilo: vanilla node:assert + spinAtlas. SOURCE EQUALITY ancorando o handler.

## How to run
`npm test` (runs all `test/*.test.mjs`) or `node test/orphans-clear-orphan.test.mjs`

The test uses a custom runner (`ok(...)` / `assert(...)` + `process.exit(0|1)`), not the `node:test` API. `npm test` runs each `test/*.test.mjs` as a subprocess and uses the exit code as pass/fail.

## Source / invariant
See the header comment at the top of `test/orphans-clear-orphan.test.mjs` for exact file:line references. Many tests end with a "SOURCE EQUALITY" block that grep-checks production code for specific strings — if production drifts silently, the test fails.

## Fixtures / dependencies
- No Python fixtures used unless the helper is `_atlas-harness.mjs` (which uses `test/fixtures/hermes_cli/` as a fake hermes_cli).
- Otherwise the test is hermetic: tempdirs only, no network, no real vault writes.

## Maintenance
- Manual doc (michi 2026-09-02). Update Purpose when the test's scope changes.
- Parity check: `node scripts/check-test-docs.mjs` ensures every `*.test.mjs` has a matching `docs/test/<stem>/README.md`.
