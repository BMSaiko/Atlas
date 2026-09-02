# Run Integration

> Test file: `test/run-integration.test.mjs` (129 lines)  
> Helper: `_atlas-harness.mjs` (spinAtlasHarness — python spawn + git worktree + close handler)  
> Source under test: inline / multiple

## Purpose
Integration test REAL: spawn python + git worktree + close-handler doing->review. Substitui hermes_cli por fixtures/hermes_cli/ (PYTHONPATH). Cobre os 2 bugs reportados em 2026-09-01: B1: card preso em doing (worker crashou ou esqueceu result) -> [i2] forget_result mode: colId stays doing, no result -> [i3] crash mode (exit 1): colId doing + result='ERRO: processo terminou com codigo 1' B2: 'ERRO: processo terminou com codigo N' nao aparece -> [i3] crash mode detecta regressao do ERRO marker Happy path [i1]: spawn OK + kanban.result set + promotion doing->review. Source equality [i4]: wrapperWithPane e argv indices inalterados (regressao do dee0c2d). 4 testes sequenciais partilham 1 atlasRepo (cwd sticky via _sharedCwd); isolamento entre eles = slug unico. Worktrees + branches diferentes por teste. Cleanup cross-test e' YAGNI (tmpdir apagado no fim do processo). ponytail: skip on CI — the harness needs git worktrees + launchHermes spawn which require a real Vite + filesystem layout CI does not provide. Local dev: `node test/run-integration.test.mjs`.

## How to run
node test/run-integration.test.mjs

The test uses a custom runner (`ok(...)` / `assert(...)` + `process.exit(0|1)`), not the `node:test` API. `npm test` runs each `test/*.test.mjs` as a subprocess and uses the exit code as pass/fail.

## Source / invariant
See the header comment at the top of `test/run-integration.test.mjs` for exact file:line references. Many tests end with a "SOURCE EQUALITY" block that grep-checks production code for specific strings — if production drifts silently, the test fails.

## Fixtures / dependencies
- No Python fixtures used unless the helper is `_atlas-harness.mjs` (which uses `test/fixtures/hermes_cli/` as a fake hermes_cli).
- Otherwise the test is hermetic: tempdirs only, no network, no real vault writes.

## Maintenance
- Manual doc (michi 2026-09-02). Update Purpose when the test's scope changes.
- Parity check: `node scripts/check-test-docs.mjs` ensures every `*.test.mjs` has a matching `docs/test/<stem>/README.md`.
