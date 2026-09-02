# atlas test suite

Custom-runner regression tests for the Atlas dev-server + Vite plugin (`server/api.ts`).

## What's here

- 32 `*.test.mjs` files, each one self-contained with its own `ok(...)`/`assert(...)` counters and a final `process.exit(0|1)` to signal pass/fail.
- 3 helper files prefixed with `_` (loaded by tests but not themselves test files):
  - `_atlas-runtime.mjs` — `spinAtlas()`: spins a Vite dev server in middleware mode + the real `atlas-api` plugin against a tempdir. **The default harness** for 19 tests.
  - `_atlas-harness.mjs` — `spinAtlasHarness()`: spins `launchHermes` for real (Python spawn + git worktree + close handler doing→review). Used only by `run-integration.test.mjs`.
  - `_ts-loader.mjs` — Node loader hook that resolves extensionless `.ts` imports from `api.ts`. Wired in `npm test` via `--experimental-loader`.
- `fixtures/hermes_cli/` — Python stub of `hermes_cli` (used only by `_atlas-harness.mjs`). `PYTHONPATH` includes this dir so `python -m hermes_cli.main` finds the stub instead of the real one.

## Running

```bash
npm test                            # all 32 tests (sequential)
node test/<name>.test.mjs           # one test only
```

**CI gate:** the project gates on `npm test` — RC must be 0. `run-integration.test.mjs` is skipped on CI (needs real filesystem layout; see its doc).

## Custom-runner note

These tests do **not** use the `node:test` API (`describe/it/test`). They use a hand-rolled runner:

```js
let failures = 0
function ok(cond, label) { if (!cond) { failures++; console.error('FAIL:', label) } else { console.log('ok', label) } }
// ...
console.log(`${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
```

`node --experimental-strip-types --test test/*.test.mjs` runs each file as a subprocess and uses the exit code to report pass/fail. The glob `*.test.mjs` is what selects the files.

## Documentation

Each test has a matching `docs/test/<stem>/README.md` with: purpose, source under test, how to run, and the invariant being checked. The parity check enforces this 1:1:

```bash
node scripts/check-test-docs.mjs
# OK: 32 testes, todos com doc.
```

## Adding a new test

1. Create `test/<name>.test.mjs` — must end with `process.exit(0|1)` based on a failure counter.
2. Add a matching `docs/test/<name>/README.md` (copy any existing one as a template; the Purpose section is what matters).
3. `node scripts/check-test-docs.mjs` should pass.
4. `npm test` should pass.

## What this suite does NOT cover

- Browser-driven UI tests (Atlas has none — UI is Vite-served and the e2e coverage is manual).
- Live network calls (everything is hermetic tempdirs).
- Python unit tests (the hermes_cli stub is exercised via the integration test only).

## See also

- `scripts/check-test-docs.mjs` — parity check for test docs.
- `docs/test/README.md` — index of all per-test docs.
