import { api, Nota, uid } from '../api'
import { icon } from '../ui/icons'
import { openModal } from '../ui/modal'
import { toast } from '../ui/toast'
import { confirmDialog } from '../ui/confirm'
import { linkify } from '../ui/text'

export async function renderNotes(root: HTMLElement, slug: string) {
  let notes = await api.notes.get(slug).catch(() => [] as Nota[])
  const save = async () => { await api.notes.put(slug, notes); }
  const fmt = (ts: number) => new Date(ts).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  root.innerHTML = `
    <div class="notes-toolbar">
      <input class="notes-search" id="nsearch" placeholder="Buscar notas…" aria-label="Buscar notas">
      <button class="btn btn-primary" id="nadd">${icon('plus', 16)} Nova nota</button>
    </div>
    <div class="notes-grid" id="ngrid"></div>`
  const grid = root.querySelector('#ngrid') as HTMLElement

  const doRender = (q = '') => {
    const list = notes.filter(n => !q || n.title.toLowerCase().includes(q) || n.text.toLowerCase().includes(q)).sort((a, b) => b.ts - a.ts)
    if (list.length === 0) { grid.innerHTML = `<div class="empty">${notes.length === 0 ? 'Sem notas ainda. Cria a primeira.' : 'Sem resultados.'}</div>`; return }
    grid.innerHTML = list.map(n => `
      <article class="note-card" data-id="${n.id}">
        <h4>${esc(n.title)}</h4>
        <div class="note-text">${linkify(n.text)}</div>
        <div class="note-date">${fmt(n.ts)}</div>
        <div class="note-actions">
          <button class="btn-icon btn-ghost" data-act="edit" aria-label="Editar">${icon('pencil', 16)}</button>
          <button class="btn-icon btn-ghost" data-act="del" aria-label="Eliminar">${icon('trash', 16)}</button>
        </div>
      </article>`).join('')
  }
  doRender()

  const searchInput = root.querySelector('#nsearch') as HTMLInputElement
  searchInput.addEventListener('input', () => doRender(searchInput.value.toLowerCase()))

  root.querySelector('#nadd')!.addEventListener('click', () => noteModal(null))
  grid.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null
    if (!btn) return
    const card = btn.closest('.note-card') as HTMLElement
    const n = notes.find(x => x.id === card.dataset.id)!
    if (btn.dataset.act === 'del') {
      confirmDialog({ title: 'Eliminar nota', message: 'Apagar esta nota?' }).then(ok => { if (!ok) return; notes = notes.filter(x => x.id !== n.id); save().then(()=>doRender()); toast('Nota eliminada') })
    }
    if (btn.dataset.act === 'edit') noteModal(n)
  })

  function noteModal(n: Nota | null) {
    openModal({
      title: n ? 'Editar nota' : 'Nova nota', submitText: n ? 'Guardar' : 'Criar',
      body: () => `<div class="field"><label for="nt-title">Título</label><input id="nt-title" name="title" required value="${esc(n?.title || '')}"></div>
                   <div class="field"><label for="nt-text">Texto</label><textarea id="nt-text" name="text">${esc(n?.text || '')}</textarea></div>`,
      onSubmit: () => {
        const form = document.querySelector('.modal form') as HTMLFormElement
        const title = (form.querySelector('[name=title]') as HTMLInputElement).value.trim()
        const text = (form.querySelector('[name=text]') as HTMLTextAreaElement).value
        if (!title) return
        if (n) { n.title = title; n.text = text }
        else notes.unshift({ id: uid(), title, text, ts: Date.now() })
        save().then(() => { doRender(searchInput.value.toLowerCase()); toast(n ? 'Nota guardada' : 'Nota criada') })
      },
    })
  }
}
function esc(s: string) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }
