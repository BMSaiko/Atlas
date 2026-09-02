// test/server-http-helpers.test.mjs
//
// Unit tests for server/lib/http.ts. Pure functions, no atlas boot needed.
// We import the .ts via the same strip-types mechanism the test runner uses.

import test from "node:test"
import assert from "node:assert/strict"
import {
  HTTP,
  isLoopback,
  makeSend,
  errorSend,
  readJsonBody,
} from "../server/lib/http.ts"

// === HTTP codes ===
test("HTTP.OK is 200", () => {
  assert.equal(HTTP.OK, 200)
})
test("HTTP has the codes the API actually returns", () => {
  // ponytail: don't grow this list without a real call site to justify it
  const expected = [200, 400, 401, 403, 404, 409, 500, 503]
  const actual = Object.values(HTTP).sort((a, b) => a - b)
  assert.deepEqual(actual, expected)
})

// === isLoopback ===
function fakeReq(remoteAddress) {
  return { socket: { remoteAddress } }
}
test("isLoopback: IPv4 127.0.0.1", () => {
  assert.equal(isLoopback(fakeReq("127.0.0.1")), true)
})
test("isLoopback: IPv6 ::1", () => {
  assert.equal(isLoopback(fakeReq("::1")), true)
})
test("isLoopback: IPv4-mapped IPv6", () => {
  assert.equal(isLoopback(fakeReq("::ffff:127.0.0.1")), true)
})
test("isLoopback: rejects non-loopback", () => {
  assert.equal(isLoopback(fakeReq("192.168.1.5")), false)
  assert.equal(isLoopback(fakeReq("10.0.0.1")), false)
  assert.equal(isLoopback(fakeReq("::2")), false)
})
test("isLoopback: rejects missing remoteAddress", () => {
  assert.equal(isLoopback({ socket: {} }), false)
  assert.equal(isLoopback({}), false)
})

// === makeSend ===
test("makeSend writes JSON with the given status code", () => {
  const chunks = []
  const headers = {}
  const res = {
    statusCode: 0,
    setHeader(k, v) { headers[k] = v },
    end(s) { chunks.push(s) },
  }
  const send = makeSend(res)
  send(201, { ok: true, value: 42 })
  assert.equal(res.statusCode, 201)
  assert.equal(headers["Content-Type"], "application/json")
  assert.equal(chunks.length, 1)
  assert.deepEqual(JSON.parse(chunks[0]), { ok: true, value: 42 })
})
test("makeSend: each call writes exactly one chunk", () => {
  const chunks = []
  const res = {
    statusCode: 0,
    setHeader() {},
    end(s) { chunks.push(s) },
  }
  const send = makeSend(res)
  send(200, { a: 1 })
  send(404, { b: 2 })
  assert.equal(chunks.length, 2)
})

// === errorSend ===
test("errorSend wraps msg into { error }", () => {
  const calls = []
  const send = (code, v) => calls.push({ code, v })
  errorSend(send, 401, "nope")
  assert.deepEqual(calls, [{ code: 401, v: { error: "nope" } }])
})

// === readJsonBody ===
import { Readable } from "node:stream"
function reqWithBody(text) {
  return Readable.from([Buffer.from(text, "utf8")])
}
test("readJsonBody: parses JSON object", async () => {
  const r = reqWithBody('{"slug":"abc"}')
  assert.deepEqual(await readJsonBody(r), { slug: "abc" })
})
test("readJsonBody: empty body -> null", async () => {
  assert.equal(await readJsonBody(reqWithBody("")), null)
})
test("readJsonBody: malformed JSON -> null (does not throw)", async () => {
  assert.equal(await readJsonBody(reqWithBody("{not json")), null)
})
test("readJsonBody: literal null is preserved", async () => {
  assert.equal(await readJsonBody(reqWithBody("null")), null)
})
test("readJsonBody: array is preserved", async () => {
  assert.deepEqual(await readJsonBody(reqWithBody("[1,2,3]")), [1, 2, 3])
})
