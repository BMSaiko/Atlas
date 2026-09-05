import { api } from '../api'

// ponytail: badge de contagem nos tabs do workspace (Notas ativas / Cartoes em curso).
// Partilhado por workspace.ts (switch/init) e pelas views notes/kanban (apos cada save),
// para o count atualizar de forma reativa ao arquivar nota ou concluir cartao.
export async function refreshTabCounts(slug: string) {
  const notes = await api.notes.get(slug).catch(() => null)
  const notesArr: { archived?: boolean }[] = notes?.items ?? []
  const set = (id: string, n: number) => {
    const el = document.getElementById(id)
    if (!el) return
    el.querySelector('.side-count')?.remove()
    if (n > 0) el.insertAdjacentHTML('beforeend', `<span class="side-count">${n}</span>`)
  }
  set('tab-notes', notesArr.filter(n => !n.archived).length)
}
