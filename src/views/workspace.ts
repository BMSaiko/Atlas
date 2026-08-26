import { api, WorkdirMeta } from '../api'
import { icon } from '../ui/icons'
import { navigate } from '../router'
import { renderNotes } from './notes'
import { renderKanban } from './kanban'
import { renderSettings } from './settings'

export async function renderWorkspace(root: HTMLElement, slug: string, isSettings: boolean) {
  root.innerHTML = `
    <div class="orb-bg"></div>
    <main class="ws">
      <div class="ws-head">
        <a class="ws-back" href="/" data-nav="/" aria-label="Voltar ao hub">${icon('back', 22)}</a>
        <div>
          <h1>${esc(slug)}</h1>
          <div class="desc" id="ws-desc"></div>
        </div>
        <div class="spacer"></div>
        <a class="btn btn-ghost ${isSettings ? 'active' : ''}" href="/w/${slug}/settings" data-nav="/w/${slug}/settings">${icon('gear', 18)} Definir</a>
      </div>
      ${isSettings ? '' : `
      <nav class="ws-tabs" id="tabs">
        <button class="ws-tab active" data-tab="notes" id="tab-notes">${icon('note', 16)} Notas</button>
        <button class="ws-tab" data-tab="kanban" id="tab-kanban">${icon('board', 16)} Kanban</button>
      </nav>
      <div id="ws-content"></div>`}
    </main>`

  const meta = await api.meta(slug).catch(() => null)
  if (!meta || (meta as any).error) {
    root.querySelector('#ws-desc')!.textContent = 'Workdir não encontrado'
    return
  }
  const wdm = meta as WorkdirMeta
  try { localStorage.setItem('atlas.active', slug) } catch {}
  root.querySelector('#ws-desc')!.textContent = wdm.description || ''
  root.querySelector('.ws-head h1')!.textContent = wdm.name

  if (isSettings) { renderSettings(root, slug); return }

  let tab: 'notes' | 'kanban' = 'notes'
  const content = root.querySelector('#ws-content') as HTMLElement
  const show = async () => {
    const ts = root.querySelectorAll('.ws-tab')
    ts.forEach(t => t.classList.toggle('active', t.getAttribute('data-tab') === tab))
    if (tab === 'notes') await renderNotes(content, slug)
    else await renderKanban(content, slug)
  }
  show()
  root.querySelectorAll('.ws-tab').forEach(t => {
    t.addEventListener('click', () => { tab = t.getAttribute('data-tab') as any; show() })
  })

  root.querySelectorAll('[data-nav]').forEach(a => {
    a.addEventListener('click', e => { e.preventDefault(); navigate(a.getAttribute('data-nav')!); render() })
  })
}

function esc(s: string) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
function render() { location.reload() }
