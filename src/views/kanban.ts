import { api, Board, Card, Coluna, Prioridade, uid } from '../api'
import { icon } from '../ui/icons'
import { openModal } from '../ui/modal'
import { toast } from '../ui/toast'
import { confirmDialog } from '../ui/confirm'

export async function renderKanban(root: HTMLElement, slug: string) {
  let board = await api.kanban.get(slug).catch(() => ({ columns: [], cards: [] } as Board))
  const save = async () => { await api.kanban.put(slug, board) }
  const PRIO: Record<Prioridade, string> = { low:'low', medium:'medium', high:'high' }
  const showArchived = false

  function render() {
    root.innerHTML = `
      <div class="kanban-toolbar" style="display:flex;gap:12px;margin-bottom:16px;align-items:center">
        <button class="btn btn-primary" id="kadd">${icon('plus', 16)} Novo cartão</button>
        <button class="btn btn-ghost" id="karch">${icon('archive', 16)} Arquivados</button>
        <span class="muted" style="font-size:.85rem">${board.cards.filter(c=>!c.archived).length} cartões</span>
      </div>
      <div class="kanban" id="kboard">${board.columns.map(col => `
        <section class="kcol" data-col="${col.id}">
          <h4>${esc(col.name)} <span class="muted" style="font-size:.78rem">${count(col.id)}</span></h4>
          <div class="kcards" data-col="${col.id}">${cardsOf(col.id)}</div>
        </section>`).join('')}
      </div>`
    bind()
    root.querySelector('#kadd')!.addEventListener('click', () => cardModal(null))
    root.querySelector('#karch')!.addEventListener('click', showArchivedModal)
    const boardEl = root.querySelector('#kboard') as HTMLElement
    bindDnd(boardEl)
  }

  function count(colId: string) { return board.cards.filter(c => c.colId === colId && !c.archived).length }
  function prioLabel(p: Prioridade) { return p === 'high' ? 'Alta' : p === 'medium' ? 'Média' : 'Baixa' }

  function cardsOf(colId: string) {
    return board.cards.filter(c => c.colId === colId && !c.archived).map(c => {
      const idx = board.columns.findIndex(x => x.id === c.colId)
      const prev = board.columns[idx-1]?.id, next = board.columns[idx+1]?.id
      return `<article class="kcard" draggable="true" data-id="${c.id}">
        <h5>${esc(c.title)}</h5>
        ${c.description ? `<div class="kdesc">${esc(c.description)}</div>` : ''}
        <div class="kfoot">
          <span class="prio ${PRIO[c.priority]}"><span class="dot"></span>${prioLabel(c.priority)}</span>
          <div class="kops">
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
      if (!btn) return
      const cardEl = btn.closest('.kcard') as HTMLElement | null
      const c = cardEl ? board.cards.find(x => x.id === (cardEl.dataset as { id?: string }).id) : null
      const act = btn.dataset.act
      if (act === 'edit' && c) { cardModal(c); return }
      if (act === 'del' && c) { confirmDialog({ title: 'Eliminar cartão', message: 'Apagar este cartão?' }).then(ok => { if (!ok) return; board.cards = board.cards.filter(x => x.id !== c.id); save().then(render); toast('Eliminado') }); return }
      if (act === 'arch' && c) { c.archived = true; save().then(render); toast('Arquivado'); return }
      if (act === 'move' && c) {
        const dir = parseInt(btn.dataset.dir || '0'); const idx = board.columns.findIndex(x => x.id === c.colId)
        const target = board.columns[idx + dir]; if (!target) return
        c.colId = target.id; save().then(render); return
      }
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
}
function esc(s: string) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }
