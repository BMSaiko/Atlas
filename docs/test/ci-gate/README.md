# CI Gate

> Test file: `test/ci-gate.test.mjs` (231 lines)  
> Helper: no helper (pure unit / custom runner)  
> Source under test: `server/api.ts`

## Purpose
Regressao: server/api.ts::checkConflictMarkers + runCIGate (L140-153). Cobre 2 invariantes: 1. checkConflictMarkers: true se houver markers <<<<<<< ou >>>>>>> no repo 2. runCIGate: para no 1o passo que falhe (conflict-markers -> typecheck -> build), devolve {ok, step, out} com a trace do passo que falhou Como runCIGate chama 'npm.cmd' hardcoded, o test faz MIRROR EXATO com runCmd injectable (mesmo padrao de wipe-guard.test.mjs) e SOURCE EQUALITY no fim: se alguem editar o handler sem actualizar o mirror, isto falha.

## How to run
node test/ci-gate.test.mjs

The test uses a custom runner (`ok(...)` / `assert(...)` + `process.exit(0|1)`), not the `node:test` API. `npm test` runs each `test/*.test.mjs` as a subprocess and uses the exit code as pass/fail.

## Source / invariant
See the header comment at the top of `test/ci-gate.test.mjs` for exact file:line references. Many tests end with a "SOURCE EQUALITY" block that grep-checks production code for specific strings — if production drifts silently, the test fails.

## Fixtures / dependencies
- No Python fixtures used unless the helper is `_atlas-harness.mjs` (which uses `test/fixtures/hermes_cli/` as a fake hermes_cli).
- Otherwise the test is hermetic: tempdirs only, no network, no real vault writes.

## Maintenance
- Manual doc (michi 2026-09-02). Update Purpose when the test's scope changes.
- Parity check: `node scripts/check-test-docs.mjs` ensures every `*.test.mjs` has a matching `docs/test/<stem>/README.md`.
