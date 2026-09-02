// server/routes/workdirs.ts
//
// ponytail: 5 workdir endpoints (list/create/reorder + get/patch/delete by slug).
// Extracted from server/api.ts (Phase 2C of the backend refactor). Behaviour
// identical to the inline if-blocks they replace.

import { mkdirSync } from "node:fs"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import type { Route } from "../routes"
import type { WD } from "../lib/types"

export const ROUTES: Route[] = [
  {
    method: "GET",
    length: 1,
    match: ["workdirs"],
    name: "workdirs:list",
    handler: async (ctx) => {
      const { deps = {} as any, send } = ctx
      send(200, await deps.readIdx())
    },
  },
  {
    method: "PUT",
    length: 1,
    match: ["workdirs"],
    name: "workdirs:reorder",
    handler: async (ctx) => {
      const { deps = {} as any, send, req } = ctx
      const b = (await deps.readJsonBody(req)) || {}
      const order = Array.isArray(b.order) ? b.order.filter((x: any) => typeof x === "string") : null
      if (!order) { send(400, { error: "order required" }); return }
      const idx = await deps.readIdx()
      const bySlug = new Map(idx.map((w: any) => [w.slug, w]))
      const next: any[] = []
      for (const sl of order) { const w = bySlug.get(sl); if (w && !next.includes(w)) next.push(w) }
      for (const w of idx) if (!next.includes(w)) next.push(w)
      await deps.writeJ(join(deps.DATA, deps.INDEX), next)
      send(200, next)
    },
  },
  {
    method: "POST",
    length: 1,
    match: ["workdirs"],
    name: "workdirs:create",
    handler: async (ctx) => {
      const { deps = {} as any, send, req } = ctx
      const b = await deps.readJsonBody(req)
      if (!b || typeof b.name !== "string" || !b.name.trim()) { send(400, { error: "name required" }); return }
      const idx = await deps.readIdx()
      let slug = deps.toSlug(b.name) || "workdir"; let base = slug, i = 1
      while (idx.some((w: any) => w.slug === base)) base = `${slug}-${i++}`
      const wd = { slug: base, name: b.name.trim(), description: (b.description || "").trim(), icon: deps.pickIcon(idx), createdAt: Date.now(), repo: typeof b.repo === "string" ? (b.repo.trim() || undefined) : undefined } as WD
      idx.push(wd)
      await deps.writeJ(join(deps.DATA, deps.INDEX), idx)
      const d = join(deps.DATA, base)
      mkdirSync(d, { recursive: true })
      const meta0: Record<string, any> = { slug: base, name: wd.name, description: wd.description, icon: wd.icon, createdAt: wd.createdAt }
      if (wd.repo) meta0.repo = wd.repo
      await deps.writeJ(join(d, "meta.json"), meta0)
      // ver:0 -> bumpVer on 1st write records ver:1
      await deps.writeJ(join(d, "notes.json"), { ver: 0, items: [] })
      await deps.writeJ(join(d, "kanban.json"), { ver: 0, columns: [{ id: "todo", name: "To Do" }, { id: "doing", name: "Em Curso" }, { id: "review", name: "Review/Revisão" }, { id: "done", name: "Concluído" }], cards: [] })
      send(201, wd)
    },
  },
  {
    method: "PATCH",
    length: 2,
    match: ["workdirs", null],
    name: "workdirs:patch",
    handler: async (ctx) => {
      const { deps = {} as any, send, req, parts } = ctx
      const slug = parts[1]
      const idx = await deps.readIdx()
      const wd = idx.find((w: any) => w.slug === slug)
      if (!wd) { send(404, { error: "not found" }); return }
      const dir = join(deps.DATA, slug)
      const b = (await deps.readJsonBody(req)) || {}
      if (typeof b.name === "string" && b.name.trim()) wd.name = b.name.trim()
      if (typeof b.description === "string") wd.description = b.description.trim()
      if (typeof b.icon === "string" && deps.iconCatalog().includes(b.icon)) wd.icon = b.icon
      if (typeof b.repo === "string") wd.repo = b.repo.trim() || undefined
      await deps.writeJ(join(deps.DATA, deps.INDEX), idx)
      const meta: Record<string, any> = (await deps.readJ(join(dir, "meta.json"))) || {}
      meta.name = wd.name
      meta.description = wd.description
      if (wd.icon) meta.icon = wd.icon
      if (wd.repo) meta.repo = wd.repo
      else delete meta.repo
      await deps.writeJ(join(dir, "meta.json"), meta)
      send(200, wd)
    },
  },
  {
    method: "DELETE",
    length: 2,
    match: ["workdirs", null],
    name: "workdirs:delete",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts } = ctx
      const slug = parts[1]
      const idx = await deps.readIdx()
      const wd = idx.find((w: any) => w.slug === slug)
      if (!wd) { send(404, { error: "not found" }); return }
      const dir = join(deps.DATA, slug)
      await rm(dir, { recursive: true, force: true })
      await deps.writeJ(join(deps.DATA, deps.INDEX), idx.filter((w: any) => w.slug !== slug))
      send(200, { ok: true })
    },
  },
]
