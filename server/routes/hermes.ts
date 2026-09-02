// server/routes/hermes.ts
//
// ponytail: 2 read-only endpoints that surface Hermes internals to the UI.
// /hermes/keys redacts access_token to a 10-char sha256 fingerprint.
// /hermes/usage aggregates a JSONL log by key_id. Both are pure file IO +
// aggregation; no side effects, no auth beyond loopback (which the
// dispatcher's caller handles; these routes do not check).

import { join } from "node:path"
import type { Route } from "../routes"

export const ROUTES: Route[] = [
  {
    method: "GET",
    length: 2,
    match: ["hermes", "keys"],
    name: "hermes:keys",
    handler: async (ctx) => {
      const { deps = {} as any, send } = ctx
      const auth = await deps.readJ(join(deps.cfg.hermesHome, "auth.json"))
      const cp = (auth && typeof auth === "object" && auth.credential_pool && typeof auth.credential_pool === "object")
        ? auth.credential_pool : {}
      const out: any[] = []
      for (const [provider, list] of Object.entries(cp)) {
        if (!Array.isArray(list)) continue
        for (const k of list) {
          if (!k || typeof k !== "object") continue
          const code = typeof k.last_error_code === "number" ? k.last_error_code : null
          const reason = typeof k.last_error_reason === "string" ? k.last_error_reason : null
          let status: "active" | "exhausted" | "error" | "unknown" = "unknown"
          if (code === 429 || /quota|rate.?limit|exhaust/i.test(reason || "")) status = "exhausted"
          else if (code && code >= 400) status = "error"
          else if (typeof k.last_status === "number" && k.last_status >= 200 && k.last_status < 300) status = "active"
          // ponytail: fingerprint do token, NUNCA envia access_token. sha256.slice(0,10).
          const tok = typeof (k as any).access_token === "string" ? (k as any).access_token : ""
          const fp = tok ? deps.createHash("sha256").update(tok).digest("hex").slice(0, 10) : null
          out.push({
            provider,
            id: typeof k.id === "string" ? k.id : null,
            label: typeof k.label === "string" ? k.label : null,
            source: typeof k.source === "string" ? k.source : null,
            auth_type: typeof k.auth_type === "string" ? k.auth_type : null,
            base_url: typeof k.base_url === "string" ? k.base_url : null,
            priority: typeof k.priority === "number" ? k.priority : null,
            status,
            last_status: typeof k.last_status === "number" ? k.last_status : null,
            last_status_at: k.last_status_at ?? null,
            last_error_code: code,
            last_error_reason: reason,
            last_error_message: typeof k.last_error_message === "string" ? k.last_error_message : null,
            last_error_reset_at: k.last_error_reset_at ?? null,
            request_count: typeof k.request_count === "number" ? k.request_count : 0,
            secret_fingerprint: fp,
            has_token: !!tok,
          })
        }
      }
      send(200, out)
    },
  },
  {
    method: "GET",
    length: 2,
    match: ["hermes", "usage"],
    name: "hermes:usage",
    handler: async (ctx) => {
      const { deps = {} as any, send, req } = ctx
      const url = new URL(req.url || "/", "http://localhost")
      const sinceQ = parseInt(url.searchParams.get("since") || "0", 10)
      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
      const since = Number.isFinite(sinceQ) && sinceQ > 0 ? sinceQ : startOfToday.getTime()
      const rows: any[] = []
      const totals: Record<string, any> = {}
      const file = join(deps.cfg.hermesHome, "logs", "atlas", "usage.jsonl")
      try {
        const text = await deps.readFile(file, "utf8")
        for (const line of text.split("\n")) {
          if (!line) continue
          let r: any
          try { r = JSON.parse(line) } catch { continue }
          const ts = typeof r?.ts === "number" ? r.ts : 0
          if (!ts || ts < since) continue
          const keyId = typeof r?.key_id === "string" && r.key_id ? r.key_id : "__unknown__"
          const pt = typeof r?.prompt_tokens === "number" ? r.prompt_tokens : 0
          const ct = typeof r?.completion_tokens === "number" ? r.completion_tokens : 0
          const cost = typeof r?.cost_usd === "number" ? r.cost_usd : 0
          const model = typeof r?.model === "string" ? r.model : undefined
          const provider = typeof r?.provider === "string" ? r.provider : undefined
          rows.push({ ts, key_id: keyId, model, prompt_tokens: pt, completion_tokens: ct, cost_usd: cost, provider })
          const t = totals[keyId] || (totals[keyId] = { requests: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, last_ts: 0, model, provider })
          t.requests += 1
          t.prompt_tokens += pt
          t.completion_tokens += ct
          t.cost_usd += cost
          if (ts > t.last_ts) { t.last_ts = ts; if (model) t.model = model; if (provider) t.provider = provider }
        }
      } catch { /* missing/unreadable -> empty response, dashboard shows "—" */ }
      send(200, { rows, totals_by_key: totals, since, generated_at: Date.now() })
    },
  },
]
