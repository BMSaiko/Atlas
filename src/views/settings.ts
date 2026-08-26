import { api, Board } from '../api'
import { icon } from '../ui/icons'
import { toast } from '../ui/toast'
import { navigate } from '../router'

export async function renderSettings(root: HTMLElement, slug: string) {
  let meta = await api.meta(slug).catch(() => null)
  let board: Board = await api.kanban.get(slug).catch(() => ({ columns: [], cards: [] }))
  const saveBoard = async () => { await api.kanban.put(slug, board) }

  root.innerHTML = `
    <div class="settings">
      <div class="card-block">
        <h3>Workdir</h3>
        <form id="meta-form">
          <div class="field"><label for="s-name">Nome</label><input id="s-name" name="name" value="${esc(meta?.name || '')}" required></div>
          <div class="field"><label for="s-desc">Descrição</label><textarea id="s-desc" name="description">${esc(meta?.description || '')}</textarea></div>
          <button class="btn btn-primary" type="submit">Guardar</button>
        </form>
      </div>
      <div class="card-block">
        <h3>Colunas do kanban</h3>
        <div class="col-list" id="collist">
          ${board.columns.map(c => colRow(c.id, c.name)).join('')}
        </div>
        <div class="actions-row" style="margin-top:12px">
          <button class="btn btn-ghost" id="col-add">${icon('plus', 16)} Adicionar coluna</button>
          <button class="btn btn-primary" id="col-save">Guardar colunas</button>
        </div>
      </div>
      <div class="card-block danger-zone">
        <h3>Zona perigosa</h3>
        <p class="muted" style="margin-bottom:12px">Eliminar este workdir apaga todas as notas e cartões. Irreversível.</p>
        <button class="btn btn-danger" id="wd-del">${icon('trash', 16)} Eliminar workdir</button>
      </div>
    </div>`

  const list = root.querySelector('#collist') as HTMLElement
  const renderList = () => { list.innerHTML = board.columns.map(c => colRow(c.id, c.name)).join('') }

  // delegated events on the list
  list.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null
    if (!btn || btn.dataset.act !== 'col-del') return
    const id = (btn.closest('.col-row') as HTMLElement).dataset.col!
    if (board.columns.length <= 1) { toast('Precisa de pelo menos uma coluna'); return }
    const moving = board.cards.filter(c => c.colId === id).length
    if (moving) board.cards.forEach(c => { if (c.colId === id) c.colId = board.columns[0].id })
    board.columns = board.columns.filter(x => x.id !== id)
    renderList(); toast(`${moving ? moving + ' cartões movidos. ' : ''}Coluna removida — guarda para persistir.`)
  })
  list.addEventListener('input', e => {
    const inp = e.target as HTMLInputElement
    if (!inp.classList.contains('col-name')) return
    const col = board.columns.find(x => x.id === (inp.closest('.col-row') as HTMLElement).dataset.col!)
    if (col) col.name = inp.value
  })

  root.querySelector('#col-add')!.addEventListener('click', () => {
    board.columns.push({ id: 'c' + Math.random().toString(36).slice(2, 7), name: 'Nova coluna' })
    renderList(); toast('Coluna adicionada — guarda para persistir')
  })
  root.querySelector('#col-save')!.addEventListener('click', async () => { await saveBoard(); toast('Colunas guardadas') })

  root.querySelector('#meta-form')!.addEventListener('submit', async e => {
    e.preventDefault()
    const form = e.target as HTMLFormElement
    const name = (form.querySelector('[name=name]') as HTMLInputElement).value.trim()
    const description = (form.querySelector('[name=description]') as HTMLTextAreaElement).value
    if (!name) { toast('Nome obrigatório'); return }
    try { await api.patchWorkdir(slug, { name, description }); toast('Guardado'); navigate('/w/' + slug) }
    catch (err: any) { toast('Erro: ' + err.message) }
  })

  root.querySelector('#wd-del')!.addEventListener('click', async () => {
    if (!confirm(`Eliminar definitivamente o workdir "${meta?.name || slug}"?`)) return
    if (!confirm('Tem a certeza absoluta? Esta acção não pode ser desfeita.')) return
    await api.deleteWorkdir(slug); toast('Workdir eliminado'); navigate('/')
  })
}
function colRow(id: string, name: string) {
  return `<div class="col-row" data-col="${id}">
    <input class="col-name" value="${esc(name)}" aria-label="Nome da coluna">
    <button class="btn-icon btn-ghost" data-act="col-del" aria-label="Eliminar coluna">${icon('trash', 16)}</button>
  </div>`
}
function esc(s: unknown) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }
