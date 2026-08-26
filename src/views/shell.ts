import { api } from '../api'
import { icon } from '../ui/icons'
import { openModal } from '../ui/modal'
import { toast } from '../ui/toast'
import { navigate } from '../router'
import { renderWorkspace } from './workspace'

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

  root.innerHTML = `
    <div class="orb-bg"></div>
    <div class="shell" id="shell">
      <aside class="side" id="side">
        <div class="side-head"><a class="logo logo-sm" href="/" data-nav="/">ATLAS</a></div>
        <nav class="side-nav" aria-label="Workdirs">
          ${items.map(w => `<a class="side-item${w.slug === activeSlug ? ' active' : ''}" data-slug="${w.slug}" href="/w/${w.slug}">
            <span class="side-icon">${icon('sphere', 18)}</span>
            <span class="side-label">${esc(w.name)}</span>
            ${w.open ? `<span class="side-count">${w.open}</span>` : ''}</a>`).join('')}
        </nav>
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
  window.addEventListener('keydown', e => {
    if (!e.ctrlKey) return
    if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
    if (document.querySelector('.modal-backdrop')) return
    const n = parseInt(e.key); if (n >= 1 && n <= 9 && items[n - 1]) {
      e.preventDefault(); setActive(items[n - 1].slug); navigate('/w/' + items[n - 1].slug)
    }
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
