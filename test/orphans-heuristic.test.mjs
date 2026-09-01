// test/orphans-heuristic.test.mjs
//
// Cobre /api/w/:slug/orphans: heuristica de deteccao de cards stuck em 'doing'
// com worker crash. Janela STALE_MS = 5min (5*60*1000ms). Card e' orphan se
// startedAt > 5min atras E (log vazio OU log parado > 5min). Idempotente.
//
// Estilo: vanilla node:assert. SOURCE EQUALITY (api.ts:1058-1099).
//
// Run: node test/orphans-heuristic.test.mjs

import { readFileSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs'
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

// helper: cria um card 'doing' com ageMs e ficheiros .log e .status
async function setupCard(a, slug, cardId, opts = {}) {
  const { ageMs = FIVE_MIN + 60000, logMtime = 0, logContent = '', status = { state: 'running' }, colId = 'doing', archived = false } = opts
  // Escreve kanban.json com o card
  mkdirSync(join(a.cwd, 'data', slug), { recursive: true })
  const board = { ver: 1, columns: [{id:'todo',name:'To Do'},{id:'doing',name:'Doing'},{id:'done',name:'Done'}], cards: [{
    id: cardId, colId, title: `Card ${cardId}`,
    startedAt: Date.now() - ageMs,
    priority: 'medium', ts: Date.now() - ageMs, archived,
  }] }
  writeFileSync(join(a.cwd, 'data', slug, 'kanban.json'), JSON.stringify(board, null, 2))
  // Cria runs/<slug>/<cardId>.status e .log
  const repo = a.cwd  // atlasRepo = cwd
  const runsDir = join(repo, 'data', '.wt', 'runs', slug)
  mkdirSync(runsDir, { recursive: true })
  writeFileSync(join(runsDir, cardId + '.status'), JSON.stringify(status))
  if (logContent || logMtime) {
    const logPath = join(runsDir, cardId + '.log')
    writeFileSync(logPath, logContent || 'running...')
    if (logMtime > 0) {
      // Forca mtime para logMtime ms atras
      const mtimeSec = (Date.now() - logMtime) / 1000
      utimesSync(logPath, mtimeSec, mtimeSec)
    }
  }
}

console.log('\n[1] sem kanban.json -> orphans: [] (200, nao 500)')
{
  const a = await spinAtlas()
  const r = await a.req('GET', '/api/w/no-board/orphans')
  ok(r.status === 200, `GET orphans sem board -> 200 (got ${r.status})`)
  ok(Array.isArray(r.json?.orphans) && r.json.orphans.length === 0, `orphans vazio (got ${r.json?.orphans?.length})`)
  await a.close()
}

console.log('\n[2] card com ageMs < 5min NAO conta (ainda a arrancar)')
{
  const a = await spinAtlas()
  await setupCard(a, 'young', 'card-young', { ageMs: 60 * 1000 })  // 1 min
  const r = await a.req('GET', '/api/w/young/orphans')
  ok(r.json?.orphans?.length === 0, `1min card NAO e' orphan (got ${r.json?.orphans?.length})`)
  await a.close()
}

console.log('\n[3] card 6min + log vazio (sem .log file) -> orphan')
{
  const a = await spinAtlas()
  await setupCard(a, 'empty-log', 'card-1', { ageMs: 6 * 60 * 1000, logContent: null })
  const r = await a.req('GET', '/api/w/empty-log/orphans')
  ok(r.json?.orphans?.length === 1, `6min+log vazio -> 1 orphan (got ${r.json?.orphans?.length})`)
  const o = r.json?.orphans?.[0]
  ok(o?.cardId === 'card-1', `cardId (got ${o?.cardId})`)
  ok(o?.logSize === 0, `logSize=0 (got ${o?.logSize})`)
  await a.close()
}

console.log('\n[4] card 6min + log velho (>5min) -> orphan')
{
  const a = await spinAtlas()
  await setupCard(a, 'stale-log', 'card-stale', { ageMs: 6 * 60 * 1000, logContent: 'old', logMtime: 6 * 60 * 1000 })
  const r = await a.req('GET', '/api/w/stale-log/orphans')
  ok(r.json?.orphans?.length === 1, `log velho -> orphan (got ${r.json?.orphans?.length})`)
  await a.close()
}

console.log('\n[5] card 6min + log recente (<5min) -> NAO orphan (ainda a escrever)')
{
  const a = await spinAtlas()
  await setupCard(a, 'active', 'card-active', { ageMs: 6 * 60 * 1000, logContent: 'active!', logMtime: 30 * 1000 })
  const r = await a.req('GET', '/api/w/active/orphans')
  ok(r.json?.orphans?.length === 0, `log recente NAO e' orphan (got ${r.json?.orphans?.length})`)
  await a.close()
}

console.log('\n[6] card arquivado ou done NAO conta (mesmo com ageMs > 5min)')
{
  const a = await spinAtlas()
  // card em 'todo' (nao 'doing') com ageMs 6min -> skip
  // 1. card em 'todo' nao conta
  await setupCard(a, 'notdoing', 'card-todo', { colId: 'todo' })
  const r = await a.req('GET', '/api/w/notdoing/orphans')
  ok(r.json?.orphans?.length === 0, `card em 'todo' NAO e' orphan (got ${r.json?.orphans?.length})`)

  // Manipula o kanban para meter colId != 'doing'
  const board = { ver:1, columns:[], cards:[{
    id:'archived', colId:'done', title:'done', startedAt: Date.now() - 6*60*1000, archived:true, ts:0
  }]}
  writeFileSync(join(a.cwd, 'data', 'notdoing', 'kanban.json'), JSON.stringify(board, null, 2))
  const r2 = await a.req('GET', '/api/w/notdoing/orphans')
  ok(r2.json?.orphans?.length === 0, `archived/done NAO contam (got ${r2.json?.orphans?.length})`)
  await a.close()
}

console.log('\n[7] card sem .status NAO conta')
{
  const a = await spinAtlas()
  // Card em doing com 6min mas SEM ficheiro .status
  mkdirSync(join(a.cwd, 'data', 'nostatus'), { recursive: true })
  const board = { ver:1, columns:[{id:'doing',name:'Doing'}], cards:[{
    id:'no-status', colId:'doing', title:'x', startedAt: Date.now() - 6*60*1000, ts:0
  }]}
  writeFileSync(join(a.cwd, 'data', 'nostatus', 'kanban.json'), JSON.stringify(board, null, 2))
  const r = await a.req('GET', '/api/w/nostatus/orphans')
  ok(r.json?.orphans?.length === 0, `sem .status -> NAO orphan (got ${r.json?.orphans?.length})`)
  await a.close()
}

console.log('\n[8] card com .status.state != running NAO conta')
{
  const a = await spinAtlas()
  await setupCard(a, 'done-state', 'card-d', { ageMs: 6*60*1000, status: { state: 'done' } })
  const r = await a.req('GET', '/api/w/done-state/orphans')
  ok(r.json?.orphans?.length === 0, `state != running -> NAO orphan (got ${r.json?.orphans?.length})`)
  await a.close()
}

console.log('\n[9] GET idempotente (nao muta estado)')
{
  const a = await spinAtlas()
  await setupCard(a, 'idem', 'card-i', { ageMs: 6*60*1000, logContent: null })
  const r1 = await a.req('GET', '/api/w/idem/orphans')
  const r2 = await a.req('GET', '/api/w/idem/orphans')
  ok(r1.json?.orphans?.length === 1 && r2.json?.orphans?.length === 1, `2x GET dao mesmo resultado`)
  // Card continua em 'doing'
  const board = JSON.parse(readFileSync(join(a.cwd, 'data', 'idem', 'kanban.json'), 'utf8'))
  ok(board.cards[0].colId === 'doing', `card nao foi movido (colId=${board.cards[0].colId})`)
  await a.close()
}

console.log('\n[10] STALE_MS = 5min (5*60*1000 = 300000) - boundary tests')
{
  // ponytail: 1 helper, 2 cards com slugs diferentes. Reusar a1 evita o
  // module-cache trap do DATA (api.ts:11 captura process.cwd() no import).
  const a1 = await spinAtlas()
  // 4min 59s - NAO
  await setupCard(a1, 'edge-low', 'card-low', { ageMs: 4*60*1000 + 59*1000, logContent: null })
  const r1 = await a1.req('GET', '/api/w/edge-low/orphans')
  ok(r1.json?.orphans?.length === 0, `4min59s -> NAO orphan (boundary test)`)
  // 5min 1s - SIM
  await setupCard(a1, 'edge-high', 'card-high', { ageMs: 5*60*1000 + 1*1000, logContent: null })
  const r2 = await a1.req('GET', '/api/w/edge-high/orphans')
  ok(r2.json?.orphans?.length === 1, `5min1s -> orphan (boundary test, got ${r2.json?.orphans?.length})`)
  await a1.close()
}

// SOURCE EQUALITY
console.log('\n[11] SOURCE EQUALITY — api.ts:1058-1099 (route + heuristic + 5min)')
{
  ok(apiSrc.includes("parts[0] === 'w' && parts.length === 3 && parts[2] === 'orphans' && m === 'GET'"), 'guard: orphans GET (api.ts:1061)')
  ok(apiSrc.includes('STALE_MS = 5 * 60 * 1000'), 'STALE_MS=5min (api.ts:1064)')
  ok(apiSrc.includes("logStale = logMtime === 0 || (now - logMtime) > STALE_MS"), 'logStale check (api.ts:1085)')
  ok(apiSrc.includes("c.archived || c.colId !== 'doing' || !c.startedAt"), 'skip archived/done/no-startedAt (api.ts:1071)')
  ok(apiSrc.includes("!st || st.state !== 'running'"), 'skip sem-running status (api.ts:1074)')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
