# Config

> Test file: `test/config.test.mjs` (157 lines)  
> Helper: no helper (pure unit / custom runner)  
> Source under test: `server/config.ts`

## Purpose
Regressao: precedencia de config do runner (server/config.ts loadConfig). Cadeia: env > ficheiro (atlas.config.json) > DEFAULTS. Cobertura: [1] defaults only (sem env, sem ficheiro) → todos os campos = DEFAULTS, wtoken random [2] file only (sem env) → fromFile sobrescreve DEFAULTS nos campos presentes [3] env+file+defaults → env vence sobre file vence sobre defaults [4] envNum: ATLAS_PORT nao-numerico cai no fallback (Number.isFinite guard) [5] wtoken: env fixa persiste; sem env = 64-char hex (randomBytes(32).hex) [6] SOURCE EQUALITY — server/config.ts inalterado (6 anchors)

## How to run
node test/config.test.mjs

The test uses a custom runner (`ok(...)` / `assert(...)` + `process.exit(0|1)`), not the `node:test` API. `npm test` runs each `test/*.test.mjs` as a subprocess and uses the exit code as pass/fail.

## Source / invariant
See the header comment at the top of `test/config.test.mjs` for exact file:line references. Many tests end with a "SOURCE EQUALITY" block that grep-checks production code for specific strings — if production drifts silently, the test fails.

## Fixtures / dependencies
- No Python fixtures used unless the helper is `_atlas-harness.mjs` (which uses `test/fixtures/hermes_cli/` as a fake hermes_cli).
- Otherwise the test is hermetic: tempdirs only, no network, no real vault writes.

## Maintenance
- Manual doc (michi 2026-09-02). Update Purpose when the test's scope changes.
- Parity check: `node scripts/check-test-docs.mjs` ensures every `*.test.mjs` has a matching `docs/test/<stem>/README.md`.
