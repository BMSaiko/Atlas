// test/chat-routes.test.mjs
// ponytail: route-table test for server/routes/chat.ts. 8 endpoints (history GET/DELETE, send POST,
// output GET, conversations GET, conversation new POST, conversation switch POST, conversation delete DELETE).
// Real spawn gated via ATLAS_TEST_NO_SPAWN.

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

test("ALL_ROUTES contains the 8 chat handlers", () => {
  const chat = ALL_ROUTES.filter(r => r.name.startsWith("chat:")).map(r => r.name).sort()
  assert.deepEqual(chat, [
    "chat:clear",
    "chat:conversation:delete",
    "chat:conversation:new",
    "chat:conversation:switch",
    "chat:conversations",
    "chat:history",
    "chat:output",
    "chat:send",
  ])
})

test("GET /chat/history -> 1 fresh conv with 0 messages", async () => {
  const d = mkdtempSync(join(tmpdir(), "atlas-chat-"))
  try {
    const { ctx, lastCode, lastBody } = mkCtx(["chat", "history"], "GET", null, d)
    assert.equal(await dispatch(ctx), true)
    assert.equal(lastCode(), 200)
    assert.equal(lastBody().conversations.length, 1)
    assert.equal(lastBody().messages.length, 0)
    assert.equal(lastBody().current, lastBody().conversations[0].id)
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

test("POST /chat/send with text -> 200 + runId + conversationId (ATLAS_TEST_NO_SPAWN)", async () => {
  const d = mkdtempSync(join(tmpdir(), "atlas-chat-"))
  const prev = process.env.ATLAS_TEST_NO_SPAWN
  process.env.ATLAS_TEST_NO_SPAWN = "1"
  try {
    const { ctx, lastCode, lastBody } = mkCtx(["chat", "send"], "POST", { text: "em atlas, lista notas" }, d)
    assert.equal(await dispatch(ctx), true)
    assert.equal(lastCode(), 200)
    assert.equal(lastBody().ok, true)
    assert.match(lastBody().runId, /^r-/)
    assert.ok(lastBody().conversationId, "conversationId present")
  } finally {
    if (prev == null) delete process.env.ATLAS_TEST_NO_SPAWN
    else process.env.ATLAS_TEST_NO_SPAWN = prev
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

test("GET /chat/conversations -> 1 item with current id", async () => {
  const d = mkdtempSync(join(tmpdir(), "atlas-chat-"))
  try {
    const { ctx, lastCode, lastBody } = mkCtx(["chat", "conversations"], "GET", null, d)
    assert.equal(await dispatch(ctx), true)
    assert.equal(lastCode(), 200)
    assert.equal(lastBody().conversations.length, 1)
    assert.ok(lastBody().current)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test("POST /chat/conversation/new -> creates + returns", async () => {
  const d = mkdtempSync(join(tmpdir(), "atlas-chat-"))
  try {
    const { ctx, lastCode, lastBody } = mkCtx(["chat", "conversation", "new"], "POST", null, d)
    assert.equal(await dispatch(ctx), true)
    assert.equal(lastCode(), 200)
    assert.equal(lastBody().messages.length, 0)
    assert.equal(lastBody().conversations.length, 2)
    assert.equal(lastBody().current, lastBody().conversation.id)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test("POST /chat/conversation/switch without id -> 400", async () => {
  const d = mkdtempSync(join(tmpdir(), "atlas-chat-"))
  try {
    const { ctx, lastCode, lastBody } = mkCtx(["chat", "conversation", "switch"], "POST", {}, d)
    assert.equal(await dispatch(ctx), true)
    assert.equal(lastCode(), 400)
    assert.deepEqual(lastBody(), { error: "id required" })
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test("POST /chat/conversation/switch with unknown id -> 404", async () => {
  const d = mkdtempSync(join(tmpdir(), "atlas-chat-"))
  try {
    const { ctx, lastCode, lastBody } = mkCtx(["chat", "conversation", "switch"], "POST", { id: "nope" }, d)
    assert.equal(await dispatch(ctx), true)
    assert.equal(lastCode(), 404)
    assert.deepEqual(lastBody(), { error: "conversation not found" })
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test("DELETE /chat/conversation/<id> of unknown -> 404", async () => {
  const d = mkdtempSync(join(tmpdir(), "atlas-chat-"))
  try {
    const { ctx, lastCode, lastBody } = mkCtx(["chat", "conversation", "nope"], "DELETE", null, d)
    assert.equal(await dispatch(ctx), true)
    assert.equal(lastCode(), 404)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
