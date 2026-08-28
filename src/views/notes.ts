import { api, Nota, uid } from '../api'
import { icon } from '../ui/icons'
import { openModal } from '../ui/modal'
import { refreshTabCounts } from '../ui/counts'
import { toast } from '../ui/toast'
import { confirmDialog } from '../ui/confirm'
import { linkify } from '../ui/text'

export const parseTags = (v: string) => Array.from(new Set(v.split(/[,\s]+/).map(t => t.trim().toLowerCase()).filter(Boolean)))

export async function renderNotes(root: HTMLElement, slug: string) {
  let notes = await api.notes.get(slug).catch(() => [] as Nota[])
  let showArch = false
  let tagFilter = ''  // tag ativa para filtrar ('' = sem filtro)
  // ponytail: bulk — selecao de multiplas notas
  let selMode = false
  let sel = new Set<string>()
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
      <input class="notes-search" id="nsearch" placeholder="Buscar notas ou tags…" aria-label="Buscar notas">
      <button class="btn btn-ghost" id="narch" aria-pressed="${showArch}" title="${showArch ? 'Ver ativas' : 'Ver arquivadas'}">${icon('archive', 16)} <span>Arquivadas</span><span class="side-count" id="narchcount">${archCount()}</span></button>
      <button class="btn btn-primary kbdhint" id="nadd" aria-describedby="nadd-tip">${icon('plus', 16)} Nova nota<span class="kbdhint-tip" id="nadd-tip" role="tooltip"><kbd>Ctrl</kbd>+<kbd>K</kbd></span></button>
      <button class="btn btn-ghost" id="nsel" title="Selecionar várias notas para operações em bulk" style="${selMode?'color:var(--gold)':''}">${icon('check', 16)} ${selMode ? 'Concluir' : 'Bulk'}</button>
    </div>
    <div class="notes-tagbar" id="ntagbar"></div>
    ${selMode ? bulkBarNotes() : ''}
    <div class="notes-grid" id="ngrid"></div>`
  const grid = root.querySelector('#ngrid') as HTMLElement

  const renderTagbar = () => {
    const all = Array.from(new Set(notes.flatMap(n => n.tags || []))).sort()
    const bar = root.querySelector('#ntagbar') as HTMLElement
    bar.innerHTML = all.length ? all.map(t =>
      `<button class="tag-chip${t === tagFilter ? ' on' : ''}" data-tag="${esc(t)}" aria-pressed="${t === tagFilter}">${icon('tag', 12)} ${esc(t)}</button>`
    ).join('') : ''
    bar.classList.toggle('active', all.length > 0)
  }

  const doRender = (q = '') => {
    const ql = q.toLowerCase()
    const list = notes.filter(n =>
      (showArch ? n.archived : !n.archived) &&
      (!ql || n.title.toLowerCase().includes(ql) || n.text.toLowerCase().includes(ql) || (n.tags || []).some(t => t.includes(ql))) &&
      (!tagFilter || (n.tags || []).includes(tagFilter))
    ).sort((a, b) => b.ts - a.ts)
    renderTagbar()
    const badge = document.getElementById('narchcount')
    if (badge) badge.textContent = String(showArch ? notes.filter(n => !n.archived).length : notes.filter(n => n.archived).length)
    // ponytail: badge acima do early-return — arquivar a ultima nota ativa esvazia a grid e
    // return cedo deixava a contagem desatualizada (DI). Contagem atualiza sempre.
    if (list.length === 0) { grid.innerHTML = `<div class="empty">${notes.length === 0 ? 'Sem notas ainda. Cria a primeira.' : (tagFilter ? `Não há notas com a tag «${tagFilter}».` : showArch ? 'Sem notas arquivadas.' : 'Sem resultados.')}</div>`; return }
    const unhide = (print: string) => `<span class="note-arch">${print}</span>`
    grid.innerHTML = list.map(n => `
      <article class="${n.archived ? 'note-card archived' : 'note-card'}${sel.has(n.id) ? ' sel' : ''}" data-id="${n.id}" tabindex="0">
        ${selMode ? `<input type="checkbox" class="nselbox" data-sel="${n.id}" ${sel.has(n.id) ? 'checked' : ''} aria-label="Selecionar ${esc(n.title)}">` : ''}
        <h4>${esc(n.title)}</h4>
        <div class="note-text">${linkify(n.text)}</div>
        ${(n.tags && n.tags.length) ? `<div class="note-tags">${n.tags.map(t => `<button class="tag-chip" data-tag="${esc(t)}" aria-label="Filtrar por ${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
        <div class="note-date">${showArch ? unhide('Arquivada') : ''}${fmt(n.ts)}</div>
        <div class="note-actions">
          <button class="btn-icon btn-ghost" data-act="tocanban" title="Converter para cartão" aria-label="Converter para cartão">${icon('board', 16)}</button>
          <button class="btn-icon btn-ghost" data-act="edit" aria-label="Editar">${icon('pencil', 16)}</button>
          <button class="btn-icon btn-ghost" data-act="${n.archived ? 'unarch' : 'arch'}" title="${n.archived ? 'Restaurar' : 'Arquivar'}" aria-label="${n.archived ? 'Restaurar' : 'Arquivar'}">${icon('archive', 16)}</button>
          <button class="btn-icon btn-ghost" data-act="del" aria-label="Eliminar">${icon('trash', 16)}</button>
        </div>
      </article>`).join('')
    const nbar = document.getElementById('nbulkbar')
    if (nbar) {
      nbar.querySelector('#nbulk-arch')!.addEventListener('click', bulkArchNotes)
      nbar.querySelector('#nbulk-del')!.addEventListener('click', bulkDelNotes)
      nbar.querySelector('#nbulk-card')!.addEventListener('click', bulkToCard)
      nbar.querySelector('#nbulk-clear')!.addEventListener('click', () => { sel.clear(); doRender(searchInput.value.toLowerCase()) })
    }
  }
  doRender()

  const searchInput = root.querySelector('#nsearch') as HTMLInputElement
  searchInput.addEventListener('input', () => doRender(searchInput.value))

  const archBtn = root.querySelector('#narch') as HTMLButtonElement
  archBtn.addEventListener('click', () => {
    showArch = !showArch  // eslint-disable-line
    archBtn.setAttribute('aria-pressed', String(showArch))
    archBtn.title = showArch ? 'Ver ativas' : 'Ver arquivadas'
    archBtn.querySelector('span')!.textContent = showArch ? 'Ativas' : 'Arquivadas'
    doRender(searchInput.value)
  })

  const tickTag = (tag: string) => { tagFilter = tagFilter === tag ? '' : tag; doRender(searchInput.value) }
  root.querySelector('#ntagbar')!.addEventListener('click', e => { const b = (e.target as HTMLElement).closest('[data-tag]') as HTMLElement | null; if (b) tickTag(b.dataset.tag!) })

  root.querySelector('#nadd')!.addEventListener('click', () => noteModal(null))
  root.querySelector('#nsel')!.addEventListener('click', () => { selMode = !selMode; if (!selMode) sel.clear(); doRender(searchInput.value.toLowerCase()) })
  grid.addEventListener('keydown', e => {
    const t = e.target as HTMLElement
    if (t.classList.contains('note-card') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); const n = notes.find(x => x.id === t.dataset.id); if (n) noteView(n) }
  })
  grid.addEventListener('click', e => {
    const tagEl = (e.target as HTMLElement).closest('.tag-chip') as HTMLElement | null
    const chk = (e.target as HTMLElement).closest('.nselbox') as HTMLElement | null
    const btn = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null
    const card = (e.target as HTMLElement).closest('.note-card') as HTMLElement | null
    const n = card ? notes.find(x => x.id === card.dataset.id) : undefined
    if (tagEl && n) { tickTag(tagEl.dataset.tag!); return }
    if (selMode && !btn && card) { const id = card.dataset.id!; if (sel.has(id)) sel.delete(id); else sel.add(id); refreshBulkNotes(); return }
    if (chk) { const id = chk.dataset.sel!; if (sel.has(id)) sel.delete(id); else sel.add(id); refreshBulkNotes(); return }
    if (!btn && n && !(e.target as HTMLElement).closest('a')) { noteView(n); return }
    if (!btn || !n) return
    if (btn.dataset.act === 'del') {
      confirmDialog({ title: 'Eliminar nota', message: showArch ? 'Eliminar esta nota arquivada?' : 'Apagar esta nota?' }).then(ok => { if (!ok) return; notes = notes.filter(x => x.id !== n.id); save().then(()=>doRender(searchInput.value)); toast('Nota eliminada') })
    }
    if (btn.dataset.act === 'edit') noteModal(n)
    if (btn.dataset.act === 'tocanban') toCard(n)
    if (btn.dataset.act === 'arch') { n.archived = true; save().then(()=>doRender(searchInput.value)); toast('Nota arquivada') }
    if (btn.dataset.act === 'unarch') { delete n.archived; save().then(()=>doRender(searchInput.value)); toast('Nota restaurada') }
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
        ${(n.tags && n.tags.length) ? `<div class="note-tags" style="margin-bottom:10px">${n.tags.map(t => `<span class="tag-chip on">${esc(t)}</span>`).join('')}</div>` : ''}
        <div class="note-view-text">${linkify(n.text)}</div>`,
      onSubmit: () => noteModal(n),
    })
  }

  function noteModal(n: Nota | null) {
    openModal({
      title: n ? 'Editar nota' : 'Nova nota', submitText: n ? 'Guardar' : 'Criar',
      body: () => `<div class="field"><label for="nt-title">Título</label><input id="nt-title" name="title" required value="${esc(n?.title || '')}"></div>
                   <div class="field"><label for="nt-text">Texto</label><textarea id="nt-text" name="text">${esc(n?.text || '')}</textarea></div>
                   <div class="field"><label for="nt-tags">Tags</label><input id="nt-tags" name="tags" placeholder="separadas por espaço ou vírgula" value="${esc((n?.tags || []).join(', '))}"></div>`,
      onSubmit: () => {
        const form = document.querySelector('.modal form') as HTMLFormElement
        const title = (form.querySelector('[name=title]') as HTMLInputElement).value.trim()
        const text = (form.querySelector('[name=text]') as HTMLTextAreaElement).value
        const tags = parseTags((form.querySelector('[name=tags]') as HTMLInputElement).value)
        if (!title) return
        if (n) { n.title = title; n.text = text; n.tags = tags }
        else notes.unshift({ id: uid(), title, text, ts: Date.now(), tags })
        save().then(() => { doRender(searchInput.value); toast(n ? 'Nota guardada' : 'Nota criada') })
      },
    })
  }

  // ponytail: bulk — barra + handlers (arquivar/restaurar consoante a vista)
  function bulkBarNotes() {
    const label = showArch ? 'Restaurar' : 'Arquivar'
    const i = showArch ? 'back' : 'archive'
    return `<div class="bulkbar" id="nbulkbar">
        <span class="muted" style="font-size:.85rem"><span id="nbulkcount">${sel.size}</span> selecionadas</span>
        <button class="btn btn-ghost" id="nbulk-arch" ${sel.size===0?'disabled':''}>${icon(i,15)} ${label}</button>
        <button class="btn btn-ghost" id="nbulk-card" ${sel.size===0?'disabled':''}>${icon('board',15)} Para cartão</button>
        <button class="btn btn-danger" id="nbulk-del" ${sel.size===0?'disabled':''}>${icon('trash',15)} Eliminar</button>
        <button class="btn btn-ghost" id="nbulk-clear" ${sel.size===0?'disabled':''}>Limpar</button>
      </div>`
  }
  function refreshBulkNotes() {
    const pre = document.getElementById('nbulkcount'); if (pre) pre.textContent = String(sel.size)
    const bar = document.getElementById('nbulkbar'); if (!bar) return
    ;['#nbulk-arch','#nbulk-card','#nbulk-del','#nbulk-clear'].forEach(sel2 => {
      const el = bar.querySelector(sel2) as HTMLButtonElement|null
      if (el) el.disabled = sel.size === 0
    })
    if (bar) doRender(searchInput.value.toLowerCase())
  }
  function currentSelNotes() { return notes.filter(n => sel.has(n.id)) }
  function bulkArchNotes() {
    const n = sel.size
    currentSelNotes().forEach(x => { if (showArch) delete x.archived; else x.archived = true })
    sel.clear(); save().then(() => { doRender(searchInput.value.toLowerCase()); toast(showArch ? `Restauradas ${n} notas` : `Arquivadas ${n} notas`) })
  }
  function bulkDelNotes() {
    const n = sel.size
    confirmDialog({ title: 'Eliminar notas', message: `Apagar ${n} notas selecionadas?` }).then(ok => {
      if (!ok) return; const ids = new Set(sel); notes = notes.filter(x => !ids.has(x.id)); sel.clear(); save().then(() => { doRender(searchInput.value.toLowerCase()); toast('Notas eliminadas') })
    })
  }
  function bulkToCard() {
    const n = sel.size
    api.kanban.get(slug).then(b => {
      const col = b.columns.find(c => c.id === 'todo' || c.id === 'doing')?.id || b.columns[0]?.id
      if (!col) { toast('Sem colunas no kanban'); return }
      currentSelNotes().filter(x => !x.archived).forEach(x => b.cards.push({ id: uid(), title: x.title, description: (x.text || '').trim(), priority: 'low', colId: col, ts: Date.now(), archived: false }))
      api.kanban.put(slug, b).then(() => { sel.clear(); refreshSideCount(); refreshTabCounts(slug); doRender(searchInput.value.toLowerCase()); toast(`Criados cartões (${n})`) }).catch(e => toast('Erro: ' + e.message))
    }).catch(e => toast('Erro: ' + e.message))
  }
}
function esc(s: string) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;') }