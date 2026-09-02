# Timer Helpers

> Test file: `test/timer-helpers.test.mjs` (201 lines)  
> Helper: no helper (pure unit / custom runner)  
> Source under test: inline / multiple

## Purpose
Self-check das funcoes puras do timer em src/views/kanban.ts. Cobre: timerRemainingMs / timerLabel / timerTooltip / timerBadge / logica do add1 (preserva progresso). Mesmo estilo do wrapper-argv.test.mjs (Node puro, sem framework). Como o kanban.ts importa DOM/UI e rebenta em Node, o test reimplementa as 4 funcoes com a formula EXATA que vive no source. A seccao "SOURCE EQUALITY" no fim le kanban.ts como texto e verifica que as formulas no test ainda batem com o source — se alguem mexer no kanban.ts sem actualizar o test, isto falha.

## How to run
node test/timer-helpers.test.mjs

The test uses a custom runner (`ok(...)` / `assert(...)` + `process.exit(0|1)`), not the `node:test` API. `npm test` runs each `test/*.test.mjs` as a subprocess and uses the exit code as pass/fail.

## Source / invariant
See the header comment at the top of `test/timer-helpers.test.mjs` for exact file:line references. Many tests end with a "SOURCE EQUALITY" block that grep-checks production code for specific strings — if production drifts silently, the test fails.

## Fixtures / dependencies
- No Python fixtures used unless the helper is `_atlas-harness.mjs` (which uses `test/fixtures/hermes_cli/` as a fake hermes_cli).
- Otherwise the test is hermetic: tempdirs only, no network, no real vault writes.

## Maintenance
- Manual doc (michi 2026-09-02). Update Purpose when the test's scope changes.
- Parity check: `node scripts/check-test-docs.mjs` ensures every `*.test.mjs` has a matching `docs/test/<stem>/README.md`.
