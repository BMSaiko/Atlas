import { api, Board, Card, Coluna, MichiPhase, Prioridade, uid, BoardDoc } from '../api'
import { icon } from '../ui/icons'
import { openModal, readForm } from '../ui/modal'
import { refreshTabCounts } from '../ui/counts'
import { toast } from '../ui/toast'
import { confirmDialog } from '../ui/confirm'
import { renderMd } from '../ui/text'
import { navigate } from '../router'

// ponytail: handle unico do poll — renderKanban re-corre em cada navegacao e criava um
// setInterval novo por chamada. Limpa o anterior antes de criar. O poll so faz refresh
// ao vivo do board; as notificacoes de review sao globais (main.ts), não dependem do poll.
// ponytail: lançador comum de um card no Hermes headless — reusado pelos botoes do grid/modal
export function launchRun(slug: string, c: Card): Promise<boolean> {
  return fetch(`/api/w/${slug}/run`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardId: c.id }),
  }).then(r => r.json()).then((d: any) => {
    if (d && d.ok) return true
    throw new Error((d && d.error) || 'Erro ao executar')
  }).catch((e: any) => { toast((e && e.message) || 'Falha ao abrir Hermes'); return false })
}

let pollTimer: ReturnType<typeof setInterval> | undefined
// ponitail: pollers de DP que sobrevivem ao fecho do modal p/ notificar conclusao
const dpPollers: Record<string, { timer?: ReturnType<typeof setInterval>; pre?: HTMLPreElement; statusEl?: HTMLElement }> = {}

// ponytail: modal complete de criar cartão — standalone (leva o seu board + retry 409), usado
// TAKE: palette Ctrl+K (quickAdd) e a UNICA entrada para "Novo cartão". Botao #kadd removido do toolbar. A
// criacao re-sync ver no 409 e retenta 1x (mesmo putBoard da vista) e depois recarrega o tab.
// ponytail: PUT com retry no 409 (escritor concorrente avançou `ver`) — re-sync + re-aplica criacao local e retenta 1x.
export async function putKanbanRetry(slug: string, doc: BoardDoc): Promise<BoardDoc> {
  try { const r = await api.kanban.put(slug, doc); if (r?.ver) doc.ver = r.ver; return doc }
  catch (e: any) {
    if (e?.status !== 409) throw e
    const fresh = await api.kanban.get(slug)
    for (const c of doc.cards) if (!fresh.cards.some(f => f.id === c.id)) fresh.cards.push(c)
    const r = await api.kanban.put(slug, fresh); if (r?.ver) fresh.ver = r.ver; return fresh
  }
}

function wireCardTemplate(root: HTMLElement, slug: string) {
  const sel = root.querySelector('[name=template]') as HTMLSelectElement | null
  if (!sel) return
  api.templates.get(slug).then(tpls => {
    (tpls || []).filter(t => t.kind === 'card').forEach(t => {
      const o = document.createElement('option'); o.value = t.id; o.textContent = t.name; sel.add(o)
    })
    sel.addEventListener('change', () => {
      const t = (tpls || []).find(x => x.id === sel.value); if (!t) return
      const title = root.querySelector('[name=title]') as HTMLInputElement
      const desc = root.querySelector('[name=description]') as HTMLTextAreaElement
      const prio = root.querySelector('[name=priority]') as HTMLSelectElement
      const col = root.querySelector('[name=colId]') as HTMLSelectElement
      if (t.title !== undefined && title) title.value = t.title
      if (t.body !== undefined && desc) desc.value = t.body
      // ponytail: prio/col opcionais (modal de refinar nao tem colId)
      if (t.priority && prio && [...prio.options].some(o => o.value === t.priority)) prio.value = t.priority
      if (t.colId && col && [...col.options].some(o => o.value === t.colId)) col.value = t.colId
    })
  }).catch(() => {})
}

// ponytail: no modal de refinar, escolher template aplica SO a nota de revisao — nao mexe titulo/desc/prio
function wireRefineTemplate(root: HTMLElement, slug: string) {
  const sel = root.querySelector('[name=template]') as HTMLSelectElement | null
  if (!sel) return
  api.templates.get(slug).then(tpls => {
    (tpls || []).filter(t => t.kind === 'card').forEach(t => {
      const o = document.createElement('option'); o.value = t.id; o.textContent = t.name; sel.add(o)
    })
    sel.addEventListener('change', () => {
      const t = (tpls || []).find(x => x.id === sel.value); if (!t) return
      const note = root.querySelector('#r-note') as HTMLTextAreaElement
      if (t.body !== undefined && note) note.value = t.body
    })
  }).catch(() => {})
}

export async function openNewCardModal(slug: string) {
  let board = await api.kanban.get(slug).catch(() => null)
  if (!board) { toast('Falha a carregar o quadro'); return }
  const m = openModal({
    title: 'Novo cartão', submitText: 'Criar',
    body: () => `<div class="field"><label for="k-template">Template</label><select name="template" id="k-template"><option value="">Novo a partir de template…</option></select></div>
      <div class="field"><label for="k-title">Título</label><input id="k-title" name="title" required></div>
      <div class="field"><label for="k-desc">Descrição</label><textarea id="k-desc" name="description"></textarea></div>
      <div class="field"><label for="k-prio">Prioridade</label><select id="k-prio" name="priority">
        <option value="urgent">Urgente</option>
        <option value="high">Alta</option>
        <option value="medium">Média</option>
        <option value="low">Baixa</option>
      </select></div>
      <div class="field"><label for="k-due">Prazo (obrigatório)</label><input id="k-due" name="due" type="date"></div>
      <div class="field"><label for="k-recur">Recorrência</label><select id="k-recur" name="recur">
        <option value="">Não recorrente</option>
        <option value="daily">Diária</option>
        <option value="weekly">Semanal</option>
        <option value="monthly">Mensal</option>
      </select></div>`,
    onSubmit: async () => {
      const form = m.root.querySelector('form') as HTMLFormElement
      const title = (form.querySelector('[name=title]') as HTMLInputElement).value.trim()
      if (!title) return
      const dueV = (form.querySelector('[name=due]') as HTMLInputElement).value
      let due: number | undefined
      if (dueV) { const [Y, M, D] = dueV.split('-').map(Number); due = new Date(Y, M - 1, D).getTime() }
      const recurV = (form.querySelector('[name=recur]') as HTMLSelectElement).value as Card['recur']
      board!.cards.push({
        id: uid(), ts: Date.now(), archived: false,
        title, description: (form.querySelector('[name=description]') as HTMLTextAreaElement).value,
        priority: (form.querySelector('[name=priority]') as HTMLSelectElement).value as Prioridade,
        colId: 'todo', due,
        recur: recurV || undefined,
      })
      try { board = await putKanbanRetry(slug, board!) } catch (e: any) { toast((e && e.message) || 'Falha ao criar') ; return }
      toast('Criado'); navigate('/w/' + slug + '?tab=kanban')
    },
  })
  wireCardTemplate(m.root, slug)
}

// ponytail: openReplyModal — modal de reply reutilizável (exportado p/ notes.ts: botão nas notas grilled).
// rung 2: reusa openModal/readForm. Sem server change.
// rung 6: 1 função, 2 callers (botão 'Reply' no terminal + replyGrill em notes.ts).
// submitText='Reply' = submete só com click/Enter explícito. Esc ou backdrop = cancel. Sem auto-close.
// ctx.save/render/runCard vêm do caller (renderKanban scope) para não duplicar handlers.
// ponytail: openReplyModal — 1 painel a esquerda (perguntas) + 1 modal a direita (reply).
// rung 1 (YAGNI): 2 surfaces independentes. Submit do reply fecha ambos e chama onSubmit.
// rung 6: painel esquerda via DOM directo (sem form, sem keydown), modal direita via openModal (reusa helper).
export function openReplyModal(c: Card, ctx: { onSubmit: (reply: string) => Promise<void> | void }, opts?: { noteText?: string; noteTitle?: string }) {
  const leftTitle = opts?.noteTitle || c.title
  const leftMd = opts?.noteText || c.description || '(sem descricao)'
  // ponytail: painel esquerdo — so leitura, sem form. Fixo no canto esquerdo do viewport.
  const leftPanel = document.createElement('div')
  leftPanel.className = 'reply-side-panel'
  leftPanel.setAttribute('role', 'region')
  leftPanel.setAttribute('aria-label', 'Perguntas do round')
  leftPanel.style.cssText = 'position:fixed;top:5vh;left:2vw;width:48vw;height:85vh;background:var(--bg-1,#1a1a1a);border:1px solid var(--border,#333);border-radius:8px;padding:1.2rem;overflow:auto;z-index:1900;box-shadow:0 8px 32px rgba(0,0,0,0.4)'
  leftPanel.innerHTML = '<h3 style="margin:0 0 1rem">' + esc(leftTitle) + '</h3>' +
    '<div class="md-view" style="min-height:0;max-height:calc(85vh - 100px);overflow-y:auto;overflow-x:hidden;padding-right:0.5rem">' + renderMd(leftMd) + '</div>' +
    '<div style="position:absolute;top:0.8rem;right:0.8rem"><button type="button" class="btn-icon btn-ghost" data-close-side aria-label="Fechar painel">×</button></div>'
  document.body.appendChild(leftPanel)
  const closeLeft = () => leftPanel.remove()
  leftPanel.querySelector('[data-close-side]')!.addEventListener('click', closeLeft)
  // ponytail: modal direita — openModal (reusa helper). Style: canto direito do viewport.
  const m = openModal({
    title: 'Reply · ' + c.title,
    body: () => '<div class="field"><label for="reply-tx">Resposta ao grilling</label>' +
      '<textarea id="reply-tx" name="reply" rows="22" autofocus placeholder="Escreve a tua resposta (Ctrl+Enter submete)" style="height:calc(80vh - 200px);min-height:300px"></textarea>' +
      '<div class="muted" style="font-size:.8rem;margin-top:.4rem">Cria um novo card de grilling com o teu reply anexado.</div></div>',
    submitText: 'Reply (novo card)',
    cancelText: 'Fechar',
    onCancel: closeLeft,  // ponytail: Esc/click no backdrop fecha os 2
  })
  // ponytail: o modal centralizado pelo helper — mover para o canto direito.
  const modalDiv = m.root.querySelector('.modal') as HTMLElement
  if (modalDiv) modalDiv.style.cssText = 'position:fixed;top:5vh;right:2vw;width:48vw;height:85vh;max-width:none;max-height:none;display:flex;flex-direction:column'
  const formBody = m.root.querySelector('.modal-body') as HTMLElement
  if (formBody) formBody.style.cssText = 'flex:1;overflow:auto'
  // ponytail: o backdrop de openModal fica centered mas o modal esta fixed right. Manter o backdrop invisivel.
  m.root.style.background = 'transparent'
  m.root.style.alignItems = 'flex-start'
  m.root.style.justifyContent = 'flex-end'
  const form = m.root.querySelector('form')!
  form.addEventListener('submit', async e => {
    e.preventDefault()
    const reply = readForm(form).reply?.trim()
    m.close()
    closeLeft()
    if (!reply) { toast('Reply vazio'); return }
    await ctx.onSubmit(reply)
  })
  // ponytail: clicar no backdrop transparente agora fecha os dois.
  m.root.addEventListener('click', e => { if (e.target === m.root) { m.close(); closeLeft() } })
}

export async function renderKanban(root: HTMLElement, slug: string) {
  let board: BoardDoc = await api.kanban.get(slug).catch(() => ({ ver: 0, columns: [], cards: [] } as BoardDoc))
  const adopt = (d: { ver?: number } | undefined) => { if (d && typeof d.ver === 'number') board.ver = d.ver }  // mantem etag local em sync apos PUT
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
    try { await putBoard() } catch (e: any) { toast((e && e.message) || 'Falha ao guardar') }
    refreshSideCount(); refreshTabCounts(slug)
  }
  // ponytail: PUT com retry — 409 (outro escritor avancou `ver`, ex. worker headless a gravar noutro
  // card do MESMO board) fazia o item \"nao aparecer\". Re-sync ver + re-aplica criacoes locais e retenta 1x.
  // Ceiling: edit concorrente do MESMO card — re-aplica por id (criacao); o edit perde-se na janela pequena
  // (normal = worker a adicionar a OUTRO card, coberto integralmente).
  const putBoard = async () => {
    try { adopt(await api.kanban.put(slug, board)) }
    catch (e: any) {
      if (e?.status !== 409) throw e
      const fresh = await api.kanban.get(slug)
      for (const c of board.cards) if (!fresh.cards.some(f => f.id === c.id)) fresh.cards.push(c)
      board = fresh
      try { adopt(await api.kanban.put(slug, board)) }
      catch (e2: any) {
        if (e2?.status !== 409) throw e2
        // ponytail: 2o 409 seguido = conflito persistente (writer a sobrescrever o MESMO card); toast + re-fetch.
        toast('Conflito persistente — refresh manual')
        board = await api.kanban.get(slug)
        throw e2
      }
    }
  }
  // ponytail: sidebar count computed once at renderShell; keep in sync on every board mutation
  function refreshSideCount() {
    const n = board.cards.filter(c => !c.archived && c.colId !== 'done').length
    const item = document.querySelector<HTMLElement>(`.side-item[data-slug="${slug}"]`)
    if (!item) return
    item.querySelector('.side-count')?.remove()
    if (n) item.insertAdjacentHTML('beforeend', `<span class="side-count">${n}</span>`)
  }
  const PRIO: Record<Prioridade, string> = { low:'low', medium:'medium', high:'high', urgent:'urgent' }
  const showArchived = false
  // ponytail: bulk — selecao de multiplos cards; selMode liga checkboxes, barra bulk no topo
  let selMode = false
  let sel = new Set<string>()
  const P: Record<Prioridade, number> = { low: 0, medium: 1, high: 2, urgent: 3 }
  const PRIOS: Array<{ id: Prioridade; label: string }> = [
    { id: 'urgent', label: 'Urgente' },
    { id: 'high', label: 'Alta' },
    { id: 'medium', label: 'Média' },
    { id: 'low', label: 'Baixa' },
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
      <div class="kanban-toolbar">
        <span class="kt-sec">
          <button class="btn-icon btn-ghost" id="karch" title="Cartões arquivados">${icon('archive', 16)}</button>
          <button class="btn-icon btn-ghost" id="kimport" title="Importar roadmap (markdown)">${icon('forward', 16)}</button>
          <button class="btn-icon btn-ghost" id="kortch" title="Orquestrar mundo (TODO → Em Curso)">${icon('term', 16)}</button>
          <button class="btn-icon btn-ghost" id="ksel" title="${selMode ? 'Concluir seleção' : 'Selecionar para bulk'}" style="${selMode?'color:var(--gold)':''}">${icon('check', 16)}</button>
        </span>
        <span class="kb-right"><span class="muted k-count">${board.cards.filter(c=>!c.archived).length} cartões</span></span>
      </div>
      ${selMode ? bulkBar() : ''}
      <div class="kanban" id="kboard">${board.columns.map(col => `
        <section class="kcol" data-col="${col.id}">
          <div class="khead">
            <h4>${esc(col.name)}</h4>
            <span class="kcount">${count(col.id)}</span>
            <div class="kctrl">
              ${selMode ? `<button type="button" class="btn-icon btn-ghost kcol-sel" data-col-sel="${col.id}" title="Selecionar / limpar coluna (visíveis)">${icon('check',14)}</button>` : ''}
              <select class="k-sort" data-col="${col.id}" aria-label="Ordenar ${esc(col.name)}" title="Ordenar coluna">
                <option value="pos"   ${keyOf(col.id)==='pos'  ?'selected':''}>Posição</option>
                <option value="prio"  ${keyOf(col.id)==='prio' ?'selected':''}>Prioridade</option>
                <option value="date"  ${keyOf(col.id)==='date' ?'selected':''}>Data</option>
                <option value="title" ${keyOf(col.id)==='title'?'selected':''}>Título</option>
              </select>
              ${kolFilter(col.id)}
            </div>
          </div>
          <div class="kcards" data-col="${col.id}">${cardsOf(col.id)}</div>
        </section>`).join('')}
      </div>`
    bind()
    // ponytail: re-aplica running nos botoes DP apos re-render (o finish() dispara render; fonte de verdade = dpPollers)
    board.cards.forEach(cc => { if (dpPollers[`${slug}:dp-${cc.id}`]) setDpRunning(cc.id, true) })
    root.querySelectorAll<HTMLSelectElement>('.k-sort').forEach(sel => sel.addEventListener('change', e => {
      sortKey[sel.dataset.col!] = (e.target as HTMLSelectElement).value as SortKey
      localStorage.setItem(`atlas.kbsort.${slug}`, JSON.stringify(sortKey))
      render()
    }))
    root.querySelector('#karch')!.addEventListener('click', showArchivedModal)
    root.querySelector('#kimport')!.addEventListener('click', importRoadmap)
    root.querySelector('#kortch')!.addEventListener('click', () => {
      api.orchestrator.start(slug).then(d => {
        toast(d.moved ? `Orquestrador: ${d.moved} tarefa${d.moved === 1 ? '' : 's'} TODO → Em Curso` : 'Orquestrador: sem TODOs neste mundo (0)')
        render()
      }).catch(e => toast('Orquestrador: ' + e.message))
    })
    root.querySelector('#ksel')!.addEventListener('click', () => { selMode = !selMode; if (!selMode) sel.clear(); render() })
    root.querySelector<HTMLElement>('#kboard')!.addEventListener('click', e => {
      // centinela externo: clicar fora de um popover fecha todos os menus abertos
      const inKf = (e.target as HTMLElement).closest<HTMLElement>('[data-kf], [data-filter-toggle]')
      if (!inKf) closeFilterMenus()
      const tgl = (e.target as HTMLElement).closest<HTMLElement>('[data-filter-toggle]')
      const tgt = (e.target as HTMLElement).closest<HTMLElement>('[data-filter-prio]')
      if (!tgl && !tgt) return
      if (tgl) {
        const colId = tgl.dataset.filterToggle!
        const menu = root.querySelector<HTMLElement>(`[data-kfmenu="${colId}"]`)
        const open = menu && !menu.hidden
        closeFilterMenus()
        if (menu && !open) { menu.hidden = false; tgl.setAttribute('aria-expanded','true') }
        return
      }
      // selecionou um item do menu
      const colId = tgt!.closest<HTMLElement>('.kcol')?.dataset.col || ''
      const p = tgt!.dataset.filterPrio
      if (!colId || !p) return
      if (colFilters[colId] !== p) { colFilters[colId] = p as ColFilter; render() }
      closeFilterMenus()
    })
    function closeFilterMenus() {
      root.querySelectorAll<HTMLElement>('[data-kfmenu]').forEach(m => { m.hidden = true })
      root.querySelectorAll<HTMLElement>('[data-filter-toggle]').forEach(b2 => b2.setAttribute('aria-expanded','false'))
    }
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
    const activeP = active === 'all' ? null : PRIOS.find(p => p.id === active)
    const on = active !== 'all'
    const items = [{ id: 'all' as ColFilter, label: 'Todas' }, ...PRIOS].map(p =>
      `<button type="button" class="kf-item${active === p.id ? ' on' : ''}" data-filter-prio="${p.id}" aria-pressed="${active === p.id}">${active === p.id ? icon('check', 13) : ''}${p.label}</button>`
    ).join('')
    return `<div class="kfwrap" data-kf="${colId}">
      <button type="button" class="btn-icon btn-ghost kfilter-btn${on ? ' on' : ''}" data-filter-toggle="${colId}" aria-haspopup="menu" aria-expanded="false" title="${on ? `Filtro: ${activeP!.label}` : 'Filtrar por prioridade'}">${icon('filter', 15)}</button>
      <div class="kfilter-menu" data-kfmenu="${colId}" hidden>${items}</div>
    </div>`
  }
  function matchesColFilter(c: Card, colId: string) {
    const f = colFilters[colId] || 'all'
    return f === 'all' || c.priority === f
  }
  function count(colId: string) { return board.cards.filter(c => c.colId === colId && !c.archived && matchesColFilter(c, colId)).length }
  function prioLabel(p: Prioridade) { return p === 'urgent' ? 'Urgente' : p === 'high' ? 'Alta' : p === 'medium' ? 'Média' : 'Baixa' }

  function cardsOf(colId: string) {
    return board.cards.filter(c => c.colId === colId && !c.archived && matchesColFilter(c, colId)).sort((a,b) => cmp(a, b, keyOf(colId))).map(c => {
      const idx = board.columns.findIndex(x => x.id === c.colId)
      const prev = board.columns[idx-1]?.id, next = board.columns[idx+1]?.id
      const isSel = sel.has(c.id)
      return `<article class="kcard${c.result ? ' has-output' : ''}${isSel ? ' sel' : ''}${dueState(c).cls === 'over' ? ' overdue' : ''}${dueState(c).cls === 'near' ? ' due-near' : ''}" draggable="true" tabindex="0" data-id="${c.id}">
        <div class="ktitle">${selMode ? `<input type="checkbox" class="kselbox" data-sel="${c.id}" ${isSel ? 'checked' : ''} aria-label="Selecionar ${esc(c.title)}">` : ''}<h5>${esc(c.title)}</h5><span class="kdate" title="Criado em ${fmtDate(c.ts)}">${fmtDate(c.ts)}</span></div>
        ${c.description ? `<div class="kdesc">${esc(previewText(c.description))}</div>` : ''}
        <div class="kstates">${stateChip(c)}${phaseChip(c)}${roundsFromResult(c)}${c.dp ? `<span class="kbadge kbadge-dp">DP</span>` : ''}${c.result ? `<span class="kbadge kbadge-out">resultado</span>` : ''}${c.recur ? `<span class="kbadge kbadge-recur" title="Recorrente · ${esc(recurLabel(c.recur))}">↻ ${esc(recurLabel(c.recur))}</span>` : ''}</div>
        <div class="kfoot">
          ${dueBadge(c)}
          <span class="prio ${PRIO[c.priority]}"><span class="dot"></span>${prioLabel(c.priority)}</span>
          ${kops(c)}
        </div>
      </article>`
    }).join('')
  }

  // ponytail: seleciona todos os cards visiveis da coluna (mesmo filtro de cardsOf)
  function selectCol(colId: string) {
    // toggle: marca toda a coluna visivel, ou desmarca se ja estiver toda selecionada
    const vis = board.cards.filter(c => c.colId === colId && !c.archived && matchesColFilter(c, colId))
    const allSel = vis.length > 0 && vis.every(c => sel.has(c.id))
    vis.forEach(c => allSel ? sel.delete(c.id) : sel.add(c.id))
    refreshBulk()
  }

  // ponytail: composição condicional do .kops por coluna — só a ação de ciclo de vida relevante ao estado.
  // start/play só em todo; restart(reset)+term só em doing; move/edit/arch/del em todas.
  // ponytail: card = snippet frio — só ações de fluxo (run/dp/term). Gestão (move/edit/arch/del/approve/reject) vive no modal.
  function kops(c: Card): string {
    const b: string[] = []
    // ponytail: card h1y3yfsy crash diagnostics — badge "⚠ retry após crash" no botão Run.
    // Aparece quando o card está em TODO mas vem de um crash (c.crashRetry). Sem cor permanente
    // — o user quer ver o badge sem ficar vermelho no kanban.
    const crashBadge = c.crashRetry ? `<span class="k-badge-warn" title="Card recuperado após crash — o botão Run agora é um retry manual">⚠ retry após crash</span>` : ''
    if (c.colId === 'todo') {
      b.push(`<button class="btn-icon btn-ghost" data-act="run" aria-label="Executar no Hermes">${icon('play', 15)}</button>${crashBadge}`)
      b.push(`<button class="btn-icon btn-ghost" data-act="dp" data-card="${c.id}" aria-label="Gerar DP (design plan)">${icon('doc', 15)}</button>`)
    } else if (c.colId === 'doing') {
      b.push(`<button class="btn-icon btn-ghost" data-act="run" aria-label="Reiniciar execução">${icon('reset', 15)}</button>`)
      b.push(`<button class="btn-icon btn-ghost" data-act="term" aria-label="Ver terminal / log do run">${icon('term', 16)}</button>`)
      // ponytail: reply — botão universal em doing. Re-spawn com description extendida. Sem filtro por skill.
      b.push(`<button class="btn-icon btn-ghost" data-act="reply" aria-label="Responder (cola texto e reinicia)">${icon('pencil', 15)}</button>`)
    }
    if (!b.length) return ''
    return `<div class="kops">${b.join('')}</div>`
  }

  // ponytail: barra de operacoes em bulk — aparece quando selMode ativo
  function bulkBar() {
    const cols = board.columns.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')
    return `<div class="bulkbar" id="kbulkbar">
        <span class="muted" style="font-size:.85rem"><span id="bulkcount">${sel.size}</span> selecionados</span>
        <select id="bulk-col" title="Mover para coluna" ${sel.size===0?'disabled':''}><option value="">Mover para coluna…</option>${cols}</select>
        <select id="bulk-prio" title="Mudar prioridade" ${sel.size===0?'disabled':''}><option value="">Prioridade…</option>
          <option value="urgent">Urgente</option><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option>
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
      const csel = (e.target as HTMLElement).closest('[data-col-sel]') as HTMLElement | null
      if (csel) { selectCol(csel.dataset.colSel!); return }
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

  function setDpRunning(cardId: string, on: boolean) {
    // ponytail: toggla .running + disabled nos botoes DP (grid e modal) por card; fonte de verdade = dpPollers
    document.querySelectorAll<HTMLElement>(`[data-act="dp"][data-card="${cardId}"], [data-card-act="dp"][data-card="${cardId}"]`).forEach(el => {
      el.classList.toggle('running', on)
      ;(el as HTMLButtonElement).disabled = on
    })
  }

  function dpCard(c: Card) {
    // ponytail: botao DP por card — router de 3 ramos: re-aderir se poller ja corre, ver dp gravado se existir,
    // ou disparar headless. NUNCA regenera por engano.
    const key = `${slug}:dp-${c.id}`
    if (dpPollers[key]) { viewDp(c); return }
    if (c.dp) { setDpRunning(c.id, false); viewDp(c); return }
    fetch(`/api/w/${slug}/dp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId: c.id }),
    }).then(r => r.json()).then((d: any) => {
      if (d && d.ok) { setDpRunning(c.id, true); toast('A gerar DP em segundo plano (headless)'); viewDp(c) }
      else toast((d && d.error) || 'Erro ao gerar DP')
    }).catch(() => toast('Falha ao iniciar DP'))
  }

    function viewDp(c: Card) {
    const key = `${slug}:dp-${c.id}`
    // ponytail: 3 ramos — re-aderir (poller vivo), ver dp gravado (estatico), ou primeira vez (cria poller+modal).
    // re-aderir: usa o mesmo pre/statusEl do poller vivo (o tick continua a escrever no mesmo DOM node).
    const p = dpPollers[key]
    if (p && p.pre && p.statusEl) {
      // ponytail: re-abrir depois de fechar — pre ficou detached mas com todo o output acumulado; outerHTML captura-o.
      const preHtml = p.pre.outerHTML, statusTxt = p.statusEl.textContent || ''
      openModal({
        title: 'DP · ' + c.title, submitText: 'Fechar', cancelText: 'Fechar',
        body: () => `<div class="term-wrap">${preHtml}<div class="term-status" id="${esc(c.id)}-dpstatus">${esc(statusTxt)}</div></div>`,
        onSubmit: () => {},
      })
      return
    }
    // ponytail: c.dp ja gravado, sem poller vivo — mostra direto via dpHtml (sem spinner "A ligar..." enganador)
    if (!dpPollers[key] && c.dp) {
      const dpBody = dpHtml(c.dp)
      openModal({
        title: 'DP · ' + c.title, submitText: 'Fechar', cancelText: 'Fechar',
        body: () => `<div class="kmodal-sec"><h6 class="kmodal-sec-t">${icon('doc',14)} Design Plan · DP</h6><div class="kmodal-sec-body">${dpBody}</div></div>`,
        onSubmit: () => {},
      })
      return
    }
    // ponytail: primeira vez — cria poller + modal de progresso. Modal pode fechar; poller sobrevive p/ notificar fim.
    let offset = 0
    let pre = document.createElement('pre')
    pre.className = 'term-view'
    pre.textContent = 'A ligar ao DP...'
    let timer: ReturnType<typeof setInterval> | undefined
    const body = () => `<div class="term-wrap">${pre.outerHTML}<div class="term-status" id="${esc(c.id)}-dpstatus">a trabalhar…</div></div>`
    const m = openModal({
      title: 'DP · ' + c.title, submitText: 'Fechar', cancelText: 'Fechar',
      body,
      // ponitail: o poller continua em 2o plano apos fechar p/ conseguir notificar o fim do DP
      onSubmit: () => {},
    })
    pre = m.root.querySelector('.term-view') as HTMLPreElement
    const statusEl = m.root.querySelector('.term-status') as HTMLElement
    const started = Date.now()
    const finish = (code: number) => {
      // ponitail: NOTIFICACAO quando o DP acaba — dispara mesmo com o modal ja fechado
      toast(code === 0 ? ('DP concluído ✓ · ' + c.title) : ('DP terminou com erro (código ' + code + ') · ' + c.title))
      if (dpPollers[key]) { clearInterval(dpPollers[key].timer); delete dpPollers[key] }
      setDpRunning(c.id, false)
      // ponitail: re-le o board p/ o card.dp (gravado pelo worker via API) aparecer logo ao fechar
      if (code === 0) api.kanban.get(slug).then(fresh => { board = fresh; render() })
    }
    const tick = async () => {
      // ponitail: cap de seguranca — para o poller detachado apos 30 min se nunca acabar (evita leak)
      if (Date.now() - started > 30 * 60 * 1000) { if (dpPollers[key]) { clearInterval(dpPollers[key].timer); delete dpPollers[key] } setDpRunning(c.id, false); return }
      try {
        const d = await api.run.output(slug, 'dp-' + c.id, offset)
        if (d && d.chunk) { pre.textContent += d.chunk; pre.scrollTop = pre.scrollHeight }
        offset = d ? d.offset : offset
        if (d && d.done) {
          if (d.code === 0) statusEl.textContent = 'concluído ✓ (arquivado no card)'
          else { statusEl.textContent = 'terminou com erro (código ' + d.code + ') — vê o log acima'; statusEl.classList.add('err') }
          finish(d.code ?? 0)
          return
        }
        if (d && d.started === false && !pre.textContent) { statusEl.textContent = 'ainda não gerado' }
      } catch { /* aguenta — server pode reiniciar */ }
    }
    timer = setInterval(tick, 1000)
    dpPollers[key] = { timer, pre, statusEl }
    tick()
  }

function runCard(c: Card) {
    toast('A abrir WezTerm com o Hermes...')
    launchRun(slug, c).then(ok => {
      if (!ok) return
      c.colId = 'doing'; c.startedAt = Date.now(); save().then(render); toast('A executar em segundo plano (headless)')
    })
  }

  function viewTerminal(c: Card) {
    // ponytail: placeholder honesto — sem ficheiro .status a UI diz 'ainda nao lancado', nunca
    // inventa 'concluido'. O pre so recebe bytes quando o log tem conteudo real.
    let offset = 0
    let pre = document.createElement('pre')
    pre.className = 'term-view'
    pre.textContent = ''
    let timer: ReturnType<typeof setInterval> | undefined
    const body = () => `<div class="term-wrap">${pre.outerHTML}<div class="term-status" id="${esc(c.id)}-tstatus">ainda não lançado</div></div>` +
    `<div class="term-actions" style="margin-top:.6rem"><button type="button" class="btn btn-primary" data-act="reply-from-term">Reply</button></div>`
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
        if (d) {
          if (d.chunk) { pre.textContent += d.chunk; pre.scrollTop = pre.scrollHeight }
          offset = d.offset
          if (d.done) {
            if (timer) clearInterval(timer)
            statusEl.textContent = d.code === 0 ? 'concluído ✓' : ('terminou com erro (código ' + d.code + ') — vê o log acima')
            statusEl.classList.toggle('err', !!(d.code !== 0))
            return
          }
          if (d.started === false && !pre.textContent) { statusEl.textContent = 'ainda não lançado'; return }
          statusEl.textContent = '● a trabalhar (update 1s)'
        }
      } catch { /* aguenta — server pode reiniciar */ }
    }
    timer = setInterval(tick, 1000)
    tick()
    // parar polling quando o modal fechar (backdrop removido)
    const obs = new MutationObserver(() => { if (!m.root.isConnected) { if (timer) clearInterval(timer); obs.disconnect() } })
    obs.observe(document.body, { childList: true })

    // ponytail: botão Reply no terminal modal — reusa openReplyModal top-level
    m.root.querySelector('[data-act=reply-from-term]')!.addEventListener('click', () => openReplyModal(c, { onSubmit: async (reply: string) => {
  // ponytail: re-spawn (legacy — botao no terminal modal continua a re-spawn no mesmo card)
  c.description = (c.description || '') + '\n\n## Reply do user (' + new Date().toLocaleString('pt-PT') + ')\n' + reply
  await save()
  render()
  runCard(c)
} }))
  }

  function approveCard(c: Card) {
    // ponytail: o handler do viewModal ja fez m.close() antes desta chamada. O confirmDialog
    // abre o seu proprio modal — fechamos o backdrop remanescente so em sucesso (cancel => mantem aberto).
    // Decisao R3.Q2: o approve e' headless (agente faz git ff + push + flip do card via API). Nao fazemos
    // flip otimista — o card fica em 'review' ate o watcher detectar a transicao feita pelo agente.
    confirmDialog({ title: 'Aprovar e concluir', message: 'Validar na branch dev, marcar como concluído e fazer merge dev → main?' })
      .then(ok => { if (!ok) return
        api.review.approveAgent(slug, c.id).then(d => {
          document.querySelector('.modal-backdrop')?.remove()
          toast('A concluir (agente)…')
        }).catch(e => toast('Erro: ' + e.message))
      })
  }
  function rejectCard(c: Card) {
    const prioOpts = `<option value="urgent" ${c.priority==='urgent'?'selected':''}>Urgente</option>
      <option value="high" ${c.priority==='high'?'selected':''}>Alta</option>
      <option value="medium" ${c.priority==='medium'?'selected':''}>Média</option>
      <option value="low" ${c.priority==='low'?'selected':''}>Baixa</option>`
    const m = openModal({
      title: 'Refinar tarefa', submitText: 'Enviar para Em Curso',
      body: () => `<div class="field"><label for="r-template">Template</label><select name="template" id="r-template"><option value="">Manter estrutura atual…</option></select></div>
        <div class="field"><label for="r-title">Título</label><input id="r-title" name="title" required value="${esc(c.title)}"></div>
        <div class="field"><label for="r-desc">Descrição</label><textarea id="r-desc" name="description">${esc(c.description || '')}</textarea></div>
        <div class="field"><label for="r-prio">Prioridade</label><select id="r-prio" name="priority">${prioOpts}</select></div>
        <div class="field"><label>Nota de revisão (o que ajustar — será anexado à tarefa)</label><textarea id="r-note" placeholder="Ex.: o resultado está aproximado, refina o prompt para..."></textarea></div>`,
      onSubmit: () => {
        const title = (m.root.querySelector('[name=title]') as HTMLInputElement).value.trim()
        if (!title) return
        const description = (m.root.querySelector('[name=description]') as HTMLTextAreaElement).value
        const priority = (m.root.querySelector('[name=priority]') as HTMLSelectElement).value as Prioridade
        const note = (m.root.querySelector('#r-note') as HTMLTextAreaElement)?.value || ''
        api.review.reject(slug, c.id, { note, title, description, priority }).then(d => {
          // server aplica overrides + appends a nota; re-fetch p/ não gravar descricao obsoleta
          return api.kanban.get(slug).then(fresh => { board = fresh; render(); toast('Voltou para Em Curso') })
        }).catch(e => toast('Erro: ' + e.message))
      },
    })
    wireRefineTemplate(m.root, slug)
  }

  function resetCard(c: Card) {
    // ponytail: reset semantico - limpa historico de execucao e volta a TODO;
    // reutiliza save() (PUT com retry 409) em vez de criar um endpoint novo.
    delete c.dp
    delete c.result
    delete c.reviewed
    delete c.startedAt
    c.colId = 'todo'
    save().then(render)
    toast('Recomeçado do zero')
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
    // ponytail: seletor de template so em novo cartao; preenche titulo/descrição/prio/coluna (kind 'card')
    const tplField = c ? '' : '<div class="field"><label for="k-template">Template</label><select name="template" id="k-template"><option value="">Novo a partir de template…</option></select></div>'
    const m = openModal({
      title: c ? 'Editar cartão' : 'Novo cartão', submitText: c ? 'Guardar' : 'Criar',
      body: () => `${tplField}<div class="field"><label for="k-title">Título</label><input id="k-title" name="title" required value="${esc(c?.title || '')}"></div>
        <div class="field"><label for="k-desc">Descrição</label><textarea id="k-desc" name="description">${esc(c?.description || '')}</textarea></div>
        <div class="field"><label for="k-prio">Prioridade</label><select id="k-prio" name="priority">
          <option value="urgent" ${c?.priority==='urgent'?'selected':''}>Urgente</option>
          <option value="high" ${c?.priority==='high'?'selected':''}>Alta</option>
          <option value="medium" ${c?.priority==='medium'?'selected':''}>Média</option>
          <option value="low" ${c?.priority==='low'?'selected':''}>Baixa</option>
        </select></div>
        <div class="field"><label for="k-due">Prazo (obrigatório)</label><input id="k-due" name="due" type="date" value="${c?.due ? toInputDate(c.due) : ''}"></div>
        <div class="field"><label for="k-recur">Recorrência</label><select id="k-recur" name="recur">
          <option value="">Não recorrente</option>
          <option value="daily" ${c?.recur==='daily'?'selected':''}>Diária</option>
          <option value="weekly" ${c?.recur==='weekly'?'selected':''}>Semanal</option>
          <option value="monthly" ${c?.recur==='monthly'?'selected':''}>Mensal</option>
        </select></div>
        ${c ? `<div class="field">
          <label>Temporizador</label>
          ${c.timerMs
            ? `<div class="ktimer-modal" data-timer-modal>
                <span class="ktimer-modal-label">${c.timerStartedAt ? 'A contar: ' : 'Pausado · '}restantes <strong>${esc(fmtClock(timerRemainingMs(c)))}</strong> · duração total ${esc(fmtClock(c.timerMs))}</span>
                <span class="ktimer-modal-actions">
                  <button type="button" class="btn btn-ghost btn-sm" data-timer-act="toggle">${c.timerStartedAt ? 'Pausar' : 'Retomar'}</button>
                  <button type="button" class="btn btn-ghost btn-sm" data-timer-act="add1">+1 min</button>
                  <button type="button" class="btn btn-ghost btn-sm" data-timer-act="remove">Remover</button>
                </span>
              </div>`
            : `<div class="ktimer-modal" data-timer-modal>
                <span class="ktimer-modal-label">Sem temporizador</span>
                <span class="ktimer-modal-actions">
                  <input type="number" min="1" max="240" step="1" value="25" name="timerMin" aria-label="Duração em minutos" style="width:5em">
                  <button type="button" class="btn btn-primary btn-sm" data-timer-act="start">Iniciar</button>
                </span>
              </div>`}
        </div>` : ''}
        <div class="field"><label for="k-col">Coluna</label><select id="k-col" name="colId">${cols}</select></div>`,
      onSubmit: () => {
        const form = document.querySelector('.modal form') as HTMLFormElement
        const title = (form.querySelector('[name=title]') as HTMLInputElement).value.trim()
        if (!title) return
        const dueV = (form.querySelector('[name=due]') as HTMLInputElement).value
        let due: number | undefined
        if (dueV) { const [Y, M, D] = dueV.split('-').map(Number); due = new Date(Y, M - 1, D).getTime() }
        const recurV = (form.querySelector('[name=recur]') as HTMLSelectElement).value as Card['recur']
        const data = {
          title, description: (form.querySelector('[name=description]') as HTMLTextAreaElement).value,
          priority: (form.querySelector('[name=priority]') as HTMLSelectElement).value as Prioridade,
          colId: (form.querySelector('[name=colId]') as HTMLSelectElement).value,
          due, recur: recurV || undefined,
        }
        if (c) { Object.assign(c, data); if (!c.due) delete c.due; if (!c.recur) delete c.recur }
        else board.cards.push({ id: uid(), ts: Date.now(), archived: false, ...data, priority: data.priority ?? 'low' })
        save().then(render); toast(c ? 'Guardado' : 'Criado')
      },
    })
    if (!c) wireCardTemplate(m.root, slug)
    // ponytail: handler dos botoes do temporizador no modal de edit. Acoes: start/toggle/add1/remove.
    // start: grava timerMs+timerStartedAt; toggle: inverte timerStartedAt mantendo timerMs; remove: apaga ambos.
    // add1: soma 60_000 a timerMs; se a correr, recalcula timerStartedAt para preservar o progresso.
    // Todas as acoes mutam o card local, persistem, fecham modal e dao toast (padrao dos outros botoes do modal).
    if (c) {
      m.root.querySelector<HTMLElement>('[data-timer-modal]')?.addEventListener('click', e => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-timer-act]')
        if (!btn) return
        const act = btn.dataset.timerAct
        if (act === 'start') {
          const inp = m.root.querySelector<HTMLInputElement>('[name=timerMin]')
          const n = Math.max(1, Math.min(240, Number(inp?.value || 25) || 25))
          c.timerMs = n * 60_000
          c.timerStartedAt = Date.now()
        } else if (act === 'toggle') {
          if (!c.timerMs) return
          if (c.timerStartedAt) {
            // pausar: congelar o progresso subtraindo o elapsed
            const elapsed = Date.now() - c.timerStartedAt
            c.timerMs = Math.max(0, c.timerMs - elapsed)
            delete c.timerStartedAt
          } else {
            // retomar: o progresso ja esta em c.timerMs, so precisamos de novo timestamp
            c.timerStartedAt = Date.now()
          }
        } else if (act === 'add1') {
          if (!c.timerMs) return
          if (c.timerStartedAt) {
            const elapsed = Date.now() - c.timerStartedAt
            // soma 60_000 ao total e reposiciona startedAt para preservar elapsed
            c.timerMs += 60_000
            c.timerStartedAt = Date.now() - elapsed
          } else {
            c.timerMs += 60_000
          }
        } else if (act === 'remove') {
          delete c.timerMs
          delete c.timerStartedAt
        } else return
        e.stopPropagation()
        save().then(() => { m.close(); render(); toast(act === 'remove' ? 'Temporizador removido' : act === 'start' ? 'Temporizador iniciado' : act === 'add1' ? '+1 min' : (c.timerStartedAt ? 'Temporizador retomado' : 'Temporizador pausado')) })
      })
    }
  }
  function viewModal(c: Card) {
    const col = board.columns.find(x => x.id === c.colId)?.name || ''
    const vidx = board.columns.findIndex(x => x.id === c.colId)
    const prev = board.columns[vidx - 1]?.id, next = board.columns[vidx + 1]?.id
    const m = openModal({
      title: c.title, submitText: 'Editar',
      body: () => `
        <div class="kmodal-head">
          <button type="button" class="kcopy" data-id="${c.id}" title="Copiar ID">#${c.id}</button>
          <span class="prio ${PRIO[c.priority]}"><span class="dot"></span>${prioLabel(c.priority)}</span>
          <span class="muted"> · ${esc(col)}</span>
          <span class="muted"> · criado ${fmtDate(c.ts)}</span>
          ${c.due ? `${dueBadge(c)}` : ''}
          ${c.recur ? `<span class="kbadge kbadge-recur" title="Recorrente">↻ ${esc(recurLabel(c.recur))}</span>` : ''}
        </div>
        ${stateChip(c) || roundsFromResult(c) ? `<div class="kmodal-status">${stateChip(c)}${phaseChip(c)}${roundsFromResult(c)}</div>` : ''}
        ${c.description
          ? `<div class="kdesc md-view">${renderMd(c.description)}</div>`
          : '<div class="muted">Sem descrição</div>'}
        ${c.dp
          ? `<section class="kmodal-sec"><h6 class="kmodal-sec-t">${icon('doc',14)} Design Plan · DP</h6><div class="kmodal-sec-body">${dpHtml(c.dp)}</div></section>`
          : ''}
        ${c.result
          ? `<section class="kmodal-sec"><h6 class="kmodal-sec-t">${icon('check',14)} Resultado</h6><div class="kmodal-sec-body">${resultHtml(c.result)}</div></section>`
          : ''}
        <div class="kmodal-actions" data-card-actions>
          <div class="kmodal-actions-primary">
            ${c.colId === 'todo'
              ? `<button type="button" class="btn btn-primary btn-sm" data-card-act="run">${icon('play',14)} ${c.crashRetry ? 'Retry após crash' : 'Executar no Hermes'}</button>
                 <button type="button" class="btn btn-ghost btn-sm" data-card-act="dp" data-card="${c.id}">${icon('doc',14)} Gerar DP</button>`
              : c.colId === 'doing'
                ? `<button type="button" class="btn btn-primary btn-sm" data-card-act="run">${icon('reset',14)} Reiniciar execução</button>
                   <button type="button" class="btn btn-ghost btn-sm" data-card-act="term">${icon('term',14)} Ver terminal</button>`
                : c.colId === 'review'
                  ? `<button type="button" class="btn btn-primary btn-sm" data-card-act="approve">${icon('check',14)} Aprovar</button>
                     <button type="button" class="btn btn-ghost btn-sm" data-card-act="reject">${icon('pencil',14)} Refinar</button>
                     <button type="button" class="btn btn-ghost btn-sm" data-card-act="reset">${icon('reset',14)} Começar do zero</button>`
                  : '<span class="muted" style="font-size:.82rem">Sem ações para esta coluna</span>'}
            ${c.orphanWorktreePath
              ? `<button type="button" class="btn btn-ghost btn-sm" data-card-act="clear-orphan" title="Apagar manualmente a worktree órfã em ${esc(c.orphanWorktreePath)}">${icon('trash',14)} Limpar worktree órfã</button>`
              : ''}
          </div>
          <div class="kmodal-actions-meta">
            <button type="button" class="btn-icon btn-ghost" data-card-act="move" data-dir="-1" ${prev?'':'disabled'} title="Mover atrás">${icon('back',15)}</button>
            <button type="button" class="btn-icon btn-ghost" data-card-act="move" data-dir="1" ${next?'':'disabled'} title="Mover frente">${icon('forward',15)}</button>
            <button type="button" class="btn-icon btn-ghost" data-card-act="edit" title="Editar">${icon('pencil',15)}</button>
          </div>
          <div class="kmodal-actions-danger">
            <button type="button" class="btn-icon btn-ghost" data-card-act="arch" title="Arquivar">${icon('archive',15)}</button>
            <button type="button" class="btn-icon btn-ghost" data-card-act="del" title="Eliminar" style="color:var(--danger)">${icon('trash',15)}</button>
          </div>
        </div>`
      ,
      onSubmit: () => cardModal(c),
    })
    m.root.querySelector('.kcopy')?.addEventListener('click', e => {
      e.stopPropagation()
      navigator.clipboard.writeText(c.id).then(() => toast('ID copiado: ' + c.id)).catch(() => toast('Falha ao copiar'))
    })
    // ponytail: acoes do card no modal — cada branch fecha o viewModal (m.close) ao disparar;
    // run/dp/term/reject/edit abrem outro modal por cima (limpo). move/arch mutam o cartao (fecha).
    // approve fecha o confirm-dialog no sucesso (via approveCard). del so fecha em sucesso.
    // Reutiliza os mesmos helpers (runCard/dpCard/...) que os botoes do grid usam.
    m.root.querySelector('[data-card-actions]')?.addEventListener('click', e => {
      const actBtn = (e.target as HTMLElement).closest('[data-card-act]') as HTMLElement | null
      if (!actBtn) return
      const a = actBtn.dataset.cardAct
      if (a === 'run') { m.close(); runCard(c) }
      else if (a === 'dp') { m.close(); dpCard(c) }
      else if (a === 'term') { m.close(); viewTerminal(c) }
      else if (a === 'approve') { m.close(); approveCard(c) }
      else if (a === 'reject') { m.close(); rejectCard(c) }
      else if (a === 'reset') { m.close(); resetCard(c) }
      else if (a === 'move') {
        const dir = parseInt(actBtn.dataset.dir || '0'); const i = board.columns.findIndex(x => x.id === c.colId)
        const target = board.columns[i + dir]; if (!target) return
        m.close(); c.colId = target.id; save().then(render)
      }
      else if (a === 'edit') { m.close(); cardModal(c) }
      else if (a === 'arch') { m.close(); c.archived = true; save().then(render); toast('Arquivado') }
      else if (a === 'del') { m.close(); confirmDialog({ title: 'Eliminar cartão', message: 'Apagar este cartão?' }).then(ok => { if (!ok) return; board.cards = board.cards.filter(x => x.id !== c.id); save().then(render); toast('Eliminado') }) }
      // ponytail: card h1y3yfsy — botao manual "Limpar worktree orfa'" (modal so' o mostra se
      // c.orphanWorktreePath setado). Confirma, chama api.run.clearOrphan, fecha modal e re-render.
      else if (a === 'clear-orphan') {
        if (!c.orphanWorktreePath) return
        m.close()
        confirmDialog({ title: 'Limpar worktree órfã', message: 'Apagar ' + c.orphanWorktreePath + '?' }).then(ok => {
          if (!ok) return
          api.run.clearOrphan(slug, c.id).then(d => {
            delete c.orphanWorktreePath
            toast('Worktree órfã limpa' + (d && d.cleared ? (' (' + d.cleared + ')') : ''))
            // re-fetch para sincronizar crashRetry + estado
            return api.kanban.get(slug).then(fresh => { board = fresh; render() })
          }).catch(e => toast('Erro: ' + e.message))
        })
      }
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
// + os badges .kbadge-timer do per-card timer (label + warn/running). Custo zero extra (mesmo loop).
setInterval(() => {
  const now = Date.now()
  document.querySelectorAll<HTMLElement>('.ktimer').forEach(el => {
    const start = parseInt(el.dataset.start || '0', 10)
    if (!start) return
    el.textContent = fmtElapsed(now - start)
  })
  document.querySelectorAll<HTMLElement>('.kbadge-timer').forEach(el => {
    const ms = Number(el.dataset.timerMs || 0)
    if (!ms) return
    const started = Number(el.dataset.timerStarted || 0)
    const isRunning = !!started
    const remaining = isRunning ? Math.max(0, ms - (Date.now() - started)) : ms
    const warn = isRunning && remaining <= ms * 0.2
    const running = isRunning && !warn
    el.textContent = isRunning ? fmtClock(remaining) : `pausado ${fmtClock(ms)}`
    el.classList.toggle('warn', warn)
    el.classList.toggle('running', running)
    el.setAttribute('title', isRunning
      ? (remaining <= 0 ? 'Temporizador concluído · carrega em Editar para reiniciar' : `Temporizador · falta ${fmtClock(remaining)}`)
      : 'Temporizador parado · carrega em Editar para retomar')
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
// ponytail: preview cru no card — arranca markdown, 1-2 linhas clamp via CSS (.kdesc). Full md fica no modal.
function previewText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, ' ')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
// ponytail: chip de estado no card — doing=acao+clock, review/done=badge. Sem conteudo, so sinal.
function stateChip(c: Card): string {
  if (c.colId === 'doing' && !c.result) return `<div class="kstates-live">${kdoing(c)}</div>`
  if (c.colId === 'review') return `<span class="kbadge kbadge-review">REVISAO</span>`
  if (c.colId === 'done') return `<span class="kbadge kbadge-out"><span class="dot" style="background:var(--gold)"></span>Concluido</span>`
  return ''
}

// ponytail: phase michi workflow — derivado de colId + skills no MVP. Persistir em phase 3.
// Mapeamento: todo=todo, doing=da (running worker), review=review, done=done.
// skills contem grill-me -> grill. dp preenchido -> dp. crashRetry -> reflect.
function colIdToPhase(c: Card): MichiPhase {
  if (c.colId === 'done') return 'done'
  if (c.colId === 'review') return 'review'
  if (c.colId === 'doing') return 'da'
  if (c.colId === 'todo') {
    if (c.crashRetry) return 'reflect'
    if (Array.isArray(c.skills) && c.skills.some(s => /grill/i.test(s))) return 'grill'
    if (c.dp) return 'dp'
    return 'todo'
  }
  return 'todo'
}
function phaseChip(c: Card): string {
  const p = colIdToPhase(c)
  if (p === 'todo') return ''
  const labels: Record<MichiPhase, string> = { todo: '', grill: 'grill', dr: 'dr', dp: 'dp', da: 'a correr', gates: 'gates', review: 'review', reflect: 'reflect', done: '' }
  return `<span class="kbadge kbadge-phase phase-${p}" title="Fase michi: ${p}">${labels[p]}</span>`
}

// ponytail: timeline read-only — regex sobre c.result, 0 schema change.
// Se utilizador quiser persistir rounds[] no Card, trocar isto por c.rounds?.length ?? matches.length.
function roundsFromResult(c: Card): string {
  if (!c.result) return ''
  const matches = c.result.match(/Round \d+/g) || []
  if (!matches.length) return ''
  const uniq = Array.from(new Set(matches))
  return `<span class="kbadge-row" title="Rounds no result">${uniq.map(m => `<span class="kbadge kbadge-round">${m}</span>`).join('')}</span>`
}

function dpHtml(dp: string): string {
  // ponytail: DP apresentado como bloco destacado (primeira linha = cabecalho), cor distinta do result
  const nl = dp.indexOf('\n')
  const title = nl === -1 ? dp : dp.slice(0, nl)
  const body = nl === -1 ? '' : dp.slice(nl + 1)
  return `<div class="kdp"><div class="kdp-title">${esc(title)}</div>${body ? `<div class="kdp-body md-view">${renderMd(body)}</div>` : ''}</div>`
}
function resultHtml(r: string): string {
  // ponytail: primeira linha = destaque (ex. 'Task cumprida: ...'); corpo separado
  const nl = r.indexOf('\n')
  const title = nl === -1 ? r : r.slice(0, nl)
  const body = nl === -1 ? '' : r.slice(nl + 1)
  return `<div class="kresult"><div class="kresult-title">${esc(title)}</div>${body ? `<div class="kresult-body md-view">${renderMd(body)}</div>` : ''}</div>`
}
function deindent(s: string): string { return s.replace(/^\s+/gm, '').replace(/\n{2,}/g, '\n').trim() }
function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (h > 0) return `h\u00e1 ${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `h\u00e1 ${m}m ${String(sec).padStart(2, '0')}s`
  return `h\u00e1 ${sec}s`
}
// ponytail: estados do prazo por proximidade — ok (silencioso) -> near (>=48h, laranja) -> over (passado, vermelho urgente).
// Quanto mais proximo o prazo, mais alarmante a cor (refinamento 29/08). done nunca alarme.
function dueState(c: Card): { cls: string; icon: string; label: string } {
  if (!c.due || c.colId === 'done') return { cls: '', icon: '', label: '' }
  const dt = c.due - Date.now()
  if (dt < 0) return { cls: 'over', icon: '⚠ ', label: ' · Atrasada' }
  if (dt < 48 * 3600 * 1000) return { cls: 'near', icon: '⏳ ', label: '' }
  return { cls: '', icon: '⏱ ', label: '' }
}
function isOverdue(c: Card): boolean { return dueState(c).cls === 'over' }
function recurLabel(r: NonNullable<Card['recur']>): string { return r === 'daily' ? 'diária' : r === 'weekly' ? 'semanal' : 'mensal' }
function dueBadge(c: Card): string {
  if (!c.due) return ''
  const s = dueState(c)
  const body = `${s.icon}${fmtDue(c.due)}${s.label}`
  return `<span class="kdue${s.cls ? ' ' + s.cls : ''}" title="Prazo: ${fmtDate(c.due)}">${body}</span>`
}
function fmtDue(ts: number): string {
  return new Date(ts).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' })
}
function toInputDate(ts: number): string {
  const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
// ponytail: helpers do temporizador por-cartao (badge + modal). Estado vive no Card (timerMs, timerStartedAt);
// derivamos tudo em runtime (progresso, label, classe). Sem libs; tick reusa o de 1s que ja atualiza o .ktimer.
function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(s / 60), sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}
export function timerRemainingMs(c: Card): number {
  if (!c.timerMs) return 0
  if (!c.timerStartedAt) return c.timerMs  // parado: mostra a duracao total como paused label
  return Math.max(0, c.timerMs - (Date.now() - c.timerStartedAt))
}
export function timerLabel(c: Card): string {
  if (!c.timerMs) return ''
  if (!c.timerStartedAt) return `pausado ${fmtClock(c.timerMs)}`
  return fmtClock(timerRemainingMs(c))
}
export function timerTooltip(c: Card): string {
  if (!c.timerMs) return ''
  if (!c.timerStartedAt) return 'Temporizador parado · carrega em Editar para retomar'
  const rem = timerRemainingMs(c)
  if (rem <= 0) return 'Temporizador concluído · carrega em Editar para reiniciar'
  return `Temporizador · falta ${fmtClock(rem)}`
}
export function timerBadge(c: Card): string {
  if (!c.timerMs || c.archived) return ''
  const remaining = timerRemainingMs(c)
  const cls = c.timerStartedAt && remaining <= c.timerMs * 0.2 ? ' warn'
  : c.timerStartedAt ? ' running' : ''
  return `<span class="kbadge kbadge-timer${cls}" data-timer-card="${c.id}" data-timer-ms="${c.timerMs}" data-timer-started="${c.timerStartedAt || 0}" title="${esc(timerTooltip(c))}">${esc(timerLabel(c))}</span>`
}
function esc(s: string) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }