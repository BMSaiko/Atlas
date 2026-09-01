// test/notes-kanban-put.test.mjs
//
// Cobre GET/PUT /api/w/:slug/notes e /api/w/:slug/kanban — defaults, OT
// (ver mismatch 409), wipe guard + backup (threshold max(5, before*0.5)),
// backup pre-PUT + prune 10, sanitize id, ver bump, kill-on-transition.
// Estilo: vanilla node:assert. SOURCE EQUALITY (api.ts:1245-1344).
//
// Run: node test/notes-kanban-put.test.mjs

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs'
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

async function mkWorkdir(a, slug) {
  mkdirSync(join(a.cwd, 'data', slug), { recursive: true })
}

console.log('\n[1] GET /api/w/:slug/notes sem ficheiro -> default {ver:0,items:[]}')
{
  const a = await spinAtlas()
  await mkWorkdir(a, 'nk1')
  const r = await a.req('GET', '/api/w/nk1/notes')
  ok(r.status === 200, `200 (got ${r.status})`)
  ok(r.json?.ver === 0 && Array.isArray(r.json?.items) && r.json.items.length === 0, `default (got ${JSON.stringify(r.json)})`)
  await a.close()
}

console.log('\n[2] GET /api/w/:slug/kanban sem ficheiro -> default {ver:0,columns:[],cards:[]}')
{
  const a = await spinAtlas()
  await mkWorkdir(a, 'nk2')
  const r = await a.req('GET', '/api/w/nk2/kanban')
  ok(r.status === 200, `200 (got ${r.status})`)
  ok(r.json?.ver === 0 && Array.isArray(r.json?.columns) && Array.isArray(r.json?.cards), `default (got ${JSON.stringify(r.json)})`)
  await a.close()
}

console.log('\n[3] PUT notes — ver bump (writeJ avanca ver)')
{
  const a = await spinAtlas()
  await mkWorkdir(a, 'nk3')
  writeFileSync(join(a.cwd, 'data', 'nk3', 'notes.json'), JSON.stringify({ ver: 5, items: [] }))
  const r = await a.req('PUT', '/api/w/nk3/notes', { ver: 5, items: [] })
  ok(r.status === 200, `200 (got ${r.status}, body=${JSON.stringify(r.json)})`)
  const after = JSON.parse(readFileSync(join(a.cwd, 'data', 'nk3', 'notes.json'), 'utf8'))
  ok(after.ver === 6, `ver bumped 5->6 (got ${after.ver})`)
  await a.close()
}

console.log('\n[4] PUT notes — OT mismatch (inVer != storedVer, storedVer != 0) -> 409')
{
  const a = await spinAtlas()
  await mkWorkdir(a, 'nk4')
  writeFileSync(join(a.cwd, 'data', 'nk4', 'notes.json'), JSON.stringify({ ver: 3, items: [] }))
  const r = await a.req('PUT', '/api/w/nk4/notes', { ver: 2, items: [] })
  ok(r.status === 409, `409 (got ${r.status}, body=${JSON.stringify(r.json)})`)
  ok(r.json?.ver === 3, `devolve storedVer (got ${r.json?.ver})`)
  ok(r.json?.error?.includes('conflito'), `error (got ${r.json?.error})`)
  await a.close()
}

console.log('\n[5] PUT notes — sanitize: items sem id recebem nid()')
{
  const a = await spinAtlas()
  await mkWorkdir(a, 'nk5')
  writeFileSync(join(a.cwd, 'data', 'nk5', 'notes.json'), JSON.stringify({ ver: 0, items: [] }))
  const r = await a.req('PUT', '/api/w/nk5/notes', {
    ver: 0,
    items: [{ title: 'a' }, { id: 'manter', title: 'b' }, { title: 'c' }],
  })
  ok(r.status === 200, `200 (got ${r.status})`)
  const after = JSON.parse(readFileSync(join(a.cwd, 'data', 'nk5', 'notes.json'), 'utf8'))
  ok(after.items.length === 3, `3 items (got ${after.items.length})`)
  ok(after.items[0].id && typeof after.items[0].id === 'string' && after.items[0].id.length >= 4, `item 0 ganhou id (got ${after.items[0].id})`)
  ok(after.items[1].id === 'manter', `item 1 id preservado`)
  ok(after.items[2].id && after.items[2].id !== 'manter', `item 2 ganhou id novo`)
  await a.close()
}

console.log('\n[6] PUT notes — wipe guard: loss > threshold sem X-Atlas-Confirm-Wipe -> 409 + backup')
{
  const a = await spinAtlas()
  await mkWorkdir(a, 'nk6')
  // 20 items -> threshold = max(5, 10) = 10. loss de 20 -> 1 = 19 > 10
  const items = Array.from({ length: 20 }, (_, i) => ({ id: 'i' + i, title: 't' + i }))
  writeFileSync(join(a.cwd, 'data', 'nk6', 'notes.json'), JSON.stringify({ ver: 0, items }))
  const r = await a.req('PUT', '/api/w/nk6/notes', { ver: 0, items: [items[0]] })
  ok(r.status === 409, `409 (got ${r.status}, body=${JSON.stringify(r.json)})`)
  ok(r.json?.error?.includes('wipe'), `error wipe (got ${r.json?.error})`)
  ok(r.json?.before === 20 && r.json?.after === 1, `before/after (got ${JSON.stringify({ b: r.json?.before, a: r.json?.after })})`)
  ok(r.json?.loss === 19, `loss=19 (got ${r.json?.loss})`)
  // backup criado
  const backupDir = join(a.cwd, 'data', 'nk6', '.backup')
  ok(existsSync(backupDir), `backup dir criado`)
  const files = readdirSync(backupDir).filter(f => f.startsWith('notes-'))
  ok(files.length >= 1, `>=1 backup file (got ${files.length})`)
  await a.close()
}

console.log('\n[7] PUT notes — wipe guard: com X-Atlas-Confirm-Wipe: yes -> proceed')
{
  const a = await spinAtlas()
  await mkWorkdir(a, 'nk7')
  const items = Array.from({ length: 20 }, (_, i) => ({ id: 'i' + i, title: 't' + i }))
  writeFileSync(join(a.cwd, 'data', 'nk7', 'notes.json'), JSON.stringify({ ver: 0, items }))
  const r = await a.req('PUT', '/api/w/nk7/notes',
    { ver: 0, items: [items[0]] },
    { 'X-Atlas-Confirm-Wipe': 'yes' })
  ok(r.status === 200, `200 (got ${r.status}, body=${JSON.stringify(r.json)})`)
  const after = JSON.parse(readFileSync(join(a.cwd, 'data', 'nk7', 'notes.json'), 'utf8'))
  ok(after.items.length === 1, `1 item (got ${after.items.length})`)
  await a.close()
}

console.log('\n[8] PUT notes — pre-PUT backup prune: 12 PUTs -> <=10 backups')
{
  const a = await spinAtlas()
  await mkWorkdir(a, 'nk8')
  writeFileSync(join(a.cwd, 'data', 'nk8', 'notes.json'), JSON.stringify({ ver: 0, items: [] }))
  for (let i = 0; i < 12; i++) {
    // cada PUT bump ver, por isso atualizamos inVer
    const cur = JSON.parse(readFileSync(join(a.cwd, 'data', 'nk8', 'notes.json'), 'utf8'))
    await a.req('PUT', '/api/w/nk8/notes', { ver: cur.ver, items: [] })
  }
  const files = readdirSync(join(a.cwd, 'data', 'nk8', '.backup')).filter(f => f.startsWith('notes-'))
  ok(files.length === 10, `prune a 10 backups (got ${files.length})`)
  await a.close()
}

console.log('\n[9] PUT kanban — kill-on-transition: card doing->done com shim noop')
{
  const a = await spinAtlas({ env: { ATLAS_TEST_NO_SPAWN: '1' } })
  await mkWorkdir(a, 'nk9')
  // card em doing (tem pane ficticio em status; mas como nao chamamos /run, nao ha status file
  // -> killPaneForCard noop natural). Verificamos que transicao NAO causa throw.
  writeFileSync(join(a.cwd, 'data', 'nk9', 'kanban.json'), JSON.stringify({
    ver: 1, columns: [{ id: 'todo' }, { id: 'doing' }, { id: 'review' }, { id: 'done' }],
    cards: [
      { id: 'c1', colId: 'doing', title: 'em curso', startedAt: 1, result: 'antigo' },
      { id: 'c2', colId: 'todo', title: 'pendente' },
    ],
  }))
  const r = await a.req('PUT', '/api/w/nk9/kanban', {
    ver: 1, columns: [{ id: 'todo' }, { id: 'doing' }, { id: 'review' }, { id: 'done' }],
    cards: [
      { id: 'c1', colId: 'done', title: 'em curso', result: 'final' },
      { id: 'c2', colId: 'todo', title: 'pendente' },
    ],
  })
  ok(r.status === 200, `200 (got ${r.status}, body=${JSON.stringify(r.json)})`)
  const after = JSON.parse(readFileSync(join(a.cwd, 'data', 'nk9', 'kanban.json'), 'utf8'))
  ok(after.cards[0].colId === 'done', `c1 done (got ${after.cards[0].colId})`)
  await a.close()
}

console.log('\n[10] PUT notes — SLUG regex: 400 em slug invalido')
{
  const a = await spinAtlas()
  const r = await a.req('PUT', '/api/w/MAIUSCULA/notes', { ver: 0, items: [] })
  ok(r.status === 400, `400 (got ${r.status})`)
  await a.close()
}

console.log('\n[11] SOURCE EQUALITY — OT, wipe, sanitize, backup')
{
  ok(apiSrc.includes("if (storedVer !== 0 && inVer !== storedVer)"), 'OT 409 guard')
  ok(apiSrc.includes('conflito de versao'), 'OT error message')
  ok(apiSrc.includes("const arrKey = kind === 'notes' ? 'items' : 'cards'"), 'arrKey notes/cards')
  ok(apiSrc.includes("const threshold = Math.max(5, Math.floor(beforeCount * 0.5))"), 'threshold max(5, 0.5*before)')
  ok(apiSrc.includes("'x-atlas-confirm-wipe'"), 'wipe header name')
  ok(apiSrc.includes("it.id = nid()"), 'sanitize id assign')
  ok(apiSrc.includes("while (files.length > 10)"), 'backup prune to 10')
  ok(apiSrc.includes("if (a.archived || (a.colId && a.colId !== 'doing'))"), 'kill-on-transition trigger')
  ok(apiSrc.includes("void killPaneForCard(slug, a.id)"), 'kill-pane fire-and-forget')
  ok(apiSrc.includes("if (kind === 'notes' && b && Array.isArray(b.items))"), 'sanitize branch')
  ok(apiSrc.includes("function bumpVer(v: any)"), 'ver bump helper')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
