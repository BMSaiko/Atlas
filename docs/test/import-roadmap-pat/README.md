# Roadmap Import Path-Traversal

> Test file: `test/import-roadmap-pat.test.mjs` (167 lines)  
> Helper: `_atlas-runtime.mjs` (spinAtlas — Vite middleware + atlas-api in-process)  
> Source under test: inline / multiple

## Purpose
Cobre /api/w/:slug/import-roadmap path-traversal allow-list: o path do body tem de viver dentro de <VAULT>/knowledge/projects/<slug>/. resolve() normaliza ../ antes do inside(). Sem isto, le ficheiros arbitrarios do disco. Complementa o test/roadmap-import.test.mjs existente (que cobre o parser + a path guard do P0). Aqui focamos: edge cases do allow-list (path absoluto, ../, symlink-equivalent, path inexistente, slug mismatch). Estilo: vanilla node:assert. SOURCE EQUALITY (api.ts:1156-1195).

## How to run
node test/import-roadmap-pat.test.mjs

The test uses a custom runner (`ok(...)` / `assert(...)` + `process.exit(0|1)`), not the `node:test` API. `npm test` runs each `test/*.test.mjs` as a subprocess and uses the exit code as pass/fail.

## Source / invariant
See the header comment at the top of `test/import-roadmap-pat.test.mjs` for exact file:line references. Many tests end with a "SOURCE EQUALITY" block that grep-checks production code for specific strings — if production drifts silently, the test fails.

## Fixtures / dependencies
- No Python fixtures used unless the helper is `_atlas-harness.mjs` (which uses `test/fixtures/hermes_cli/` as a fake hermes_cli).
- Otherwise the test is hermetic: tempdirs only, no network, no real vault writes.

## Maintenance
- Manual doc (michi 2026-09-02). Update Purpose when the test's scope changes.
- Parity check: `node scripts/check-test-docs.mjs` ensures every `*.test.mjs` has a matching `docs/test/<stem>/README.md`.
