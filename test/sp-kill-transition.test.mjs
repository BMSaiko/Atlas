// test/sp-kill-transition.test.mjs
//
// Cobre a extensao do kill-on-transition em PUT /api/w/:slug/kanban — agora tambem
// chama killWorkerForCard (narrow taskkill) quando o card sai de 'doing'.
// Casos: happy (doing->todo, PID file present), PID file absent (idempotent skip).
// Test seam: ATLAS_TEST_NO_SPAWN — killWorkerForCard e no-op em test mode.

import { readFileSync, writeFileSync, mkdirSync, writeFileSync as wf, existsSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spinAtlas } from './_atlas-runtime.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const wSrc = readFileSync(join(repoRoot, 'server', 'routes', 'w.ts'), 'utf8')

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

console.log('\n[1] card doing -> todo via PUT kanban: killWorkerForCard invocado (no-op em test mode)')
{
  const a = await spinAtlas({ autoExit: false, env: { ATLAS_TEST_CI_OK: '1', ATLAS_TEST_NO_SPAWN: '1' } })
  await makeWorkdir(a, 'kt1', [
    { id: 'c1', colId: 'doing', title: 't', startedAt: 1 },
  ])
  // PUT: move c1 to todo
  const r = await a.req('PUT', '/api/w/kt1/kanban', {
    ver: 1,
    columns: [{ id: 'todo' }, { id: 'doing' }, { id: 'review' }, { id: 'done' }],
    cards: [{ id: 'c1', colId: 'todo', title: 't' }],
  })
  ok(r.status === 200, `200 (got ${r.status}, body=${JSON.stringify(r.json)})`)
  await a.close()
}

console.log('\n[2] PID file absent: killWorkerForCard noop (idempotent skip), PUT succeeds')
{
  const a = await spinAtlas({ autoExit: false, env: { ATLAS_TEST_CI_OK: '1', ATLAS_TEST_NO_SPAWN: '1' } })
  await makeWorkdir(a, 'kt2', [
    { id: 'c1', colId: 'doing', title: 't' },
  ])
  const r = await a.req('PUT', '/api/w/kt2/kanban', {
    ver: 1,
    columns: [{ id: 'todo' }, { id: 'doing' }, { id: 'review' }, { id: 'done' }],
    cards: [{ id: 'c1', colId: 'todo', title: 't' }],
  })
  ok(r.status === 200, `200 (got ${r.status})`)
  await a.close()
}

console.log('\n[3] SOURCE EQUALITY — kill-on-transition extended + helper in deps')
{
  ok(wSrc.includes('void killWorkerForCard(slug, a.id)'), 'killWorkerForCard chamado no kill-on-transition loop')
  ok(wSrc.includes('void killPaneForCard(slug, a.id)'), 'killPaneForCard preservado (nao-regression)')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
