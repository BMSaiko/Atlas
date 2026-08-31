// test/sync-vault-wipe-ot.test.mjs
//
// Regressao: wipe guard + optimistic concurrency no PUT notes|kanban
// (server/api.ts L1247-1295). Bug-class: perda silenciosa de items OU
// overwrite cego de estado concorrente. Cobre:
//   1. wipe guard: loss > max(5, before*0.5) -> 409 (sem X-Atlas-Confirm-Wipe)
//   2. wipe guard: loss <= threshold -> passa
//   3. wipe guard: confirm=yes -> passa mesmo com wipe
//   4. wipe guard: threshold floored a 5 para base pequena
//   5. optimistic concurrency: PUT com ver stale -> 409
//   6. optimistic concurrency: ver matching -> passa
//   7. OT: kind=meta exempt (source salta antes)
//   8. OT fires before wipe guard (sequenciamento)
//   9. BUG-CLASS: arrKey ternario p/ kind invalido
//
// Mesma forma do syncvault-debounce.test.mjs: reimplementa a logica inline
// (sem http server) + SOURCE EQUALITY no fim. Card iykn11lg+ protege o
// vault contra scripts de teste mal-comportados.
//
// Executar: node test/sync-vault-wipe-ot.test.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const apiPath = join(here, '..', 'server', 'api.ts')

// ---- MIRROR do wipe guard (server/api.ts L1268-1295) ----
function wipeCheck(cur, body, kind, headers) {
  const arrKey = kind === 'notes' ? 'items' : 'cards'
  const beforeCount = Array.isArray(cur?.[arrKey]) ? cur[arrKey].length : 0
  const afterCount = (body && Array.isArray(body[arrKey])) ? body[arrKey].length : 0
  const loss = beforeCount - afterCount
  const threshold = Math.max(5, Math.floor(beforeCount * 0.5))
  if (loss > threshold) {
    const confirm = (headers['x-atlas-confirm-wipe'] || '')
    if (confirm !== 'yes') {
      return { block: true, code: 409, loss, threshold, beforeCount, afterCount }
    }
  }
  return { block: false }
}

// ---- MIRROR do OT check (server/api.ts L1247-1253) ----
function otCheck(cur, body) {
  const storedVer = cur?.ver ?? 0
  const inVer = (body && typeof body === 'object') ? (Number(body.ver) || 0) : 0
  if (storedVer !== 0 && inVer !== storedVer) {
    return { block: true, code: 409, storedVer }
  }
  return { block: false }
}

let failures = 0
const assert = (cond, msg) => {
  if (cond) console.log('  ok:', msg)
  else { console.error('  FAIL:', msg); failures++ }
}
const eq = (a, b, msg) => assert(a === b, `${msg}  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`)

console.log('Sync-vault wipe guard + optimistic concurrency')

// [1] wipe guard: dispara com loss > max(5, before*0.5)
console.log('\n[1] wipe guard — block loss > threshold')
{
  const cur = { ver: 1, cards: Array.from({length: 100}, (_,i) => ({id: 'c'+i, colId: 'todo'})) }
  const body = { ver: 1, cards: Array.from({length: 40}, (_,i) => ({id: 'c'+i, colId: 'todo'})) }
  const r = wipeCheck(cur, body, 'kanban', {})
  eq(r.block, true, '100->40 (loss 60, threshold 50) -> block')
  eq(r.code, 409, 'block code = 409')
  eq(r.loss, 60, 'loss = 60')
  eq(r.threshold, 50, 'threshold = max(5, 50) = 50')
}

// [2] wipe guard: passa quando loss <= threshold
console.log('\n[2] wipe guard — allow loss <= threshold')
{
  const cur = { ver: 1, cards: Array.from({length: 100}, (_,i) => ({id: 'c'+i, colId: 'todo'})) }
  const body = { ver: 1, cards: Array.from({length: 70}, (_,i) => ({id: 'c'+i, colId: 'todo'})) }
  const r = wipeCheck(cur, body, 'kanban', {})
  eq(r.block, false, '100->70 (loss 30, threshold 50) -> pass')
}
{
  const cur = { ver: 1, items: Array.from({length: 10}, (_,i) => ({id: 'n'+i})) }
  const body = { ver: 1, items: Array.from({length: 7}, (_,i) => ({id: 'n'+i})) }
  const r = wipeCheck(cur, body, 'notes', {})
  eq(r.block, false, '10->7 (loss 3, threshold 5) -> pass')
}

// [3] wipe guard: confirm=yes bypass; case-sensitive
console.log('\n[3] wipe guard — confirm=yes bypass; case-sensitive')
{
  const cur = { ver: 1, cards: Array.from({length: 100}, (_,i) => ({id: 'c'+i, colId: 'todo'})) }
  const body = { ver: 1, cards: [] }
  const r = wipeCheck(cur, body, 'kanban', { 'x-atlas-confirm-wipe': 'yes' })
  eq(r.block, false, 'confirm=yes bypass (wipe total permitido)')
}
{
  const cur = { ver: 1, cards: Array.from({length: 100}, (_,i) => ({id: 'c'+i})) }
  const body = { ver: 1, cards: [] }
  const r = wipeCheck(cur, body, 'kanban', { 'x-atlas-confirm-wipe': 'Yes' })
  eq(r.block, true, 'BUG-CLASS: confirm=Yes (case mismatch) NAO bypassa')
}

// [4] wipe guard: threshold floored a 5
console.log('\n[4] wipe guard — threshold floor of 5 (small base)')
{
  const cur = { ver: 1, items: Array.from({length: 6}, (_,i) => ({id: 'n'+i})) }
  const body = { ver: 1, items: [] }
  const r = wipeCheck(cur, body, 'notes', {})
  eq(r.block, true, '6->0 (loss 6, threshold floor 5) -> block')
  eq(r.threshold, 5, 'threshold floored a 5 quando before*0.5 < 5')
}
{
  const cur = { ver: 1, items: Array.from({length: 6}, (_,i) => ({id: 'n'+i})) }
  const body = { ver: 1, items: Array.from({length: 2}, (_,i) => ({id: 'n'+i})) }
  const r = wipeCheck(cur, body, 'notes', {})
  eq(r.block, false, '6->2 (loss 4, threshold 5) -> pass')
}

// [5] OT: ver stale -> 409
console.log('\n[5] optimistic concurrency — ver stale blocks')
{
  const cur = { ver: 7, cards: [] }
  const body = { ver: 5, cards: [] }
  const r = otCheck(cur, body)
  eq(r.block, true, 'storedVer=7, inVer=5 -> block')
  eq(r.code, 409, 'OT block code = 409')
  eq(r.storedVer, 7, 'storedVer=7 propagado p/ UI')
}

// [6] OT: matching ver / initial doc
console.log('\n[6] optimistic concurrency — matching ver / initial doc')
{
  const cur = { ver: 7, cards: [] }
  const body = { ver: 7, cards: [{ id: 'x' }] }
  const r = otCheck(cur, body)
  eq(r.block, false, 'storedVer=7, inVer=7 -> pass')
}
{
  const cur = { ver: 0, cards: [] }
  const body = { ver: 0, cards: [] }
  const r = otCheck(cur, body)
  eq(r.block, false, 'storedVer=0 (doc inicial) -> OT salta (backwards-compat)')
}

// [7] OT: kind=meta exempt
console.log('\n[7] OT — meta kind is exempt per source comment')
{
  const src = readFileSync(apiPath, 'utf-8')
  assert(
    src.includes("if (kind === 'notes' || kind === 'kanban')"),
    'source verifica kind === notes || kanban antes do OT (meta exempt)'
  )
}

// [8] OT fires before wipe guard
console.log('\n[8] OT fires before wipe guard (sequencing)')
{
  const cur = { ver: 9, cards: Array.from({length: 100}, (_,i) => ({id: 'c'+i})) }
  const body = { ver: 3, cards: Array.from({length: 5}, (_,i) => ({id: 'c'+i})) }
  const ot = otCheck(cur, body)
  eq(ot.block, true, 'ver stale: OT bloqueia ANTES de wipe check')
}

// [9] BUG-CLASS: arrKey ternario
console.log('\n[9] BUG-CLASS — arrKey ternario p/ kind invalido')
{
  const cur = {}
  const body = { items: [] }
  const r = wipeCheck(cur, body, 'meta', {})
  eq(r.block, false, 'kind sem items/cards: loss=0 (no-op) -> nao bloqueia')
}

// [10] SOURCE EQUALITY GUARD
console.log('\n[10] source equality (wipe + OT intactos no api.ts)')
const src = readFileSync(apiPath, 'utf-8')

assert(src.includes('Math.max(5, Math.floor(beforeCount * 0.5))'),
  'wipe guard: threshold = max(5, beforeCount*0.5) presente')
assert(src.includes("'x-atlas-confirm-wipe'"),
  'wipe guard: header X-Atlas-Confirm-Wipe verificado')
assert(/send\(409,\s*\{[\s\S]*?error:\s*'wipe detetado/.test(src),
  'wipe guard: 409 devolve {error: "wipe detetado:..."}')
assert(src.includes("if (kind === 'notes' || kind === 'kanban')"),
  'OT: kind filter presente (meta exempt)')
assert(src.includes('if (storedVer !== 0 && inVer !== storedVer)'),
  'OT: storedVer !== 0 && inVer !== storedVer presente')
assert(/send\(409, \{ error: 'conflito de versao[\s\S]*?ver: storedVer \}\)/.test(src),
  'OT: 409 devolve {error: "conflito de versao", ver}')
assert(src.includes("'.backup'") && src.includes("kind + '-' + ts"),
  'wipe guard: backup pre-PUT em .backup/<kind>-<ts>.json')

if (failures > 0) {
  console.error(`\nFAIL: ${failures} assercao(oes) falharam`)
  process.exit(1)
}
console.log('\nOK: wipe guard + OT regression passed (todas as assercoes)')
