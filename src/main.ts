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
watchDueReminders()
watchTimerAlarms()
watchRecurrence()

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


// ponytail: lembrete por due proximo — padrao watchReviewTransitions (poll global, dedup por chave).
// Dispara UMA notificacao nativa + toast quando um card nao-arquivado entra na janela [0, LIMIAR].
// Quando o due passa, limpa a entrada (nao volta a notificar nem no re-load).
const DUE_LIMIT_MS = 30 * 60 * 1000  // 30 min
const dueNotified = new Map<string, number>()  // key = `${slug}:${cardId}` -> due ts (para limpar quando passa)
function watchDueReminders() {
  setInterval(async () => {
    let slugs: string[]
    try { slugs = (await api.workdirs()).map(w => w.slug) } catch { return }
    const now = Date.now()
    for (const slug of slugs) {
      const b = await api.kanban.get(slug).catch(() => null)
      if (!b) continue
      for (const c of b.cards) {
        if (c.archived || c.colId === 'done') continue
        if (!c.due) continue
        const key = `${slug}:${c.id}`
        const dt = c.due - now
        if (dt <= 0) { dueNotified.delete(key); continue }  // prazo passou — limpar para nao spamar
        if (dt > DUE_LIMIT_MS) continue
        if (dueNotified.has(key)) continue
        notify(`Atlas · ${c.title}`, `Prazo aproxima-se (${Math.round(dt / 60000)} min)`)
        dueNotified.set(key, c.due)
      }
    }
  }, 30000)
}

// ponytail: alarme por-cartao do temporizador (per-card countdown). Padrao watchDueReminders: poll global a 1s,
// dedup por chave. Quando timerMs && timerStartedAt && elapsed >= timerMs => dispara 1 notif + toast, limpa
// timerStartedAt (mantem timerMs para o utilizador retomar). Limpa entradas mortas (card arquivado ou timerMs apagado).
const timerFired = new Set<string>()  // keys ja disparadas; limpas quando timerMs desaparece/arquivado
function watchTimerAlarms() {
  setInterval(async () => {
    let slugs: string[]
    try { slugs = (await api.workdirs()).map(w => w.slug) } catch { return }
    for (const slug of slugs) {
      const b = await api.kanban.get(slug).catch(() => null)
      if (!b) continue
      for (const c of b.cards) {
        const key = `${slug}:${c.id}`
        if (c.archived || !c.timerMs || !c.timerStartedAt) { timerFired.delete(key); continue }
        if (Date.now() - c.timerStartedAt < c.timerMs) continue
        if (timerFired.has(key)) continue
        notify(`Atlas · ${c.title}`, 'Temporizador concluído')
        timerFired.add(key)
        // limpa startedAt (mantem timerMs); utilizador pode retomar com o botao Retomar no modal
        try {
          delete c.timerStartedAt
          const r = await api.kanban.put(slug, b)
          if (r && r.ver) b.ver = r.ver
        } catch { /* ignora — UI nao vai refletir, mas alarme ja disparou */ }
      }
    }
  }, 1000)
}

// ponytail: cards recorrentes — quando uma ocorrencia e concluida (done ou arquivada) e nao ha
// ocorrencia ativa com o mesmo occurrenceOf, cria a proxima em 'todo' com due avancado.
// Coexiste com a entrada do template: occurrenceOf guarda a cadeia; sem chave = 1a ocorrencia.
type RecurKind = NonNullable<import('./api').Card['recur']>
// ponytail: recalcular o proximo prazo a partir de hoje (nao do due antigo) — evita "amanha" cumulativo.
function nextDue(prev: number | undefined, kind: RecurKind): number {
  const d = new Date()
  if (kind === 'daily') d.setDate(d.getDate() + 1)
  else if (kind === 'weekly') d.setDate(d.getDate() + 7)
  else d.setMonth(d.getMonth() + 1)
  return d.getTime()
}
function watchRecurrence() {
  // ponytail: gate demo de ciclo de vida — valida a logica "done -> novo card non-dup" sem browser.
  // Falha cedo se a funcao nextia deixar de cobrir as 3 periodicidades (defesa contra refactor).
  ;(() => {
    const ms = 24 * 3600 * 1000
    const d = nextDue(Date.now(), 'daily'); const w = nextDue(Date.now(), 'weekly'); const m = nextDue(Date.now(), 'monthly')
    if (Math.abs((d - Date.now()) - ms) > ms * 0.1) throw new Error('recur demo: daily off')
    if (Math.abs((w - Date.now()) - 7 * ms) > 7 * ms * 0.1) throw new Error('recur demo: weekly off')
    if (m <= Date.now()) throw new Error('recur demo: monthly not in future')
    console.log('atlas recur: self-check ok')
  })()
  setInterval(async () => {
    let slugs: string[]
    try { slugs = (await api.workdirs()).map(w => w.slug) } catch { return }
    for (const slug of slugs) {
      let b = await api.kanban.get(slug).catch(() => null)
      if (!b) continue
      let changed = false
      for (const c of b.cards) {
        if (!c.recur) continue
        // ponytail: o card "template" fica concluido/arquivado; so materializa nova ocorrencia uma vez
        const isClosed = c.archived || c.colId === 'done'
        if (!isClosed) continue
        const key = c.occurrenceOf || c.id
        // ponytail: guard anti-loop — se ja existe uma ocorrencia ativa com o mesmo occurrenceOf, nao duplica
        const existsActive = b.cards.some(x => !x.archived && x.colId !== 'done' && x !== c && x.occurrenceOf === key)
        if (existsActive) continue
        // ponytail: o proximo card herda recur e occurrenceOf; due avança a partir de hoje (nao cumulativo)
        const next: import('./api').Card = {
          id: Math.random().toString(36).slice(2, 10),
          colId: 'todo',
          title: c.title,
          description: c.description,
          priority: c.priority,
          ts: Date.now(),
          archived: false,
          recur: c.recur,
          occurrenceOf: key,
          due: nextDue(c.due, c.recur),
        }
        b.cards.push(next)
        changed = true
      }
      if (!changed) continue
      // ponytail: PUT com retry 409 (escritor concorrente) — re-sync + re-aplica e retenta 1x
      try {
        const r = await api.kanban.put(slug, b)
        if (r && r.ver) b.ver = r.ver
      } catch (e: any) {
        if (e?.status !== 409) throw e
        const fresh = await api.kanban.get(slug)
        for (const x of b.cards) if (!fresh.cards.some(f => f.id === x.id)) fresh.cards.push(x)
        await api.kanban.put(slug, fresh)
      }
    }
  }, 30000)
}


// ponytail: watchdog de worker crash. Polla /orphans a cada 30s; quando detecta card .status=running
// com log parado > 90s (heuristica do server), notifica no UI e reseta o card doing->todo. Dedup por
// cardId para nao voltar a notificar.
function watchOrphanCrashes() {
  const notified = new Set<string>()  // cardIds ja' notificados
  setInterval(async () => {
    let slugs: string[]
    try { slugs = (await api.workdirs()).map(w => w.slug) } catch { return }
    for (const slug of slugs) {
      const d = await api.run.orphans(slug).catch(() => null)
      if (!d || !d.orphans || !d.orphans.length) continue
      for (const o of d.orphans) {
        if (notified.has(o.cardId)) continue
        notified.add(o.cardId)
        // ponytail: card h1y3yfsy crash diagnostics — notification especifica por classification.
        const klass = o.classification || 'CRASH_WRAPPER_DIED'
        notify('Atlas - ' + klass, '"' + o.title + '" parou de responder - voltou a To Do (' + klass + ')')
        // reset doing->todo
        try {
          const b = await api.kanban.get(slug)
          if (!b) continue
          const c = b.cards.find((x: any) => x.id === o.cardId)
          if (!c || c.archived || c.colId !== 'doing') continue
          // ponytail: card h1y3yfsy — gravar resultado estruturado: classificacao + tail do log + meta
          // (cardAge, logSize, lastHeartbeatAt). O user ve no viewModal sem precisar de abrir o
          // terminal pane. Mantem crashRetry=true para o botao Run ganhar badge "⚠ retry apos crash".
          const tailSnippet = o.logTail ? (o.logTail.length > 240 ? o.logTail.slice(-240) : o.logTail) : '(log vazio)'
          c.result = klass + ' (cardAge=' + Math.round(o.cardAgeMs/1000) + 's, logSize=' + o.logSize +
            ', lastHeartbeatAt=' + (o.lastHeartbeatAt ? '~' + Math.round((Date.now() - o.lastHeartbeatAt)/1000) + 's atras' : 'n/a') + ').\nUltimas linhas do log:\n' + tailSnippet
          c.colId = 'todo'
          delete c.startedAt
          c.crashRetry = true
          c.crashAt = Date.now()
          if (o.orphanWorktreePath) c.orphanWorktreePath = o.orphanWorktreePath
          const r = await api.kanban.put(slug, b)
          if (r && r.ver) b.ver = r.ver
        } catch { /* best-effort */ }
      }
    }
  }, 30000)
}
watchOrphanCrashes()
