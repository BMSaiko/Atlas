// server/routes/orchestrator.ts
//
// ponytail: 1 endpoint — POST /api/orchestrator/start[/:slug]. Moves todo cards
// to doing across one or all worlds, then fires launchHermes per card.
// Extracted from server/api.ts (Phase 2F). Body 1:1 from baseline fc6331f.

import { join } from "node:path"
import type { Route } from "../routes"

export const ROUTES: Route[] = [
  {
    method: "POST",
    // ponytail: original if was `parts.length === 2 || parts.length === 3`.
    // Route table: length === 2 OR 3. Use the "wider" definition (3)
    // and rely on null slots to accept either. The original guarded
    // `only = parts.length === 3 ? decodeURIComponent(parts[2]) : ''`
    // inside the body, so the length check is purely a routing concern.
    length: 3,
    match: ["orchestrator", "start", null],
    name: "orchestrator:start",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts } = ctx
      const only = parts.length === 3 ? decodeURIComponent(parts[2]!) : ""
      const worldIdx = await deps.readIdx()
      const targets = only ? worldIdx.filter((w: any) => w.slug === only) : worldIdx
      if (only && targets.length === 0) { send(404, { error: "mundo nao encontrado" }); return }
      let moved = 0
      const launched: { slug: string; card: any }[] = []
      for (const wd of targets) {
        const file = join(deps.DATA, wd.slug, "kanban.json")
        if (!deps.inside(deps.DATA, file)) continue
        const board = await deps.readJ(file)
        if (!board || !Array.isArray(board.cards)) continue
        let dirty = false
        for (const card of board.cards) {
          if (card.archived || card.colId !== "todo") continue
          card.colId = "doing"
          card.startedAt = Date.now()
          delete card.result
          delete card.reviewed
          moved++; dirty = true
          launched.push({ slug: wd.slug, card })
        }
        if (dirty) await deps.writeJ(file, board)
      }
      // ponytail: orquestrador tambem lanca o agente (run headless) por card movido — fire-and-forget, em paralelo.
      for (const l of launched) void deps.launchHermes(l.slug, l.card).catch((e: any) => console.error("[orchestrator:" + l.slug + ":" + l.card.id + "] " + (e?.message || e)))
      send(200, { ok: true, moved, launched: launched.length })
    },
  },
]
