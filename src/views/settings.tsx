import { useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { renderSettings } from './settings-vanilla'

// ponytail: SP §7 step 8 — Settings view wraps the vanilla renderSettings because
// the underlying logic is mechanical (palette snapshots + tz + theme). React only provides
// the route + mount guard.
export default function Settings() {
  const { slug } = useParams()
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => { if (root.current && slug) renderSettings(root.current, slug) }, [slug])
  return <div id="ws-settings" ref={root} />
}
