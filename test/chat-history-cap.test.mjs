// test/chat-history-cap.test.mjs
// ponytail: pure-function tests for chat-store. No server spin, no hermes spawn.
// CAP=200 FIFO; clears are idempotent; default empty file -> [].

import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { appendHistory, clearHistory, readHistory, CAP } from "../server/lib/chat.mjs"

function fresh() {
  const d = mkdtempSync(join(tmpdir(), "atlas-chat-"))
  return { dataDir: d, cleanup: () => rmSync(d, { recursive: true, force: true }) }
}

test("readHistory default empty (no file)", async () => {
  const { dataDir, cleanup } = fresh()
  try {
    const r = await readHistory(dataDir)
    assert.deepEqual(r, { messages: [] })
  } finally { cleanup() }
})

test("appendHistory adds + persists + reads back", async () => {
  const { dataDir, cleanup } = fresh()
  try {
    await appendHistory(dataDir, { role: "user", text: "hi", ts: 1 })
    const r = await readHistory(dataDir)
    assert.equal(r.messages.length, 1)
    assert.equal(r.messages[0].text, "hi")
  } finally { cleanup() }
})

test("appendHistory FIFO cap at CAP=200", async () => {
  const { dataDir, cleanup } = fresh()
  try {
    for (let i = 0; i < CAP + 50; i++) {
      await appendHistory(dataDir, { role: "user", text: "m" + i, ts: i })
    }
    const r = await readHistory(dataDir)
    assert.equal(r.messages.length, CAP, `len=${r.messages.length}`)
    // oldest kept = m50 (50 dropped), newest = m(CAP+49)
    assert.equal(r.messages[0].text, "m50")
    assert.equal(r.messages[CAP - 1].text, "m" + (CAP + 49))
  } finally { cleanup() }
})

test("clearHistory empties and is idempotent", async () => {
  const { dataDir, cleanup } = fresh()
  try {
    await appendHistory(dataDir, { role: "user", text: "x", ts: 1 })
    await clearHistory(dataDir)
    const r = await readHistory(dataDir)
    assert.deepEqual(r, { messages: [] })
    // idempotent: second clear doesn't throw
    await clearHistory(dataDir)
    assert.deepEqual(await readHistory(dataDir), { messages: [] })
  } finally { cleanup() }
})

test("readHistory slices on read if file already > CAP (defence)", async () => {
  const { dataDir, cleanup } = fresh()
  try {
    // pre-populate with 250 messages bypassing appendHistory
    const { writeFile, mkdir } = await import("node:fs/promises")
    await mkdir(join(dataDir, "_chat"), { recursive: true })
    const big = { messages: Array.from({ length: 250 }, (_, i) => ({ role: "user", text: "p" + i, ts: i })) }
    await writeFile(join(dataDir, "_chat", "history.json"), JSON.stringify(big), "utf8")
    const r = await readHistory(dataDir)
    assert.equal(r.messages.length, CAP)
    assert.equal(r.messages[0].text, "p50")
  } finally { cleanup() }
})
