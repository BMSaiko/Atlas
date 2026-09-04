import { renderShell } from './views/shell'

const app = () => document.getElementById('app') as HTMLElement

export function navigate(path: string) { history.pushState(null, '', path); render() }

export function render() {
  const m = location.pathname.match(/^\/w\/([a-z0-9-]+)(\/settings)?$/)
  renderShell(app(), m ? m[1] : null, m ? !!m[2] : false)
}

export const router = {
  init() { window.addEventListener('popstate', render); render() },
  navigate,
}
