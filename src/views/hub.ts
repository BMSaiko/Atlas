import { api, Workdir } from '../api'
import { icon } from '../ui/icons'
import { openModal } from '../ui/modal'
import { toast } from '../ui/toast'
import { navigate } from '../router'

const ACTIVE_KEY = 'atlas.active'

function active(): string { try { return localStorage.getItem(ACTIVE_KEY) || '' } catch { return '' } }

async function counts(slug: string): Promise<{ notes: number; open: number }> {
  try {
    const [notes, board] = await Promise.all([api.notes.get(slug), api.kanban.get(slug)])
    const open = board.cards.filter(c => !c.archived && c.colId !== 'done').length
    return { notes: notes.length, open }
  } catch { return { notes: 0, open: 0 } }
}

export async function renderHub(root: HTMLElement) {
  root.innerHTML = `<div class="orb-bg"></div>
    <a class="skip-link" href="#main">Saltar para o conteúdo</a>
    <main id="main" class="hub">
      <div class="hub-head">
        <div class="logo">ATLAS</div>
        <p class="tagline">O titã que sustenta os céus — cada projecto, o seu próprio mundo.</p>
      </div>
      <div class="wd-grid" id="wdgrid"><div class="empty">A carregar…</div></div>
      <div class="hub-actions">
        <button class="btn btn-primary" id="new-wd">${icon('plus')} Novo workdir</button>
      </div>
    </main>`

  const grid = root.querySelector('#wdgrid')!
  const act = active()
  const workdirs = await api.workdirs()
  if (workdirs.length === 0) { grid.innerHTML = `<div class="empty-hub">Ainda não há workdirs. Cria o primeiro.</div>` }

  const cards = await Promise.all(workdirs.map(async w => {
    const c = await counts(w.slug)
    const isActive = w.slug === act
    return `<a class="wd-card${isActive ? '' : ' inactive'}" href="/w/${w.slug}" data-slug="${w.slug}">
      <div class="row" style="gap:8px"><span style="color:var(--gold)">${icon('sphere', 26)}</span></div>
      <h3>${esc(w.name)}</h3>
      <div class="desc">${esc(w.description || '')}</div>
      <div class="stats"><span class="stat"><b>${c.notes}</b> notas</span><span class="stat"><b>${c.open}</b> abertas</span></div>
    </a>`
  }))
  grid.innerHTML = cards.join('')

  grid.querySelectorAll('.wd-card').forEach(card => {
    card.addEventListener('click', e => { e.preventDefault(); if (card.getAttribute('data-slug')) { setActive(card.getAttribute('data-slug')!); navigate(card.getAttribute('href') || ('/w/' + card.getAttribute('data-slug'))) } })
  })

  root.querySelector('#new-wd')!.addEventListener('click', () => {
    openModal({
      title: 'Novo workdir', submitText: 'Criar',
      body: () => `<div class="field"><label for="wd-name">Nome</label><input id="wd-name" name="name" required placeholder="Ex.: Portfolio, Estudos, Pessoal"></div>
                   <div class="field"><label for="wd-desc">Descrição <span class="muted">(opcional)</span></label><input id="wd-desc" name="description" placeholder="Para que serve"></div>`,
      onSubmit: async () => {
        const form = document.querySelector('.modal form') as HTMLFormElement | null
        if (!form) return
        const name = (form.querySelector('[name=name]') as HTMLInputElement).value
        const description = (form.querySelector('[name=description]') as HTMLInputElement).value
        if (!name.trim()) return
        try {
          const wd = await api.createWorkdir(name, description)
          setActive(wd.slug); toast('Workdir criado'); navigate('/w/' + wd.slug)
        } catch (e: any) { toast('Erro: ' + e.message) }
      },
    })
  })
}

function setActive(slug: string) { try { localStorage.setItem(ACTIVE_KEY, slug) } catch {} }
function esc(s: string) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }
