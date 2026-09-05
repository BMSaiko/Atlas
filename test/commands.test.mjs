// test/commands.test.mjs
// ponytail: registry invariants + runCommand/recordUse smoke tests. JSDOM-light (Node has no
// real DOM, so we monkey-patch only the bits we need: localStorage + minimal document).
//
// What we cover:
//  - REGISTRY.length >= 40 (SP §4 success criteria).
//  - every id unique.
//  - every group in the allowed set.
//  - every label/hint non-empty.
//  - useCommands filters by `when?` correctly.
//  - runCommand calls perform + recordUse + toasts on error.
//  - recordUse: MRU order, max 10, dedup by id.
//  - getRecent returns the MRU.
//  - getShortcutOverlay has the expected keys (? and the per-group shortcuts).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// ponytail: polyfill localStorage (Node has no DOM). commands.ts swallows exceptions, so without
// this polyfill `recordUse` writes silently fail and getRecent() returns []. Tests need real storage.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size },
  }
}

// ponytail: load registry as TS — Node 22 strip-types via the existing _register-loader.
const { REGISTRY, getById, runCommand, recordUse, getRecent, clearRecent, useCommandsWith, getShortcutOverlay } =
  await import('../src/lib/commands.ts')

const ALLOWED_GROUPS = new Set(['mundo', 'notas', 'kanban', 'global', 'navegacao', 'sistema'])

test('registry has >= 40 commands', () => {
  assert.ok(REGISTRY.length >= 40, `REGISTRY has ${REGISTRY.length} commands (SP §4 requires >= 40)`)
})

test('every id is unique', () => {
  const ids = new Set()
  for (const c of REGISTRY) {
    assert.ok(!ids.has(c.id), `duplicate id: ${c.id}`)
    ids.add(c.id)
  }
})

test('every group is in the allowed set', () => {
  for (const c of REGISTRY) {
    assert.ok(ALLOWED_GROUPS.has(c.group), `command ${c.id} has invalid group ${c.group}`)
  }
})

test('every label and hint is non-empty string', () => {
  for (const c of REGISTRY) {
    assert.ok(typeof c.label === 'string' && c.label.length > 0, `${c.id} label empty`)
    assert.ok(typeof c.hint === 'string' && c.hint.length > 0, `${c.id} hint empty`)
    assert.ok(Array.isArray(c.keywords) && c.keywords.length > 0, `${c.id} keywords missing`)
    assert.ok(typeof c.perform === 'function', `${c.id} perform is not a function`)
  }
})

test('getById returns the right command', () => {
  const c = getById('mundo.novo')
  assert.ok(c, 'mundo.novo missing')
  assert.equal(c.group, 'mundo')
  assert.equal(c.icon, 'plus')
})

test('useCommands filters by when? predicate', () => {
  const ctxNoSlug = { slug: null, theme: 'dark', shift: 'night', season: 'winter', navigate: () => {}, toast: () => {}, confirm: () => Promise.resolve(true), api: {}, recordUse: () => {} }
  const ctxWithSlug = { ...ctxNoSlug, slug: 'demo' }

  const noSlug = useCommandsWith(ctxNoSlug)
  const withSlug = useCommandsWith(ctxWithSlug)

  // Commands gated on slug should NOT appear in noSlug list.
  const onlySlug = noSlug.find(c => c.id === 'mundo.merge-to-main')
  assert.equal(onlySlug, undefined, 'mundo.merge-to-main should be filtered when slug is null')

  const visible = withSlug.find(c => c.id === 'mundo.merge-to-main')
  assert.ok(visible, 'mundo.merge-to-main should be visible when slug is set')
})

test('runCommand calls perform + recordUse', async () => {
  // Reset MRU.
  clearRecent()

  let recordUseFired = false
  let toastFired = false
  let navigated = false
  const ctx = {
    slug: null,
    theme: 'dark', shift: 'night', season: 'winter',
    navigate: () => { navigated = true },
    toast: () => { toastFired = true },
    confirm: () => Promise.resolve(true),
    api: {},
    recordUse: () => { recordUseFired = true },
  }
  // 'global.dashboard' is a navCommand — perform calls ctx.navigate('/'). No window/window-undefined
  // issues. After perform resolves, runCommand calls ctx.recordUse(id).
  await runCommand('global.dashboard', ctx)
  assert.equal(navigated, true, 'navigate should fire')
  assert.equal(recordUseFired, true, 'recordUse should fire after successful perform')
  assert.equal(toastFired, false, 'toast should not fire on successful run')
})

test('runCommand toasts on error', async () => {
  // Use a non-existent id — registry.toast('Comando desconhecido: ...') should fire.
  let toastMsg = ''
  const ctx = {
    slug: null, theme: 'dark', shift: 'night', season: 'winter',
    navigate: () => {}, confirm: () => Promise.resolve(true), api: {}, recordUse: () => {},
    toast: (m) => { toastMsg = m },
  }
  await runCommand('nope.does.not.exist', ctx)
  assert.ok(toastMsg.includes('Comando desconhecido'), `expected error toast, got: ${toastMsg}`)
})

test('recordUse: MRU order, max 10, dedup by id', () => {
  clearRecent()
  // Add 12 distinct ids — only 10 should remain (oldest 2 dropped).
  for (let i = 0; i < 12; i++) recordUse('cmd.' + i)
  let r = getRecent()
  assert.equal(r.length, 10, `expected 10 recent, got ${r.length}`)
  // Most-recent first; 12 ids with MRU push means cmd.11 first, cmd.10 second, ...
  assert.equal(r[0], 'cmd.11', `expected cmd.11 first, got ${r[0]}`)
  // Last is cmd.2 (cmd.0 and cmd.1 were trimmed at the tail).
  assert.equal(r[9], 'cmd.2', `expected cmd.2 last, got ${r[9]}`)
  // Re-using an id moves it to the front.
  recordUse('cmd.5')
  r = getRecent()
  assert.equal(r[0], 'cmd.5', 'cmd.5 should be first after re-use')
  assert.equal(r.length, 10, 'dedup should keep length at 10')
})

test('every shortcut has unique key + PT-PT-safe prefix', () => {
  // ponytail: regression guard para 2026-09-05 (user reportou que bare-letter shortcuts
  // disparavam ao escrever PT-PT no filtro). Leader e' ';' (cedilha) — nunca aparece no
  // início de palavras PT-PT. Este teste confirma que todos os atalhos começam com ';' (ou
  // sao o bare '?') e que nao ha duplicados.
  const seen = new Map()  // shortcut -> command id
  for (const c of REGISTRY) {
    if (!c.shortcut) continue
    if (c.shortcut === '?') continue  // bare, único
    assert.ok(c.shortcut.startsWith(';'),
      `shortcut "${c.shortcut}" for ${c.id} must start with ';' (leader) or be bare '?'`)
    const prev = seen.get(c.shortcut)
    assert.ok(prev === undefined,
      `duplicate shortcut "${c.shortcut}" on ${prev} and ${c.id}`)
    seen.set(c.shortcut, c.id)
  }
})

test('getShortcutOverlay returns the documented keys', () => {
  const ov = getShortcutOverlay()
  const keys = ov.map(o => o.keys)
  for (const expected of [';N', ';C', ';T', ';D', ';S', ';M', ';F', '?']) {
    assert.ok(keys.includes(expected), `shortcut overlay missing ${expected}`)
  }
})
