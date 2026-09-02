# Notes + Kanban PUT

> Test file: `test/notes-kanban-put.test.mjs` (175 lines)  
> Helper: `_atlas-runtime.mjs` (spinAtlas — Vite middleware + atlas-api in-process)  
> Source under test: `server/snapshots.ts`

## Purpose
Cobre GET/PUT /api/w/:slug/notes e /api/w/:slug/kanban — defaults, OT (ver mismatch 409), wipe guard + _wipe-guard/ snapshot (threshold max(5, before*0.5)), sanitize id, ver bump, kill-on-transition. Pre-PUT backup removido — snapshots sao cron-based (4/dia, 7d, dedup) ver server/snapshots.ts + test/snapshots.test.mjs. Estilo: vanilla node:assert. SOURCE EQUALITY (api.ts:1245-1344).

## How to run
node test/notes-kanban-put.test.mjs

The test uses a custom runner (`ok(...)` / `assert(...)` + `process.exit(0|1)`), not the `node:test` API. `npm test` runs each `test/*.test.mjs` as a subprocess and uses the exit code as pass/fail.

## Source / invariant
See the header comment at the top of `test/notes-kanban-put.test.mjs` for exact file:line references. Many tests end with a "SOURCE EQUALITY" block that grep-checks production code for specific strings — if production drifts silently, the test fails.

## Fixtures / dependencies
- No Python fixtures used unless the helper is `_atlas-harness.mjs` (which uses `test/fixtures/hermes_cli/` as a fake hermes_cli).
- Otherwise the test is hermetic: tempdirs only, no network, no real vault writes.

## Maintenance
- Manual doc (michi 2026-09-02). Update Purpose when the test's scope changes.
- Parity check: `node scripts/check-test-docs.mjs` ensures every `*.test.mjs` has a matching `docs/test/<stem>/README.md`.
