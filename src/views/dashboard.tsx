import { useEffect, useRef } from 'react'
import { renderDashboard, renderWorldDashboard } from './dashboard-vanilla'

// ponytail: SP §7 step 8 — Dashboard hosts the cross-world grid (/) and the per-world tab.
export default function Dashboard() {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!root.current) return
    renderDashboard(root.current, [])
  }, [])
  return <div id="dashboard-host" ref={root} />
}
