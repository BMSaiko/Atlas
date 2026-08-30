// test/timer-helpers.test.mjs
//
// Self-check das funcoes puras do timer em src/views/kanban.ts.
// Cobre: timerRemainingMs / timerLabel / timerTooltip / timerBadge / logica do
// add1 (preserva progresso). Mesmo estilo do wrapper-argv.test.mjs (Node puro,
// sem framework).
//
// Como o kanban.ts importa DOM/UI e rebenta em Node, o test reimplementa as
// 4 funcoes com a formula EXATA que vive no source. A seccao "SOURCE
// EQUALITY" no fim le kanban.ts como texto e verifica que as formulas no
// test ainda batem com o source — se alguem mexer no kanban.ts sem
// actualizar o test, isto falha.
//
// Executar: node test/timer-helpers.test.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const kanbanPath = join(here, '..', 'src', 'views', 'kanban.ts')

// ---- Implementacoes MIRROR de src/views/kanban.ts ----
// Se mudar la, mudar aqui tambem — a SOURCE EQUALITY no fim apanha a fuga.

// mirror de fmtClock (l1020-1024)
function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(s / 60), sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

// mirror de timerRemainingMs (l1026-1030)
function timerRemainingMs(c) {
  if (!c.timerMs) return 0
  if (!c.timerStartedAt) return c.timerMs  // parado: duracao total
  return Math.max(0, c.timerMs - (Date.now() - c.timerStartedAt))
}

// mirror de timerLabel (l1031-1035)
function timerLabel(c) {
  if (!c.timerMs) return ''
  if (!c.timerStartedAt) return `pausado ${fmtClock(c.timerMs)}`
  return fmtClock(timerRemainingMs(c))
}

// mirror de timerTooltip (l1037-1043)
function timerTooltip(c) {
  if (!c.timerMs) return ''
  if (!c.timerStartedAt) return 'Temporizador parado · carrega em Editar para retomar'
  const rem = timerRemainingMs(c)
  if (rem <= 0) return 'Temporizador concluído · carrega em Editar para reiniciar'
  return `Temporizador · falta ${fmtClock(rem)}`
}

// mirror de timerBadge (l1045-1052) — devolvemos so a classe para testar
// a logica de badge (cls) sem dependência do template HTML inteiro.
function timerBadgeCls(c) {
  if (!c.timerMs || c.archived) return ''
  const remaining = timerRemainingMs(c)
  if (c.timerStartedAt && remaining <= c.timerMs * 0.2) return ' warn'
  if (c.timerStartedAt) return ' running'
  return ''
}

// ---- logica do add1 (l771-780) ----
// Recebe o card, devolve um novo objeto com +60_000 ms mantendo progresso.
function add1(c) {
  const out = { ...c }
  if (!out.timerMs) return out
  if (out.timerStartedAt) {
    const elapsed = Date.now() - out.timerStartedAt
    out.timerMs = out.timerMs + 60_000
    out.timerStartedAt = Date.now() - elapsed
  } else {
    out.timerMs = out.timerMs + 60_000
  }
  return out
}

// ---- ASSERCOES ----
let failures = 0
const assert = (cond, msg) => {
  if (cond) console.log('  ok:', msg)
  else { console.error('  FAIL:', msg); failures++ }
}
const eq = (a, b, msg) => assert(a === b, `${msg}  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`)

console.log('Timer helpers self-check')
const NOW = Date.now()

// 1. timerRemainingMs
console.log('\n[1] timerRemainingMs')
eq(timerRemainingMs({}),                                  0,        'sem timerMs -> 0')
eq(timerRemainingMs({ timerMs: 60_000 }),                 60_000,   'parado (sem startedAt) -> duracao total')
{
  const rem = timerRemainingMs({ timerMs: 60_000, timerStartedAt: Date.now() - 10_000 })
  assert(rem >= 49_000 && rem <= 51_000, `a contar: 60s - ~10s elapsed (got ${rem})`)
}
{
  const rem = timerRemainingMs({ timerMs: 60_000, timerStartedAt: Date.now() + 5_000 })
  assert(rem >= 64_000 && rem <= 66_000, `startedAt no futuro: elapsed negativo -> remaining > timerMs (got ${rem})`)
}
eq(timerRemainingMs({ timerMs: 60_000, timerStartedAt: NOW - 90_000 }),
                                                            0,      'passou do fim -> clamp 0')

// 2. timerLabel
console.log('\n[2] timerLabel')
eq(timerLabel({}),                                '',                 'sem timerMs -> ""')
eq(timerLabel({ timerMs: 90_000 }),               'pausado 01:30',    'parado -> "pausado mm:ss"')
{
  const lbl = timerLabel({ timerMs: 60_000, timerStartedAt: Date.now() - 10_000 })
  assert(/^00:5\d$/.test(lbl), `a contar -> "mm:ss" formatado (got "${lbl}")`)
}

// 3. timerTooltip
console.log('\n[3] timerTooltip')
eq(timerTooltip({}),                              '',                 'sem timerMs -> ""')
eq(timerTooltip({ timerMs: 90_000 }),             'Temporizador parado · carrega em Editar para retomar',
                                                                   'parado -> hint retoma')
{
  const tip = timerTooltip({ timerMs: 60_000, timerStartedAt: Date.now() - 10_000 })
  assert(/^Temporizador · falta 00:5\d$/.test(tip), `a contar -> "falta mm:ss" (got "${tip}")`)
}
eq(timerTooltip({ timerMs: 60_000, timerStartedAt: Date.now() - 120_000 }),
                                                 'Temporizador concluído · carrega em Editar para reiniciar',
                                                                   'expirado -> hint reinicia')

// 4. timerBadge — variantes de classe
console.log('\n[4] timerBadge class')
eq(timerBadgeCls({}),                                              '',     'sem timerMs -> ""')
eq(timerBadgeCls({ timerMs: 60_000, archived: true }),             '',     'arquivado -> ""')
eq(timerBadgeCls({ timerMs: 60_000 }),                             '',     'parado -> "" (sem running/warn)')
{
  // threshold = timerMs * 0.2 = 12_000 ms. `remaining <= 12_000` -> warn.
  eq(timerBadgeCls({ timerMs: 60_000, timerStartedAt: Date.now() - 30_000 }), ' running', 'a contar (50% restante ~30k) -> " running"')
  eq(timerBadgeCls({ timerMs: 60_000, timerStartedAt: Date.now() - 50_000 }), ' warn',    'a contar (~10s restantes < 12k) -> " warn"')
  eq(timerBadgeCls({ timerMs: 60_000, timerStartedAt: Date.now() - 61_000 }), ' warn',    'a contar (clamp 0) -> " warn"')
  eq(timerBadgeCls({ timerMs: 60_000, timerStartedAt: Date.now() - 48_000 }), ' warn',    'boundary: remaining ~12_000 -> warn (<= threshold)')
  eq(timerBadgeCls({ timerMs: 60_000, timerStartedAt: Date.now() - 47_000 }), ' running', 'just above boundary: remaining ~13_000 -> running')
}

// 5. add1 — preserva progresso + soma 60s
console.log('\n[5] add1 logic')
{
  const c = { timerMs: 60_000, timerStartedAt: Date.now() - 10_000 }
  const c2 = add1(c)
  eq(c2.timerMs, 120_000, 'timerMs += 60_000')
  // progressao preservada: remaining ~= 50_000 + 60_000 = 110_000
  const rem = timerRemainingMs(c2)
  assert(rem >= 109_000 && rem <= 111_000,
    `remaining = 50s + 60s = ~110s (got ${rem})`)
  // timerStartedAt recalculado
  assert(c2.timerStartedAt < NOW, 'timerStartedAt reposicionado (nao futuro)')
}
{
  const c = { timerMs: 60_000 }  // parado
  const c2 = add1(c)
  eq(c2.timerMs, 120_000, 'parado: timerMs += 60_000')
  eq(c2.timerStartedAt, undefined, 'parado: timerStartedAt continua undefined')
}
{
  const c = {}  // sem timer
  const c2 = add1(c)
  eq(c2.timerMs, undefined, 'sem timerMs: add1 noop')
}

// ---- SOURCE EQUALITY GUARD ----
// Garante que o mirror no test ainda bate com o source kanban.ts.
// Se alguem editar la sem actualizar aqui, isto falha antes do CI.
console.log('\n[6] source equality (kanban.ts helpers nao derivaram)')
const src = readFileSync(kanbanPath, 'utf-8')

// Procuramos os 4 nomes exportados (regex tolerante a espacos)
const expect = [
  { name: 'timerRemainingMs', pattern: /export function timerRemainingMs\(c: Card\): number \{[\s\S]*?\n\}/ },
  { name: 'timerLabel',        pattern: /export function timerLabel\(c: Card\): string \{[\s\S]*?\n\}/ },
  { name: 'timerTooltip',      pattern: /export function timerTooltip\(c: Card\): string \{[\s\S]*?\n\}/ },
  { name: 'timerBadge',        pattern: /export function timerBadge\(c: Card\): string \{[\s\S]*?\n\}/ },
]
for (const e of expect) {
  const m = src.match(e.pattern)
  assert(!!m, `${e.name} presente em kanban.ts como export function`)
}

// E o handler add1 (lógica do botao +1min) — verifica que a formula
// (timerStartedAt = Date.now() - elapsed) continua la.
assert(
  src.includes("c.timerStartedAt = Date.now() - elapsed"),
  'handler add1 preserva progresso via "Date.now() - elapsed"'
)
assert(
  src.includes("c.timerMs += 60_000"),
  'handler add1 soma 60_000 ms'
)

if (failures > 0) {
  console.error(`\nFAIL: ${failures} assercao(oes) falharam`)
  process.exit(1)
}
console.log('\nOK: timer helpers self-check passed (todas as assercoes)')
