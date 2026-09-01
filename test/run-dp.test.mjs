// test/run-dp.test.mjs
//
// Cobre POST /api/w/:slug/run e POST /api/w/:slug/dp — branches deterministicos
// antes do spawn (board mutation + guards). O spawn real (launchHermes/launchDp)
// e' testado via env-var shim.
// Test seam: ATLAS_TEST_NO_SPAWN (run + dp saltam git/spawn/headless).
// Estilo: vanilla node:assert. SOURCE EQUALITY (api.ts:run=57744+, dp=59334+).
//
// Run: node test/run-dp.test.mjs

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

// helper: cria workdir + board com 1 card no estado pedido
async function makeBoard(a, slug, card) {
  mkdirSync(join(a.cwd, 'data', slug), { recursive: true })
  writeFileSync(join(a.cwd, 'data', slug, 'kanban.json'), JSON.stringify({
    ver: 1, columns: [{ id: 'todo' }, { id: 'doing' }, { id: 'review' }, { id: 'done' }],
    cards: [card],
  }))
}

// =====================================================================
// POST /api/w/:slug/run
// =====================================================================

console.log('\n[r1] run sem cardId -> 400')
{
  const a = await spinAtlas()
  await makeBoard(a, 'rd1', { id: 'c1', colId: 'todo', title: 't' })
  const r = await a.req('POST', '/api/w/rd1/run', {})
  ok(r.status === 400, `400 (got ${r.status})`)
  await a.close()
}

console.log('\n[r2] run card inexistente -> 404')
{
  const a = await spinAtlas()
  await makeBoard(a, 'rd2', { id: 'c1', colId: 'todo', title: 't' })
  const r = await a.req('POST', '/api/w/rd2/run', { cardId: 'nao-existe' })
  ok(r.status === 404, `404 (got ${r.status})`)
  ok(r.json?.error?.includes('card not found'), `error (got ${r.json?.error})`)
  await a.close()
}

console.log('\n[r3] run card em done -> 409')
{
  const a = await spinAtlas()
  await makeBoard(a, 'rd3', { id: 'c1', colId: 'done', title: 't' })
  const r = await a.req('POST', '/api/w/rd3/run', { cardId: 'c1' })
  ok(r.status === 409, `409 (got ${r.status})`)
  ok(r.json?.error?.includes('done or archived'), `error (got ${r.json?.error})`)
  await a.close()
}

console.log('\n[r4] run card archived -> 409')
{
  const a = await spinAtlas()
  await makeBoard(a, 'rd4', { id: 'c1', colId: 'todo', title: 't', archived: true })
  const r = await a.req('POST', '/api/w/rd4/run', { cardId: 'c1' })
  ok(r.status === 409, `409 (got ${r.status})`)
  await a.close()
}

console.log('\n[r5] run happy path — shim NO_SPAWN, board vira doing + startedAt')
{
  const a = await spinAtlas({ env: { ATLAS_TEST_NO_SPAWN: '1' } })
  await makeBoard(a, 'rd5', { id: 'c1', colId: 'todo', title: 't', description: 'd' })
  const r = await a.req('POST', '/api/w/rd5/run', { cardId: 'c1' })
  ok(r.status === 200, `200 (got ${r.status}, body=${JSON.stringify(r.json)})`)
  const board = JSON.parse(readFileSync(join(a.cwd, 'data', 'rd5', 'kanban.json'), 'utf8'))
  const c = board.cards[0]
  ok(c.colId === 'doing', `colId=doing (got ${c.colId})`)
  ok(typeof c.startedAt === 'number' && c.startedAt > 0, `startedAt set (got ${c.startedAt})`)
  ok(!('result' in c) && !('reviewed' in c), `result/reviewed limpos`)
  await a.close()
}

console.log('\n[r6] run limpa result antigo (re-comecar tarefa)')
{
  const a = await spinAtlas({ env: { ATLAS_TEST_NO_SPAWN: '1' } })
  await makeBoard(a, 'rd6', { id: 'c1', colId: 'review', title: 't', result: 'antigo', reviewed: true })
  const r = await a.req('POST', '/api/w/rd6/run', { cardId: 'c1' })
  ok(r.status === 200, `200 (got ${r.status})`)
  const board = JSON.parse(readFileSync(join(a.cwd, 'data', 'rd6', 'kanban.json'), 'utf8'))
  const c = board.cards[0]
  ok(c.colId === 'doing', `colId=doing (got ${c.colId})`)
  ok(!('result' in c) && !('reviewed' in c), `result/reviewed limpos no re-run`)
  await a.close()
}

// =====================================================================
// POST /api/w/:slug/dp
// =====================================================================

console.log('\n[d1] dp sem cardId -> 400')
{
  const a = await spinAtlas()
  await makeBoard(a, 'rd7', { id: 'c1', colId: 'todo', title: 't' })
  const r = await a.req('POST', '/api/w/rd7/dp', {})
  ok(r.status === 400, `400 (got ${r.status})`)
  ok(r.json?.error?.includes('cardId required'), `error (got ${r.json?.error})`)
  await a.close()
}

console.log('\n[d2] dp card inexistente -> 404')
{
  const a = await spinAtlas()
  await makeBoard(a, 'rd8', { id: 'c1', colId: 'todo', title: 't' })
  const r = await a.req('POST', '/api/w/rd8/dp', { cardId: 'nao-existe' })
  ok(r.status === 404, `404 (got ${r.status})`)
  await a.close()
}

console.log('\n[d3] dp card archived -> 409')
{
  const a = await spinAtlas()
  await makeBoard(a, 'rd9', { id: 'c1', colId: 'todo', title: 't', archived: true })
  const r = await a.req('POST', '/api/w/rd9/dp', { cardId: 'c1' })
  ok(r.status === 409, `409 (got ${r.status})`)
  await a.close()
}

console.log('\n[d4] dp happy path — shim NO_SPAWN, board intacto (dp corre async)')
{
  const a = await spinAtlas({ env: { ATLAS_TEST_NO_SPAWN: '1' } })
  await makeBoard(a, 'rd10', { id: 'c1', colId: 'todo', title: 't', description: 'd' })
  const r = await a.req('POST', '/api/w/rd10/dp', { cardId: 'c1' })
  ok(r.status === 200, `200 (got ${r.status}, body=${JSON.stringify(r.json)})`)
  // dp e' fire-and-forget (void launchDp); sem shim nao tocaria o board antes do spawn.
  // com shim, launchDp retorna early. Board fica intacto (colId=todo, sem .dp).
  const board = JSON.parse(readFileSync(join(a.cwd, 'data', 'rd10', 'kanban.json'), 'utf8'))
  ok(board.cards[0].colId === 'todo', `colId=todo (got ${board.cards[0].colId})`)
  ok(!('dp' in board.cards[0]), `dp nao gravado pelo shim (got ${board.cards[0].dp})`)
  await a.close()
}

// =====================================================================
// SOURCE EQUALITY — guarantees the dispatch + guards nao derivaram
// =====================================================================

console.log('\n[s1] SOURCE EQUALITY — /run + /dp dispatch intacto')
{
  ok(apiSrc.includes("parts[2] === 'run' && m === 'POST'"), '/run POST dispatch')
  ok(apiSrc.includes("if (!inside(DATA, file) || !id) { send(400, { error: 'bad request' }); return }"), '/run 400 bad request')
  ok(apiSrc.includes("if (!card) { send(404, { error: 'card not found' }); return }"), '/run 404 not found')
  ok(apiSrc.includes("if (card.colId === 'done' || card.archived) { send(409, { error: 'card done or archived' }); return }"), '/run 409 done/archived')
  ok(apiSrc.includes("card.colId = 'doing'"), '/run board -> doing')
  ok(apiSrc.includes("card.startedAt = Date.now()"), '/run startedAt set')
  ok(apiSrc.includes("delete card.result"), '/run limpa result')
  ok(apiSrc.includes("delete card.reviewed"), '/run limpa reviewed')
  ok(apiSrc.includes("await launchHermes(slug, card)"), '/run chama launchHermes')

  ok(apiSrc.includes("parts[2] === 'dp' && m === 'POST'"), '/dp POST dispatch')
  ok(apiSrc.includes("if (!SLUG.test(slug)) { send(400, { error: 'bad request' }); return }"), '/dp 400 slug regex')
  ok(apiSrc.includes("if (!id) { send(400, { error: 'cardId required' }); return }"), '/dp 400 cardId required')
  ok(apiSrc.includes("if (card.archived) { send(409, { error: 'card archived' }); return }"), '/dp 409 archived')
  ok(apiSrc.includes("void launchDp(slug, card)"), '/dp chama launchDp (fire-and-forget)')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
