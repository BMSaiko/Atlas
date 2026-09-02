# Prompts

> Test file: `test/prompts.test.mjs` (64 lines)  
> Helper: no helper (pure unit / custom runner)  
> Source under test: inline / multiple

## Purpose
Regressao: loader dos prompts LLM em server/prompts/. Garante que: [1] cada prompt (run-card, brainstorm, dp, git-op) existe e nao esta vazio; [2] dp.md tem os marcadores ${...} esperados; [3] interpolate() substitui tudo e falha alto se faltar uma var.

## How to run
`npm test` (runs all `test/*.test.mjs`) or `node test/prompts.test.mjs`

The test uses a custom runner (`ok(...)` / `assert(...)` + `process.exit(0|1)`), not the `node:test` API. `npm test` runs each `test/*.test.mjs` as a subprocess and uses the exit code as pass/fail.

## Source / invariant
See the header comment at the top of `test/prompts.test.mjs` for exact file:line references. Many tests end with a "SOURCE EQUALITY" block that grep-checks production code for specific strings — if production drifts silently, the test fails.

## Fixtures / dependencies
- No Python fixtures used unless the helper is `_atlas-harness.mjs` (which uses `test/fixtures/hermes_cli/` as a fake hermes_cli).
- Otherwise the test is hermetic: tempdirs only, no network, no real vault writes.

## Maintenance
- Manual doc (michi 2026-09-02). Update Purpose when the test's scope changes.
- Parity check: `node scripts/check-test-docs.mjs` ensures every `*.test.mjs` has a matching `docs/test/<stem>/README.md`.
