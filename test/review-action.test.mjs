// test/review-action.test.mjs
//
// Cobre POST /api/w/:slug/review/:action — branches deterministicos
// antes do spawn (gate CI + merge sao testados via env-var shim).
// Test seam: ATLAS_TEST_NO_SPAWN, ATLAS_TEST_CI_OK, ATLAS_TEST_MERGE_OK.
// Estilo: vanilla node:assert. SOURCE EQUALITY (api.ts:864-915).
//
// Run: node test/review-action.test.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spinAtlas } from './_atlas-runtime.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const apiSrc = readFileSync(join(repoRoot, 'server', 'api.ts'), 'utf8')

let failures = 0
const ok = (cond, msg) => {
  if (cond) console.log('  ok:', msg)
  else { console.error('  FAIL:', msg); failures++ }
}

// helper: cria workdir + card num estado inicial
async function makeWorkdir(a, slug, card) {
  mkdirSync(join(a.cwd, 'data', slug), { recursive: true })
  writeFileSync(join(a.cwd, 'data', slug, 'kanban.json'), JSON.stringify({
    ver: 1, columns: [{ id: 'todo' }, { id: 'doing' }, { id: 'review' }, { id: 'done' }],
    cards: [card],
  }))
}

console.log('\n[1] action invalido -> 400')
{
  const a = await spinAtlas()
  await makeWorkdir(a, 'rj1', { id: 'c1', colId: 'review', title: 't' })
  const r = await a.req('POST', '/api/w/rj1/review/foo', { cardId: 'c1' })
  ok(r.status === 400, `400 (got ${r.status})`)
  ok(r.json?.error?.includes('bad action'), `error (got ${r.json?.error})`)
  await a.close()
}

console.log('\n[2] cardId missing -> 400')
{
  const a = await spinAtlas()
  await makeWorkdir(a, 'rj2', { id: 'c1', colId: 'review', title: 't' })
  const r = await a.req('POST', '/api/w/rj2/review/approve', {})
  ok(r.status === 400, `400 (got ${r.status})`)
  await a.close()
}

console.log('\n[3] card archived -> 409')
{
  const a = await spinAtlas()
  await makeWorkdir(a, 'rj3', { id: 'c1', colId: 'review', title: 't', archived: true })
  const r = await a.req('POST', '/api/w/rj3/review/approve', { cardId: 'c1' })
  ok(r.status === 409, `409 (got ${r.status})`)
  ok(r.json?.error?.includes('archived'), `error (got ${r.json?.error})`)
  await a.close()
}

console.log('\n[4] approve com colId != review -> 409')
{
  const a = await spinAtlas()
  await makeWorkdir(a, 'rj4', { id: 'c1', colId: 'doing', title: 't' })
  const r = await a.req('POST', '/api/w/rj4/review/approve', { cardId: 'c1' })
  ok(r.status === 409, `409 (got ${r.status})`)
  ok(r.json?.error?.includes('not in review'), `error (got ${r.json?.error})`)
  await a.close()
}

console.log('\n[5] approve happy path — shims CI_OK + MERGE_OK + NO_SPAWN')
{
  const a = await spinAtlas({
    env: { ATLAS_TEST_CI_OK: '1', ATLAS_TEST_MERGE_OK: '1', ATLAS_TEST_NO_SPAWN: '1' },
  })
  await makeWorkdir(a, 'rj5', { id: 'c1', colId: 'review', title: 't' })
  const r = await a.req('POST', '/api/w/rj5/review/approve', { cardId: 'c1' })
  ok(r.status === 200, `200 (got ${r.status}, body=${JSON.stringify(r.json)})`)
  // card promovido a done
  const board = JSON.parse(readFileSync(join(a.cwd, 'data', 'rj5', 'kanban.json'), 'utf8'))
  ok(board.cards[0].colId === 'done', `colId=done (got ${board.cards[0].colId})`)
  ok(board.cards[0].reviewed === true, `reviewed=true`)
  await a.close()
}

console.log('\n[6] reject — adiciona refinement note + relanca (shim NO_SPAWN)')
{
  const a = await spinAtlas({ env: { ATLAS_TEST_NO_SPAWN: '1' } })
  const original = 'prompt original'
  await makeWorkdir(a, 'rj6', { id: 'c1', colId: 'review', title: 't', description: original })
  const r = await a.req('POST', '/api/w/rj6/review/reject', {
    cardId: 'c1', title: 't2', note: 'mais detalhe please', priority: 'high',
  })
  ok(r.status === 200, `200 (got ${r.status}, body=${JSON.stringify(r.json)})`)
  const board = JSON.parse(readFileSync(join(a.cwd, 'data', 'rj6', 'kanban.json'), 'utf8'))
  ok(board.cards[0].colId === 'doing', `colId=doing (got ${board.cards[0].colId})`)
  ok(board.cards[0].title === 't2', `title override (got ${board.cards[0].title})`)
  ok(board.cards[0].priority === 'high', `priority override`)
  ok(typeof board.cards[0].startedAt === 'number', `startedAt set`)
  ok(board.cards[0].description?.includes(original) && board.cards[0].description?.includes('mais detalhe please'), 'description preserva original + refinement')
  ok(!('result' in board.cards[0]) && !('reviewed' in board.cards[0]), 'result/reviewed limpos')
  await a.close()
}

console.log('\n[7] SOURCE EQUALITY — review action + branchamento')
{
  ok(apiSrc.includes("if (parts[0] === 'w' && parts.length === 4 && parts[2] === 'review' && m === 'POST')"), 'review POST dispatch')
  ok(apiSrc.includes("if (action !== 'approve' && action !== 'reject')"), 'action allow-list')
  ok(apiSrc.includes("if (card.archived) { send(409, { error: 'card archived' }); return }"), 'archived 409')
  ok(apiSrc.includes("if (card.colId !== 'review') { send(409, { error: 'card not in review' }); return }"), 'colId guard approve')
  ok(apiSrc.includes("if (process.env.ATLAS_TEST_NO_SPAWN) return"), 'killPaneForCard shim (linha 1)')
  ok(apiSrc.includes("if (process.env.ATLAS_TEST_CI_OK) return { ok: true"), 'runCIGate shim')
  ok(apiSrc.includes("if (process.env.ATLAS_TEST_MERGE_OK) return { ok: true"), 'mergeDevToMain shim')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
