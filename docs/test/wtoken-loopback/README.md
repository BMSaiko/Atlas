# Wtoken Loopback

> Test file: `test/wtoken-loopback.test.mjs` (104 lines)  
> Helper: `_atlas-runtime.mjs` (spinAtlas — Vite middleware + atlas-api in-process)  
> Source under test: `server/api.ts`

## Purpose
Cobre /api/wtoken: devolve cfg.wtoken ao client loopback, 403 non-loopback. Sem este endpoint, abrir localhost:5173 sem ?token=... cai em 401 permanente ate o utilizador adivinhar o token impresso no console. Estilo: vanilla node:assert (igual aos outros 9 testes). Counter de failures, process.exit(0|1) no fim. SOURCE EQUALITY guard no fim apanha silenciosa divergencia do regex nas linhas 711-717 de server/api.ts.

## How to run
node test/wtoken-loopback.test.mjs

The test uses a custom runner (`ok(...)` / `assert(...)` + `process.exit(0|1)`), not the `node:test` API. `npm test` runs each `test/*.test.mjs` as a subprocess and uses the exit code as pass/fail.

## Source / invariant
See the header comment at the top of `test/wtoken-loopback.test.mjs` for exact file:line references. Many tests end with a "SOURCE EQUALITY" block that grep-checks production code for specific strings — if production drifts silently, the test fails.

## Fixtures / dependencies
- No Python fixtures used unless the helper is `_atlas-harness.mjs` (which uses `test/fixtures/hermes_cli/` as a fake hermes_cli).
- Otherwise the test is hermetic: tempdirs only, no network, no real vault writes.

## Maintenance
- Manual doc (michi 2026-09-02). Update Purpose when the test's scope changes.
- Parity check: `node scripts/check-test-docs.mjs` ensures every `*.test.mjs` has a matching `docs/test/<stem>/README.md`.
