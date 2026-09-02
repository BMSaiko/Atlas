# SyncVault Debounce

> Test file: `test/syncvault-debounce.test.mjs` (63 lines)  
> Helper: no helper (pure unit / custom runner)  
> Source under test: `server/api.ts`

## Purpose
Regression check for the syncVault debounce batching (server/api.ts). Mirrors flushVault/syncVault exactly with GIT/VAULT injectable. Uses a throwaway temp git repo so the real vault is never touched. Fails if a burst of writes produces more than one batch commit.

## How to run
`npm test` (runs all `test/*.test.mjs`) or `node test/syncvault-debounce.test.mjs`

The test uses a custom runner (`ok(...)` / `assert(...)` + `process.exit(0|1)`), not the `node:test` API. `npm test` runs each `test/*.test.mjs` as a subprocess and uses the exit code as pass/fail.

## Source / invariant
See the header comment at the top of `test/syncvault-debounce.test.mjs` for exact file:line references. Many tests end with a "SOURCE EQUALITY" block that grep-checks production code for specific strings — if production drifts silently, the test fails.

## Fixtures / dependencies
- No Python fixtures used unless the helper is `_atlas-harness.mjs` (which uses `test/fixtures/hermes_cli/` as a fake hermes_cli).
- Otherwise the test is hermetic: tempdirs only, no network, no real vault writes.

## Maintenance
- Manual doc (michi 2026-09-02). Update Purpose when the test's scope changes.
- Parity check: `node scripts/check-test-docs.mjs` ensures every `*.test.mjs` has a matching `docs/test/<stem>/README.md`.
