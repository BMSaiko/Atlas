import { api, WorkdirMeta } from '../api'
import { icon } from '../ui/icons'

import { refreshTabCounts } from '../ui/counts'
import { renderNotes } from './notes-vanilla'
import { renderKanban } from './kanban-vanilla'
import { renderSettings } from './settings-vanilla'
import { renderWorldDashboard } from './dashboard-vanilla'
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
  // ponytail: botoes canto-superior-direito (Merge/Resolve/Matar/Definir) migraram para a palette
  // Ctrl+K (ui/palette.ts). A palette ja recebe `slug`, logo as accoes sabem em que mundo estao.
  const header = `<div class="pan-head">
      <div class="pan-title"><h1>${esc(wdm.name)}</h1><div class="desc">${linkify(wdm.description || '')}</div></div>
    </div>`

  if (isSettings) {
    panel.innerHTML = `<div class="ws">${header}<div id="ws-settings"></div></div>`
    renderSettings(panel.querySelector('#ws-settings')!, slug); return
  }

  panel.innerHTML = `<div class="ws">${header}
      <nav class="ws-tabs" id="tabs">
        <button class="ws-tab active" data-tab="dash" id="tab-dash" title="Alt+← / Alt+→">${icon('sphere', 16)} Dashboard</button>
        <button class="ws-tab" data-tab="notes" id="tab-notes" title="Alt+← / Alt+→">${icon('note', 16)} Notas</button>
        <button class="ws-tab" data-tab="kanban" id="tab-kanban" title="Alt+← / Alt+→">${icon('board', 16)} Kanban</button>
      </nav>
      <div id="ws-content"></div>
    </div>`
  const tabKey = `atlas.tab.\${slug}`
  // ponytail: deep-link da busca global (?tab=notes|kanban&open=<id>) — prefere a tab pedida
  const qp = new URLSearchParams(location.search)
  const qtab = qp.get('tab') as 'notes' | 'kanban' | null
  const openId = qp.get('open')
  let tab: 'dash' | 'notes' | 'kanban' = qtab || (() => { const v = (() => { try { return localStorage.getItem(tabKey) } catch { return null } })(); return (v === 'notes' || v === 'kanban' || v === 'dash') ? v : 'dash' })()
  const content = panel.querySelector('#ws-content') as HTMLElement
  const show = async () => {
    panel.querySelectorAll('.ws-tab').forEach(t => t.classList.toggle('active', t.getAttribute('data-tab') === tab))
    if (tab === 'dash') await renderWorldDashboard(content, { slug, name: wdm.name, description: wdm.description, icon: wdm.icon })
    else if (tab === 'notes') await renderNotes(content, slug)
    else await renderKanban(content, slug)
    await refreshTabCounts(slug)
    // ponytail: deep-link abre o modal do item-alvo via click (reusa handlers ja existentes de nota/cartao)
    if (openId) {
      const target = content.querySelector<HTMLElement>(`[data-id="${openId}"]`)
      if (target) target.click()
      history.replaceState(null, '', location.pathname)  // limpa o query p/ nao reabrir em re-renders
    }
  }
  show()
  panel.querySelectorAll('.ws-tab').forEach(t => t.addEventListener('click', () => { tab = t.getAttribute('data-tab') as any; try { localStorage.setItem(tabKey, tab) } catch {}; show() }))

  // ponytail: Alt+ArrowLeft/Right cicla as 3 tabs do workspace. Mesmo padrao de guardas do shell.ts
  // (input/textarea/select focado + modal-backdrop aberto). AbortController desconecta tudo
  // automaticamente em re-entries de renderWorkspace p/ outro slug.
  const TAB_ORDER: Array<'dash' | 'notes' | 'kanban'> = ['dash', 'notes', 'kanban']
  const ac = new AbortController()
  ;(panel as any).__tabAbort = ac  // ponytail: referencia p/ re-entry cleanup (caso o router chame outra vez)
  if ((panel as any).__tabPrevAbort) (panel as any).__tabPrevAbort.abort()
  ;(panel as any).__tabPrevAbort = ac
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
    if (document.querySelector('.modal-backdrop')) return
    if (!e.altKey) return
    const delta = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
    if (!delta) return
    const i = TAB_ORDER.indexOf(tab)
    if (i < 0) return
    e.preventDefault()
    tab = TAB_ORDER[(i + delta + TAB_ORDER.length) % TAB_ORDER.length]
    try { localStorage.setItem(tabKey, tab) } catch {}
    show()
  }, { signal: ac.signal })
}

function esc(s: unknown) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }

