import { api, Board, Card, Coluna, Prioridade, uid } from '../api'
import { icon } from '../ui/icons'
import { openModal } from '../ui/modal'
import { refreshTabCounts } from '../ui/counts'
import { toast } from '../ui/toast'
import { confirmDialog } from '../ui/confirm'
import { linkify } from '../ui/text'

// ponytail: handle unico do poll — renderKanban re-corre em cada navegacao e criava um
// setInterval novo por chamada. Limpa o anterior antes de criar. O poll so faz refresh
// ao vivo do board; as notificacoes de review sao globais (main.ts), não dependem do poll.
let pollTimer: ReturnType<typeof setInterval> | undefined

export async function renderKanban(root: HTMLElement, slug: string) {
  let board = await api.kanban.get(slug).catch(() => ({ columns: [], cards: [] } as Board))
  const save = async () => {
    const now = Date.now()
    // ponytail: qualquer card em doing sem startedAt comeca o timer agora (cobre dnd/modal de entrada em doing)
    for (const c of board.cards) {
      if (c.colId === 'doing') {
        if (!c.startedAt) c.startedAt = now
        // ponytail: voltar para doing (dnd/review/done) limpa resultado e revisao anteriores
        delete c.result
        delete c.reviewed
      }
    }
    await api.kanban.put(slug, board); refreshSideCount(); refreshTabCounts(slug)
  }
  // ponytail: sidebar count computed once at renderShell; keep in sync on every board mutation
  function refreshSideCount() {
    const n = board.cards.filter(c => !c.archived && c.colId !== 'done').length
    const item = document.querySelector<HTMLElement>(`.side-item[data-slug="${slug}"]`)
    if (!item) return
    item.querySelector('.side-count')?.remove()
    if (n) item.insertAdjacentHTML('beforeend', `<span class="side-count">${n}</span>`)
  }
  const PRIO: Record<Prioridade, string> = { low:'low', medium:'medium', high:'high' }
  const showArchived = false
  // ponytail: bulk — selecao de multiplos cards; selMode liga checkboxes, barra bulk no topo
  let selMode = false
  let sel = new Set<string>()
  const P: Record<Prioridade, number> = { low: 0, medium: 1, high: 2 }
  const PRIOS: Array<{ id: Prioridade; label: string }> = [
    { id: 'low', label: 'Baixa' },
    { id: 'medium', label: 'Média' },
    { id: 'high', label: 'Alta' },
  ]
  type ColFilter = 'all' | Prioridade
  let colFilters: Record<string, ColFilter> = {}
  type SortKey = 'pos'|'prio'|'date'|'title'
  // ponytail: ordenacao/filtro POR COLUNA — cada coluna tem o seu select independente (pos/prio/date/title).
  // Guarda-se um map colId->SortKey; o componente reusa o <select> que ja existia no toolbar (agora global removido).
  let sortKey: Record<string, SortKey> = {}
  try { Object.assign(sortKey, JSON.parse(localStorage.getItem(`atlas.kbsort.${slug}`) || '{}')) } catch { /* saltou storage */ }
  const keyOf = (colId: string) => sortKey[colId] || 'pos'
  const cmp = (a: Card, b: Card, key: SortKey): number => {
    if (key === 'prio') return P[b.priority] - P[a.priority]
    if (key === 'date') return b.ts - a.ts
    if (key === 'title') return a.title.localeCompare(b.title, 'pt')
    return 0
  }

  // ponytail: a coluna Review/Revisao deve existir em todos os kanban -> garante no load
  if (!board.columns.some(c => c.id === 'review')) {
    const doneIdx = board.columns.findIndex(c => c.id === 'done')
    const reviewIdx = doneIdx === -1 ? board.columns.length : doneIdx
    board.columns.splice(reviewIdx, 0, { id: 'review', name: 'Review/Revisão' })
    save().then(() => {})
  }

  function render() {
    root.innerHTML = `
      <div class="kanban-toolbar" style="display:flex;gap:12px;margin-bottom:16px;align-items:center">
        <button class="btn btn-primary kbdhint" id="kadd" aria-describedby="kadd-tip">${icon('plus', 16)} Novo cartão<span class="kbdhint-tip" id="kadd-tip" role="tooltip"><kbd>Ctrl</kbd>+<kbd>K</kbd></span></button>
        <button class="btn btn-ghost" id="karch">${icon('archive', 16)} Arquivados</button>
        <button class="btn btn-ghost" id="kimport" title="Importar tarefas de um roadmap (markdown)">${icon('forward', 16)} Importar</button>
        <button class="btn btn-ghost" id="ksel" title="Selecionar vários cartões para operações em bulk" style="${selMode?'color:var(--gold)':''}">${icon('check', 16)} ${selMode ? 'Concluir' : 'Bulk'}</button>
        <span class="kb-right">
          <span class="muted" style="font-size:.85rem">${board.cards.filter(c=>!c.archived).length} cartões</span>
        </span>
      </div>
      ${selMode ? bulkBar() : ''}
      <div class="kanban" id="kboard">${board.columns.map(col => `
        <section class="kcol" data-col="${col.id}">
          <h4>${esc(col.name)} <span class="muted" style="font-size:.78rem">${count(col.id)}</span></h4>
          <select class="k-sort" data-col="${col.id}" aria-label="Ordenar ${esc(col.name)}" title="Ordenar coluna">
            <option value="pos"   ${keyOf(col.id)==='pos'  ?'selected':''}>Posição</option>
            <option value="prio"  ${keyOf(col.id)==='prio' ?'selected':''}>Prioridade</option>
            <option value="date"  ${keyOf(col.id)==='date' ?'selected':''}>Data</option>
            <option value="title" ${keyOf(col.id)==='title'?'selected':''}>Título</option>
          </select>
          ${kolFilter(col.id)}
          <div class="kcards" data-col="${col.id}">${cardsOf(col.id)}</div>
        </section>`).join('')}
      </div>`
    bind()
    root.querySelector('#kadd')!.addEventListener('click', () => cardModal(null))
    root.querySelectorAll<HTMLSelectElement>('.k-sort').forEach(sel => sel.addEventListener('change', e => {
      sortKey[sel.dataset.col!] = (e.target as HTMLSelectElement).value as SortKey
      localStorage.setItem(`atlas.kbsort.${slug}`, JSON.stringify(sortKey))
      render()
    }))
    root.querySelector('#karch')!.addEventListener('click', showArchivedModal)
    root.querySelector('#kimport')!.addEventListener('click', importRoadmap)
    root.querySelector('#ksel')!.addEventListener('click', () => { selMode = !selMode; if (!selMode) sel.clear(); render() })
    root.querySelector<HTMLElement>('#kboard')!.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest('[data-filter-prio]') as HTMLElement | null
      if (!b) return
      const colId = b.closest<HTMLElement>('.kcol')?.dataset.col || ''
      if (!colId) return
      const p = b.dataset.filterPrio
      if (!p) return
      if (colFilters[colId] !== p) { colFilters[colId] = p as ColFilter; render() }
    })
    const boardEl = root.querySelector('#kboard') as HTMLElement
    boardEl.addEventListener('keydown', e => {
      const tEl = e.target as HTMLElement
      if (tEl.classList.contains('kcard') && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault()
        const c = board.cards.find(x => x.id === tEl.dataset.id); if (c) viewModal(c)
      }
    })
    bindDnd(boardEl)
    // ponytail: bulk bar handlers (elemento fora do #kboard)
    const kb = root.querySelector('#kbulkbar')
    if (kb) {
      kb.querySelector('#bulk-col')!.addEventListener('change', workBulkCol)
      kb.querySelector('#bulk-prio')!.addEventListener('change', workBulkPrio)
      kb.querySelector('#bulk-arch')!.addEventListener('click', workBulkArch)
      kb.querySelector('#bulk-del')!.addEventListener('click', workBulkDel)
      kb.querySelector('#bulk-clear')!.addEventListener('click', () => { sel.clear(); render() })
    }

  }

  function kolFilter(colId: string) {
    const active = colFilters[colId] || 'all'
    const chips = [{ id: 'all' as ColFilter, label: 'Todas' }, ...PRIOS].map(p =>
      `<button type="button" class="tag-chip${active === p.id ? ' on' : ''}" data-filter-prio="${p.id}" aria-pressed="${active === p.id}">${p.id === 'all' ? 'Todas' : p.label}</button>`
    ).join('')
    return `<div class="kfilter" data-col-filter="${colId}">${chips}</div>`
  }
  function matchesColFilter(c: Card, colId: string) {
    const f = colFilters[colId] || 'all'
    return f === 'all' || c.priority === f
  }
  function count(colId: string) { return board.cards.filter(c => c.colId === colId && !c.archived && matchesColFilter(c, colId)).length }
  function prioLabel(p: Prioridade) { return p === 'high' ? 'Alta' : p === 'medium' ? 'Média' : 'Baixa' }

  function cardsOf(colId: string) {
    return board.cards.filter(c => c.colId === colId && !c.archived && matchesColFilter(c, colId)).sort((a,b) => cmp(a, b, keyOf(colId))).map(c => {
      const idx = board.columns.findIndex(x => x.id === c.colId)
      const prev = board.columns[idx-1]?.id, next = board.columns[idx+1]?.id
      const isSel = sel.has(c.id)
      return `<article class="kcard${c.result ? ' has-output' : ''}${isSel ? ' sel' : ''}" draggable="true" tabindex="0" data-id="${c.id}">
        <div class="ktitle">${selMode ? `<input type="checkbox" class="kselbox" data-sel="${c.id}" ${isSel ? 'checked' : ''} aria-label="Selecionar ${esc(c.title)}">` : ''}<h5>${esc(c.title)}</h5><span class="kdate">${fmtDate(c.ts)}</span></div>
        ${c.description ? `<div class="kdesc">${linkify(c.description)}</div>` : ''}
        ${c.colId === 'doing' && !c.result ? kdoing(c) : ''}
        ${c.result ? `${resultHtml(c.result)}` : ''}
        ${c.dp ? dpHtml(c.dp) : ''}
        ${c.colId === 'review' ? `<div class="kreview">
          <button class="btn btn-primary btn-sm" data-act="approve">${icon('check', 14)} Aprovar</button>
          <button class="btn btn-ghost btn-sm" data-act="reject">${icon('pencil', 14)} Refinar</button>
        </div>` : ''}
        <div class="kfoot">
          <span class="prio ${PRIO[c.priority]}"><span class="dot"></span>${prioLabel(c.priority)}</span>
          <div class="kops">
            <button class="btn-icon btn-ghost" data-act="run" aria-label="Executar no Hermes">${icon('play', 15)}</button>
            <button class="btn-icon btn-ghost" data-act="dp" aria-label="Gerar DP (design plan)">${icon('doc', 15)}</button>
            <button class="btn-icon btn-ghost" data-act="term" aria-label="Ver terminal / log do run">${icon('term', 16)}</button>
            <button class="btn-icon btn-ghost" data-act="move" data-dir="-1" ${prev?'':'disabled'} aria-label="Mover atrás">${icon('back', 15)}</button>
            <button class="btn-icon btn-ghost" data-act="move" data-dir="1" ${next?'':'disabled'} aria-label="Mover frente">${icon('forward', 15)}</button>
            <button class="btn-icon btn-ghost" data-act="edit" aria-label="Editar">${icon('pencil', 15)}</button>
            <button class="btn-icon btn-ghost" data-act="arch" aria-label="Arquivar">${icon('archive', 15)}</button>
            <button class="btn-icon btn-ghost" data-act="del" aria-label="Eliminar" style="color:var(--danger)">${icon('trash', 15)}</button>
          </div>
        </div>
      </article>`
    }).join('')
  }

  // ponytail: barra de operacoes em bulk — aparece quando selMode ativo
  function bulkBar() {
    const cols = board.columns.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')
    return `<div class="bulkbar" id="kbulkbar">
        <span class="muted" style="font-size:.85rem"><span id="bulkcount">${sel.size}</span> selecionados</span>
        <select id="bulk-col" title="Mover para coluna" ${sel.size===0?'disabled':''}><option value="">Mover para coluna…</option>${cols}</select>
        <select id="bulk-prio" title="Mudar prioridade" ${sel.size===0?'disabled':''}><option value="">Prioridade…</option>
          <option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option>
        </select>
        <button class="btn btn-ghost" id="bulk-arch" ${sel.size===0?'disabled':''}>${icon('archive',15)} Arquivar</button>
        <button class="btn btn-danger" id="bulk-del" ${sel.size===0?'disabled':''}>${icon('trash',15)} Eliminar</button>
        <button class="btn btn-ghost" id="bulk-clear" ${sel.size===0?'disabled':''}>Limpar</button>
      </div>`
  }

  function refreshBulk() {
    const n = sel.size
    const pre = document.getElementById('bulkcount'); if (pre) pre.textContent = String(n)
    const bar = document.getElementById('kbulkbar'); if (!bar) return
    // baseline elements atualizam estado disabled + re-render quando muda (render() re-cria bar)
    ;['#bulk-col','#bulk-prio','#bulk-arch','#bulk-del','#bulk-clear'].forEach(sel2 => {
      const el = bar.querySelector(sel2) as HTMLButtonElement|HTMLSelectElement|null
      if (el) (el as HTMLButtonElement).disabled = n === 0
    })
    // re-render para atualizar checkboxes .sel
    // ponytail: so re-render quando a barra existe (selMode ligado)
    if (bar) render()
  }
  function currentSel() { return board.cards.filter(c => sel.has(c.id)) }
  function workBulkCol(e: Event) {
    const col = (e.target as HTMLSelectElement).value; if (!col) return
    const n = sel.size; currentSel().forEach(c => c.colId = col); sel.clear(); save().then(render); toast(`Movidos ${n} cartões`)
  }
  function workBulkPrio(e: Event) {
    const p2 = (e.target as HTMLSelectElement).value as Prioridade; if (!p2) return
    const n = sel.size; currentSel().forEach(c => c.priority = p2); sel.clear(); save().then(render); toast(`Prioridade atualizada (${n})`)
  }
  function workBulkArch() {
    const n = sel.size; currentSel().forEach(c => c.archived = true); sel.clear(); save().then(render); toast(`Arquivados ${n} cartões`)
  }
  function workBulkDel() {
    const n = sel.size
    confirmDialog({ title: 'Eliminar cartões', message: `Apagar ${n} cartões selecionados?` }).then(ok => {
      if (!ok) return; const ids = new Set(sel); board.cards = board.cards.filter(x => !ids.has(x.id)); sel.clear(); save().then(render); toast('Eliminados')
    })
  }

  function bind() {
    const boardEl = root.querySelector('#kboard') as HTMLElement
    boardEl.addEventListener('click', e => {
      const chk = (e.target as HTMLElement).closest('.kselbox') as HTMLElement | null
      const btn = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null
      const cardEl = (e.target as HTMLElement).closest('.kcard') as HTMLElement | null
      // ponytail: modo bulk — clique no cartao toggles selecao, nao abre modal
      if (selMode && !btn && cardEl) {
        const id = cardEl.dataset.id!
        if (sel.has(id)) sel.delete(id); else sel.add(id)
        refreshBulk()
        return
      }
      if (chk) { const id = chk.dataset.sel!; if (sel.has(id)) sel.delete(id); else sel.add(id); refreshBulk(); return }
      if (!btn) {
        const c = cardEl ? board.cards.find(x => x.id === cardEl.dataset.id) : null
        if (c) viewModal(c)
        return
      }
      const cardEl2 = btn.closest('.kcard') as HTMLElement | null
      const c = cardEl2 ? board.cards.find(x => x.id === (cardEl2.dataset as { id?: string }).id) : null
      const act = btn.dataset.act
      if (act === 'edit' && c) { cardModal(c); return }
      if (act === 'del' && c) { confirmDialog({ title: 'Eliminar cartão', message: 'Apagar este cartão?' }).then(ok => { if (!ok) return; board.cards = board.cards.filter(x => x.id !== c.id); save().then(render); toast('Eliminado') }); return }
      if (act === 'run' && c) { runCard(c); return }
      if (act === 'dp' && c) { dpCard(c); return }
      if (act === 'term' && c) { viewTerminal(c); return }
if (act === 'arch' && c) { c.archived = true; save().then(render); toast('Arquivado'); return }
      if (act === 'approve' && c) { approveCard(c); return }
      if (act === 'reject' && c) { rejectCard(c); return }
      if (act === 'move' && c) {
        const dir = parseInt(btn.dataset.dir || '0'); const idx = board.columns.findIndex(x => x.id === c.colId)
        const target = board.columns[idx + dir]; if (!target) return
        c.colId = target.id; save().then(render); return
      }
    })
  }

  function importRoadmap() {
    openModal({
      title: 'Importar roadmap', submitText: 'Importar',
      body: () => `<div class="field"><label for="ir-path">Caminho do ficheiro .md</label><input id="ir-path" name="path" placeholder="C:/caminho/TASKS_ROADMAP.md"></div><p class="muted" style="font-size:.8rem;margin-top:6px">Lê o roadmap e cria 1 cartão por tarefa aberta (+ nota com o detalhe). Idempotente: títulos repetidos não duplicam.</p>`,
      onSubmit: () => {
        const form = document.querySelector('.modal form') as HTMLFormElement
        const path = (form.querySelector('[name=path]') as HTMLInputElement).value.trim()
        if (!path) return
        api.importRoadmap(slug, path)
          .then(d => { toast(`Importados ${d.addedCards} cartões + ${d.addedNotes} notas (${d.skipped} já existiam)`); return api.kanban.get(slug) })
          .then(fresh => { board = fresh; render(); refreshTabCounts(slug) })
          .catch(e => toast('Erro: ' + e.message))
      },
    })
  }

  function dpCard(c: Card) {
    // ponytail: botao DP por card — corre hermes headless que escreve o design plan e grava-o no card (card.dp)
    fetch(`/api/w/${slug}/dp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId: c.id }),
    }).then(r => r.json()).then((d: any) => {
      if (d && d.ok) { toast('A gerar DP em segundo plano (headless)'); viewDp(c) }
      else toast((d && d.error) || 'Erro ao gerar DP')
    }).catch(() => toast('Falha ao iniciar DP'))
  }

  function viewDp(c: Card) {
    let offset = 0
    let pre = document.createElement('pre')
    pre.className = 'term-view'
    pre.textContent = 'A ligar ao DP...'
    let timer: ReturnType<typeof setInterval> | undefined
    const body = () => `<div class="term-wrap">${pre.outerHTML}<div class="term-status" id="${esc(c.id)}-dpstatus">a trabalhar…</div></div>`
    const m = openModal({
      title: 'DP · ' + c.title, submitText: 'Fechar', cancelText: 'Fechar',
      body,
      onSubmit: () => { if (timer) clearInterval(timer) },
    })
    pre = m.root.querySelector('.term-view') as HTMLPreElement
    const statusEl = m.root.querySelector('.term-status') as HTMLElement
    const tick = async () => {
      try {
        const d = await api.run.output(slug, 'dp-' + c.id, offset)
        if (d && d.chunk) { pre.textContent += d.chunk; pre.scrollTop = pre.scrollHeight }
        offset = d ? d.offset : offset
        if (d && d.done) {
          if (timer) clearInterval(timer)
          statusEl.textContent = d.code === 0 ? 'concluído ✓ (arquivado no card)' : ('terminou com erro (código ' + d.code + ') — vê o log acima')
          statusEl.classList.toggle('err', !!(d && d.code !== 0))
          // ponytail: re-lê o board p/ o card.dp (gravado pelo worker via API) aparecer ja ao fechar
          if (d.code === 0) api.kanban.get(slug).then(fresh => { board = fresh; render() })
        }
      } catch { /* aguenta — server pode reiniciar */ }
    }
    timer = setInterval(tick, 1000)
    tick()
    const obs = new MutationObserver(() => { if (!m.root.isConnected) { if (timer) clearInterval(timer); obs.disconnect() } })
    obs.observe(document.body, { childList: true })
  }

  function runCard(c: Card) {
    toast('A abrir WezTerm com o Hermes...')
    fetch(`/api/w/${slug}/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId: c.id }),
    }).then(r => r.json()).then((d: any) => {
      if (d && d.ok) { c.colId = 'doing'; c.startedAt = Date.now(); save().then(render); toast('A executar em segundo plano (headless)') }
      else toast((d && d.error) || 'Erro ao executar')
    }).catch(() => toast('Falha ao abrir Hermes'))
  }

  function viewTerminal(c: Card) {
    let offset = 0
    let pre = document.createElement('pre')
    pre.className = 'term-view'
    pre.textContent = 'A ligar ao run...'
    let timer: ReturnType<typeof setInterval> | undefined
    const body = () => `<div class="term-wrap">${pre.outerHTML}<div class="term-status" id="${esc(c.id)}-tstatus">a trabalhar…</div></div>`
    const m = openModal({
      title: 'Terminal · ' + c.title, submitText: 'Fechar', cancelText: 'Fechar',
      body,
      onSubmit: () => { if (timer) clearInterval(timer) },
    })
    // recomecar o body real (openModal ja montou o pre via outerHTML; vamos buscar o elemento vivo)
    pre = m.root.querySelector('.term-view') as HTMLPreElement
    const statusEl = m.root.querySelector('.term-status') as HTMLElement
    const tick = async () => {
      try {
        const d = await api.run.output(slug, c.id, offset)
        if (d && d.chunk) { pre.textContent += d.chunk; pre.scrollTop = pre.scrollHeight }
        offset = d ? d.offset : offset
        if (d && d.done) {
          if (timer) clearInterval(timer)
          statusEl.textContent = d.code === 0 ? 'concluído ✓' : ('terminou com erro (código ' + d.code + ') — vê o log acima')
          statusEl.classList.toggle('err', !!(d && d.code !== 0))
        }
      } catch { /* aguenta — server pode reiniciar */ }
    }
    timer = setInterval(tick, 1000)
    tick()
    // parar polling quando o modal fechar (backdrop removido)
    const obs = new MutationObserver(() => { if (!m.root.isConnected) { if (timer) clearInterval(timer); obs.disconnect() } })
    obs.observe(document.body, { childList: true })
  }

  function approveCard(c: Card) {
    confirmDialog({ title: 'Aprovar e concluir', message: 'Validar na branch dev, marcar como concluído e fazer merge dev → main?' })
      .then(ok => { if (!ok) return
        api.review.approve(slug, c.id).then(d => {
          c.colId = 'done'; c.reviewed = true
          save().then(render)
          toast(d.merge ? `Concluído (${d.merge})` : 'Concluído')
        }).catch(e => toast('Erro: ' + e.message))
      })
  }
  function rejectCard(c: Card) {
    openModal({
      title: 'Refinar tarefa', submitText: 'Enviar para Em Curso',
      body: () => `<div class="field"><label>Nota de revisão (o que ajustar — será anexado à tarefa)</label><textarea id="r-note" placeholder="Ex.: o resultado está aproximado, refina o prompt para..."></textarea></div>`,
      onSubmit: () => {
        const note = (document.querySelector('#r-note') as HTMLTextAreaElement)?.value || ''
        api.review.reject(slug, c.id, note).then(d => {
          // server já appends a nota à descrição; re-fetch p/ não gravar descricao obsoleta
          return api.kanban.get(slug).then(fresh => { board = fresh; render(); toast('Voltou para Em Curso') })
        }).catch(e => toast('Erro: ' + e.message))
      },
    })
  }

  function bindDnd(boardEl: HTMLElement) {
    let dragId: string | null = null
    const colEls = Array.from(boardEl.querySelectorAll('.kcol')) as HTMLElement[]
    boardEl.querySelectorAll<HTMLElement>('.kcard').forEach(card => {
      card.addEventListener('dragstart', e => { dragId = card.dataset.id!; card.classList.add('dragging') })
      card.addEventListener('dragend', () => { card.classList.remove('dragging'); colEls.forEach(c => c.classList.remove('dragover')) })
    })
    colEls.forEach(col => {
      col.addEventListener('dragover', e => { if (dragId) { e.preventDefault(); col.classList.add('dragover') } })
      col.addEventListener('dragleave', () => col.classList.remove('dragover'))
      col.addEventListener('drop', e => {
        e.preventDefault(); col.classList.remove('dragover')
        if (!dragId) return
        const c = board.cards.find(x => x.id === dragId); if (!c) return
        c.colId = col.dataset.col!; save().then(() => { dragId = null; render(); toast('Movido') })
      })
    })
  }

  function cardModal(c: Card | null) {
    const cols = board.columns.map(x => `<option value="${x.id}" ${c?.colId===x.id?'selected':''}>${esc(x.name)}</option>`).join('')
    openModal({
      title: c ? 'Editar cartão' : 'Novo cartão', submitText: c ? 'Guardar' : 'Criar',
      body: () => `<div class="field"><label for="k-title">Título</label><input id="k-title" name="title" required value="${esc(c?.title || '')}"></div>
        <div class="field"><label for="k-desc">Descrição</label><textarea id="k-desc" name="description">${esc(c?.description || '')}</textarea></div>
        <div class="field"><label for="k-prio">Prioridade</label><select id="k-prio" name="priority">
          <option value="low" ${c?.priority==='low'?'selected':''}>Baixa</option>
          <option value="medium" ${c?.priority==='medium'?'selected':''}>Média</option>
          <option value="high" ${c?.priority==='high'?'selected':''}>Alta</option>
        </select></div>
        <div class="field"><label for="k-col">Coluna</label><select id="k-col" name="colId">${cols}</select></div>`,
      onSubmit: () => {
        const form = document.querySelector('.modal form') as HTMLFormElement
        const title = (form.querySelector('[name=title]') as HTMLInputElement).value.trim()
        if (!title) return
        const data = {
          title, description: (form.querySelector('[name=description]') as HTMLTextAreaElement).value,
          priority: (form.querySelector('[name=priority]') as HTMLSelectElement).value as Prioridade,
          colId: (form.querySelector('[name=colId]') as HTMLSelectElement).value,
        }
        if (c) Object.assign(c, data); else board.cards.push({ id: uid(), ts: Date.now(), archived: false, ...data })
        save().then(render); toast(c ? 'Guardado' : 'Criado')
      },
    })
  }

  function viewModal(c: Card) {
    const col = board.columns.find(x => x.id === c.colId)?.name || ''
    const m = openModal({
      title: c.title, submitText: 'Editar',
      body: () => `
        <div style="font-size:.95rem;margin-bottom:8px">
          <button type="button" class="kcopy" data-id="${c.id}" title="Copiar ID"
            style="font-family:monospace;font-size:.8rem;background:none;border:1px solid var(--line);border-radius:4px;color:var(--muted);text-decoration:underline dotted;cursor:pointer;padding:1px 6px;margin-right:8px">#${c.id}</button>
          <span class="prio ${PRIO[c.priority]}"><span class="dot"></span>${prioLabel(c.priority)}</span>
          <span class="muted"> · ${esc(col)}</span>
          <span class="muted"> · criado ${fmtDate(c.ts)}</span>
        </div>
        ${c.description
          ? `<div class="kdesc" style="font-size:1rem;white-space:pre-wrap">${esc(c.description)}</div>`
          : '<div class="muted">Sem descrição</div>'}
        ${c.result
          ? `<div style="margin-top:12px;padding-top:8px;border-top:1px solid var(--line)"><div class="muted" style="font-size:.8rem;font-weight:600;margin-bottom:6px;color:var(--gold)">Resultado</div>${resultHtml(c.result)}</div>`
          : ''}`
      ,
      onSubmit: () => cardModal(c),
    })
    m.root.querySelector('.kcopy')?.addEventListener('click', e => {
      e.stopPropagation()
      navigator.clipboard.writeText(c.id).then(() => toast('ID copiado: ' + c.id)).catch(() => toast('Falha ao copiar'))
    })
  }

  function showArchivedModal() {
    const arch = board.cards.filter(c => c.archived)
    if (arch.length === 0) { toast('Sem cartões arquivados'); return }
    openModal({
      title: 'Cartões arquivados', submitText: 'Fechar',
      body: () => arch.map(c => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)"><span style="flex:1">${esc(c.title)}</span><button type="button" class="btn btn-ghost" data-restore="${c.id}">${icon('archive', 15)} Restaurar</button></div>`).join(''),
      onSubmit: () => {},
    })
    document.querySelectorAll('[data-restore]').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.getAttribute('data-restore')!; const c = board.cards.find(x => x.id === id); if (c) c.archived = false
        save().then(() => { document.querySelector('.modal-backdrop')?.remove(); render(); toast('Restaurado') })
      })
    })
  }

  render()

  // ponytail: poll board while any card is in 'doing' so progress/result appears without manual refresh
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = setInterval(async () => {
    if (!document.getElementById('kboard')) return
    const hasDoing = board.cards.some(c => !c.archived && c.colId === 'doing')
    if (!hasDoing) return
    const fresh = await api.kanban.get(slug).catch(() => null)
    if (!fresh) return
    if (JSON.stringify(board) !== JSON.stringify(fresh)) {
      board = fresh; render()
    }
  }, 4000)
}
// ponytail: roda a palavra do doing de 8 em 8s no DOM com fade fluido (sem re-render do board)
setInterval(() => {
  const els = document.querySelectorAll('.kdoing .kword')
  if (!els.length) return
  kdoingIdx++
  const w = KDOING_WORDS[kdoingIdx % KDOING_WORDS.length]
  els.forEach(el => {
    el.classList.remove('kfade')
    void (el as HTMLElement).offsetWidth // reinicia animacao CSS
    el.textContent = w
    el.classList.add('kfade')
  })
}, 8000)
// ponytail: tick de 1s atualiza os .ktimer do doing (elapsed desde startedAt) sem re-render do board
setInterval(() => {
  const now = Date.now()
  document.querySelectorAll<HTMLElement>('.ktimer').forEach(el => {
    const start = parseInt(el.dataset.start || '0', 10)
    if (!start) return
    el.textContent = fmtElapsed(now - start)
  })
}, 1000)

const KDOING_WORDS = ['doing', 'a trabalhar', 'em curso', 'a processar', 'ajustando', 'a pensar', 'a fazer']
let kdoingIdx = 0
// ponytail: rotaciona palavras (nao so 'doing') + 3 pontos animados (CSS kdblink)
// a palavra rodada em tempo real por um interval de 3s (ver renderKanban)
function kdoing(c: Card): string {
  const w = KDOING_WORDS[kdoingIdx % KDOING_WORDS.length]
  const start = c.startedAt || c.ts
  return `<div class="kdoing"><span class="kword">${w}</span><span class="kdot" style="--i:0"></span><span class="kdot" style="--i:1"></span><span class="kdot" style="--i:2"></span><span class="ktimer" data-start="${start}">${fmtElapsed(Date.now() - start)}</span></div>`
}
function dpHtml(dp: string): string {
  // ponytail: DP apresentado como bloco destacado (primeira linha = cabecalho), cor distinta do result
  const nl = dp.indexOf('\n')
  const title = nl === -1 ? dp : dp.slice(0, nl)
  const body = nl === -1 ? '' : dp.slice(nl + 1)
  return `<div class="kdp"><div class="kdp-title">${esc(title)}</div>${body ? `<div class="kdp-body">${esc(deindent(body))}</div>` : ''}</div>`
}
function resultHtml(r: string): string {
  // ponytail: primeira linha = destaque (ex. 'Task cumprida: ...'); corpo separado
  const nl = r.indexOf('\n')
  const title = nl === -1 ? r : r.slice(0, nl)
  const body = nl === -1 ? '' : r.slice(nl + 1)
  return `<div class="kresult"><div class="kresult-title">${esc(title)}</div>${body ? `<div class="kresult-body">${esc(deindent(body))}</div>` : ''}</div>`
}
function deindent(s: string): string { return s.replace(/^\s+/gm, '').replace(/\n{2,}/g, '\n').trim() }
function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (h > 0) return `h\u00e1 ${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `h\u00e1 ${m}m ${String(sec).padStart(2, '0')}s`
  return `h\u00e1 ${sec}s`
}
function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
function esc(s: string) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }