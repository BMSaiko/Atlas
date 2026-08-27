import { api, uid } from '../api'
import { icon } from '../ui/icons'
import { openModal } from '../ui/modal'
import { toast } from '../ui/toast'
import { navigate } from '../router'
import { renderWorkspace } from './workspace'
import { startClockWidget } from '../ui/clock'
import { getTheme, setManual, Shift } from '../ui/theme'
import { mountFocus } from '../ui/pomodoro'

const ACTIVE_KEY = 'atlas.active'
const active = () => { try { return localStorage.getItem(ACTIVE_KEY) || '' } catch { return '' } }
const setActive = (s: string) => { try { localStorage.setItem(ACTIVE_KEY, s) } catch {} }

async function counts(slug: string) {
  try {
    const [notes, board] = await Promise.all([api.notes.get(slug), api.kanban.get(slug)])
    return { notes: notes.length, open: board.cards.filter(c => !c.archived && c.colId !== 'done').length }
  } catch { return { notes: 0, open: 0 } }
}

export async function renderShell(root: HTMLElement, slug: string | null, isSettings: boolean) {
  const workdirs = await api.workdirs()
  let activeSlug = slug && workdirs.some(w => w.slug === slug) ? slug : null
  if (!activeSlug) { const p = active(); if (p && workdirs.some(w => w.slug === p)) activeSlug = p }
  const items = await Promise.all(workdirs.map(async w => ({ ...w, open: (await counts(w.slug)).open })))
  state.slug = activeSlug; state.items = items

  root.innerHTML = `
    <div class="orb-bg"></div>
    <div class="shell" id="shell">
      <aside class="side" id="side">
        <div class="side-head"><a class="logo logo-sm" href="/" data-nav="/">ATLAS</a><span class="shift-ind" id="shift-ind" title="Luminosidade do dia"></span></div>
        <nav class="side-nav" aria-label="Workdirs">
          ${items.map(w => `<a class="side-item${w.slug === activeSlug ? ' active' : ''}" data-slug="${w.slug}" href="/w/${w.slug}">
            <span class="side-icon">${icon('sphere', 18)}</span>
            <span class="side-label">${esc(w.name)}</span>
            ${w.open ? `<span class="side-count">${w.open}</span>` : ''}</a>`).join('')}
        </nav>
        <div class="side-clock" id="clock">
          <div class="clock-time" data-clock="time">--:--:--</div>
          <div class="clock-sub"><span class="clock-date" data-clock="date"></span> · <span class="clock-tz">PT</span></div>
        </div>
        <div class="side-focus" id="foco"></div>
        <div class="side-foot"><button class="btn btn-primary btn-block" id="side-new">${icon('plus', 16)} Novo workdir</button></div>
      </aside>
      <button class="hamb" id="hamb" aria-label="Abrir menu workdirs">${icon('menu', 22)}</button>
      <main class="panel" id="panel"></main>
    </div>`

  const panel = root.querySelector('#panel') as HTMLElement
  if (activeSlug) { setActive(activeSlug); await renderWorkspace(panel, activeSlug, isSettings) }
  else renderEmpty(panel, items, root)

  const shell = root.querySelector('#shell') as HTMLElement
  root.querySelector('#hamb')!.addEventListener('click', () => shell.classList.toggle('side-open'))
  root.querySelectorAll('.side-item').forEach(el => el.addEventListener('click', e => {
    e.preventDefault(); setActive(el.getAttribute('data-slug')!); shell.classList.remove('side-open'); navigate('/w/' + el.getAttribute('data-slug'))
  }))
  root.querySelectorAll('[data-nav]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); navigate(el.getAttribute('data-nav')!) }))
  root.querySelector('#side-new')!.addEventListener('click', () => newWorkdir())
  bindKeydown()
  watchShift()
  startClockWidget(shell)
  mountFocus(root.querySelector('#foco') as HTMLElement)
}


const SHIFT_ICON: Record<string, 'sun'|'dusk'|'moon'> = { day: 'sun', dusk: 'dusk', night: 'moon' }
const SHIFT_LABEL: Record<string, string> = { day: 'Dia', dusk: 'Entardecer', night: 'Noite' }
// Clicar no indicador cicla Dia -> Entardecer -> Noite (escolha manual de tema).
// Modo auto é definido nas Definições; enquanto estiver ativo o botão sai da barra lateral.
const CYCLE: Array<Shift> = ['day', 'dusk', 'night']
function renderShift() {
  const el = document.getElementById('shift-ind')
  if (!el) return
  const t = getTheme()
  // Em modo auto o tema segue a hora; o botão sai da barra lateral.
  if (t.mode === 'auto') { el.style.display = 'none'; return }
  el.style.display = ''
  const s: Shift = t.shift
  el.innerHTML = icon(SHIFT_ICON[s] || 'moon', 16) +
    `<span class="shift-label">${SHIFT_LABEL[s] || 'Noite'}</span>`
  el.setAttribute('data-shift', s)
}
function watchShift() {
  renderShift()
  const el = document.getElementById('shift-ind')
  // O botão só é clicável em modo manual (o modo manual fixa o tema).
  el?.addEventListener('click', () => {
    const t = getTheme()
    if (t.mode === 'auto') return
    const next = CYCLE[(CYCLE.indexOf(t.shift) + 1) % CYCLE.length]
    setManual(next)
  })
  const mo = new MutationObserver(renderShift)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-shift'] })
}

let state: { slug: string | null; items: Array<{ slug: string }> } = { slug: null, items: [] }
let keydownBound = false
function bindKeydown() {
  if (keydownBound) return
  keydownBound = true
  window.addEventListener('keydown', e => {
    if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
    if (document.querySelector('.modal-backdrop')) return
    if (e.ctrlKey) {
      if (e.key === 'k' || e.key === 'K') { e.preventDefault(); quickAdd(state.slug); return }
      const n = parseInt(e.key); if (n >= 1 && n <= 9 && state.items[n - 1]) {
        e.preventDefault(); setActive(state.items[n - 1].slug); navigate('/w/' + state.items[n - 1].slug)
      }
      return
    }
    if (e.altKey) {
      const cur = state.slug
      if (!cur) return
      const i = state.items.findIndex(it => it.slug === cur)
      if (i < 0) return
      if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); setActive(state.items[i - 1].slug); navigate('/w/' + state.items[i - 1].slug) }
      else if (e.key === 'ArrowDown' && i < state.items.length - 1) { e.preventDefault(); setActive(state.items[i + 1].slug); navigate('/w/' + state.items[i + 1].slug) }
    }
  })
}

function quickAdd(slug: string | null) {
  if (!slug) return
  openModal({
    title: 'Criar nota ou cartão', submitText: 'Criar',
    body: () => `<div class="field"><label for="qa-type">Tipo</label>
      <select id="qa-type" name="type">
        <option value="note">Nota</option>
        <option value="card">Cartão</option>
      </select></div>
      <div class="field"><label for="qa-title">Título</label><input id="qa-title" name="title" required></div>
      <div class="field"><label for="qa-text">Texto / Descrição</label><textarea id="qa-text" name="text"></textarea></div>`,
    onSubmit: async () => {
      const form = document.querySelector('.modal form') as HTMLFormElement
      const type = (form.querySelector('[name=type]') as HTMLSelectElement).value
      const title = (form.querySelector('[name=title]') as HTMLInputElement).value.trim()
      if (!title) return
      const text = (form.querySelector('[name=text]') as HTMLTextAreaElement).value
      try {
        if (type === 'note') {
          const notes = await api.notes.get(slug)
          notes.unshift({ id: uid(), title, text, ts: Date.now() })
          await api.notes.put(slug, notes)
          toast(`Nota criada: "${title}"`)
        } else {
          const b = await api.kanban.get(slug)
          const col = b.columns.find(c => c.id === 'todo' || c.id === 'doing')?.id || b.columns[0]?.id
          if (col) {
            b.cards.push({ id: uid(), title, description: text, priority: 'low', colId: col, ts: Date.now(), archived: false })
            await api.kanban.put(slug, b)
            toast(`Cartão criado: "${title}"`)
          } else toast('Sem colunas no kanban')
        }
        navigate('/w/' + slug)
      } catch (e: any) { toast('Erro: ' + e.message) }
    },
  })
}

function renderEmpty(panel: HTMLElement, items: Array<any>, root: HTMLElement) {
  const last = active(); const lastWd = items.find(w => w.slug === last)
  panel.innerHTML = `
    <div class="panel-empty">
      <div class="logo">ATLAS</div>
      <p class="tagline">O titã que sustenta os céus — cada projecto, o seu próprio mundo.</p>
      ${items.length ? `${lastWd ? `<button class="btn btn-ghost" id="reopen">${icon('sphere', 16)} Reabrir ${esc(lastWd.name)}</button>` : ''}` : `<p class="muted">Ainda não há workdirs. Cria o primeiro.</p>`}
      <button class="btn btn-primary" id="panel-new" style="margin-top:14px">${icon('plus', 16)} ${items.length ? 'Novo workdir' : 'Criar o primeiro workdir'}</button>
    </div>`
  root.querySelector('#panel-new')!.addEventListener('click', () => newWorkdir())
  const reopen = panel.querySelector('#reopen')
  if (reopen) reopen.addEventListener('click', () => { setActive(last); navigate('/w/' + last) })
}

function newWorkdir() {
  openModal({
    title: 'Novo workdir', submitText: 'Criar',
    body: () => `<div class="field"><label for="wd-name">Nome</label><input id="wd-name" name="name" required></div>
                 <div class="field"><label for="wd-desc">Descrição <span class="muted">(opcional)</span></label><input id="wd-desc" name="description"></div>`,
    onSubmit: async () => {
      const form = document.querySelector('.modal form') as HTMLFormElement | null; if (!form) return
      const name = (form.querySelector('[name=name]') as HTMLInputElement).value
      const description = (form.querySelector('[name=description]') as HTMLInputElement).value
      if (!name.trim()) return
      try { const wd = await api.createWorkdir(name, description); setActive(wd.slug); toast('Workdir criado'); navigate('/w/' + wd.slug) }
      catch (e: any) { toast('Erro: ' + e.message) }
    },
  })
}
function esc(s: unknown) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }
