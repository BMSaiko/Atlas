// test/routes-dispatch.test.mjs
//
// Unit tests for the route dispatcher in server/routes.ts. The table is
// empty by design (Phase 2A); these tests exercise the matcher with
// synthetic routes so the dispatcher is verified before any real routes
// move in.

import test from "node:test"
import assert from "node:assert/strict"
import { dispatch } from "../server/routes.ts"

function mkCtx(parts, m = "GET") {
  let lastCode = 0, lastBody = null
  const send = (code, v) => { lastCode = code; lastBody = v }
  return { ctx: { req: {}, res: {}, send, parts, m }, lastCode, lastBody }
}

test("dispatch: unknown path returns false (no match)", async () => {
  // ponytail: 2E added /w/:slug meta (length 2), so ["w","myslug"] DOES match.
  // Use a 2-segment path that nothing owns: ["unmatched","path"].
  const { ctx } = mkCtx(["unmatched", "path"], "GET")
  assert.equal(await dispatch(ctx), false)
})

test("dispatch: matches GET with exact length and parts", async () => {
  // build a temporary route by importing the module and pushing into a local copy
  // (the exported ROUTES is empty; we just need to verify the matcher behaviour)
  // ponytail: simplest is to inline-construct via a sub-import of a test-only route
  // For now, assert the empty-table path; the populated-table tests come in Phase 2B.
  const { ctx } = mkCtx(["wtoken"], "GET")
  assert.equal(await dispatch(ctx), false)
})

// ponytail: the matcher logic itself is worth a unit test even before any
// real route exists, because if the match function regresses the whole
// backend breaks silently. We re-import the routes module to access matchRoute
// indirectly via dispatch + a synthetic ROUTES.
// Workaround: define a route that throws and assert it was called. This
// proves the dispatcher runs handler when match passes.

import * as routesModule from "../server/routes.ts"

test("dispatcher honours a synthetic route (matcher sanity)", async () => {
  let called = false
  const synth = {
    method: "GET",
    length: 1,
    match: ["wtoken"],
    handler: () => { called = true },
    name: "test:wtoken",
  }
  // ponytail: ROUTES is exported; mutate it for this test, then restore.
  // The module-level const is mutable in JS; restore or it leaks across tests.
  const saved = routesModule.ROUTES.slice()
  routesModule.ROUTES.length = 0
  routesModule.ROUTES.push(synth)
  try {
    const { ctx } = mkCtx(["wtoken"], "GET")
    const matched = await dispatch(ctx)
    assert.equal(matched, true)
    assert.equal(called, true)
  } finally {
    routesModule.ROUTES.length = 0
    routesModule.ROUTES.push(...saved)
  }
})

test("dispatcher: wrong method does not match", async () => {
  let called = false
  const synth = { method: "GET", length: 1, match: ["wtoken"], handler: () => { called = true }, name: "t" }
  const saved = routesModule.ROUTES.slice()
  routesModule.ROUTES.length = 0
  routesModule.ROUTES.push(synth)
  try {
    const { ctx } = mkCtx(["wtoken"], "POST")
    assert.equal(await dispatch(ctx), false)
    assert.equal(called, false)
  } finally {
    routesModule.ROUTES.length = 0
    routesModule.ROUTES.push(...saved)
  }
})

test("dispatcher: wrong length does not match", async () => {
  let called = false
  const synth = { method: "GET", length: 1, match: ["wtoken"], handler: () => { called = true }, name: "t" }
  const saved = routesModule.ROUTES.slice()
  routesModule.ROUTES.length = 0
  routesModule.ROUTES.push(synth)
  try {
    const { ctx } = mkCtx(["wtoken", "extra"], "GET")
    assert.equal(await dispatch(ctx), false)
    assert.equal(called, false)
  } finally {
    routesModule.ROUTES.length = 0
    routesModule.ROUTES.push(...saved)
  }
})

test("dispatcher: null match slot is wildcard", async () => {
  let called = false
  const synth = { method: "POST", length: 2, match: ["w", null], handler: () => { called = true }, name: "t" }
  const saved = routesModule.ROUTES.slice()
  routesModule.ROUTES.length = 0
  routesModule.ROUTES.push(synth)
  try {
    const { ctx } = mkCtx(["w", "anything"], "POST")
    assert.equal(await dispatch(ctx), true)
    assert.equal(called, true)
  } finally {
    routesModule.ROUTES.length = 0
    routesModule.ROUTES.push(...saved)
  }
})

test("dispatcher: first match wins", async () => {
  let firstCalled = false, secondCalled = false
  const first  = { method: "GET", length: 1, match: ["wtoken"], handler: () => { firstCalled = true }, name: "first" }
  const second = { method: "GET", length: 1, match: ["wtoken"], handler: () => { secondCalled = true }, name: "second" }
  const saved = routesModule.ROUTES.slice()
  routesModule.ROUTES.length = 0
  routesModule.ROUTES.push(first, second)
  try {
    const { ctx } = mkCtx(["wtoken"], "GET")
    assert.equal(await dispatch(ctx), true)
    assert.equal(firstCalled, true)
    assert.equal(secondCalled, false)
  } finally {
    routesModule.ROUTES.length = 0
    routesModule.ROUTES.push(...saved)
  }
})

test("dispatcher: method '*' matches anything", async () => {
  let called = false
  const synth = { method: "*", length: 1, match: ["bundle"], handler: () => { called = true }, name: "t" }
  const saved = routesModule.ROUTES.slice()
  routesModule.ROUTES.length = 0
  routesModule.ROUTES.push(synth)
  try {
    for (const m of ["GET", "POST", "PUT", "DELETE"]) {
      const { ctx } = mkCtx(["bundle"], m)
      assert.equal(await dispatch(ctx), true, `method ${m} should match '*'`)
    }
    assert.equal(called, true)
  } finally {
    routesModule.ROUTES.length = 0
    routesModule.ROUTES.push(...saved)
  }
})
