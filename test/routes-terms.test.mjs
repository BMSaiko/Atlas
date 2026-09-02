// test/routes-terms.test.mjs
//
// ponytail: route-table test for server/routes/terms.ts. Boots the routes
// module (which transitively pulls in routes.ts + routes/index.ts via the
// loader) and asserts the dispatcher fires the right handler for each
// 3-row set of (method, parts, expected_status). Handler bodies are not
// fully exercised here (those have harness coverage). The point is to
// prove: table entry exists, matcher accepts/rejects the right requests,
// and the handler returns the right status code for the trivial inputs.

import test from "node:test"
import assert from "node:assert/strict"
import { dispatch, ROUTES } from "../server/routes.ts"
import { ALL_ROUTES } from "../server/routes/index.ts"

function mkCtx(parts, m = "POST") {
  let lastCode = 0, lastBody = null
  const send = (code, v) => { lastCode = code; lastBody = v }
  // ponytail: deps stub. We don't care that the bodies run for real; we
  // only assert status codes returned by the trivial validation paths
  // (slug missing -> 400). The body helpers are stubbed to return null.
  const deps = {
    SLUG: /^[a-z0-9-]+$/,
    cfg: { wezterm: null },
    body: async () => null,
    repoDir: async () => "",
    wtRoot: () => "",
    readJ: async () => null,
    killAllPanesForSlug: async () => ({ killed: 0, checked: 0 }),
    killAllPanesAtlas: async () => ({ killed: 0, checked: 0, worlds: 0 }),
  }
  return {
    ctx: { req: {}, res: {}, send, parts, m, deps },
    lastCode: () => lastCode,
    lastBody: () => lastBody,
  }
}

test("ALL_ROUTES contains the 3 terms handlers", async () => {
  const names = ALL_ROUTES.map(r => r.name).sort()
  assert.deepEqual(names, [
    "terms:kill-all",
    "terms:kill-all-atlas",
    "terms:open",
  ])
})

test("dispatcher routes terms/kill-all POST to its handler", async () => {
  const { ctx, lastCode, lastBody } = mkCtx(["terms", "kill-all"], "POST")
  const matched = await dispatch(ctx)
  assert.equal(matched, true)
  // allow microtask flush
  await new Promise(r => setImmediate(r))
  assert.equal(lastCode(), 400)   // body was null -> slug missing
  assert.deepEqual(lastBody(), { error: "slug required" })
})

test("dispatcher routes terms/kill-all-atlas POST to its handler", async () => {
  const { ctx, lastCode, lastBody } = mkCtx(["terms", "kill-all-atlas"], "POST")
  assert.equal(await dispatch(ctx), true)
  await new Promise(r => setImmediate(r))
  // killAllPanesAtlas stub returns {killed:0,checked:0,worlds:0} -> ok
  assert.equal(lastCode(), 200)
  assert.deepEqual(lastBody(), { ok: true, killed: 0, checked: 0, worlds: 0 })
})

test("dispatcher routes terms/open POST to its handler", async () => {
  const { ctx, lastCode, lastBody } = mkCtx(["terms", "open"], "POST")
  assert.equal(await dispatch(ctx), true)
  await new Promise(r => setImmediate(r))
  assert.equal(lastCode(), 400)   // slug missing
})

test("terms/open returns 503 when wezterm is not installed", async () => {
  const { ctx, lastCode, lastBody } = mkCtx(["terms", "open"], "POST")
  ctx.deps.body = async () => ({ slug: "myslug" })
  // cfg.wezterm is null in the stub -> 503 path
  assert.equal(await dispatch(ctx), true)
  await new Promise(r => setImmediate(r))
  assert.equal(lastCode(), 503)
  assert.deepEqual(lastBody(), { error: "wezterm nao instalado" })
})

test("terms/* are POST-only (GET should not match)", async () => {
  // ponytail: ALL_ROUTES spreads termsRoutes first. If we add another
  // route that matches /terms with a different method later, this test
  // will catch it. For now: GET on any terms path should miss.
  for (const parts of [["terms"], ["terms", "kill-all"], ["terms", "open"]]) {
    const { ctx, lastCode, lastBody } = mkCtx(parts, "GET")
    assert.equal(await dispatch(ctx), false, `GET ${parts.join("/")} should not match terms routes`)
  }
})

test("ROUTES === ALL_ROUTES (the table is a copy, not a reference)", async () => {
  // ponytail: the export in routes.ts is a spread copy. Modifying ROUTES
  // here must not affect ALL_ROUTES (and vice versa). If a future refactor
  // makes ROUTES an alias, this test catches it.
  assert.notEqual(ROUTES, ALL_ROUTES)
  assert.equal(ROUTES.length, ALL_ROUTES.length)
  // mutating one must not mutate the other
  const before = ALL_ROUTES.length
  ROUTES.length = 0
  try {
    assert.equal(ALL_ROUTES.length, before)
  } finally {
    // restore (so other tests in the same node process still see the table)
    while (ALL_ROUTES.length < before) ALL_ROUTES.push(ROUTES[ALL_ROUTES.length])
    // re-spread to be safe
    ROUTES.length = 0
    ROUTES.push(...ALL_ROUTES)
  }
})
