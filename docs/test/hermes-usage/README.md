# Hermes Usage

> Test file: `test/hermes-usage.test.mjs` (199 lines)  
> Helper: `_atlas-runtime.mjs` (spinAtlas — Vite middleware + atlas-api in-process)  
> Source under test: inline / multiple

## Purpose
Cobre /api/hermes/usage?since=<ms>: lê HERMES_HOME/logs/atlas/usage.jsonl (1 linha JSON por request LLM capturado pelo HEIMDALL). Filtra por ts >= since (default = startOfToday); agrega por key_id; sem key_id -> '__unknown__'. Linhas malformadas sao ignoradas silenciosamente. Estilo: vanilla node:assert. SOURCE EQUALITY (api.ts:1015-1056).

## How to run
node test/hermes-usage.test.mjs

The test uses a custom runner (`ok(...)` / `assert(...)` + `process.exit(0|1)`), not the `node:test` API. `npm test` runs each `test/*.test.mjs` as a subprocess and uses the exit code as pass/fail.

## Source / invariant
See the header comment at the top of `test/hermes-usage.test.mjs` for exact file:line references. Many tests end with a "SOURCE EQUALITY" block that grep-checks production code for specific strings — if production drifts silently, the test fails.

## Fixtures / dependencies
- No Python fixtures used unless the helper is `_atlas-harness.mjs` (which uses `test/fixtures/hermes_cli/` as a fake hermes_cli).
- Otherwise the test is hermetic: tempdirs only, no network, no real vault writes.

## Maintenance
- Manual doc (michi 2026-09-02). Update Purpose when the test's scope changes.
- Parity check: `node scripts/check-test-docs.mjs` ensures every `*.test.mjs` has a matching `docs/test/<stem>/README.md`.
