# Run DP

> Test file: `test/run-dp.test.mjs` (174 lines)  
> Helper: `_atlas-runtime.mjs` (spinAtlas — Vite middleware + atlas-api in-process)  
> Source under test: inline / multiple

## Purpose
Cobre POST /api/w/:slug/run e POST /api/w/:slug/dp — branches deterministicos antes do spawn (board mutation + guards). O spawn real (launchHermes/launchDp) e' testado via env-var shim. Test seam: ATLAS_TEST_NO_SPAWN (run + dp saltam git/spawn/headless). Estilo: vanilla node:assert. SOURCE EQUALITY (api.ts:run=57744+, dp=59334+).

## How to run
node test/run-dp.test.mjs

The test uses a custom runner (`ok(...)` / `assert(...)` + `process.exit(0|1)`), not the `node:test` API. `npm test` runs each `test/*.test.mjs` as a subprocess and uses the exit code as pass/fail.

## Source / invariant
See the header comment at the top of `test/run-dp.test.mjs` for exact file:line references. Many tests end with a "SOURCE EQUALITY" block that grep-checks production code for specific strings — if production drifts silently, the test fails.

## Fixtures / dependencies
- No Python fixtures used unless the helper is `_atlas-harness.mjs` (which uses `test/fixtures/hermes_cli/` as a fake hermes_cli).
- Otherwise the test is hermetic: tempdirs only, no network, no real vault writes.

## Maintenance
- Manual doc (michi 2026-09-02). Update Purpose when the test's scope changes.
- Parity check: `node scripts/check-test-docs.mjs` ensures every `*.test.mjs` has a matching `docs/test/<stem>/README.md`.
