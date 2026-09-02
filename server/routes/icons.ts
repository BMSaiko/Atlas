// server/routes/icons.ts
//
// ponytail: 1 endpoint — returns the available workdir icon catalog.
// Extracted from server/api.ts (Phase 2F). Body is 1:1 from baseline.

import type { Route } from "../routes"

export const ROUTES: Route[] = [
  {
    method: "GET",
    length: 1,
    match: ["icons"],
    name: "icons:catalog",
    handler: async (ctx) => {
      const { deps = {} as any, send } = ctx
      send(200, { icons: deps.iconCatalog() })
    },
  },
]
