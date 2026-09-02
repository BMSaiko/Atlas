# Hermes Keys Redact

> Test file: `test/hermes-keys-redact.test.mjs` (190 lines)  
> Helper: `_atlas-runtime.mjs` (spinAtlas — Vite middleware + atlas-api in-process)  
> Source under test: inline / multiple

## Purpose
Cobre /api/hermes/keys: lê HERMES_HOME/auth.json, censurando access_token. Whitelist explicita de campos + secret_fingerprint derivado de sha256 (10 chars). Status derivado: 429/quota/rate/exhaust -> exhausted; 4xx/5xx -> error; 2xx last_status -> active; else unknown. access_token NUNCA sai do atlas. Estilo: vanilla node:assert. SOURCE EQUALITY no fim (api.ts:968-1013).

## How to run
node test/hermes-keys-redact.test.mjs

The test uses a custom runner (`ok(...)` / `assert(...)` + `process.exit(0|1)`), not the `node:test` API. `npm test` runs each `test/*.test.mjs` as a subprocess and uses the exit code as pass/fail.

## Source / invariant
See the header comment at the top of `test/hermes-keys-redact.test.mjs` for exact file:line references. Many tests end with a "SOURCE EQUALITY" block that grep-checks production code for specific strings — if production drifts silently, the test fails.

## Fixtures / dependencies
- No Python fixtures used unless the helper is `_atlas-harness.mjs` (which uses `test/fixtures/hermes_cli/` as a fake hermes_cli).
- Otherwise the test is hermetic: tempdirs only, no network, no real vault writes.

## Maintenance
- Manual doc (michi 2026-09-02). Update Purpose when the test's scope changes.
- Parity check: `node scripts/check-test-docs.mjs` ensures every `*.test.mjs` has a matching `docs/test/<stem>/README.md`.
