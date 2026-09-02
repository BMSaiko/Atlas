// server/routes/terms.ts
//
// ponytail: 3 terminal-control endpoints (kill-all, kill-all-atlas, open).
// Extracted from server/api.ts (Phase 2B of the backend refactor).
// Behaviour identical to the inline if-blocks they replace; see
// server/api.ts git history if you need the diff.
//
// The handlers reach into module-level helpers via ctx.deps (the bag
// built in api.ts). See routes.ts RouteCtx for the design.

import { existsSync, readdirSync } from "node:fs"
import { spawn } from "node:child_process"
import { join } from "node:path"
import type { Route } from "../routes"

export const ROUTES: Route[] = [
  {
    method: "POST",
    length: 2,
    match: ["terms", "kill-all"],
    name: "terms:kill-all",
    handler: async (ctx) => {
      const { deps = {} as any, send, req } = ctx
      const b = (await deps.body(req)) || {}
      const slug = typeof b.slug === "string" ? b.slug : ""
      if (!deps.SLUG.test(slug)) { send(400, { error: "slug required" }); return }
      const r = await deps.killAllPanesForSlug(slug)
      send(200, { ok: true, killed: r.killed, checked: r.checked })
    },
  },
  {
    method: "POST",
    length: 2,
    match: ["terms", "kill-all-atlas"],
    name: "terms:kill-all-atlas",
    handler: async (ctx) => {
      const { deps = {} as any, send } = ctx
      const r = await deps.killAllPanesAtlas()
      send(200, { ok: true, killed: r.killed, checked: r.checked, worlds: r.worlds })
    },
  },
  {
    method: "POST",
    length: 2,
    match: ["terms", "open"],
    name: "terms:open",
    handler: async (ctx) => {
      const { deps = {} as any, send, req } = ctx
      const b = (await deps.body(req)) || {}
      const slug = typeof b.slug === "string" ? b.slug : ""
      if (!deps.SLUG.test(slug)) { send(400, { error: "slug required" }); return }
      if (!deps.cfg.wezterm || !existsSync(deps.cfg.wezterm)) { send(503, { error: "wezterm nao instalado" }); return }
      const repo = await deps.repoDir(slug)
      let cwd = repo
      try {
        const runsDir = join(deps.wtRoot(repo), "runs", slug)
        if (existsSync(runsDir)) {
          for (const f of readdirSync(runsDir).filter(x => x.endsWith(".status"))) {
            const st = await deps.readJ(join(runsDir, f)).catch(() => null)
            if (st?.state === "running") {
              const wt = join(deps.wtRoot(repo), slug, f.replace(/\.status$/, ""))
              if (existsSync(wt)) { cwd = wt; break }
            }
          }
        }
      } catch { /* fallback repo */ }
      try {
        // ponytail: se ja ha um wezterm-gui a correr, adiciona tab (focus fica no
        // wezterm existente que o user ja tem a frente); senao abre janela nova.
        // Use tasklist para detectar: wezterm-gui.exe sem arg de comando = GUI host.
        const probe = spawn("tasklist", ["/FI", "IMAGENAME eq wezterm-gui.exe", "/NH"],
          { stdio: ["ignore", "pipe", "ignore"] })
        let hasInstance = false
        probe.stdout.on("data", (d: Buffer) => { if (/wezterm-gui\.exe/i.test(d.toString())) hasInstance = true })
        await new Promise<void>(r => probe.on("close", () => r()))
        const args = hasInstance
          ? ["start", "--cwd", cwd, "--", "cmd.exe"]                              // tab no mux existente
          : ["start", "--always-new-process", "--cwd", cwd, "--", "cmd.exe"]      // janela nova
        spawn(deps.cfg.wezterm, args, { detached: true, stdio: "ignore" }).unref()
        send(200, { ok: true, cwd, reused: hasInstance })
      } catch (e: any) {
        send(500, { error: "wezterm start falhou: " + e.message })
      }
    },
  },
]
