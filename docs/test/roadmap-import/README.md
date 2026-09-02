# Roadmap Import

> Test file: `test/roadmap-import.test.mjs` (203 lines)  
> Helper: no helper (pure unit / custom runner)  
> Source under test: `server/api.ts`, `server/roadmap.ts`

## Purpose
Cobre: 1. parseRoadmap (server/roadmap.ts) — 3 shapes + done-set cross-check + prioFrom 2. /api/w/:slug/import-roadmap (server/api.ts) — path guard (bug P0) Estilo: vanilla node:assert, sem framework (igual aos outros 3 testes do atlas). ponytail: parseRoadmap importado direto do .ts via file:// URL (Node 22+ tem --experimental-strip-types). Mirror manual seria mais codigo e duplicado. SOURCE EQUALITY no fim apanha divergencias estruturais.

## How to run
node test/roadmap-import.test.mjs

The test uses a custom runner (`ok(...)` / `assert(...)` + `process.exit(0|1)`), not the `node:test` API. `npm test` runs each `test/*.test.mjs` as a subprocess and uses the exit code as pass/fail.

## Source / invariant
See the header comment at the top of `test/roadmap-import.test.mjs` for exact file:line references. Many tests end with a "SOURCE EQUALITY" block that grep-checks production code for specific strings — if production drifts silently, the test fails.

## Fixtures / dependencies
- No Python fixtures used unless the helper is `_atlas-harness.mjs` (which uses `test/fixtures/hermes_cli/` as a fake hermes_cli).
- Otherwise the test is hermetic: tempdirs only, no network, no real vault writes.

## Maintenance
- Manual doc (michi 2026-09-02). Update Purpose when the test's scope changes.
- Parity check: `node scripts/check-test-docs.mjs` ensures every `*.test.mjs` has a matching `docs/test/<stem>/README.md`.
