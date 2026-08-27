import { api, Board, Card, Coluna, Prioridade, uid } from '../api'
import { icon } from '../ui/icons'
import { openModal } from '../ui/modal'
import { toast } from '../ui/toast'
import { confirmDialog } from '../ui/confirm'
import { linkify } from '../ui/text'

export async function renderKanban(root: HTMLElement, slug: string) {
  let board = await api.kanban.get(slug).catch(() => ({ columns: [], cards: [] } as Board))
  const save = async () => { await api.kanban.put(slug, board); refreshSideCount() }
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
  const P: Record<Prioridade, number> = { low: 0, medium: 1, high: 2 }
  type SortKey = 'pos'|'prio'|'date'|'title'
  let sortKey: SortKey = (localStorage.getItem(`atlas.kbsort.${slug}`) as SortKey) || 'pos'
  const cmp = (a: Card, b: Card): number => {
    if (sortKey === 'prio') return P[b.priority] - P[a.priority]
    if (sortKey === 'date') return b.ts - a.ts
    if (sortKey === 'title') return a.title.localeCompare(b.title, 'pt')
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
        <button class="btn btn-primary kbdhint" id="kadd" aria-describedby="kadd-tip">${icon('plus', 16)} Novo cartão<span class="kbdhint-tip" id="kadd-tip" role="tooltip">Novo cartão <kbd>Ctrl</kbd>+<kbd>K</kbd></span></button>
        <button class="btn btn-ghost" id="karch">${icon('archive', 16)} Arquivados</button>
        <span class="kb-right">
          <span class="muted" style="font-size:.85rem">${board.cards.filter(c=>!c.archived).length} cartões</span>
          <label class="muted" style="font-size:.85rem;display:flex;align-items:center;gap:6px">Ordenar
          <select id="k-sort">
            <option value="pos" ${sortKey==='pos'?'selected':''}>Posição</option>
            <option value="prio" ${sortKey==='prio'?'selected':''}>Prioridade</option>
            <option value="date" ${sortKey==='date'?'selected':''}>Data</option>
            <option value="title" ${sortKey==='title'?'selected':''}>Título</option>
          </select>
        </label>
        </span>
      </div>
      <div class="kanban" id="kboard">${board.columns.map(col => `
        <section class="kcol" data-col="${col.id}">
          <h4>${esc(col.name)} <span class="muted" style="font-size:.78rem">${count(col.id)}</span></h4>
          <div class="kcards" data-col="${col.id}">${cardsOf(col.id)}</div>
        </section>`).join('')}
      </div>`
    bind()
    root.querySelector('#kadd')!.addEventListener('click', () => cardModal(null))
    root.querySelector('#k-sort')!.addEventListener('change', e => {
      sortKey = (e.target as HTMLSelectElement).value as SortKey
      board.cards.sort(cmp)
      localStorage.setItem(`atlas.kbsort.${slug}`, sortKey)
      save().then(render)
    })
    root.querySelector('#karch')!.addEventListener('click', showArchivedModal)
    const boardEl = root.querySelector('#kboard') as HTMLElement
    boardEl.addEventListener('keydown', e => {
      const tEl = e.target as HTMLElement
      if (tEl.classList.contains('kcard') && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault()
        const c = board.cards.find(x => x.id === tEl.dataset.id); if (c) viewModal(c)
      }
    })
    bindDnd(boardEl)

  }

  function count(colId: string) { return board.cards.filter(c => c.colId === colId && !c.archived).length }
  function prioLabel(p: Prioridade) { return p === 'high' ? 'Alta' : p === 'medium' ? 'Média' : 'Baixa' }

  function cardsOf(colId: string) {
    return board.cards.filter(c => c.colId === colId && !c.archived).sort(cmp).map(c => {
      const idx = board.columns.findIndex(x => x.id === c.colId)
      const prev = board.columns[idx-1]?.id, next = board.columns[idx+1]?.id
      return `<article class="kcard${c.result ? ' has-output' : ''}" draggable="true" tabindex="0" data-id="${c.id}">
        <div class="ktitle"><h5>${esc(c.title)}</h5><span class="kdate">${fmtDate(c.ts)}</span></div>
        ${c.description ? `<div class="kdesc">${linkify(c.description)}</div>` : ''}
        ${c.colId === 'doing' && !c.result ? kdoing() : ''}
        ${c.result ? `${resultHtml(c.result)}` : ''}
        ${c.colId === 'review' ? `<div class="kreview">
          <button class="btn btn-primary btn-sm" data-act="approve">${icon('check', 14)} Aprovar</button>
          <button class="btn btn-ghost btn-sm" data-act="reject">${icon('pencil', 14)} Refinar</button>
        </div>` : ''}
        <div class="kfoot">
          <span class="prio ${PRIO[c.priority]}"><span class="dot"></span>${prioLabel(c.priority)}</span>
          <div class="kops">
            <button class="btn-icon btn-ghost" data-act="run" aria-label="Executar no Hermes">${icon('play', 15)}</button>
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

  function bind() {
    const boardEl = root.querySelector('#kboard') as HTMLElement
    boardEl.addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null
      if (!btn) {
        const cardEl = (e.target as HTMLElement).closest('.kcard') as HTMLElement | null
        const c = cardEl ? board.cards.find(x => x.id === cardEl.dataset.id) : null
        if (c) viewModal(c)
        return
      }
      const cardEl = btn.closest('.kcard') as HTMLElement | null
      const c = cardEl ? board.cards.find(x => x.id === (cardEl.dataset as { id?: string }).id) : null
      const act = btn.dataset.act
      if (act === 'edit' && c) { cardModal(c); return }
      if (act === 'del' && c) { confirmDialog({ title: 'Eliminar cartão', message: 'Apagar este cartão?' }).then(ok => { if (!ok) return; board.cards = board.cards.filter(x => x.id !== c.id); save().then(render); toast('Eliminado') }); return }
      if (act === 'run' && c) { runCard(c); return }
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

  function runCard(c: Card) {
    toast('A abrir WezTerm com o Hermes...')
    fetch(`/api/w/${slug}/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId: c.id }),
    }).then(r => r.json()).then((d: any) => {
      if (d && d.ok) { c.colId = 'doing'; save().then(render) }
      else toast((d && d.error) || 'Erro ao executar')
    }).catch(() => toast('Falha ao abrir Hermes'))
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

  // ponytail: pede permissao de notificacao uma vez (default -> request); ignorado se ja decidida
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission()

  // ponytail: poll board while any card is in 'doing' so progress/result appears without manual refresh
  setInterval(async () => {
    if (!document.getElementById('kboard')) return
    const hasDoing = board.cards.some(c => !c.archived && c.colId === 'doing')
    if (!hasDoing) return
    const fresh = await api.kanban.get(slug).catch(() => null)
    if (!fresh) return
    if (JSON.stringify(board) !== JSON.stringify(fresh)) {
      // ponytail: tarefa 'acabou' noutro tab = qualquer card que transita para 'review' -> notifica
      for (const fc of fresh.cards) {
        const pc = board.cards.find(c => c.id === fc.id)
        if (pc && pc.colId !== fc.colId && fc.colId === 'review') notifyCard(fc)
      }
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

const KDOING_WORDS = ['doing', 'a trabalhar', 'em curso', 'a processar', 'ajustando', 'a pensar', 'a fazer']
let kdoingIdx = 0
// ponytail: rotaciona palavras (nao so 'doing') + 3 pontos animados (CSS kdblink)
// a palavra rodada em tempo real por um interval de 3s (ver renderKanban)
function kdoing(): string {
  const w = KDOING_WORDS[kdoingIdx % KDOING_WORDS.length]
  return `<div class="kdoing"><span class="kword">${w}</span><span class="kdot" style="--i:0"></span><span class="kdot" style="--i:1"></span><span class="kdot" style="--i:2"></span></div>`
}
function resultHtml(r: string): string {
  // ponytail: primeira linha = destaque (ex. 'Task cumprida: ...'); corpo separado
  const nl = r.indexOf('\n')
  const title = nl === -1 ? r : r.slice(0, nl)
  const body = nl === -1 ? '' : r.slice(nl + 1)
  return `<div class="kresult"><div class="kresult-title">${esc(title)}</div>${body ? `<div class="kresult-body">${esc(deindent(body))}</div>` : ''}</div>`
}
function deindent(s: string): string { return s.replace(/^\s+/gm, '').replace(/\n{2,}/g, '\n').trim() }
// ponytail: notificacao de browser quando um card entra em review (agente terminou noutro tab)
function notifyCard(c: Card) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  try { new Notification(`Atlas · ${c.title}`, { body: 'Tarefa concluída — Review/Revisão' }) } catch { /* ctor ausente */ }
}
function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
function esc(s: string) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }