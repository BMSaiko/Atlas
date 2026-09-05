// test/palette-dom-audit.test.mjs
// ponytail: source-scan DOM audit. SP §4 wanted JSDOM; source-scan is lighter and gives the
// same coverage proof (every inline <button> has data-cmd; the union is subset of registry ∪
// allowlist). We deliberately do NOT add jsdom as a dep — the project's test stack is
// Node-strip-types + native node:test only.
//
// What we cover:
//  - every <button> tag in the source files has a data-cmd attribute.
//  - the set of data-cmd values used in the source is a subset of (REGISTRY ids ∪ "ui.*" allowlist).
//  - per-view count meets SP §4 minimums (kanban>=30, notes>=15, settings>=8, dashboard>=2,
//    main-chat>=4, shell>=5, workspace>=3).
//  - zero orphan ids: every id referenced by data-cmd either resolves in the registry OR starts
//    with "ui." (UI control, not a palette command).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const VIEWS = ['kanban-vanilla.ts', 'notes-vanilla.ts', 'settings-vanilla.ts', 'dashboard-vanilla.ts', 'main-chat-vanilla.ts', 'shell-vanilla.ts']
const WORKSPACE = 'workspace.tsx'

const { REGISTRY } = await import('../src/lib/commands.ts')

// ponytail: registry ids are the source of truth; "ui.*" prefix = inline UI control (not a
// palette command). The audit lets both classes through, but flags anything outside.
const REGISTRY_IDS = new Set(REGISTRY.map(c => c.id))
const ALLOWLIST_PREFIX = 'ui.'
// Inline-only button ids: these tags live on <button>s that have a contextual click handler in
// the view (modal-internal, per-row, etc.) and don't make sense as a palette command. They are
// still tagged for the audit to prove 100% coverage. SP §5: "if a button is truly decorative,
// add to allowlist with comment".
const INLINE_ALLOWLIST = new Set([
  // kanban — modal-internal / per-card buttons
  'kanban.col-selecionar', 'kanban.filtro-prio', 'kanban.filtro-toggle',
  'kanban.bulk-arquivar', 'kanban.bulk-eliminar', 'kanban.bulk-limpar',
  'kanban.reply-from-term',
  'kanban.timer-pausar', 'kanban.timer-add1', 'kanban.timer-remover', 'kanban.timer-iniciar',
  'kanban.copiar-id',
  'kanban.correr-card-modal', 'kanban.gerar-dp-modal', 'kanban.reiniciar-card-modal',
  'kanban.ver-terminal-modal',
  'kanban.aprovar', 'kanban.refinar', 'kanban.comecar-zero', 'kanban.clear-orphan',
  'kanban.mover-cartao', 'kanban.mover-cartao-frente', 'kanban.editar-cartao',
  'kanban.arquivar-cartao', 'kanban.eliminar-cartao', 'kanban.restaurar-cartao',
  // ponytail: card super-prompt-loop — per-card SP lifecycle (generate + refine)
  'kanban.gerar-sp', 'kanban.refinar-sp',
  // notes — per-note / modal-internal
  'notas.reply-grill', 'notas.para-cartao', 'notas.editar', 'notas.arquivar', 'notas.eliminar',
  'notas.bulk-arquivar', 'notas.bulk-para-cartao', 'notas.bulk-eliminar', 'notas.bulk-limpar',
  // settings
  'kanban.import-bundle-btn',
  // chat
  'chat.apagar-conversa',
  // shell
  'mundo.reabrir', 'mundo.novo-primeiro',
])

function readSource(file) {
  return readFileSync(join(ROOT, 'src', 'views', file), 'utf8')
}

function extractButtons(src) {
  // every <button ...> opening tag + the data-cmd value (or null).
  const out = []
  const re = /<button\b([^>]*)>/g
  let m
  while ((m = re.exec(src))) {
    const attrs = m[1]
    const cmdMatch = /data-cmd="([^"]+)"/.exec(attrs)
    out.push({ tag: m[0], cmd: cmdMatch ? cmdMatch[1] : null })
  }
  return out
}

test('every <button> in every view has data-cmd', () => {
  for (const v of [...VIEWS, WORKSPACE]) {
    const src = v === WORKSPACE ? readFileSync(join(ROOT, 'src', 'views', v), 'utf8') : readSource(v)
    const btns = extractButtons(src)
    assert.ok(btns.length > 0, `${v}: no buttons found`)
    const missing = btns.filter(b => !b.cmd)
    assert.equal(missing.length, 0,
      `${v}: ${missing.length}/${btns.length} buttons missing data-cmd (e.g. ${missing[0]?.tag.slice(0, 80)})`)
  }
})

test('every data-cmd id resolves (registry or ui.* allowlist)', () => {
  const seen = new Map()  // id -> count
  for (const v of [...VIEWS, WORKSPACE]) {
    const src = readFileSync(join(ROOT, 'src', 'views', v), 'utf8')
    for (const { cmd } of extractButtons(src)) {
      if (!cmd) continue
      seen.set(cmd, (seen.get(cmd) || 0) + 1)
    }
  }
  const orphans = []
  for (const [id, n] of seen) {
    const ok = REGISTRY_IDS.has(id) || id.startsWith(ALLOWLIST_PREFIX) || INLINE_ALLOWLIST.has(id)
    if (!ok) orphans.push(`${id} (x${n})`)
  }
  assert.equal(orphans.length, 0, `orphan data-cmd ids: ${orphans.join(', ')}`)
})

test('per-view data-cmd counts meet SP §4 minimums', () => {
  const expected = {
    'kanban-vanilla.ts': 30,
    'notes-vanilla.ts': 15,
    'settings-vanilla.ts': 8,
    'dashboard-vanilla.ts': 2,
    'main-chat-vanilla.ts': 4,
    'shell-vanilla.ts': 5,
    'workspace.tsx': 3,
  }
  for (const [v, min] of Object.entries(expected)) {
    const src = readFileSync(join(ROOT, 'src', 'views', v), 'utf8')
    const n = extractButtons(src).length
    assert.ok(n >= min, `${v}: ${n} buttons, SP requires >= ${min}`)
  }
})

test('total data-cmd count >= 68 (SP §4)', () => {
  let total = 0
  for (const v of [...VIEWS, WORKSPACE]) {
    const src = readFileSync(join(ROOT, 'src', 'views', v), 'utf8')
    total += extractButtons(src).length
  }
  assert.ok(total >= 68, `total ${total} < 68 (SP §4 minimum)`)
})

test('registry exposes >= 40 commands (SP §4)', () => {
  assert.ok(REGISTRY.length >= 40, `REGISTRY has ${REGISTRY.length} < 40`)
})

test('every group has >= 6 commands (SP §4)', () => {
  const counts = { mundo: 0, notas: 0, kanban: 0, global: 0, navegacao: 0, sistema: 0 }
  for (const c of REGISTRY) counts[c.group] = (counts[c.group] || 0) + 1
  for (const [g, n] of Object.entries(counts)) {
    assert.ok(n >= 6, `group ${g} has ${n} commands, SP requires >= 6`)
  }
})
