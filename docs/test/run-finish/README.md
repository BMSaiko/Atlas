# Run Finish

> Test file: `test/run-finish.test.mjs` (197 lines)  
> Helper: no helper (pure unit / custom runner)  
> Source under test: `server/api.ts`

## Purpose
Cobre a logica de finalizacao do p.on('close') em launchHermes (server/api.ts ~L29981): 5 branches de promocao/erro. Mirror EXACTO do handler; source equality garante que o handler em producao nao derivou sem o teste saber. Branches (5): [1] code!==0 && !result -> grava result='ERRO: ...', NAO promove [2] code!==0 && result pre-existente -> NAO sobrescreve, NAO promove [3] code===0 && !result -> NAO promove (worker esqueceu de reportar) [4] code===0 && result && colId=doing && !archived && !mergeFailed -> PROMOVE a review [5] mergeFailed -> grava result='MERGE FALHOU...', NAO promove [6] archived -> NAO promove mesmo com tudo ok [7] colId!=doing (user ja mexeu) -> NAO sobrescreve

## How to run
node test/run-finish.test.mjs

The test uses a custom runner (`ok(...)` / `assert(...)` + `process.exit(0|1)`), not the `node:test` API. `npm test` runs each `test/*.test.mjs` as a subprocess and uses the exit code as pass/fail.

## Source / invariant
See the header comment at the top of `test/run-finish.test.mjs` for exact file:line references. Many tests end with a "SOURCE EQUALITY" block that grep-checks production code for specific strings — if production drifts silently, the test fails.

## Fixtures / dependencies
- No Python fixtures used unless the helper is `_atlas-harness.mjs` (which uses `test/fixtures/hermes_cli/` as a fake hermes_cli).
- Otherwise the test is hermetic: tempdirs only, no network, no real vault writes.

## Maintenance
- Manual doc (michi 2026-09-02). Update Purpose when the test's scope changes.
- Parity check: `node scripts/check-test-docs.mjs` ensures every `*.test.mjs` has a matching `docs/test/<stem>/README.md`.
