// server/routes/chat.ts
// ponytail: endpoints cross-mundo para o main chat (/c). NAO workdir-scoped.
// History multi-conversa em data/_chat/history.json. Runs em data/_chat/runs/<runId>.{log,status}.
// Stream via poll (clone de w:output, sem SSE/WebSocket — overkill, pattern ja em uso).

import type { Route } from "../routes"
import { join } from "node:path"
import { readFile } from "node:fs/promises"
import {
  appendHistory, clearHistory, deleteConversation, launchChat, listConversations,
  newConversation, readHistory, switchConversation,
} from "../lib/chat.mjs"

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
      const ts = Date.now()
      const userMsg = { role: "user" as const, text, ts }
      const { messages, current } = await appendHistory(deps.DATA, userMsg)
      const worlds = await deps.readIdx()
      const launched = await launchChat({
        dataDir: deps.DATA,
        cfg: deps.cfg,
        userMsg: text,
        history: messages,
        worlds,
      })
      send(200, { ok: true, runId: launched.runId, ts, conversationId: current })
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
      const started = !!st
      const st2 = st || { state: "running" }
      let full = ""
      try { full = _sanitizeText(await readFile(logPath, "utf8")) } catch { full = "" }
      const done = st2.state !== "running"
      const chunk = full.slice(offset)
      // ponytail: gravar resposta do agente no history 1x quando done. Idempotente via
      // lookup por runId (se a UI pollou 2x com offset diferente, nao duplica).
      if (done && full.trim()) {
        const hist = await readHistory(deps.DATA)
        if (!hist.messages.some((m: any) => m.role === "agent" && m.runId === runId)) {
          const agentEndTs = (st2.ts as number) || Date.now()
          await appendHistory(deps.DATA, { role: "agent", text: full.trim(), ts: agentEndTs, runId })
        }
      }
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
  // ponytail: multi-conversation endpoints
  {
    method: "GET",
    length: 2,
    match: ["chat", "conversations"],
    name: "chat:conversations",
    handler: async (ctx) => {
      const { deps = {} as any, send } = ctx
      // ponytail: chamar readHistory primeiro (cria default se store vazia) — senao listConversations devolve 0 e o UI parte
      await readHistory(deps.DATA)
      const list = await listConversations(deps.DATA)
      const state = await readHistory(deps.DATA)
      send(200, { current: state.current, conversations: list })
    },
  },
  {
    method: "POST",
    length: 3,
    match: ["chat", "conversation", "new"],
    name: "chat:conversation:new",
    handler: async (ctx) => {
      const { deps = {} as any, send } = ctx
      const state = await newConversation(deps.DATA)
      send(200, state)
    },
  },
  {
    method: "POST",
    length: 3,
    match: ["chat", "conversation", "switch"],
    name: "chat:conversation:switch",
    handler: async (ctx) => {
      const { deps = {} as any, send, req } = ctx
      const b = (await deps.readJsonBody(req)) || {}
      const id = typeof b.id === "string" ? b.id : ""
      if (!id) { send(400, { error: "id required" }); return }
      const state = await switchConversation(deps.DATA, id)
      if (!state) { send(404, { error: "conversation not found" }); return }
      send(200, state)
    },
  },
  {
    method: "DELETE",
    length: 3,
    match: ["chat", "conversation", null],
    name: "chat:conversation:delete",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts } = ctx
      const id = parts[2]
      if (!id) { send(400, { error: "id required" }); return }
      const r = await deleteConversation(deps.DATA, id)
      if (!r) { send(404, { error: "conversation not found" }); return }
      send(200, r)
    },
  },
]
