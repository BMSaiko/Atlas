# Sync Vault Wipe OT

> Test file: `test/sync-vault-wipe-ot.test.mjs` (200 lines)  
> Helper: no helper (pure unit / custom runner)  
> Source under test: `server/api.ts`

## Purpose
Regressao: wipe guard + optimistic concurrency no PUT notes|kanban (server/api.ts L1247-1295). Bug-class: perda silenciosa de items OU overwrite cego de estado concorrente. Cobre: 1. wipe guard: loss > max(5, before*0.5) -> 409 (sem X-Atlas-Confirm-Wipe) 2. wipe guard: loss <= threshold -> passa 3. wipe guard: confirm=yes -> passa mesmo com wipe 4. wipe guard: threshold floored a 5 para base pequena 5. optimistic concurrency: PUT com ver stale -> 409 6. optimistic concurrency: ver matching -> passa 7. OT: kind=meta exempt (source salta antes) 8. OT fires before wipe guard (sequenciamento) 9. BUG-CLASS: arrKey ternario p/ kind invalido Mesma forma do syncvault-debounce.test.mjs: reimplementa a logica inline (sem http server) + SOURCE EQUALITY no fim. Card iykn11lg+ protege o vault contra scripts de teste mal-comportados.

## How to run
node test/sync-vault-wipe-ot.test.mjs

The test uses a custom runner (`ok(...)` / `assert(...)` + `process.exit(0|1)`), not the `node:test` API. `npm test` runs each `test/*.test.mjs` as a subprocess and uses the exit code as pass/fail.

## Source / invariant
See the header comment at the top of `test/sync-vault-wipe-ot.test.mjs` for exact file:line references. Many tests end with a "SOURCE EQUALITY" block that grep-checks production code for specific strings — if production drifts silently, the test fails.

## Fixtures / dependencies
- No Python fixtures used unless the helper is `_atlas-harness.mjs` (which uses `test/fixtures/hermes_cli/` as a fake hermes_cli).
- Otherwise the test is hermetic: tempdirs only, no network, no real vault writes.

## Maintenance
- Manual doc (michi 2026-09-02). Update Purpose when the test's scope changes.
- Parity check: `node scripts/check-test-docs.mjs` ensures every `*.test.mjs` has a matching `docs/test/<stem>/README.md`.
