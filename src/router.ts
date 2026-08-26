import { renderHub } from './views/hub'
import { renderWorkspace } from './views/workspace'

const app = () => document.getElementById('app') as HTMLElement

export function navigate(path: string) { history.pushState(null, '', path); render() }

export function render() {
  const path = location.pathname
  const w = path.match(/^\/w\/([a-z0-9-]+)(\/settings)?$/)
  if (w) { renderWorkspace(app(), w[1], !!w[2]); return }
  if (path === '/' || path === '') { renderHub(app()); return }
  // 404 → hub
  app().innerHTML = ''; renderHub(app())
}

export const router = {
  init() {
    window.addEventListener('popstate', render)
    render()
  },
  navigate,
}
