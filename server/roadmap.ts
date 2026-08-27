// Roadmap markdown -> kanban (notas + cards). Migra tarefas ABERTAS de um roadmap
// para o kanban do workdir. ponytail: cobre as 3 formas em que tarefas abertas
// vivem num roadmap (checkboxes `- [ ]`, tabela BACKLOG `| Txx | detalhe |`,
// bullets de issues pendentes) e filtra fechadas pelo marcador DONE (verificado
// no texto completo da linha, nao so no prefixo) — o mesmo padrao do skill
// kanban-project-boards.

export type Prio = 'low' | 'medium' | 'high'

export interface ImportedTask {
  title: string
  detail: string
  raw: string
  priority: Prio
}

// ponytail: marcadores de "feito" podem aparecer fundo na celula (T75/T80/T83).
// ponytail: marcador real e um TOKEN em maiusculas (DONE/FEITO/BLOCKED...). Nao casar lowercase 'blocked'/'feita'/'feita' em prosa corrente (ex. 'JS-rendered+blocked', 'ser feita ANTES') que sao falso positivo.
const DONE = /\b(?:DONE|FEITO|FEITA|DESCARTADA|BLOCKED|SKIP|DROPPED|NAO\s*[\- ]?\s*PROBLEMA)\b/
const TX = /\bT(\d+(?:\.\d+)?)\b/i

function strip(t: string) {
  return t.replace(/^\s*\*\*/, '').replace(/\*\*\s*$/, '').replace(/^`|`$/g, '').trim()
}
function prioFrom(s: string): Prio {
  if (/\[(alta|high)\]/i.test(s)) return 'high'
  if (/\[(media|medium)\]/i.test(s)) return 'medium'
  if (/\[(baixa|low)\]/i.test(s)) return 'low'
  if (/\[P0\]/i.test(s) || /\[P1\]/i.test(s)) return 'high'
  if (/\[P2\]/i.test(s)) return 'medium'
  return 'low'
}

export function parseRoadmap(md: string): ImportedTask[] {
  const lines = md.split(/\r?\n/)
  // cross-check: tasks declaradas DONE noutra secao do documento ficam de fora
  // (tabela BACKLOG pode estar stale vs "PENDENTES RECENTES" — caso T60).
  const done = new Set<string>()
  for (const line of lines) {
    if (!DONE.test(line)) continue
    const m = line.match(TX)
    if (m) done.add('T' + m[1])
  }
  const out: ImportedTask[] = []
  const seen = new Set<string>()
  const add = (title: string, detail: string, raw: string) => {
    title = strip(title)
    if (!title) return
    const tx = title.match(TX)
    // so tasks simples (nao sub-tarefas T10.2) sao cross-checadas contra o done-set
    if (tx && !/\d\.\d/.test(tx[1]) && done.has('T' + tx[1])) return
    if (DONE.test(raw)) return
    const key = title.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push({ title, detail: detail.trim(), raw: raw.trim(), priority: prioFrom(raw) })
  }

  let inBacklog = false
  for (const line of lines) {
    if (/^##\s*BACKLOG/i.test(line)) inBacklog = true
    else if (/^##\s/.test(line)) inBacklog = false

    const cb = line.match(/^\s*-\s*\[ \]\s*(.+)$/)
    if (cb && !DONE.test(line)) { add(cb[1], cb[1], line); continue }

    if (inBacklog) {
      if (!line.startsWith('|')) continue
      const cells = line.split('|').map(c => c.trim())
      if (cells.length < 3) continue
      const taskCell = cells[1]
      if (!/T\d+/i.test(taskCell)) continue // header | Task | Notas | e separadores |---|---|
      add(taskCell, cells[2] || '', line)
    } else {
      // bullet de issue pendente fora de tabela: "- 132 2FA — ..."
      const bt = line.match(/^\s*-\s+(\d+[\s\S]*)$/)
      if (bt && !DONE.test(line)) add(bt[1], bt[1], line)
    }
  }
  return out
}
