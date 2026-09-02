// test/routes-workdirs.test.mjs
//
// ponytail: route-table test for server/routes/workdirs.ts. Asserts the
// 5 workdir entries exist, dispatch routes correctly, and trivial
// validation paths return expected status codes. Bodies of real handlers
// (file IO, etc.) are covered by the harness.

import test from "node:test"
import assert from "node:assert/strict"
import { dispatch } from "../server/routes.ts"
import { ALL_ROUTES } from "../server/routes/index.ts"

function mkCtx(parts, m = "GET", bodyStub = null) {
  let lastCode = 0, lastBody = null
  const send = (code, v) => { lastCode = code; lastBody = v }
  const deps = {
    DATA: "/tmp/atlas-fake-data",
    INDEX: "index.json",
    readIdx: async () => [],
    readJ: async () => null,
    writeJ: async () => {},
    readJsonBody: async () => bodyStub,
    toSlug: (s) => s.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    pickIcon: () => "default-icon",
    iconCatalog: () => ["default-icon", "alt-icon"],
  }
  return {
    ctx: { req: {}, res: {}, send, parts, m, deps },
    lastCode: () => lastCode,
    lastBody: () => lastBody,
  }
}

test("ALL_ROUTES contains the 5 workdir handlers", () => {
  const wd = ALL_ROUTES.filter(r => r.name.startsWith("workdirs:")).map(r => r.name).sort()
  assert.deepEqual(wd, [
    "workdirs:create",
    "workdirs:delete",
    "workdirs:list",
    "workdirs:patch",
    "workdirs:reorder",
  ])
})

test("GET /workdirs -> list (empty)", async () => {
  const { ctx, lastCode, lastBody } = mkCtx(["workdirs"], "GET")
  assert.equal(await dispatch(ctx), true)
  assert.equal(lastCode(), 200)
  assert.deepEqual(lastBody(), [])
})

test("POST /workdirs without name -> 400", async () => {
  const { ctx, lastCode, lastBody } = mkCtx(["workdirs"], "POST", {})
  assert.equal(await dispatch(ctx), true)
  assert.equal(lastCode(), 400)
  assert.deepEqual(lastBody(), { error: "name required" })
})

test("PUT /workdirs without order -> 400", async () => {
  const { ctx, lastCode, lastBody } = mkCtx(["workdirs"], "PUT", {})
  assert.equal(await dispatch(ctx), true)
  assert.equal(lastCode(), 400)
  assert.deepEqual(lastBody(), { error: "order required" })
})

test("PUT /workdirs with non-array order -> 400", async () => {
  const { ctx, lastCode } = mkCtx(["workdirs"], "PUT", { order: "not-an-array" })
  assert.equal(await dispatch(ctx), true)
  assert.equal(lastCode(), 400)
})

test("PATCH /workdirs/:slug with unknown slug -> 404", async () => {
  // ponytail: readIdx stub returns []. find() returns undefined -> 404 path.
  const { ctx, lastCode, lastBody } = mkCtx(["workdirs", "missing"], "PATCH", {})
  assert.equal(await dispatch(ctx), true)
  assert.equal(lastCode(), 404)
  assert.deepEqual(lastBody(), { error: "not found" })
})

test("DELETE /workdirs/:slug with unknown slug -> 404", async () => {
  const { ctx, lastCode } = mkCtx(["workdirs", "missing"], "DELETE", null)
  assert.equal(await dispatch(ctx), true)
  assert.equal(lastCode(), 404)
})

test("PATCH /workdirs/:slug accepts any second slot (length === 2, slot[1] = null)", () => {
  // ponytail: the patch/delete entries use match: ["workdirs", null] (the
  // null slot is a wildcard). This test makes the contract explicit.
  const patch = ALL_ROUTES.find(r => r.name === "workdirs:patch")
  assert.deepEqual(patch.match, ["workdirs", null])
  assert.equal(patch.length, 2)
})
