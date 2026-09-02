# Null-Write Guard

> Test file: `test/null-write-guard.test.mjs` (89 lines)  
> Helper: `_atlas-runtime.mjs` (spinAtlas — Vite middleware + atlas-api in-process)  
> Source under test: inline / multiple

## Purpose
Regression: null-write guard prevents kanban wipe (card null-write-fix). Wipe real observado em 2026-09-01T03:43: kanban 117 cards -> 0 cards por PUT com body vazio. body() devolve null em Content-Length=0 ou JSON parse fail; sem guard, writeJ grava 'null' (4 bytes) e wipea kanban.json. Backup pre-PUT tambem fica vitima (le ficheiro ja corrompido). Cobertura: [1] PUT empty body    -> 400, file untouched [2] PUT literal "null" -> 400, file untouched [3] PUT {} (no cards) -> 400, file untouched [4] PUT cards:'nope'  -> 400, file untouched [5] PUT valid          -> 200, file written [6] SOURCE EQUALITY    -> guard strings present em api.ts CI:   scripts/run_tests.sh test/null-write-guard.test.mjs -q

## How to run
node test/null-write-guard.test.mjs

The test uses a custom runner (`ok(...)` / `assert(...)` + `process.exit(0|1)`), not the `node:test` API. `npm test` runs each `test/*.test.mjs` as a subprocess and uses the exit code as pass/fail.

## Source / invariant
See the header comment at the top of `test/null-write-guard.test.mjs` for exact file:line references. Many tests end with a "SOURCE EQUALITY" block that grep-checks production code for specific strings — if production drifts silently, the test fails.

## Fixtures / dependencies
- No Python fixtures used unless the helper is `_atlas-harness.mjs` (which uses `test/fixtures/hermes_cli/` as a fake hermes_cli).
- Otherwise the test is hermetic: tempdirs only, no network, no real vault writes.

## Maintenance
- Manual doc (michi 2026-09-02). Update Purpose when the test's scope changes.
- Parity check: `node scripts/check-test-docs.mjs` ensures every `*.test.mjs` has a matching `docs/test/<stem>/README.md`.
