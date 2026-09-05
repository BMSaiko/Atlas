// test/sp-persistence.test.mjs
//
// Cobre POST /api/w/:slug/kanban/sp — persiste superPromptBody + superPromptRef + bump ver.
// Casos: happy, body<50 (400), body>200000 (400), ver mismatch (409).
// Test seam: ATLAS_TEST_NO_SPAWN (skip spawn) + ATLAS_TEST_CI_OK (gate passa para outros routes).

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, unlinkSync, readdirSync } from 'node:fs'
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

async function makeWorkdir(a, slug, cards) {
  mkdirSync(join(a.cwd, 'data', slug), { recursive: true })
  writeFileSync(join(a.cwd, 'data', slug, 'kanban.json'), JSON.stringify({
    ver: 1, columns: [{ id: 'todo' }, { id: 'doing' }, { id: 'review' }, { id: 'done' }],
    cards,
  }))
}

const validBody = 'A'.repeat(60)  // 60 chars > 50
const validRef = 'knowledge/infra/super-prompts/atlas-2026-09-05.md'

console.log('\n[1] happy: POST with body>=50 + valid ref -> 200 + ver bumped + fields persisted')
{
  const a = await spinAtlas({ autoExit: false, env: { ATLAS_TEST_CI_OK: '1', ATLAS_TEST_NO_SPAWN: '1' } })
  await makeWorkdir(a, 'sp1', [{ id: 'c1', colId: 'todo', title: 't' }])
  const r = await a.req('POST', '/api/w/sp1/kanban/sp', { cardId: 'c1', body: validBody, ref: validRef, ver: 1 })
  ok(r.status === 200, `200 (got ${r.status}, body=${JSON.stringify(r.json)})`)
  ok(r.json?.ok === true, 'ok=true')
  ok(typeof r.json?.ver === 'number' && r.json.ver > 1, `ver bumped (got ${r.json?.ver})`)
  // re-read board
  const got = await a.req('GET', '/api/w/sp1/kanban')
  const c = got.json?.cards?.find((x) => x.id === 'c1')
  ok(c?.superPromptBody === validBody, 'body persisted')
  ok(c?.superPromptRef === validRef, 'ref persisted')
  await a.close()
}

console.log('\n[2] body < 50 -> 400')
{
  const a = await spinAtlas({ autoExit: false, env: { ATLAS_TEST_CI_OK: '1', ATLAS_TEST_NO_SPAWN: '1' } })
  await makeWorkdir(a, 'sp2', [{ id: 'c1', colId: 'todo', title: 't' }])
  const r = await a.req('POST', '/api/w/sp2/kanban/sp', { cardId: 'c1', body: 'short', ref: validRef, ver: 1 })
  ok(r.status === 400, `400 (got ${r.status})`)
  ok(r.json?.error?.includes('too short'), `error mentions too short (got ${r.json?.error})`)
  await a.close()
}

console.log('\n[3] body > 200KB -> 400')
{
  const a = await spinAtlas({ autoExit: false, env: { ATLAS_TEST_CI_OK: '1', ATLAS_TEST_NO_SPAWN: '1' } })
  await makeWorkdir(a, 'sp3', [{ id: 'c1', colId: 'todo', title: 't' }])
  const bigBody = 'A'.repeat(200_001)
  const r = await a.req('POST', '/api/w/sp3/kanban/sp', { cardId: 'c1', body: bigBody, ref: validRef, ver: 1 })
  ok(r.status === 400, `400 (got ${r.status})`)
  ok(r.json?.error?.includes('too large'), `error mentions too large (got ${r.json?.error})`)
  await a.close()
}

console.log('\n[4] ver mismatch -> 409')
{
  const a = await spinAtlas({ autoExit: false, env: { ATLAS_TEST_CI_OK: '1', ATLAS_TEST_NO_SPAWN: '1' } })
  await makeWorkdir(a, 'sp4', [{ id: 'c1', colId: 'todo', title: 't' }])
  // ver=1 on disk; client sends ver=99
  const r = await a.req('POST', '/api/w/sp4/kanban/sp', { cardId: 'c1', body: validBody, ref: validRef, ver: 99 })
  ok(r.status === 409, `409 (got ${r.status})`)
  ok(r.json?.error?.includes('conflito'), `error mentions conflito (got ${r.json?.error})`)
  await a.close()
}

console.log('\n[5] ref invalido (path traversal) -> 400')
{
  const a = await spinAtlas({ autoExit: false, env: { ATLAS_TEST_CI_OK: '1', ATLAS_TEST_NO_SPAWN: '1' } })
  await makeWorkdir(a, 'sp5', [{ id: 'c1', colId: 'todo', title: 't' }])
  const r = await a.req('POST', '/api/w/sp5/kanban/sp', { cardId: 'c1', body: validBody, ref: '../../../etc/passwd', ver: 1 })
  ok(r.status === 400, `400 (got ${r.status})`)
  ok(r.json?.error?.includes('ref invalido'), `error mentions ref invalido (got ${r.json?.error})`)
  await a.close()
}

console.log('\n[6] SOURCE EQUALITY — sp route presente + validates')
{
  ok(wSrc.includes('w:kanban:sp'), 'route w:kanban:sp registada')
  ok(wSrc.includes("match: [\"w\", null, \"kanban\", \"sp\"]"), 'match correto')
  ok(apiSrc.includes('Card'), 'Card type existe')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
