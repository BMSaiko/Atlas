# Cleanup Runs

> Test file: `test/cleanup-runs.test.mjs` (185 lines)  
> Helper: no helper (pure unit / custom runner)  
> Source under test: `server/api.ts`

## Purpose
Regressao: cleanupRuns (server/api.ts L187-213) — apaga .log/.status antigos em <wtRoot>/runs/<slug>/*. Guard duplo: idade mtime OU stuck .status > 6h. Re-implementado em JS (mirror EXACTO da logica de L187-213) + exercicio contra um fs tree real (tmp dir com ficheiros backdated via utimes). Sem transpile, sem deps externas. Cobertura: [1] mtime > 7d em .log/.status → apagado [2] mtime < 7d → preservado [3] .status stuck "running" com mtime > 6h → apagado [4] .status stuck "running" com mtime < 6h → preservado [5] outros files (.txt, .json) → NAO tocados (so .log/.status) [6] dir slug com files removidos → base dir permanece (quirk) [7] slug sem dir → noop silencioso [8] SOURCE EQUALITY — server/api.ts L183-213 inalterado Nao cobre: cleanupWorktrees (depende de git worktree + readIdx; fora do escopo deste backfill — YAGNI para item #5).

## How to run
node test/cleanup-runs.test.mjs

The test uses a custom runner (`ok(...)` / `assert(...)` + `process.exit(0|1)`), not the `node:test` API. `npm test` runs each `test/*.test.mjs` as a subprocess and uses the exit code as pass/fail.

## Source / invariant
See the header comment at the top of `test/cleanup-runs.test.mjs` for exact file:line references. Many tests end with a "SOURCE EQUALITY" block that grep-checks production code for specific strings — if production drifts silently, the test fails.

## Fixtures / dependencies
- No Python fixtures used unless the helper is `_atlas-harness.mjs` (which uses `test/fixtures/hermes_cli/` as a fake hermes_cli).
- Otherwise the test is hermetic: tempdirs only, no network, no real vault writes.

## Maintenance
- Manual doc (michi 2026-09-02). Update Purpose when the test's scope changes.
- Parity check: `node scripts/check-test-docs.mjs` ensures every `*.test.mjs` has a matching `docs/test/<stem>/README.md`.
