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
