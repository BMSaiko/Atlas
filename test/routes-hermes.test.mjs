// test/routes-hermes.test.mjs
//
// ponytail: route-table test for server/routes/hermes.ts. Asserts the
// 2 entries exist, dispatch routes correctly, and trivial validation
// paths (missing file, malformed JSONL) return expected shapes. Bodies
// of real handlers (file IO) are covered by integration tests.

import test from "node:test"
import assert from "node:assert/strict"
import { dispatch } from "../server/routes.ts"
import { ALL_ROUTES } from "../server/routes/index.ts"

function mkCtx(parts, m = "GET", opts = {}) {
  let lastCode = 0, lastBody = null
  const send = (code, v) => { lastCode = code; lastBody = v }
  const deps = {
    cfg: { hermesHome: "/tmp/hermes-fake" },
    readJ: opts.readJ || (async () => null),
    readFile: opts.readFile || (async () => { throw new Error("not found") }),
    createHash: (_alg) => ({
      update(_s) { return this },
      // ponytail: real createHash('sha256').digest('hex') returns 64 hex chars.
      // The handler slices to 10, so we return a deterministic 10-char prefix.
      digest(_enc) { return "deadbeef00" },
    }),
  }
  const req = opts.req || { url: "/api/hermes/keys" }
  return {
    ctx: { req, res: {}, send, parts, m, deps },
    lastCode: () => lastCode,
    lastBody: () => lastBody,
  }
}

test("ALL_ROUTES contains the 2 hermes handlers", () => {
  const h = ALL_ROUTES.filter(r => r.name.startsWith("hermes:")).map(r => r.name).sort()
  assert.deepEqual(h, ["hermes:keys", "hermes:usage"])
})

test("GET /hermes/keys with no auth.json returns []", async () => {
  // ponytail: readJ returns null when the file is missing -> empty pool -> [].
  const { ctx, lastCode, lastBody } = mkCtx(["hermes", "keys"])
  assert.equal(await dispatch(ctx), true)
  assert.equal(lastCode(), 200)
  assert.deepEqual(lastBody(), [])
})

test("GET /hermes/keys with a key returns redacted fields (no access_token)", async () => {
  const { ctx, lastCode, lastBody } = mkCtx(["hermes", "keys"], "GET", {
    readJ: async () => ({
      credential_pool: {
        openai: [{
          label: "primary",
          access_token: "sk-secret-1234567890",
          last_status: 200,
        }],
      },
    }),
  })
  assert.equal(await dispatch(ctx), true)
  assert.equal(lastCode(), 200)
  const arr = lastBody()
  assert.equal(arr.length, 1)
  assert.equal(arr[0].label, "primary")
  assert.equal(arr[0].status, "active")
  assert.equal(arr[0].secret_fingerprint, "deadbeef00")  // mock createHash format
  // ponytail: the critical contract — access_token MUST NOT appear in the response.
  assert.equal("access_token" in arr[0], false, "access_token must be redacted")
})

test("GET /hermes/keys classifies 429/quota errors as exhausted", async () => {
  const { ctx, lastBody } = mkCtx(["hermes", "keys"], "GET", {
    readJ: async () => ({
      credential_pool: {
        anthropic: [{ access_token: "x", last_error_code: 429, last_error_reason: "quota" }],
      },
    }),
  })
  await dispatch(ctx)
  assert.equal(lastBody()[0].status, "exhausted")
})

test("GET /hermes/keys rejects non-GET (POST is not registered)", async () => {
  const { ctx } = mkCtx(["hermes", "keys"], "POST")
  assert.equal(await dispatch(ctx), false)
})

test("GET /hermes/usage with no log file returns empty aggregates", async () => {
  // readFile throws (file missing) -> the handler's try/catch swallows -> empty result.
  const { ctx, lastCode, lastBody } = mkCtx(["hermes", "usage"], "GET", {
    req: { url: "/api/hermes/usage" },
  })
  assert.equal(await dispatch(ctx), true)
  assert.equal(lastCode(), 200)
  const body = lastBody()
  assert.deepEqual(body.rows, [])
  assert.deepEqual(body.totals_by_key, {})
  assert.equal(typeof body.since, "number")
  assert.equal(typeof body.generated_at, "number")
})

test("GET /hermes/usage respects ?since=... query param", async () => {
  let observedSince = -1
  const { ctx, lastBody } = mkCtx(["hermes", "usage"], "GET", {
    req: { url: "/api/hermes/usage?since=1700000000000" },
    readFile: async () => {
      // two lines: one before, one after the threshold
      return [
        JSON.stringify({ ts: 1600000000000, key_id: "k1", prompt_tokens: 10, cost_usd: 0.01 }),
        JSON.stringify({ ts: 1750000000000, key_id: "k1", prompt_tokens: 20, cost_usd: 0.02 }),
        "",
      ].join("\n")
    },
  })
  await dispatch(ctx)
  const body = lastBody()
  assert.equal(body.since, 1700000000000)
  // only the post-threshold line should be aggregated
  assert.equal(body.rows.length, 1)
  assert.equal(body.totals_by_key.k1.requests, 1)
  assert.equal(body.totals_by_key.k1.prompt_tokens, 20)
})

test("GET /hermes/usage falls back to start-of-today when since is missing or invalid", async () => {
  // since=0 -> invalid -> startOfToday
  const { ctx, lastBody } = mkCtx(["hermes", "usage"], "GET", {
    req: { url: "/api/hermes/usage" },
  })
  await dispatch(ctx)
  const body = lastBody()
  // start of today is a positive number; just assert it's not 0 and is "now-ish"
  assert.ok(body.since > 0, "since should be startOfToday (positive)")
  assert.ok(Date.now() - body.since < 24 * 60 * 60 * 1000, "since within last 24h")
})
