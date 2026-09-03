// test/orphans-ack.test.mjs
//
// Cobre /api/w/:slug/orphans/ack (POST) e o enriquecimento do GET /orphans
// (card h1y3yfsy: heartbeat + classification + logTail + orphanWorktreePath).
//
// Estilo: vanilla node:assert + spinAtlas. SOURCE EQUALITY (api.ts:1061+).
// Run: node test/orphans-ack.test.mjs

import { readFileSync, writeFileSync, mkdirSync, utimesSync, existsSync } from 'node:fs'
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

const FIVE_MIN = 5 * 60 * 1000

// helper: cria card 'doing' com ageMs + .status + .log
async function setupCard(a, slug, cardId, opts = {}) {
  const { ageMs = FIVE_MIN + 60000, logMtime = 0, logContent = '', status = { state: 'running' }, colId = 'doing', archived = false } = opts
  mkdirSync(join(a.cwd, 'data', slug), { recursive: true })
  const board = { ver: 1, columns: [{id:'todo',name:'To Do'},{id:'doing',name:'Doing'},{id:'done',name:'Done'}], cards: [{
    id: cardId, colId, title: 'Card ' + cardId,
    startedAt: Date.now() - ageMs,
    priority: 'medium', ts: Date.now() - ageMs, archived,
  }] }
  writeFileSync(join(a.cwd, 'data', slug, 'kanban.json'), JSON.stringify(board, null, 2))
  const repo = a.cwd
  const runsDir = join(repo, 'data', '.wt', 'runs', slug)
  mkdirSync(runsDir, { recursive: true })
  writeFileSync(join(runsDir, cardId + '.status'), JSON.stringify(status))
  if (logContent || logMtime) {
    const logPath = join(runsDir, cardId + '.log')
    writeFileSync(logPath, logContent || 'running...')
    if (logMtime > 0) {
      const mtimeSec = (Date.now() - logMtime) / 1000
      utimesSync(logPath, mtimeSec, mtimeSec)
    }
  }
}

console.log('\n[1] POST /orphans/ack sem body -> 400')
{
  const a = await spinAtlas()
  const r = await a.req('POST', '/api/w/no-body/orphans/ack', {})
  ok(r.status === 400, 'empty body -> 400 (got ' + r.status + ')')
  await a.close()
}

console.log('\n[2] POST /orphans/ack cardIds vazio -> 400')
{
  const a = await spinAtlas()
  const r = await a.req('POST', '/api/w/empty-list/orphans/ack', { cardIds: [] })
  ok(r.status === 400, 'empty cardIds -> 400 (got ' + r.status + ')')
  await a.close()
}

console.log('\n[3] POST /orphans/ack move card doing->todo e classifica WRAPPER_DIED')
{
  const a = await spinAtlas()
  await setupCard(a, 'wd', 'card-wd', { ageMs: 6*60*1000, logContent: '' })
  const r = await a.req('POST', '/api/w/wd/orphans/ack', { cardIds: ['card-wd'] })
  ok(r.status === 200, '200 (got ' + r.status + ')')
  ok(r.json?.mutated === true, 'mutated=true')
  ok(r.json?.results?.[0]?.classification === 'CRASH_WRAPPER_DIED', 'classification=CRASH_WRAPPER_DIED (got ' + r.json?.results?.[0]?.classification + ')')
  ok(r.json?.results?.[0]?.ok === true, 'results[0].ok=true')
  // card no disco deve estar em todo
  const board = JSON.parse(readFileSync(join(a.cwd, 'data', 'wd', 'kanban.json'), 'utf8'))
  const c = board.cards[0]
  ok(c.colId === 'todo', 'colId=todo (got ' + c.colId + ')')
  ok(c.crashRetry === true, 'crashRetry=true')
  ok(typeof c.crashAt === 'number', 'crashAt set (got ' + c.crashAt + ')')
  ok(!c.startedAt, 'startedAt removed')
  ok(c.result?.startsWith('CRASH_WRAPPER_DIED'), 'result comeca com CRASH_WRAPPER_DIED (got ' + c.result?.slice(0, 40) + ')')
  ok(board.ver >= 2, 'board.ver bumped >=2 (got ' + board.ver + ')')
  await a.close()
}

console.log('\n[4] POST /orphans/ack idempotente (card ja em todo -> skip)')
{
  const a = await spinAtlas()
  await setupCard(a, 'idem', 'card-i', { ageMs: 6*60*1000, logContent: '', colId: 'todo' })
  const r = await a.req('POST', '/api/w/idem/orphans/ack', { cardIds: ['card-i'] })
  ok(r.status === 200, '200')
  ok(r.json?.results?.[0]?.reason?.includes('not doing'), 'skip not-doing (got ' + r.json?.results?.[0]?.reason + ')')
  ok(r.json?.mutated === false, 'mutated=false (idempotente)')
  await a.close()
}

console.log('\n[5] POST /orphans/ack arquivado -> skip')
{
  const a = await spinAtlas()
  await setupCard(a, 'arch', 'card-arch', { ageMs: 6*60*1000, logContent: '', archived: true })
  const r = await a.req('POST', '/api/w/arch/orphans/ack', { cardIds: ['card-arch'] })
  ok(r.json?.results?.[0]?.reason === 'archived', 'skip archived')
  await a.close()
}

console.log('\n[6] POST /orphans/ack com .status.state=merge-failed -> CRASH_MERGE_FAILED')
{
  const a = await spinAtlas()
  await setupCard(a, 'mf', 'card-mf', { ageMs: 6*60*1000, logContent: 'log com 1 linha', status: { state: 'merge-failed', log: 'conflito x' } })
  const r = await a.req('POST', '/api/w/mf/orphans/ack', { cardIds: ['card-mf'] })
  ok(r.json?.results?.[0]?.classification === 'CRASH_MERGE_FAILED', 'classification=CRASH_MERGE_FAILED')
  await a.close()
}

console.log('\n[7] POST /orphans/ack nao sobrescreve result existente')
{
  const a = await spinAtlas()
  mkdirSync(join(a.cwd, 'data', 'keep'), { recursive: true })
  const board = { ver: 1, columns: [{id:'todo',name:'To Do'},{id:'doing',name:'Doing'}], cards: [{
    id: 'keep', colId: 'doing', title: 'k', startedAt: Date.now() - 6*60*1000, ts: 0,
    result: 'RESULT MANUAL - nao mexer',
  }] }
  writeFileSync(join(a.cwd, 'data', 'keep', 'kanban.json'), JSON.stringify(board, null, 2))
  const repo = a.cwd
  const runsDir = join(repo, 'data', '.wt', 'runs', 'keep')
  mkdirSync(runsDir, { recursive: true })
  writeFileSync(join(runsDir, 'keep.status'), JSON.stringify({ state: 'running' }))
  writeFileSync(join(runsDir, 'keep.log'), 'conteudo')
  const r = await a.req('POST', '/api/w/keep/orphans/ack', { cardIds: ['keep'] })
  const c = JSON.parse(readFileSync(join(a.cwd, 'data', 'keep', 'kanban.json'), 'utf8')).cards[0]
  ok(c.colId === 'todo', 'colId=todo (movido)')
  ok(c.result === 'RESULT MANUAL - nao mexer', 'result preservado (got ' + c.result + ')')
  ok(c.crashRetry === true, 'crashRetry=true (mesmo sem mexer result)')
  await a.close()
}

console.log('\n[8] GET /orphans enriquecido: logTail, classification, statusState, lastHeartbeatAt')
{
  const a = await spinAtlas()
  await setupCard(a, 'enr', 'card-enr', {
    ageMs: 6*60*1000,
    logContent: 'linha1\nlinha2\nlinha3\nlinha4\nlinha5\nlinha6\n',
    logMtime: 6*60*1000,  // log velho > STALE_MS para ser orphan
    status: { state: 'running', lastHeartbeatAt: Date.now() - 6*60*1000 }  // heartbeat velho em ms (consistente com wrapper Python ms)
  })
  const r = await a.req('GET', '/api/w/enr/orphans')
  const o = r.json?.orphans?.[0]
  ok(o?.cardId === 'card-enr', 'cardId (got ' + o?.cardId + ')')
  ok(o?.statusState === 'running', 'statusState=running (got ' + o?.statusState + ')')
  ok(typeof o?.lastHeartbeatAt === 'number', 'lastHeartbeatAt presente (got ' + o?.lastHeartbeatAt + ')')
  ok(typeof o?.logTail === 'string' && o.logTail.length > 0, 'logTail nao vazio (got len=' + (o?.logTail?.length || 0) + ')')
  ok((o?.logTail?.split('\n')?.length || 0) >= 2, 'logTail multi-linha (got ' + (o?.logTail?.split('\n')?.length || 0) + ')')
  ok(o?.classification === 'CRASH_HERMES_STUCK', 'classification=CRASH_HERMES_STUCK (got ' + o?.classification + ')')
  ok(o?.orphanWorktreePath === null, 'orphanWorktreePath=null (wt nao existe) (got ' + o?.orphanWorktreePath + ')')
  await a.close()
}

console.log('\n[9] GET /orphans: orphanWorktreePath preenchido se wt existe')
{
  const a = await spinAtlas()
  await setupCard(a, 'wtpath', 'card-wtp', {
    ageMs: 6*60*1000,
    logContent: '',
  })
  // cria a worktree orfa'
  const wtPath = join(a.cwd, 'data', '.wt', 'wtpath', 'card-wtp')
  mkdirSync(wtPath, { recursive: true })
  writeFileSync(join(wtPath, '.git'), 'gitdir: ../../../.git/worktrees/card-wtp')
  const r = await a.req('GET', '/api/w/wtpath/orphans')
  const o = r.json?.orphans?.[0]
  ok(o?.orphanWorktreePath === wtPath, 'orphanWorktreePath=' + wtPath + ' (got ' + o?.orphanWorktreePath + ')')
  await a.close()
}

console.log('\n[10] GET /orphans: CRASH_WRAPPER_DIED quando log vazio + sem heartbeat')
{
  const a = await spinAtlas()
  await setupCard(a, 'wd2', 'card-wd2', { ageMs: 6*60*1000, logContent: '' })
  const r = await a.req('GET', '/api/w/wd2/orphans')
  ok(r.json?.orphans?.[0]?.classification === 'CRASH_WRAPPER_DIED', 'classification=CRASH_WRAPPER_DIED (got ' + r.json?.orphans?.[0]?.classification + ')')
  await a.close()
}

console.log('\n[11] POST /orphans/ack + GET /orphans combinam (ack remove o card da lista)')
{
  const a = await spinAtlas()
  await setupCard(a, 'both', 'card-b', { ageMs: 6*60*1000, logContent: '' })
  const before = await a.req('GET', '/api/w/both/orphans')
  ok(before.json?.orphans?.length === 1, 'antes ack: 1 orphan')
  await a.req('POST', '/api/w/both/orphans/ack', { cardIds: ['card-b'] })
  const after = await a.req('GET', '/api/w/both/orphans')
  ok(after.json?.orphans?.length === 0, 'apos ack: 0 orphans')
  await a.close()
}

console.log('\n[12] SOURCE EQUALITY — wrapper heartbeat + orphans routes')
{
  ok(apiSrc.includes("import threading as _th,_t"), 'wrapper importa threading (api.ts wrapper)')
  ok(apiSrc.includes("_hb()"), 'wrapper define _hb (heartbeat daemon)')
  ok(apiSrc.includes("_th.Thread(target=_hb,daemon=True).start()"), 'wrapper arranca thread daemon')
  ok(apiSrc.includes("'lastHeartbeatAt':int(_t.time()*1000)"), 'wrapper escreve lastHeartbeatAt (ms) no .status')
  ok(apiSrc.includes("parts[3] === 'ack'"), 'POST /orphans/ack route guard')
  ok(apiSrc.includes("CRASH_WRAPPER_DIED"), 'classification CRASH_WRAPPER_DIED')
  ok(apiSrc.includes("CRASH_HERMES_STUCK"), 'classification CRASH_HERMES_STUCK')
  ok(apiSrc.includes("CRASH_MERGE_FAILED"), 'classification CRASH_MERGE_FAILED')
  ok(apiSrc.includes("CRASH_TRANSIENT"), 'classification CRASH_TRANSIENT (R2/Q5 fallback)')
  ok(apiSrc.includes("logTail"), 'logTail field no GET /orphans')
  ok(apiSrc.includes("orphanWorktreePath"), 'orphanWorktreePath field no GET /orphans')
  ok(apiSrc.includes("classification = (() => {"), 'classification IIFE pattern')
}

console.log('\n' + (failures === 0 ? 'PASS' : 'FAIL') + ': ' + failures + ' failures')
process.exit(failures === 0 ? 0 : 1)
