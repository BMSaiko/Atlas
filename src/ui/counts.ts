import { api } from '../api'

// ponytail: badge de contagem nos tabs do workspace (Notas ativas / Cartoes em curso).
// Partilhado por workspace.ts (switch/init) e pelas views notes/kanban (apos cada save),
// para o count atualizar de forma reativa ao arquivar nota ou concluir cartao.
export async function refreshTabCounts(slug: string) {
  const [notes, board] = await Promise.all([
    api.notes.get(slug).catch(() => [] as { archived?: boolean }[]),
    api.kanban.get(slug).catch(() => ({ cards: [] as { archived?: boolean; colId?: string }[] })),
  ])
  const set = (id: string, n: number) => {
    const el = document.getElementById(id)
    if (!el) return
    el.querySelector('.side-count')?.remove()
    if (n > 0) el.insertAdjacentHTML('beforeend', `<span class="side-count">${n}</span>`)
  }
  set('tab-notes', notes.filter(n => !n.archived).length)
  set('tab-kanban', board.cards.filter(c => !c.archived && c.colId !== 'done').length)
}
