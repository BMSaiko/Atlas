# Orphans Heuristic

> Test file: `test/orphans-heuristic.test.mjs` (185 lines)  
> Helper: `_atlas-runtime.mjs` (spinAtlas — Vite middleware + atlas-api in-process)  
> Source under test: inline / multiple

## Purpose
Cobre /api/w/:slug/orphans: heuristica de deteccao de cards stuck em 'doing' com worker crash. Janela STALE_MS = 5min (5*60*1000ms). Card e' orphan se startedAt > 5min atras E (log vazio OU log parado > 5min). Idempotente. Estilo: vanilla node:assert. SOURCE EQUALITY (api.ts:1058-1099).

## How to run
node test/orphans-heuristic.test.mjs

The test uses a custom runner (`ok(...)` / `assert(...)` + `process.exit(0|1)`), not the `node:test` API. `npm test` runs each `test/*.test.mjs` as a subprocess and uses the exit code as pass/fail.

## Source / invariant
See the header comment at the top of `test/orphans-heuristic.test.mjs` for exact file:line references. Many tests end with a "SOURCE EQUALITY" block that grep-checks production code for specific strings — if production drifts silently, the test fails.

## Fixtures / dependencies
- No Python fixtures used unless the helper is `_atlas-harness.mjs` (which uses `test/fixtures/hermes_cli/` as a fake hermes_cli).
- Otherwise the test is hermetic: tempdirs only, no network, no real vault writes.

## Maintenance
- Manual doc (michi 2026-09-02). Update Purpose when the test's scope changes.
- Parity check: `node scripts/check-test-docs.mjs` ensures every `*.test.mjs` has a matching `docs/test/<stem>/README.md`.
