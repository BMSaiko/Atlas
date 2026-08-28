import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'

import { router } from './router'
import { applyTheme } from './ui/theme'
import { api } from './api'
import { notify } from './ui/notifs'
applyTheme()
router.init()
watchReviewTransitions()
watchBrainstormCompletions()

// ponytail: as notificacoes de review sao GLOBAIS (qualquer vista/tab) — antes so disparavam no poll
// da view kanban, por isso nada aparecia a partir do dashboard ou doutra workdir (o poll nem corria).
// Dedup por (slug,card): notifica na 1a transicao para 'review'; enquanto o card la permanece nao
// volta a notificar; se sair e reentrar, notifica outra vez. 'seen' cresce no maximo o nº de cards.
function watchReviewTransitions() {
  const seen = new Map<string, string>()
  setInterval(async () => {
    let slugs: string[]
    try { slugs = (await api.workdirs()).map(w => w.slug) } catch { return }
    for (const slug of slugs) {
      const b = await api.kanban.get(slug).catch(() => null)
      if (!b) continue
      for (const c of b.cards) {
        if (c.archived) continue
        const key = `${slug}:${c.id}`
        const prev = seen.get(key)
        if (prev !== undefined && prev !== 'review' && c.colId === 'review') {
          notify(`Atlas · ${c.title}`, 'Tarefa concluída — Review/Revisão')
        }
        seen.set(key, c.colId)
      }
    }
  }, 3000)
}

// ponytail: notificacao global de fim de brainstorm (padrao watchReviewTransitions): corre em
// qualquer vista. Dedup por transicao running->done do run .status -> so notifica quando um run
// termina NOVAMENTE, nunca para runs ja concluidos antes de abrir a app (prev===true na 1a vez).
function watchBrainstormCompletions() {
  const lastRunning = new Map<string, boolean>()
  setInterval(async () => {
    let slugs: string[]
    try { slugs = (await api.workdirs()).map(w => w.slug) } catch { return }
    for (const slug of slugs) {
      const d = await api.run.output(slug, 'brainstorm', 0).catch(() => null)
      if (!d) continue
      const wasRunning = lastRunning.get(slug)
      const running = !d.done
      if (wasRunning === true && !running) {
        const ok = (d.code ?? 0) === 0
        notify(ok ? 'Atlas · Brainstorm concluído' : 'Atlas · Brainstorm com erro',
               ok ? 'Notas novas criadas no workdir.' : 'O brainstorm terminou com erro (código ' + (d.code ?? 0) + ') — vê o log.')
      }
      lastRunning.set(slug, running)
    }
  }, 3000)
}
