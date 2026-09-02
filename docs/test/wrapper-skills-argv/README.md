# Wrapper Skills Argv

> Test file: `test/wrapper-skills-argv.test.mjs` (125 lines)  
> Helper: no helper (pure unit / custom runner)  
> Source under test: `server/api.ts`

## Purpose
card grill-me-palette — wrapper python (server/api.ts L406-441) propaga ATLAS_CARD_SKILLS=grill-me,grilling ao hermes_cli.main como args --skills X --skills Y. Cobertura: 1. SOURCE EQUALITY: a source do wrapper tem de casar com o contrato (le env, monta pares) 2. Comportamento: extrai o wrapper REAL e executa-o, capturando os args que passaria a hermes_cli.main - sem env: 5 args (backward compat) - com env 'grill-me': 7 args - com env 'grill-me,grilling': 9 args - com env empty / whitespace: 5 args (filtrado)

## How to run
`npm test` (runs all `test/*.test.mjs`) or `node test/wrapper-skills-argv.test.mjs`

The test uses a custom runner (`ok(...)` / `assert(...)` + `process.exit(0|1)`), not the `node:test` API. `npm test` runs each `test/*.test.mjs` as a subprocess and uses the exit code as pass/fail.

## Source / invariant
See the header comment at the top of `test/wrapper-skills-argv.test.mjs` for exact file:line references. Many tests end with a "SOURCE EQUALITY" block that grep-checks production code for specific strings — if production drifts silently, the test fails.

## Fixtures / dependencies
- No Python fixtures used unless the helper is `_atlas-harness.mjs` (which uses `test/fixtures/hermes_cli/` as a fake hermes_cli).
- Otherwise the test is hermetic: tempdirs only, no network, no real vault writes.

## Maintenance
- Manual doc (michi 2026-09-02). Update Purpose when the test's scope changes.
- Parity check: `node scripts/check-test-docs.mjs` ensures every `*.test.mjs` has a matching `docs/test/<stem>/README.md`.
