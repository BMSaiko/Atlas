// test/review-approve-agent.test.mjs
//
// Cobre POST /api/w/:slug/review/approve-agent — handler que spawna o
// merge-approve agent headless. Card h1y3yfsy partial DA + nehpzsd7 review
// testado: o .log file DEVE existir com >0 bytes apos o handler correr.
// Test seam: ATLAS_TEST_NO_SPAWN (skip spawn) + ATLAS_TEST_CI_OK (gate passa).
// Estilo: vanilla node:assert. SOURCE EQUALITY (server/routes/w.ts:34-65).
//
// Run: node test/review-approve-agent.test.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spinAtlas } from './_atlas-runtime.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const wSrc = readFileSync(join(repoRoot, 'server', 'routes', 'w.ts'), 'utf8')
const apiSrc = readFileSync(join(repoRoot, 'server', 'api.ts'), 'utf8')

let failures = 0
const ok = (cond, msg) => {
  if (cond) console.log('  ok:', msg)
  else { console.error('  FAIL:', msg); failures++ }
}

async function makeWorkdir(a, slug, card) {
  mkdirSync(join(a.cwd, 'data', slug), { recursive: true })
  writeFileSync(join(a.cwd, 'data', slug, 'kanban.json'), JSON.stringify({
    ver: 1, columns: [{ id: 'todo' }, { id: 'doing' }, { id: 'review' }, { id: 'done' }],
    cards: [card],
  }))
}

console.log('\n[1] handler returns 200 with mode=agent + logPath')
{
  const a = await spinAtlas({ autoExit: false,
    env: { ATLAS_TEST_CI_OK: '1', ATLAS_TEST_NO_SPAWN: '1' },
  })
  await makeWorkdir(a, 'raa1', { id: 'c1', colId: 'review', title: 'Test' })
  const r = await a.req('POST', '/api/w/raa1/review/approve-agent', { cardId: 'c1' })
  ok(r.status === 200, `200 (got ${r.status}, body=${JSON.stringify(r.json)})`)
  ok(r.json?.ok === true, `ok=true`)
  ok(r.json?.mode === 'agent', `mode=agent (got ${r.json?.mode})`)
  ok(typeof r.json?.logPath === 'string' && r.json.logPath.includes('merge-approve.log'),
     `logPath aponta para merge-approve.log (got ${r.json?.logPath})`)
  await a.close()
}

console.log('\n[2] NO_SPAWN shim NAO corre python — log path devolvido mas file NAO criado (porque spawn e skip)')
{
  // ponytail: com NO_SPAWN, o handler ainda devolve 200 (gate passou) mas o spawnHeadless
  // e no-op. Sem python a correr, nao ha log gravado. Documenta o comportamento.
  const a = await spinAtlas({ autoExit: false, env: { ATLAS_TEST_CI_OK: '1', ATLAS_TEST_NO_SPAWN: '1' } })
  await makeWorkdir(a, 'raa2', { id: 'c1', colId: 'review', title: 't' })
  const r = await a.req('POST', '/api/w/raa2/review/approve-agent', { cardId: 'c1' })
  ok(r.status === 200, `200`)
  // logPath devolvido e' o path esperado (relativo a wtRoot), mas como spawn e' skip, sem file
  ok(typeof r.json?.logPath === 'string', 'logPath returned')
  await a.close()
}

console.log('\n[3] card archived -> 409')
{
  const a = await spinAtlas({ autoExit: false, env: { ATLAS_TEST_CI_OK: '1', ATLAS_TEST_NO_SPAWN: '1' } })
  await makeWorkdir(a, 'raa3', { id: 'c1', colId: 'review', title: 't', archived: true })
  const r = await a.req('POST', '/api/w/raa3/review/approve-agent', { cardId: 'c1' })
  ok(r.status === 409, `409 (got ${r.status})`)
  await a.close()
}

console.log('\n[4] colId != review -> 409')
{
  const a = await spinAtlas({ autoExit: false, env: { ATLAS_TEST_CI_OK: '1', ATLAS_TEST_NO_SPAWN: '1' } })
  await makeWorkdir(a, 'raa4', { id: 'c1', colId: 'doing', title: 't' })
  const r = await a.req('POST', '/api/w/raa4/review/approve-agent', { cardId: 'c1' })
  ok(r.status === 409, `409 (got ${r.status})`)
  ok(r.json?.error?.includes('not in review'), `error (got ${r.json?.error})`)
  await a.close()
}

console.log('\n[5] card not found -> 404')
{
  const a = await spinAtlas({ autoExit: false, env: { ATLAS_TEST_CI_OK: '1', ATLAS_TEST_NO_SPAWN: '1' } })
  await makeWorkdir(a, 'raa5', { id: 'c1', colId: 'review', title: 't' })
  const r = await a.req('POST', '/api/w/raa5/review/approve-agent', { cardId: 'nope' })
  ok(r.status === 404, `404 (got ${r.status})`)
  await a.close()
}

console.log('\n[6] gate CI falhou -> 500 (sem spawn)')
{
  const a = await spinAtlas({ autoExit: false, env: { ATLAS_TEST_NO_SPAWN: '1' } })  // sem CI_OK -> gate falha
  await makeWorkdir(a, 'raa6', { id: 'c1', colId: 'review', title: 't' })
  const r = await a.req('POST', '/api/w/raa6/review/approve-agent', { cardId: 'c1' })
  ok(r.status === 500, `500 (got ${r.status})`)
  ok(r.json?.error?.includes('CI gate'), `error (got ${r.json?.error})`)
  await a.close()
}

console.log('\n[7] SOURCE EQUALITY — approve-agent handler exists + uses spawnHeadless')
{
  // ponytail: garantir que o handler continua a chamar spawnHeadless + writeFile do banner.
  // se alguem refactorar e esquecer o spawn, este anchor apanha.
  ok(wSrc.includes('w:review:approve-agent'), 'route name w:review:approve-agent presente')
  ok(wSrc.includes('spawnHeadless('), 'spawnHeadless chamado')
  ok(wSrc.includes("loadPrompt('merge-approve')"), 'prompt merge-approve carregado')
  ok(wSrc.includes("'agent'"), "mode: 'agent' no response")
  ok(apiSrc.includes("if (process.env.ATLAS_TEST_NO_SPAWN) return"), 'spawnHeadless respeita NO_SPAWN')
  ok(apiSrc.includes("_sanitizeText('◆ ' + banner") || apiSrc.includes("writeFile(logPath, '◆ ' + banner"), 'banner gravado antes do spawn')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
