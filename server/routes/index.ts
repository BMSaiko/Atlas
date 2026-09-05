// server/routes/index.ts
//
// ponytail: barrel for per-domain route tables. Add a new domain by:
//   1) creating server/routes/<name>.ts exporting `ROUTES: Route[]`
//   2) re-exporting it here
// The dispatcher in routes.ts imports `ALL_ROUTES` (the flat concat) at
// module init; per-domain files stay independent.
//
// strip-kanban (2026-09-05): w.ts + orchestratorRoutes removed; w-survivors.ts holds the 7
// /api/w/* routes that survive (bundle, snapshots*, export, notes/templates/events/meta).

import type { Route } from "../routes"
import { ROUTES as termsRoutes } from "./terms"
import { ROUTES as workdirsRoutes } from "./workdirs"
import { ROUTES as hermesRoutes } from "./hermes"
import { ROUTES as wSurvivorsRoutes } from "./w-survivors"
import { ROUTES as iconsRoutes } from "./icons"
import { ROUTES as chatRoutes } from "./chat"

export const ALL_ROUTES: Route[] = [
  ...termsRoutes,
  ...workdirsRoutes,
  ...hermesRoutes,
  ...wSurvivorsRoutes,
  ...iconsRoutes,
  ...chatRoutes,
]
