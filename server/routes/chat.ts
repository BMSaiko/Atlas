// server/routes/chat.ts
// ponytail: 4 endpoints cross-mundo para o main chat (/c). NAO workdir-scoped.
// History em data/_chat/history.json, runs em data/_chat/runs/<runId>.{log,status}.
// Stream via poll (clone de w:output, sem SSE/WebSocket — overkill, pattern ja em uso).

import type { Route } from "../routes"
import { join } from "node:path"
import { readFile } from "node:fs/promises"
import { appendHistory, clearHistory, launchChat, readHistory } from "../lib/chat.mjs"

const _C1_RE = /[-�]/g
function _sanitizeText(s: string): string { return s.replace(_C1_RE, "") }

export const ROUTES: Route[] = [
  {
    method: "GET",
    length: 2,
    match: ["chat", "history"],
    name: "chat:history",
    handler: async (ctx) => {
      const { deps = {} as any, send } = ctx
      send(200, await readHistory(deps.DATA))
    },
  },
  {
    method: "POST",
    length: 2,
    match: ["chat", "send"],
    name: "chat:send",
    handler: async (ctx) => {
      const { deps = {} as any, send, req } = ctx
      const b = (await deps.readJsonBody(req)) || {}
      const text = typeof b.text === "string" ? b.text.trim() : ""
      if (!text) { send(400, { error: "text required" }); return }
      // append user message
      const ts = Date.now()
      const userMsg = { role: "user" as const, text, ts }
      const { messages } = await appendHistory(deps.DATA, userMsg)
      // gather worlds from index
      const worlds = await deps.readIdx()
      // launch headless
      const launched = await launchChat({
        dataDir: deps.DATA,
        cfg: deps.cfg,
        userMsg: text,
        history: messages,
        worlds,
      })
      send(200, { ok: true, runId: launched.runId, ts })
    },
  },
  {
    method: "GET",
    length: 3,
    match: ["chat", "output", null],
    name: "chat:output",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts, req } = ctx
      const url = new URL(req.url || "/", "http://localhost")
      const runId = parts[2]
      const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10) || 0)
      const logPath = join(deps.DATA, "_chat", "runs", runId + ".log")
      const stPath = join(deps.DATA, "_chat", "runs", runId + ".status")
      const st = await readFile(stPath, "utf8").then((r) => { try { return JSON.parse(r) } catch { return null } }).catch(() => null)
      // ponytail: sem ficheiro .status = NUNCA lancado (honesto, NAO fantasma done). Default
      // running em vez de done evita inventar 'concluido'.
      const started = !!st
      const st2 = st || { state: "running" }
      let full = ""
      try { full = _sanitizeText(await readFile(logPath, "utf8")) } catch { full = "" }
      const done = st2.state !== "running"
      const chunk = full.slice(offset)
      send(200, { ok: true, started, done, code: done ? (st2.code ?? 0) : null, chunk, offset: offset + chunk.length, size: full.length })
    },
  },
  {
    method: "DELETE",
    length: 2,
    match: ["chat", "history"],
    name: "chat:clear",
    handler: async (ctx) => {
      const { deps = {} as any, send } = ctx
      await clearHistory(deps.DATA)
      send(200, { ok: true })
    },
  },
]
