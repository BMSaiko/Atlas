import { api, Nota, Prioridade, uid } from '../api'
import { icon } from '../ui/icons'
import { openModal } from '../ui/modal'
import { refreshTabCounts } from '../ui/counts'
import { toast } from '../ui/toast'
import { confirmDialog } from '../ui/confirm'
import { renderMd } from '../ui/text'
import { navigate } from '../router'

export const parseTags = (v: string) => Array.from(new Set(v.split(/[,\s]+/).map(t => t.trim().toLowerCase()).filter(Boolean)))
const existingTags = (notes: Nota[]) => Array.from(new Set(notes.flatMap(n => n.tags || []))).sort()
// Autocomplete de tags: completa o token atual (ultima palavra apos espaco/virgula) com tags existentes.
// Popover a nivel do body (position:fixed) — escapa ao overflow do .modal-body (era o que escondia as
// sugestoes). Setas Arriba/Baixo mudam, Enter/Tab ou clique aceitam, Esc fecha.
export function bindTagAutocomplete(inp: HTMLInputElement, existing: string[]) {
  if (!existing.length) return
  const box = document.createElement('div')
  box.className = 'tag-sugg'
  box.setAttribute('role', 'listbox')
  document.body.appendChild(box)
  let items: string[] = []
  let idx = 0
  const curToken = (v: string) => { const m = v.match(/([^,\s]+)$/); return m ? m[1].toLowerCase() : '' }
  const close = (clear = true) => { box.classList.remove('open'); if (clear) box.innerHTML = '' }
  const position = () => {
    const r = inp.getBoundingClientRect()
    const h = Math.min(200, box.scrollHeight || 200)
    const gap = 5
    if (r.bottom + gap + h > window.innerHeight && r.top > h + gap) box.style.top = `${r.top - h - gap}px`
    else box.style.top = `${r.bottom + gap}px`
    box.style.left = `${r.left}px`
    box.style.width = `${r.width}px`
  }
  const render = (scroll = false) => {
    const tok = curToken(inp.value)
    items = tok ? existing.filter(t => t.startsWith(tok) && t !== tok).sort() : []
    close()
    if (!items.length) return
    box.innerHTML = items.map((t, i) => `<button type="button" class="tag-sugg-item${i === idx ? ' on' : ''}" data-i="${i}" role="option">${esc(t)}</button>`).join('')
    box.classList.add('open')
    if (scroll) box.querySelector<HTMLElement>('.on')?.scrollIntoView({ block: 'nearest' })
    position()
  }
  const accept = (i: number) => {
    const tag = items[i]; if (!tag) return
    inp.value = inp.value.replace(/([^,\s]+)$/, tag)  // ponytail: troca o token atual pela tag completa
    close(); inp.focus()
  }
  inp.addEventListener('input', () => { idx = 0; render() })
  inp.addEventListener('focus', () => { idx = 0; render() })
  inp.addEventListener('keydown', e => {
    if (!box.classList.contains('open')) {
      if (e.key === 'ArrowDown') { e.preventDefault(); idx = 0; render() }
      return
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); idx = (idx + 1) % items.length; render(true); break
      case 'ArrowUp': e.preventDefault(); idx = (idx - 1 + items.length) % items.length; render(true); break
      case 'Enter': case 'Tab': e.preventDefault(); accept(idx); break
      case 'Escape': close(); break
    }
  })
  box.addEventListener('mousedown', e => {  // mousedown (nao clique) para nao roubar o foco do input
    const b = (e.target as HTMLElement).closest('.tag-sugg-item') as HTMLElement | null
    if (b) { e.preventDefault(); accept(Number(b.dataset.i)) }
  })
  inp.addEventListener('blur', () => setTimeout(() => { if (!box.matches(':hover')) close() }, 120))
  // limpa o popover quando o modal fechar
  const backdrop = inp.closest('.modal-backdrop')
  if (backdrop) {
    const mo = new MutationObserver(() => { if (!backdrop.isConnected) { mo.disconnect(); box.remove() } })
    mo.observe(backdrop, { childList: true, subtree: true })
  }
}

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
      <button class="btn btn-ghost" id="nbrain" title="Brainstorm + SWOT do projeto (headless — cria notas novas)" aria-label="Brainstorm + SWOT do projeto">${icon('aura', 16)} Brainstorm</button>
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
        <div class="note-text">${renderMd(n.text)}</div>
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
  const brainBtn = root.querySelector('#nbrain') as HTMLButtonElement
  if (brainBtn) brainBtn.addEventListener('click', () => brainstorm(slug))
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
      if (!b.columns.length) { toast('Sem colunas no kanban'); return }
      const cols = b.columns.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')
      openModal({
        title: 'Novo cartão', submitText: 'Criar',
        body: () => `<div class="field"><label for="nk-title">Título</label><input id="nk-title" name="title" required value="${esc(n.title)}"></div>
                   <div class="field"><label for="nk-desc">Descrição</label><textarea id="nk-desc" name="description">${esc((n.text||'').trim())}</textarea></div>
                   <div class="field"><label for="nk-prio">Prioridade</label><select id="nk-prio" name="priority">
                     <option value="low" selected>Baixa</option>
                     <option value="medium">Média</option>
                     <option value="high">Alta</option>
                   </select></div>
                   <div class="field"><label for="nk-col">Coluna</label><select id="nk-col" name="colId">${cols}</select></div>`,
        onSubmit: () => {
          const form = document.querySelector('.modal form') as HTMLFormElement
          const title = (form.querySelector('[name=title]') as HTMLInputElement).value.trim()
          if (!title) return
          b.cards.push({
            id: uid(), title,
            description: (form.querySelector('[name=description]') as HTMLTextAreaElement).value,
            priority: (form.querySelector('[name=priority]') as HTMLSelectElement).value as Prioridade,
            colId: (form.querySelector('[name=colId]') as HTMLSelectElement).value,
            ts: Date.now(), archived: false,
          })
          api.kanban.put(slug, b)
            .then(() => { refreshSideCount(); refreshTabCounts(slug); toast(`Criado: "${title}"`) })
            .catch(e => toast('Erro: ' + e.message))
        },
      })
    }).catch(e => toast('Erro: ' + e.message))
  }

  function noteView(n: Nota) {
    openModal({
      title: n.title, submitText: 'Editar',
      body: () => `<div style="font-size:.85rem;color:var(--text-dim);margin-bottom:10px">${fmt(n.ts)}${n.archived ? ' <span style="color:var(--gold)">· Arquivada</span>' : ''}</div>
        ${(n.tags && n.tags.length) ? `<div class="note-tags" style="margin-bottom:10px">${n.tags.map(t => `<span class="tag-chip on">${esc(t)}</span>`).join('')}</div>` : ''}
        <div class="note-view-text">${renderMd(n.text)}</div>`,
      onSubmit: () => noteModal(n),
    })
  }

    function noteModal(n: Nota | null) {
    const m = openModal({
      title: n ? 'Editar nota' : 'Nova nota', submitText: n ? 'Guardar' : 'Criar',
      body: () => `<div class="md-tabs" role="tablist" aria-label="Edição da nota">
          <button type="button" class="md-tab on" data-mdtab="edit" role="tab" aria-selected="true">Editar</button>
          <button type="button" class="md-tab" data-mdtab="prev" role="tab" aria-selected="false" aria-controls="nt-preview">Pré-visualização</button>
        </div>
        <div class="field"><label for="nt-title">Título</label><input id="nt-title" name="title" required value="${esc(n?.title || '')}"></div>
        <div class="md-pane" data-mdpane="edit"><div class="field"><label for="nt-text">Texto</label><textarea id="nt-text" name="text">${esc(n?.text || '')}</textarea></div></div>
        <div class="md-pane" data-mdpane="prev" hidden><div class="md-preview" id="nt-preview"></div></div>
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
    // abas Editar/Pré-visualização: switch local no corpo do modal (modal.ts nao muda) + preview em tempo real
    const textEl = m.root.querySelector('[name=text]') as HTMLTextAreaElement | null
    const preview = m.root.querySelector('#nt-preview') as HTMLElement | null
    const showTab = (id: string) => {
      m.root.querySelectorAll<HTMLElement>('.md-pane').forEach(p => { p.hidden = p.dataset.mdpane !== id })
      m.root.querySelectorAll<HTMLButtonElement>('.md-tab').forEach(b => {
        const on = b.dataset.mdtab === id
        b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on))
      })
    }
    m.root.querySelector('.md-tabs')?.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest('.md-tab') as HTMLButtonElement | null
      if (!b) return
      showTab(b.dataset.mdtab!)
      if (b.dataset.mdtab === 'prev' && preview && textEl) preview.innerHTML = renderMd(textEl.value)
    })
    if (textEl && preview) textEl.addEventListener('input', () => { preview.innerHTML = renderMd(textEl.value) })
    bindTagAutocomplete(m.root.querySelector('[name=tags]') as HTMLInputElement, existingTags(notes))
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
// ponytail: botão Brainstorm na toolbar de notas — corre um hermes headless que analisa o
// source-tree, faz SWOT + brainstorm e escreve notas novas no workdir. Log streameado do
// mecanismo /output do run-card (id ficticio "brainstorm"); ao concluir, refresca a lista.
function brainstorm(slug: string) {
  fetch(`/api/w/${slug}/brainstorm`, { method: 'POST' })
    .then(r => r.json()).then((d: any) => {
      if (d && d.ok) { toast('Brainstorm a correr em segundo plano (headless)'); viewBrainstorm(slug) }
      else toast((d && d.error) || 'Erro ao iniciar brainstorm')
    }).catch(() => toast('Falha ao iniciar brainstorm'))
}
function viewBrainstorm(slug: string) {
  let offset = 0
  let pre = document.createElement('pre')
  pre.className = 'term-view'
  pre.textContent = 'A ligar ao brainstorm...'
  let timer: ReturnType<typeof setInterval> | undefined
  const body = () => `<div class="term-wrap">${pre.outerHTML}<div class="term-status" id="bs-tstatus">a trabalhar…</div></div>`
  const m = openModal({
    title: 'Brainstorm/SWOT · ' + slug, submitText: 'Fechar', cancelText: 'Fechar',
    body,
    onSubmit: () => { if (timer) clearInterval(timer) },
  })
  pre = m.root.querySelector('.term-view') as HTMLPreElement
  const statusEl = m.root.querySelector('.term-status') as HTMLElement
  const tick = async () => {
    try {
      const d = await api.run.output(slug, 'brainstorm', offset)
      if (d && d.chunk) { pre.textContent += d.chunk; pre.scrollTop = pre.scrollHeight }
      offset = d ? d.offset : offset
      if (d && d.done) {
        if (timer) clearInterval(timer)
        statusEl.textContent = d.code === 0 ? 'concluído ✓ (notas criadas)' : ('terminou com erro (código ' + d.code + ') — vê o log acima')
        statusEl.classList.toggle('err', !!(d && d.code !== 0))
        // ponytail: refresca as notas quando o brainstorm acaba (o worker escreveu notas novas via API)
        if (d.code === 0) renderNotesAfterBrainstorm(slug)
      }
    } catch { }
  }
  timer = setInterval(tick, 1000)
  tick()
  const obs = new MutationObserver(() => { if (!m.root.isConnected) { if (timer) clearInterval(timer); obs.disconnect() } })
  obs.observe(document.body, { childList: true })
}
// ponytail: o worker escreveu notas novas via API; re-render so relendo. Como renderNotes é
// uma closure com estado, o mais fiável e simples é refazer a viagem à rota (re-render shell).
function renderNotesAfterBrainstorm(slug: string) { navigate(`/w/${slug}`) }
function esc(s: string) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;') }