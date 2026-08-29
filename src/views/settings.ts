import { api, BoardDoc } from '../api'
import { icon } from '../ui/icons'
import { toast } from '../ui/toast'
import { confirmDialog } from '../ui/confirm'
import { navigate } from '../router'
import { getTheme, setMode, shiftSchedule, setSeasonMode, seasonSchedule } from '../ui/theme'
import { notifState, requestNotifs } from '../ui/notifs'

export async function renderSettings(root: HTMLElement, slug: string) {
  const th = getTheme()
  let meta = await api.meta(slug).catch(() => null)
  let board: BoardDoc = await api.kanban.get(slug).catch(() => ({ ver: 0, columns: [], cards: [] }))
  const adopt = (d: { ver?: number } | undefined) => { if (d && typeof d.ver === 'number') board.ver = d.ver }
  const saveBoard = async () => { adopt(await api.kanban.put(slug, board)) }

  root.innerHTML = `
    <div class="settings">
      <div class="card-block">
        <h3>Workdir</h3>
        <form id="meta-form">
          <div class="field"><label for="s-name">Nome</label><input id="s-name" name="name" value="${esc(meta?.name || '')}" required></div>
          <div class="field"><label for="s-desc">Descrição</label><textarea id="s-desc" name="description">${esc(meta?.description || '')}</textarea></div>
          <div class="field"><label for="s-repo">Repo (path absoluto)</label><input id="s-repo" name="repo" placeholder="ex. C:\Users\bruno\proj" value="${esc(meta?.repo || '')}"></div>
          <div class="field"><label>Icon do workdir</label>
            <div class="icon-grid" id="icon-grid">${(await api.icons()).map(n =>
              `<button type="button" class="icon-cell${n === (meta?.icon || '') ? ' sel' : ''}" data-icon="${n}" aria-label="${n.replace(/\.svg$/,'')}"><img src="/icons/${n}" alt=""></button>`).join('')}
            </div>
          </div>
          <button class="btn btn-primary" type="submit">Guardar</button>
        </form>
      </div>
      <div class="card-block">
        <h3>Tema</h3>
        <p class="muted" style="margin-bottom:12px">Em automático o tema segue a hora do dia. Em manual escolhes o tema no indicador da barra lateral (Dia / Entardecer / Noite), que se esconde quando voltas a automático.</p>

        <div class="tema-sched" style="margin-bottom:12px;font-size:.85rem">${shiftSchedule().map(sd => `<span style="display:inline-block;margin-right:16px"><b>${esc(sd.label)}</b> ${sd.range}</span>`).join()}</div>
        <div class="tema-sched" style="margin-bottom:12px;font-size:.85rem">${seasonSchedule().map(sd => `<span style="display:inline-block;margin-right:16px"><b>${esc(sd.label)}</b> ${sd.range}</span>`).join()}</div>
        <div class="field"><label for="se-mode">Estação do ano</label>
          <select id="se-mode">
            <option value="auto" ${th.seasonMode === 'auto' ? 'selected' : ''}>Automático — segue a estação do mês</option>
            <option value="manual" ${th.seasonMode === 'manual' ? 'selected' : ''}>Manual — fico fixo na estação atual</option>
          </select></div>
        <div class="field"><label for="th-mode">Troca automática</label>
          <select id="th-mode">
            <option value="auto" ${th.mode === 'auto' ? 'selected' : ''}>Automático — segue a hora do dia</option>
            <option value="manual" ${th.mode === 'manual' ? 'selected' : ''}>Manual — fico fixo no meu tema</option>
          </select></div>
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
      <div class="card-block">
        <h3>Notificações</h3>
        <p class="muted" style="margin-bottom:12px">Notificações do navegador avisam quando um cartão entra em revisão e no fim do pomodoro.</p>
        <button class="btn" id="notif-btn" type="button"></button>
      </div>
      <div class="card-block">
        <h3>Backup</h3>
        <p class="muted" style="margin-bottom:12px">Descarregar ou carregar o workdir inteiro (meta + notas + kanban) como um único ficheiro JSON. Útil para portabilidade entre instalações e para um snapshot fora do git.</p>
        <div class="actions-row">
          <button class="btn" id="bk-export" type="button">Exportar bundle (.json)</button>
          <button class="btn btn-ghost" id="bk-import-btn" type="button">Importar bundle…</button>
          <input type="file" id="bk-import" accept="application/json,.json" hidden>
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
    const colName = board.columns.find(x => x.id === id)?.name || ''
    if (board.columns.length <= 1) { toast('Precisa de pelo menos uma coluna'); return }
    confirmDialog({ title: 'Eliminar coluna', message: `Apagar a coluna "${colName}"?` }).then(ok => { if (!ok) return
    const moving = board.cards.filter(c => c.colId === id).length
    if (moving) board.cards.forEach(c => { if (c.colId === id) c.colId = board.columns[0].id })
    board.columns = board.columns.filter(x => x.id !== id)
    renderList(); toast(`${moving ? moving + ' cartões movidos. ' : ''}Coluna removida — guarda para persistir.`)
    })
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

  // --- Tema: modo auto/manual (a escolha do tema fica no indicador da sidebar) ---
  root.querySelector('#th-mode')!.addEventListener('change', e => {
    setMode((e.target as HTMLSelectElement).value === 'manual' ? 'manual' : 'auto')
  })
  root.querySelector('#se-mode')!.addEventListener('change', e => {
    setSeasonMode((e.target as HTMLSelectElement).value === 'manual' ? 'manual' : 'auto')
  })

  // --- Notificações: pedir permissão SÓ num user gesture (click) ---
  const notifBtn = root.querySelector('#notif-btn') as HTMLButtonElement
  const renderNotifBtn = () => {
    const st = notifState()
    const granted = st === 'granted'
    const denied = st === 'denied'
    notifBtn.innerHTML = `${icon(granted ? 'bell' : (denied ? 'bellOff' : 'bell'), 16)} ${granted ? 'Notificações ativadas' : (denied ? 'Bloqueadas no navegador' : 'Ativar notificações')}`
    notifBtn.disabled = granted || denied
    notifBtn.title = denied ? 'Desbloqueia nas definições de permissões do navegador' : ''
  }
  renderNotifBtn()
  notifBtn.addEventListener('click', async () => {
    const st = await requestNotifs()
    renderNotifBtn()
    if (st === 'granted') toast('Notificações ativadas')
    else if (st === 'denied') toast('Notificações bloqueadas no navegador')
  })

  let selIcon = meta?.icon
  const grid = root.querySelector('#icon-grid') as HTMLElement
  grid.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('[data-icon]') as HTMLElement | null
    if (!btn) return
    selIcon = btn.dataset.icon
    grid.querySelectorAll('[data-icon]').forEach(b => b.classList.toggle('sel', b === btn))
  })
  root.querySelector('#meta-form')!.addEventListener('submit', async e => {
    e.preventDefault()
    const form = e.target as HTMLFormElement
    const name = (form.querySelector('[name=name]') as HTMLInputElement).value.trim()
    const description = (form.querySelector('[name=description]') as HTMLTextAreaElement).value
    const repo = (form.querySelector('[name=repo]') as HTMLInputElement).value.trim()
    if (!name) { toast('Nome obrigatório'); return }
    try { await api.patchWorkdir(slug, { name, description, icon: selIcon, repo }); toast('Guardado'); navigate('/w/' + slug) }
    catch (err: any) { toast('Erro: ' + err.message) }
  })

  root.querySelector('#wd-del')!.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Eliminar workdir', message: `Eliminar definitivamente "${meta?.name || slug}"? Esta acção não pode ser desfeita.` })
    if (!ok) return
    await api.deleteWorkdir(slug); toast('Workdir eliminado'); navigate('/')
  })

  // --- Backup: exportar / importar bundle (meta+notes+kanban) ---
  root.querySelector('#bk-export')!.addEventListener('click', async () => {
    try {
      const b = await api.bundle.get(slug)
      const blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const ymd = new Date().toISOString().slice(0, 10)
      a.href = url; a.download = `atlas-${slug}-${ymd}.json`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast('Bundle exportado')
    } catch (err: any) { toast('Erro a exportar: ' + err.message) }
  })
  root.querySelector('#bk-import-btn')!.addEventListener('click', () => (root.querySelector('#bk-import') as HTMLInputElement).click())
  root.querySelector('#bk-import')!.addEventListener('change', async e => {
    const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return
    let bundle: any
    try {
      const text = await file.text()
      bundle = JSON.parse(text)
    } catch { toast('Ficheiro JSON invalido'); (e.target as HTMLInputElement).value = ''; return }
    // ponytail: valida shape minimo — recusar bundle malformado NAO sobrescreve estado.
    if (!bundle || typeof bundle !== 'object' || !bundle.meta || !bundle.notes || !bundle.kanban) {
      toast('Bundle invalido: requer meta+notes+kanban'); (e.target as HTMLInputElement).value = ''; return
    }
    const ok = await confirmDialog({
      title: 'Importar bundle',
      message: `Sobrescrever "${meta?.name || slug}" com o conteudo do bundle? Os dados actuais do workdir serao substituidos (a vault guarda um auto-commit do estado anterior).`,
    })
    if (!ok) { (e.target as HTMLInputElement).value = ''; return }
    try {
      await api.bundle.put(slug, { meta: bundle.meta, notes: bundle.notes, kanban: bundle.kanban })
      toast('Bundle importado')
      navigate('/w/' + slug + '/settings')
    } catch (err: any) { toast('Erro a importar: ' + err.message) }
    finally { (e.target as HTMLInputElement).value = '' }
  })
}
function colRow(id: string, name: string) {
  return `<div class="col-row" data-col="${id}">
    <input class="col-name" value="${esc(name)}" aria-label="Nome da coluna">
    <button class="btn-icon btn-ghost" data-act="col-del" aria-label="Eliminar coluna">${icon('trash', 16)}</button>
  </div>`
}
function esc(s: unknown) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }
