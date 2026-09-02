// server/routes.ts
//
// ponytail: route table + dispatcher for the atlas API. Phase 2 of the
// backend refactor. Each entry in ROUTES describes a single HTTP route:
// method, path pattern, and the handler that runs when it matches.
//
// Invariants (do not break these without reading server/api.ts first):
//  - Handlers receive (req, res, ctx). ctx carries: send, parts (the URL
//    parts array, already split), m (the method), and a few domain hooks.
//  - Handlers MUST end by calling send(...) or returning (which means
//    "handled, send what you already prepared"). A handler that wants to
//    fall through to the next route must call ctx.next() — this is for
//    routes that share a prefix and discriminate on parts.length (rare;
//    today only /api/wtoken and the workdirs list/create use it, and
//    those are still inline).
//  - The dispatcher runs routes in order. First match wins. This mirrors
//    the if/else-if chain in api.ts; do not change the order without
//    checking the harness and the client.
//
// This file is the table only. Per-domain handler bodies live in
// server/routes/<name>.ts. Empty for now (Phase 2A = wire the dispatcher
// without moving any handlers; Phase 2B+ moves them in).

import type { IncomingMessage, ServerResponse } from "node:http"
import type { Send } from "./lib/http"

// ponytail: a tiny subset of the parts[] values the original if-chains
// matched on. Keeping it as a string-array preserves the original shape
// (and the harness/ci-gate tests depend on it).
export type Parts = string[]

export interface RouteCtx {
  req: IncomingMessage
  res: ServerResponse
  send: Send
  parts: Parts
  m: string
  // ponytail: a few handlers need shared in-memory state. Today nothing
  // does, but the slot is here so adding one later doesn't require
  // editing the Route type.
  state?: Record<string, unknown>
  // ponytail: handlers reach into module-level helpers in api.ts
  // (killAllPanesForSlug, repoDir, writeJ, ...). Rather than lift every
  // helper to its own module (and add N import statements per route file),
  // we pass a single bag with the names handlers need. Built once in
  // api.ts and shared via dispatch(). Untyped on purpose: lazy ceiling,
  // tighten per route file when one handler needs more than 2 deps.
  deps?: Record<string, any>
}

export type Handler = (ctx: RouteCtx) => Promise<void> | void

export interface Route {
  // HTTP method. Use "*" to match any method (rare; today only the
  // bundle handler does that — see api.ts around line 1322).
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "*"
  // parts.length the route expects. "*" = any length.
  length: number | "*"
  // parts[0..] the route expects (literal match). Use null for "any".
  match: (string | null)[]
  handler: Handler
  // ponytail: human-readable label for logs and the route-table test.
  name: string
}

// ponytail: routes are spread from per-domain files in ./routes/index.ts.
// Adding a new domain = add a file in ./routes/ + re-export in index.ts.
// This module stays type-only; data lives in the index barrel.
import { ALL_ROUTES } from "./routes/index"
export const ROUTES: Route[] = [...ALL_ROUTES]

// ponytail: dispatcher. Linear scan (the table is < 30 entries; a hash
// map would be slower at this size due to JS object overhead). First
// match wins. Returns true if a route handled the request, false if the
// caller should fall through (today: send 404).
export async function dispatch(ctx: RouteCtx): Promise<boolean> {
  for (const r of ROUTES) {
    if (!matchRoute(r, ctx.parts, ctx.m)) continue
    // ponytail: await the handler. The original middleware was async
    // and wrapped everything in a try/catch, so awaiting here is safe.
    // Awaiting (vs fire-and-forget) means tests can assert against
    // post-handler state without races.
    await r.handler(ctx)
    return true
  }
  return false
}

function matchRoute(r: Route, parts: string[], m: string): boolean {
  if (r.method !== "*" && r.method !== m) return false
  if (r.length !== "*" && r.length !== parts.length) return false
  for (let i = 0; i < r.match.length; i++) {
    const want = r.match[i]
    if (want === null) continue
    if (parts[i] !== want) return false
  }
  return true
}
