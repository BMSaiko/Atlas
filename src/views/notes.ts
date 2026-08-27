import { api, Nota, uid } from '../api'
import { icon } from '../ui/icons'
import { openModal } from '../ui/modal'
import { refreshTabCounts } from '../ui/counts'
import { toast } from '../ui/toast'
import { confirmDialog } from '../ui/confirm'
import { linkify } from '../ui/text'

export async function renderNotes(root: HTMLElement, slug: string) {
  let notes = await api.notes.get(slug).catch(() => [] as Nota[])
  let showArch = false
  const save = async () => { await api.notes.put(slug, notes); refreshTabCounts(slug) }
  const fmt = (ts: number) => new Date(ts).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const archCount = () => notes.filter(n => n.archived).length
  // ponytail: ao converter nota->cartao (tocanban) o board muda fora de kanban.ts; re-sync sidebar aqui
  function refreshSideCount() {
    api.kanban.get(slug).then(b => {
      const n = b.cards.filter(c => !c.archived && c.colId !== 'done').length
      const item = document.querySelector<HTMLElement>(`.side-item[data-slug="${slug}"]`)
      if (!item) return
      item.querySelector('.side-count')?.remove()
      if (n) item.insertAdjacentHTML('beforeend', `<span class="side-count">${n}</span>`)
    }).catch(() => {})
  }

  root.innerHTML = `
    <div class="notes-toolbar">
      <input class="notes-search" id="nsearch" placeholder="Buscar notas…" aria-label="Buscar notas">
      <button class="btn btn-ghost" id="narch" aria-pressed="${showArch}" title="${showArch ? 'Ver ativas' : 'Ver arquivadas'}">${icon('archive', 16)} <span>Arquivadas</span><span class="side-count" id="narchcount">${archCount()}</span></button>
      <button class="btn btn-primary kbdhint" id="nadd" aria-describedby="nadd-tip">${icon('plus', 16)} Nova nota<span class="kbdhint-tip" id="nadd-tip" role="tooltip">Nova nota <kbd>Ctrl</kbd>+<kbd>K</kbd></span></button>
    </div>
    <div class="notes-grid" id="ngrid"></div>`
  const grid = root.querySelector('#ngrid') as HTMLElement

  const doRender = (q = '') => {
    const list = notes.filter(n =>
      (showArch ? n.archived : !n.archived) &&
      (!q || n.title.toLowerCase().includes(q) || n.text.toLowerCase().includes(q))
    ).sort((a, b) => b.ts - a.ts)
    const badge = document.getElementById('narchcount')
    if (badge) badge.textContent = String(showArch ? notes.filter(n => !n.archived).length : notes.filter(n => n.archived).length)
    // ponytail: badge acima do early-return — arquivar a ultima nota ativa esvazia a grid e
    // return cedo deixava a contagem desatualizada (DI). Contagem atualiza sempre.
    if (list.length === 0) { grid.innerHTML = `<div class="empty">${showArch ? 'Sem notas arquivadas.' : notes.length === 0 ? 'Sem notas ainda. Cria a primeira.' : 'Sem resultados.'}</div>`; return }
    const unhide = (print: string) => `<span class="note-arch">${print}</span>`
    grid.innerHTML = list.map(n => `
      <article class="${n.archived ? 'note-card archived' : 'note-card'}" data-id="${n.id}" tabindex="0">
        <h4>${esc(n.title)}</h4>
        <div class="note-text">${linkify(n.text)}</div>
        <div class="note-date">${showArch ? unhide('Arquivada') : ''}${fmt(n.ts)}</div>
        <div class="note-actions">
          <button class="btn-icon btn-ghost" data-act="tocanban" title="Converter para cartão" aria-label="Converter para cartão">${icon('board', 16)}</button>
          <button class="btn-icon btn-ghost" data-act="edit" aria-label="Editar">${icon('pencil', 16)}</button>
          <button class="btn-icon btn-ghost" data-act="${n.archived ? 'unarch' : 'arch'}" title="${n.archived ? 'Restaurar' : 'Arquivar'}" aria-label="${n.archived ? 'Restaurar' : 'Arquivar'}">${icon('archive', 16)}</button>
          <button class="btn-icon btn-ghost" data-act="del" aria-label="Eliminar">${icon('trash', 16)}</button>
        </div>
      </article>`).join('')
  }
  doRender()

  const searchInput = root.querySelector('#nsearch') as HTMLInputElement
  searchInput.addEventListener('input', () => doRender(searchInput.value.toLowerCase()))

  const archBtn = root.querySelector('#narch') as HTMLButtonElement
  archBtn.addEventListener('click', () => {
    showArch = !showArch  // eslint-disable-line
    archBtn.setAttribute('aria-pressed', String(showArch))
    archBtn.title = showArch ? 'Ver ativas' : 'Ver arquivadas'
    archBtn.querySelector('span')!.textContent = showArch ? 'Ativas' : 'Arquivadas'
    doRender(searchInput.value.toLowerCase())
  })

  root.querySelector('#nadd')!.addEventListener('click', () => noteModal(null))
  grid.addEventListener('keydown', e => {
    const t = e.target as HTMLElement
    if (t.classList.contains('note-card') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); const n = notes.find(x => x.id === t.dataset.id); if (n) noteView(n) }
  })
  grid.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null
    const card = (e.target as HTMLElement).closest('.note-card') as HTMLElement | null
    const n = card ? notes.find(x => x.id === card.dataset.id) : undefined
    if (!btn && n && !(e.target as HTMLElement).closest('a')) { noteView(n); return }
    if (!btn || !n) return
    if (btn.dataset.act === 'del') {
      confirmDialog({ title: 'Eliminar nota', message: showArch ? 'Eliminar esta nota arquivada?' : 'Apagar esta nota?' }).then(ok => { if (!ok) return; notes = notes.filter(x => x.id !== n.id); save().then(()=>doRender()); toast('Nota eliminada') })
    }
    if (btn.dataset.act === 'edit') noteModal(n)
    if (btn.dataset.act === 'tocanban') toCard(n)
    if (btn.dataset.act === 'arch') { n.archived = true; save().then(()=>doRender()); toast('Nota arquivada') }
    if (btn.dataset.act === 'unarch') { delete n.archived; save().then(()=>doRender()); toast('Nota restaurada') }
  })

  function toCard(n: Nota) {
    api.kanban.get(slug).then(b => {
      const col = b.columns.find(c => c.id === 'todo' || c.id === 'doing')?.id || b.columns[0]?.id
      if (!col) { toast('Sem colunas no kanban'); return }
      b.cards.push({ id: uid(), title: n.title, description: (n.text || '').trim(), priority: 'low', colId: col, ts: Date.now(), archived: false })
      api.kanban.put(slug, b)
        .then(() => { refreshSideCount(); refreshTabCounts(slug); toast(`Cartão criado: "${n.title}"`) })
        .catch(e => toast('Erro: ' + e.message))
    }).catch(e => toast('Erro: ' + e.message))
  }

  function noteView(n: Nota) {
    openModal({
      title: n.title, submitText: 'Editar',
      body: () => `<div style="font-size:.85rem;color:var(--text-dim);margin-bottom:10px">${fmt(n.ts)}${n.archived ? ' <span style="color:var(--gold)">· Arquivada</span>' : ''}</div>
        <div class="note-view-text">${linkify(n.text)}</div>`,
      onSubmit: () => noteModal(n),
    })
  }

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
function esc(s: string) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;') }
