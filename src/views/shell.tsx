import { useEffect, useRef } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { renderShellChrome } from './shell-vanilla'
import { navigate } from '../router'

// ponytail: SP §7 step 8 — Shell is the app layout. Sidebar chrome (logo, world nav, clock,
// focus pill, footer) is rendered by vanilla renderShellChrome() into #side-nav-host. The
// main panel is a separate React-managed <main> that hosts <Outlet/> for child routes.
// NavBridge captures useNavigate() into the module-level _nav ref so vanilla views can
// call navigate('/...') imperatively. Lives INSIDE the RouterProvider tree so useNavigate
// has access to the router context.
export default function Shell() {
  const sideRef = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const fn = useNavigate()
  const slugMatch = location.pathname.match(/^\/w\/([a-z0-9-]+)(\/settings)?$/)
  const slug = slugMatch ? slugMatch[1] : null
  const isSettings = !!slugMatch?.[2]
  const isChat = /^\/c(\/settings)?$/.test(location.pathname)

  useEffect(() => {
    if (!sideRef.current) return
    renderShellChrome(sideRef.current, slug, isSettings, isChat)
  }, [slug, isSettings, isChat])

  return (
    <div className="shell" id="shell">
      <div className="orb-bg"></div>
      <aside className="side" id="side">
        <div id="side-nav-host" ref={sideRef}></div>
      </aside>
      <button className="hamb" id="hamb" aria-label="Abrir menu workdirs">≡</button>
      <main className="panel" id="panel">
        <NavBridge nav={fn} />
        <Outlet />
      </main>
    </div>
  )
}

function NavBridge({ nav }: { nav: (path: string) => void }) {
  // ponytail: SP §7 step 8 — bridge imperative navigate() from vanilla views into react-router.
  // Sets module-level _nav on every render. The vanilla views call navigate('/...') as before.
  useEffect(() => {
    ;(globalThis as any).__atlasNav = nav
  }, [nav])
  return null
}
