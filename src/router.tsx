import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'
import Shell from './views/shell'
import Dashboard from './views/dashboard'
import Workspace from './views/workspace'
import Settings from './views/settings'
import MainChat from './views/main-chat'
import Calendar from './views/calendar'

// ponytail: SP §5 + atlas-calendar-2026-09-05 — frozen URL contract. Routes: /, /w/:slug, /w/:slug/settings, /c, /c/calendar
const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'w/:slug', element: <Workspace /> },
      { path: 'w/:slug/settings', element: <Settings /> },
      { path: 'c', element: <MainChat /> },
      // ponytail: SP atlas-calendar-2026-09-05 — month grid, events from meta.json
      { path: 'c/calendar', element: <Calendar /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])

export default router
export { RouterProvider }

// ponytail: shim for vanilla views that imported `navigate` from './router'. The bridge
// is wired by Shell's NavBridge which sets globalThis.__atlasNav to react-router's
// useNavigate() callback. If called before Shell mounts, fall back to history.pushState.
export function navigate(path: string) {
  const fn = (globalThis as any).__atlasNav
  if (fn) fn(path)
  else window.history.pushState(null, '', path)
}
