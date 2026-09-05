import { useEffect, useRef } from 'react'
import { renderMainChat } from './main-chat-vanilla'

// ponytail: SP §7 step 8 — MainChat cross-world view (was lazy-loaded, see Epic A6 fix).
export default function MainChat() {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!root.current) return
    renderMainChat(root.current)
  }, [])
  return <div id="mainchat-host" ref={root} />
}

// ponytail: re-export for shell-vanilla.ts dynamic import (`renderMainChat`)
export { renderMainChat } from './main-chat-vanilla'
