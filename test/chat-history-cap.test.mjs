// test/chat-history-cap.test.mjs
// ponytail: pure-function tests for chat-store (multi-conversation).
// CAP=200 FIFO per conversation; CONV_CAP=50 conversas; migrate old {messages:[]}.

import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  appendHistory, clearHistory, CAP, newConversation, readHistory, switchConversation, deleteConversation, listConversations,
} from "../server/lib/chat.mjs"

function fresh() {
  const d = mkdtempSync(join(tmpdir(), "atlas-chat-"))
  return { dataDir: d, cleanup: () => rmSync(d, { recursive: true, force: true }) }
}

test("readHistory default: 1 fresh conversation created", async () => {
  const { dataDir, cleanup } = fresh()
  try {
    const s = await readHistory(dataDir)
    assert.equal(s.conversations.length, 1)
    assert.equal(s.messages.length, 0)
    assert.ok(s.current)
    assert.equal(s.current, s.conversations[0].id)
  } finally { cleanup() }
})

test("appendHistory adds + persists + reads back, title=1st user msg", async () => {
  const { dataDir, cleanup } = fresh()
  try {
    await appendHistory(dataDir, { role: "user", text: "em atlas, lista notas", ts: 1 })
    const s = await readHistory(dataDir)
    assert.equal(s.messages.length, 1)
    assert.equal(s.messages[0].text, "em atlas, lista notas")
    assert.equal(s.conversations[0].title, "em atlas, lista notas")
  } finally { cleanup() }
})

test("appendHistory FIFO cap at CAP=200 per conversation", async () => {
  const { dataDir, cleanup } = fresh()
  try {
    for (let i = 0; i < CAP + 50; i++) {
      await appendHistory(dataDir, { role: "user", text: "m" + i, ts: i })
    }
    const s = await readHistory(dataDir)
    assert.equal(s.messages.length, CAP, `len=${s.messages.length}`)
    assert.equal(s.messages[0].text, "m50")
    assert.equal(s.messages[CAP - 1].text, "m" + (CAP + 49))
  } finally { cleanup() }
})

test("clearHistory soft-deletes messages but keeps conversation", async () => {
  const { dataDir, cleanup } = fresh()
  try {
    await appendHistory(dataDir, { role: "user", text: "x", ts: 1 })
    await clearHistory(dataDir)
    const s = await readHistory(dataDir)
    assert.equal(s.messages.length, 0)
    assert.equal(s.conversations.length, 1)
  } finally { cleanup() }
})

test("migrate old {messages:[]} shape -> 1 conversation", async () => {
  const { dataDir, cleanup } = fresh()
  try {
    const { writeFile, mkdir } = await import("node:fs/promises")
    await mkdir(join(dataDir, "_chat"), { recursive: true })
    await writeFile(join(dataDir, "_chat", "history.json"), JSON.stringify({
      messages: [
        { role: "user", text: "old1", ts: 1 },
        { role: "agent", text: "old-reply", ts: 2 },
      ],
    }), "utf8")
    const s = await readHistory(dataDir)
    assert.equal(s.conversations.length, 1)
    assert.equal(s.messages.length, 2)
    assert.equal(s.messages[0].text, "old1")
    assert.equal(s.conversations[0].title, "old1")
  } finally { cleanup() }
})

test("newConversation creates + sets current; old conversation kept", async () => {
  const { dataDir, cleanup } = fresh()
  try {
    await appendHistory(dataDir, { role: "user", text: "first", ts: 1 })
    const before = await readHistory(dataDir)
    const r = await newConversation(dataDir)
    assert.equal(r.messages.length, 0)
    assert.notEqual(r.current, before.current)
    // old conv ainda existe
    const list = await listConversations(dataDir)
    assert.equal(list.length, 2)
  } finally { cleanup() }
})

test("switchConversation moves current + returns its messages", async () => {
  const { dataDir, cleanup } = fresh()
  try {
    await appendHistory(dataDir, { role: "user", text: "conv1 msg", ts: 1 })
    const old = (await readHistory(dataDir)).current
    const n = await newConversation(dataDir)
    await appendHistory(dataDir, { role: "user", text: "conv2 msg", ts: 2 })
    const back = await switchConversation(dataDir, old)
    assert.equal(back.current, old)
    assert.equal(back.messages.length, 1)
    assert.equal(back.messages[0].text, "conv1 msg")
  } finally { cleanup() }
})

test("switchConversation to unknown id -> null", async () => {
  const { dataDir, cleanup } = fresh()
  try {
    const r = await switchConversation(dataDir, "does-not-exist")
    assert.equal(r, null)
  } finally { cleanup() }
})

test("deleteConversation removes + auto-switches current to next", async () => {
  const { dataDir, cleanup } = fresh()
  try {
    await appendHistory(dataDir, { role: "user", text: "a", ts: 1 })
    const c1 = (await readHistory(dataDir)).current
    await newConversation(dataDir)
    const r = await deleteConversation(dataDir, c1)
    assert.equal(r.conversations.length, 1)
    assert.notEqual(r.current, c1)
    // c1 desapareceu
    const list = await listConversations(dataDir)
    assert.equal(list.length, 1)
    assert.equal(list[0].id, r.current)
  } finally { cleanup() }
})

test("deleteConversation of non-existent id -> null", async () => {
  const { dataDir, cleanup } = fresh()
  try {
    const r = await deleteConversation(dataDir, "nope")
    assert.equal(r, null)
  } finally { cleanup() }
})

test("listConversations returns summaries (no messages)", async () => {
  const { dataDir, cleanup } = fresh()
  try {
    await appendHistory(dataDir, { role: "user", text: "hello world", ts: 1 })
    const list = await listConversations(dataDir)
    assert.equal(list.length, 1)
    assert.equal(list[0].msgCount, 1)
    assert.equal(list[0].title, "hello world")
    assert.ok(!("messages" in list[0]))
  } finally { cleanup() }
})
