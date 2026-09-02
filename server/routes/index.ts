// server/routes/index.ts
//
// ponytail: barrel for per-domain route tables. Add a new domain by:
//   1) creating server/routes/<name>.ts exporting `ROUTES: Route[]`
//   2) re-exporting it here
// The dispatcher in routes.ts imports `ALL_ROUTES` (the flat concat) at
// module init; per-domain files stay independent.

import type { Route } from "../routes"
import { ROUTES as termsRoutes } from "./terms"
import { ROUTES as workdirsRoutes } from "./workdirs"

export const ALL_ROUTES: Route[] = [
  ...termsRoutes,
  ...workdirsRoutes,
  // future: ...hermesRoutes, ...wRoutes, ...iconsRoutes, ...orchestratorRoutes,
]
