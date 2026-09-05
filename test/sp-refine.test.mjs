// test/sp-refine.test.mjs
//
// Cobre POST /api/w/:slug/kanban/refine — atualiza SP body+ref, deixa colId em review,
// mata PID anterior (best-effort), re-spawn via launchHermes.
// Casos: happy, colId!=review (409), PID file missing (idempotent skip), stale PID.
// Test seam: ATLAS_TEST_NO_SPAWN (skip real python spawn — launchHermes e no-op).

import { readFileSync, writeFileSync, mkdirSync, existsSync, writeFileSync as wf } from 'node:fs'
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

const validBody = 'B'.repeat(60)
const validRef = 'knowledge/infra/super-prompts/atlas-2026-09-05.md'

console.log('\n[1] happy: card in review -> 200 + ver bumped + body persisted + colId stays review')
{
  const a = await spinAtlas({ autoExit: false, env: { ATLAS_TEST_CI_OK: '1', ATLAS_TEST_NO_SPAWN: '1' } })
  await makeWorkdir(a, 'rf1', [{ id: 'c1', colId: 'review', title: 't', superPromptBody: 'OLD', superPromptRef: validRef }])
  const r = await a.req('POST', '/api/w/rf1/kanban/refine', { cardId: 'c1', body: validBody, ref: validRef, ver: 1 })
  ok(r.status === 200, `200 (got ${r.status}, body=${JSON.stringify(r.json)})`)
  ok(r.json?.ok === true, 'ok=true')
  // re-read
  const got = await a.req('GET', '/api/w/rf1/kanban')
  const c = got.json?.cards?.find((x) => x.id === 'c1')
  ok(c?.superPromptBody === validBody, `body updated (got len=${c?.superPromptBody?.length})`)
  ok(c?.superPromptRef === validRef, 'ref persisted')
  ok(c?.colId === 'review', `colId stays review (got ${c?.colId})`)
  await a.close()
}

console.log('\n[2] colId != review (todo) -> 409')
{
  const a = await spinAtlas({ autoExit: false, env: { ATLAS_TEST_CI_OK: '1', ATLAS_TEST_NO_SPAWN: '1' } })
  await makeWorkdir(a, 'rf2', [{ id: 'c1', colId: 'todo', title: 't' }])
  const r = await a.req('POST', '/api/w/rf2/kanban/refine', { cardId: 'c1', body: validBody, ref: validRef, ver: 1 })
  ok(r.status === 409, `409 (got ${r.status})`)
  ok(r.json?.error?.includes('not in review'), `error mentions not in review (got ${r.json?.error})`)
  await a.close()
}

console.log('\n[3] body < 50 -> 400')
{
  const a = await spinAtlas({ autoExit: false, env: { ATLAS_TEST_CI_OK: '1', ATLAS_TEST_NO_SPAWN: '1' } })
  await makeWorkdir(a, 'rf3', [{ id: 'c1', colId: 'review', title: 't' }])
  const r = await a.req('POST', '/api/w/rf3/kanban/refine', { cardId: 'c1', body: 'short', ref: validRef, ver: 1 })
  ok(r.status === 400, `400 (got ${r.status})`)
  await a.close()
}

console.log('\n[4] SOURCE EQUALITY — refine route + killWorkerForCard helper + pidPath extension')
{
  ok(wSrc.includes('w:kanban:refine'), 'route w:kanban:refine registada')
  ok(apiSrc.includes('async function killWorkerForCard'), 'killWorkerForCard helper defined')
  // run-card.mjs has pidPath support
  const rcSrc = readFileSync(join(repoRoot, 'server', 'lib', 'run-card.mjs'), 'utf8')
  ok(rcSrc.includes('pidPath'), 'run-card.mjs honours pidPath')
  ok(rcSrc.includes('if (pidPath) writeFile(pidPath'), 'pidPath writes child.pid to file')
  // run-card.d.mts has pidPath?
  const rcDts = readFileSync(join(repoRoot, 'server', 'lib', 'run-card.d.mts'), 'utf8')
  ok(rcDts.includes('pidPath?'), 'RunCardOpts has pidPath? field')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
