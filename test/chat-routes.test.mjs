// test/chat-routes.test.mjs
// ponytail: route-table test for server/routes/chat.ts. Asserts the 4 chat entries
// exist, dispatch routes correctly, and trivial validation paths return expected
// status codes. Real spawn is gated behind ATLAS_TEST_NO_SPAWN so the dispatch
// path is exercisable without hermes.

import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { dispatch } from "../server/routes.ts"
import { ALL_ROUTES } from "../server/routes/index.ts"

function mkCtx(parts, m = "GET", bodyStub = null, dataDir = "/tmp/atlas-fake-data") {
  let lastCode = 0, lastBody = null
  const send = (code, v) => { lastCode = code; lastBody = v }
  const deps = {
    DATA: dataDir,
    cfg: { port: 5173, hermesPy: "python", hermesHome: "/tmp", wtoken: "test-token" },
    readIdx: async () => [],
    readJsonBody: async () => bodyStub,
  }
  return {
    ctx: { req: { url: "/api/chat/" + parts.join("/") }, res: {}, send, parts, m, deps },
    lastCode: () => lastCode,
    lastBody: () => lastBody,
  }
}

test("ALL_ROUTES contains the 4 chat handlers", () => {
  const chat = ALL_ROUTES.filter(r => r.name.startsWith("chat:")).map(r => r.name).sort()
  assert.deepEqual(chat, ["chat:clear", "chat:history", "chat:output", "chat:send"])
})

test("GET /chat/history -> empty list (no file)", async () => {
  const d = mkdtempSync(join(tmpdir(), "atlas-chat-"))
  try {
    const { ctx, lastCode, lastBody } = mkCtx(["chat", "history"], "GET", null, d)
    assert.equal(await dispatch(ctx), true)
    assert.equal(lastCode(), 200)
    assert.deepEqual(lastBody(), { messages: [] })
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test("POST /chat/send without text -> 400", async () => {
  const d = mkdtempSync(join(tmpdir(), "atlas-chat-"))
  try {
    const { ctx, lastCode, lastBody } = mkCtx(["chat", "send"], "POST", {}, d)
    assert.equal(await dispatch(ctx), true)
    assert.equal(lastCode(), 400)
    assert.deepEqual(lastBody(), { error: "text required" })
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test("POST /chat/send with text -> 200 + runId (ATLAS_TEST_NO_SPAWN gates real spawn)", async () => {
  const d = mkdtempSync(join(tmpdir(), "atlas-chat-"))
  const prevNoSpawn = process.env.ATLAS_TEST_NO_SPAWN
  process.env.ATLAS_TEST_NO_SPAWN = "1"
  try {
    const { ctx, lastCode, lastBody } = mkCtx(["chat", "send"], "POST", { text: "em atlas, lista notas" }, d)
    assert.equal(await dispatch(ctx), true)
    assert.equal(lastCode(), 200)
    assert.equal(lastBody().ok, true)
    assert.match(lastBody().runId, /^r-/)  // ponytail: gate returns 'r-no-spawn'; real run = 'r-<ts>-<rand>'
    // history should now have 1 user message
    const { readHistory } = await import("../server/lib/chat.mjs")
    const h = await readHistory(d)
    assert.equal(h.messages.length, 1)
    assert.equal(h.messages[0].text, "em atlas, lista notas")
    assert.equal(h.messages[0].role, "user")
  } finally {
    if (prevNoSpawn == null) delete process.env.ATLAS_TEST_NO_SPAWN
    else process.env.ATLAS_TEST_NO_SPAWN = prevNoSpawn
    rmSync(d, { recursive: true, force: true })
  }
})

test("GET /chat/output/<id> without .status -> started=false, done=false, chunk=''", async () => {
  const d = mkdtempSync(join(tmpdir(), "atlas-chat-"))
  try {
    const { ctx, lastCode, lastBody } = mkCtx(["chat", "output", "ghost"], "GET", null, d)
    assert.equal(await dispatch(ctx), true)
    assert.equal(lastCode(), 200)
    assert.equal(lastBody().started, false)
    assert.equal(lastBody().done, false)
    assert.equal(lastBody().code, null)
    assert.equal(lastBody().chunk, "")
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test("DELETE /chat/history -> ok + empties", async () => {
  const d = mkdtempSync(join(tmpdir(), "atlas-chat-"))
  try {
    // first seed a message via /send (no-spawn)
    const prev = process.env.ATLAS_TEST_NO_SPAWN
    process.env.ATLAS_TEST_NO_SPAWN = "1"
    try {
      const c1 = mkCtx(["chat", "send"], "POST", { text: "hello" }, d)
      await dispatch(c1.ctx)
      assert.equal(c1.lastCode(), 200)
    } finally {
      if (prev == null) delete process.env.ATLAS_TEST_NO_SPAWN
      else process.env.ATLAS_TEST_NO_SPAWN = prev
    }
    // then clear
    const { ctx, lastCode, lastBody } = mkCtx(["chat", "history"], "DELETE", null, d)
    assert.equal(await dispatch(ctx), true)
    assert.equal(lastCode(), 200)
    assert.deepEqual(lastBody(), { ok: true })
    const { readHistory } = await import("../server/lib/chat.mjs")
    assert.deepEqual(await readHistory(d), { messages: [] })
  } finally { rmSync(d, { recursive: true, force: true }) }
})
