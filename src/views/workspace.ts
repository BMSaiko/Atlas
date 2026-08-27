import { api, WorkdirMeta } from '../api'
import { icon } from '../ui/icons'
import { navigate } from '../router'
import { renderNotes } from './notes'
import { renderKanban } from './kanban'
import { renderSettings } from './settings'
import { linkify } from '../ui/text'

class NotFound extends Error {}
const metaOrThrow = async (slug: string): Promise<WorkdirMeta> => {
  const m = await api.meta(slug).catch(() => null)
  if (!m || (m as any).error) throw new NotFound()
  return m as WorkdirMeta
}

export async function renderWorkspace(panel: HTMLElement, slug: string, isSettings: boolean) {
  let wdm: WorkdirMeta
  try { wdm = await metaOrThrow(slug) } catch { panel.innerHTML = `<div class="empty">Workdir não encontrado</div>`; return }
  try { localStorage.setItem('atlas.active', slug) } catch {}
  const header = `<div class="pan-head">
      <div class="pan-title"><h1>${esc(wdm.name)}</h1><div class="desc">${linkify(wdm.description || '')}</div></div>
      <span class="kbdhint" title="Criar nota ou cartão no trabalho selecionado">${icon('aura', 14)} <kbd>Ctrl</kbd>+<kbd>K</kbd></span>
      <div class="spacer"></div>
      <a class="btn btn-ghost" href="/w/${slug}${isSettings ? '' : '/settings'}" data-nav="/w/${slug}${isSettings ? '' : '/settings'}">${icon(isSettings ? 'back' : 'gear', 18)} ${isSettings ? 'Voltar' : 'Definir'}</a>
    </div>`

  if (isSettings) {
    panel.innerHTML = `<div class="ws">${header}<div id="ws-settings"></div></div>`
    bindNav(panel); renderSettings(panel.querySelector('#ws-settings')!, slug); return
  }

  panel.innerHTML = `<div class="ws">${header}
      <nav class="ws-tabs" id="tabs">
        <button class="ws-tab active" data-tab="notes" id="tab-notes">${icon('note', 16)} Notas</button>
        <button class="ws-tab" data-tab="kanban" id="tab-kanban">${icon('board', 16)} Kanban</button>
      </nav>
      <div id="ws-content"></div>
    </div>`
  bindNav(panel)
  let tab: 'notes' | 'kanban' = 'notes'
  const content = panel.querySelector('#ws-content') as HTMLElement
  const show = async () => {
    panel.querySelectorAll('.ws-tab').forEach(t => t.classList.toggle('active', t.getAttribute('data-tab') === tab))
    if (tab === 'notes') await renderNotes(content, slug); else await renderKanban(content, slug)
  }
  show()
  panel.querySelectorAll('.ws-tab').forEach(t => t.addEventListener('click', () => { tab = t.getAttribute('data-tab') as any; show() }))
}

function bindNav(root: HTMLElement) {
  root.querySelectorAll('[data-nav]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); navigate(a.getAttribute('data-nav')!) }))
}
function esc(s: unknown) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }
