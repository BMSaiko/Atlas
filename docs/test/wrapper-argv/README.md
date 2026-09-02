# Wrapper Argv

> Test file: `test/wrapper-argv.test.mjs` (192 lines)  
> Helper: no helper (pure unit / custom runner)  
> Source under test: `server/api.ts`

## Purpose
Regressao: argv off-by-1 do wrapper python em server/api.ts. Cobre 3 wrappers: A. launchHermes headless (L406-441) — 6-arg set [stPath,wt,branch,repo,prompt,baseBranch] B. launchHermes with-pane (L453-461) — prepended pane-capture, mesmo 6-arg set C. launchDp (L529-534) — wrapper minimo, 1-arg set [prompt] (sem git/merge) Bug historico: python -c faz sys.argv[0]='-c' (NAO o python path). Confirma: 1. wrapperWithPane grava .status com pane=WEZTERM_PANE e argv[1]=stPath 2. wrapper principal le sys.argv[1..6] corretamente (stPath..baseBranch) 3. os.chdir(repo) corre OK (NUNCA os.chdir(base) que crashava com NameError) 4. launchDp le sys.argv[1]=prompt corretamente (1-arg set, sem git) Reproduzido em 2026-08-30 nos cards bao35dg0/phqqhn10/q49x3w24.

## How to run
node test/wrapper-argv.test.mjs

The test uses a custom runner (`ok(...)` / `assert(...)` + `process.exit(0|1)`), not the `node:test` API. `npm test` runs each `test/*.test.mjs` as a subprocess and uses the exit code as pass/fail.

## Source / invariant
See the header comment at the top of `test/wrapper-argv.test.mjs` for exact file:line references. Many tests end with a "SOURCE EQUALITY" block that grep-checks production code for specific strings — if production drifts silently, the test fails.

## Fixtures / dependencies
- No Python fixtures used unless the helper is `_atlas-harness.mjs` (which uses `test/fixtures/hermes_cli/` as a fake hermes_cli).
- Otherwise the test is hermetic: tempdirs only, no network, no real vault writes.

## Maintenance
- Manual doc (michi 2026-09-02). Update Purpose when the test's scope changes.
- Parity check: `node scripts/check-test-docs.mjs` ensures every `*.test.mjs` has a matching `docs/test/<stem>/README.md`.
