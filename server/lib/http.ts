// server/lib/http.ts
//
// ponytail: shared HTTP helpers for the Vite middleware. Extracted from
// server/api.ts (Phase 1 of the backend refactor). No behavior change.
// Just one source of truth for: loopback check, status codes, the send
// factory, body parsing, and the very common error+ok shorthands.

import type { IncomingMessage, ServerResponse } from "node:http"

// ponytail: status codes used by the API. Keep this list lean. Only the
// codes the middleware actually returns. Adding codes here doesnt make
// them correct, it just makes them typo-resistant.
export const HTTP = {
  OK: 200,
  BadRequest: 400,
  Unauthorized: 401,
  Forbidden: 403,
  NotFound: 404,
  Conflict: 409,
  ServerError: 500,
  ServiceUnavailable: 503,
} as const

// ponytail: loopback was inlined 3x in api.ts (PUT fence, wtoken GET,
// terms/open). All three want the same predicate. One function or one
// subtle drift. Remote can be IPv4 (127.0.0.1), IPv6 (::1), or the
// IPv4-mapped IPv6 form Windows sometimes emits (::ffff:127.0.0.1).
export function isLoopback(req: IncomingMessage): boolean {
  const r = (req.socket as any)?.remoteAddress as string | undefined
  return r === "127.0.0.1" || r === "::1" || r === "::ffff:127.0.0.1"
}

// ponytail: the send closure was defined once per request inside the
// middleware. Same shape, just exported. Caller still owns the response.
export type Send = (code: number, v: unknown) => void
export function makeSend(res: ServerResponse): Send {
  return (code, v) => {
    res.statusCode = code
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify(v))
  }
}

// ponytail: ~50 call sites do send(CODE, { error: msg }). One helper.
// Also used 20x as send(200, { ok: true, ... }) - same shape, no point
// having a separate ok() when callers already mix fields.
export function errorSend(send: Send, code: number, msg: string): void {
  send(code, { error: msg })
}

// ponytail: the original body() lived as a private function in api.ts.
// It returns parsed JSON or null on any failure (parse error, no data).
// Null-on-fail is the contract every existing handler assumes. Keep it.
export function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise(resolve => {
    let d = ""
    req.on("data", (c: Buffer) => { d += c })
    req.on("end", () => {
      try { resolve(JSON.parse(d || "null")) } catch { resolve(null) }
    })
  })
}
