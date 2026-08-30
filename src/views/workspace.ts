import { api, WorkdirMeta } from '../api'
import { icon } from '../ui/icons'
import { navigate } from '../router'
import { refreshTabCounts } from '../ui/counts'
import { renderNotes } from './notes'
import { renderKanban } from './kanban'
import { renderSettings } from './settings'
import { renderWorldDashboard } from './dashboard'
import { linkify } from '../ui/text'
import { openModal } from '../ui/modal'
import { toast } from '../ui/toast'
import { confirmDialog } from '../ui/confirm'

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
      <div class="spacer"></div>
      ${(slug === 'atlas' || wdm.repo) ? `
        <a class="btn btn-ghost" href="#" id="git-merge-main" data-git="merge-main" title="Merge dev → main (headless)">${icon('forward', 16)} Merge to main</a>
        <a class="btn btn-ghost" href="#" id="git-resolve" data-git="resolve" title="Resolve merge conflito em dev (headless)">${icon('reset', 15)} Resolve conflito</a>
        <button type="button" class="btn btn-ghost" id="atlas-kill-all" data-kill-all title="Matar todos os terminais WezTerm abertos pelo ATLAS">${icon('kill', 16)} Matar terminais</button>` : ''}
      <a class="btn btn-ghost" href="/w/${slug}${isSettings ? '' : '/settings'}" data-nav="/w/${slug}${isSettings ? '' : '/settings'}">${icon(isSettings ? 'back' : 'gear', 18)} ${isSettings ? 'Voltar' : 'Definir'}</a>
    </div>`

  if (isSettings) {
    panel.innerHTML = `<div class="ws">${header}<div id="ws-settings"></div></div>`
    bindNav(panel); bindGitOps(panel, slug); renderSettings(panel.querySelector('#ws-settings')!, slug); return
  }

  panel.innerHTML = `<div class="ws">${header}
      <nav class="ws-tabs" id="tabs">
        <button class="ws-tab active" data-tab="dash" id="tab-dash" title="Alt+← / Alt+→">${icon('sphere', 16)} Dashboard</button>
        <button class="ws-tab" data-tab="notes" id="tab-notes" title="Alt+← / Alt+→">${icon('note', 16)} Notas</button>
        <button class="ws-tab" data-tab="kanban" id="tab-kanban" title="Alt+← / Alt+→">${icon('board', 16)} Kanban</button>
      </nav>
      <div id="ws-content"></div>
    </div>`
  bindNav(panel); bindGitOps(panel, slug); bindKillAll(panel, slug)
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

function bindNav(root: HTMLElement) {
  root.querySelectorAll('[data-nav]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); navigate(a.getAttribute('data-nav')!) }))
}
function esc(s: unknown) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }

// gitOp: dispara uma operacao git de topo de repo (merge dev->main / resolver conflito) no terminal
// headless do Hermes. Otimiza o padrao launchDp: POST so arranca; o log streameia num modal term-view
// via /api/w/:slug/output/<op>. op de route != id do log em resolve (route 'resolve', log 'resolve-conflict').
function gitOp(slug: string, op: string) {
  const opId = op === 'resolve' ? 'resolve-conflict' : op
  const label = op === 'resolve' ? 'Resolve merge conflito' : 'Merge dev → main'
  fetch(`/api/w/${slug}/git/${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
    .then(r => r.json()).then((d: any) => {
      if (d && d.ok) { toast('A ' + label + ' em segundo plano (headless)'); viewGitTerm(slug, opId, label) }
      else toast((d && d.error) || 'Erro ao iniciar ' + label)
    }).catch(() => toast('Falha ao iniciar ' + label))
}

// bindGitOps: liga os botoes git do header ([data-git]) ao gitOp(). Eram <a href="#"> sem handler
// -> clicar so relocalizava o hash ('refresh') sem disparar nada. preventDefault trava o salto.
function bindGitOps(root: HTMLElement, slug: string) {
  root.querySelectorAll('[data-git]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault()
    gitOp(slug, a.getAttribute('data-git')!)
  }))
}

// bindKillAll: card terminal-control — botao master no header. Manda fechar todos os panes
// WezTerm abertos por cards em doing deste workdir (POST /api/terms/kill-all). Confirm-dialog antes
// de disparar (master kill e' destrutivo: nao da undo).
function bindKillAll(root: HTMLElement, slug: string) {
  const btn = root.querySelector<HTMLButtonElement>('[data-kill-all]')
  if (!btn) return
  btn.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Matar terminais ATLAS', message: 'Fecha todas as janelas WezTerm abertas por cards em doing. Continuar?' })
    if (!ok) return
    try {
      const r = await fetch('/api/terms/kill-all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug }) }).then(r => r.json())
      const killed = (r && typeof r.killed === 'number') ? r.killed : 0
      toast(killed > 0 ? `${killed} terminais fechados` : 'Nenhum terminal aberto')
    } catch (e: any) { toast('Erro: ' + (e?.message || e)) }
  })
}

// viewGitTerm: replica o viewTerminal dos cards, mas para um id de operacao git (op). Mostra o log do
// hermes headless com stream offset-based; para de fazer poll quando o modal fecha (MutationObserver).
function viewGitTerm(slug: string, opId: string, label: string) {
  let offset = 0
  let pre = document.createElement('pre')
  pre.className = 'term-view'
  pre.textContent = ''
  let timer: ReturnType<typeof setInterval> | undefined
  const body = () => `<div class="term-wrap">${pre.outerHTML}<div class="term-status" id="${opId}-gstatus">ainda não lançada</div></div>`
  const m = openModal({ title: label + ' · ' + slug, submitText: 'Fechar', cancelText: 'Fechar', body, onSubmit: () => { if (timer) clearInterval(timer) } })
  pre = m.root.querySelector('.term-view') as HTMLPreElement
  const statusEl = m.root.querySelector('.term-status') as HTMLElement
  const tick = async () => {
    try {
      const d = await api.run.output(slug, opId, offset)
      if (d) {
        if (d.chunk) { pre.textContent += d.chunk; pre.scrollTop = pre.scrollHeight }
        offset = d.offset
        if (d.done) {
          if (timer) clearInterval(timer)
          statusEl.textContent = d.code === 0 ? 'concluído ✓' : ('terminou com erro (código ' + d.code + ') — vê o log acima')
          statusEl.classList.toggle('err', !!(d.code !== 0))
          return
        }
        if (d.started === false && !pre.textContent) { statusEl.textContent = 'ainda não lançada'; return }
        statusEl.textContent = '● a trabalhar (update 1s)'
      }
    } catch { /* aguenta — server pode reiniciar */ }
  }
  timer = setInterval(tick, 1000)
  tick()
  const obs = new MutationObserver(() => { if (!m.root.isConnected) { if (timer) clearInterval(timer); obs.disconnect() } })
  obs.observe(document.body, { childList: true })
}
