// test/null-write-guard.test.mjs
//
// Regression: null-write guard prevents kanban wipe (card null-write-fix).
// Wipe real observado em 2026-09-01T03:43: kanban 117 cards -> 0 cards por PUT com body vazio.
// body() devolve null em Content-Length=0 ou JSON parse fail; sem guard, writeJ grava
// 'null' (4 bytes) e wipea kanban.json. Backup pre-PUT tambem fica vitima (le ficheiro ja corrompido).
//
// Cobertura:
// [1] PUT empty body    -> 400, file untouched
// [2] PUT literal "null" -> 400, file untouched
// [3] PUT {} (no cards) -> 400, file untouched
// [4] PUT cards:'nope'  -> 400, file untouched
// [5] PUT valid          -> 200, file written
// [6] SOURCE EQUALITY    -> guard strings present em api.ts
//
// Run: node test/null-write-guard.test.mjs
// CI:   scripts/run_tests.sh test/null-write-guard.test.mjs -q

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { spinAtlas } from './_atlas-runtime.mjs'

const TOK = 'test-token-1234'
let failures = 0
const ok = (cond, msg) => { if (cond) console.log('  ok:', msg); else { console.error('  FAIL:', msg); failures++ } }

console.log('\n[setup] spinAtlas + seed 1 card')
const a = await spinAtlas({ env: { ATLAS_WTOKEN: TOK } })
// ponytail: writeJ nao cria parent dirs (card null-write-fix spinAtlas so' cria data/, nao data/<slug>/)
mkdirSync(join(a.cwd, 'data', 'atlas'), { recursive: true })
const base = `http://127.0.0.1:${a.port}`
const getBoard = async () => await (await fetch(`${base}/api/w/atlas/kanban`)).json()
const seed = { ver: 0, columns: [{id:'todo',name:'To Do'}], cards: [{id:'tst12345',title:'seed',colId:'todo'}] }
const seedRes = await fetch(`${base}/api/w/atlas/kanban`, {
  method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(seed)
})
ok(seedRes.status === 200, `seed PUT 200 (got ${seedRes.status})`)
let cur = await getBoard()
ok(cur.cards.length === 1, 'seeded with 1 card')
const curVer = () => cur.ver
const getCards = async () => (await getBoard()).cards
const put = async (body) => {
  const res = await fetch(`${base}/api/w/atlas/kanban`, {
    method: 'PUT', headers: {'Content-Type':'application/json'}, body
  })
  if (res.status === 200) cur = await getBoard()
  return res
}

console.log('\n[1] PUT empty body -> 400, file untouched')
const empty = await put('')
ok(empty.status === 400, `empty body -> 400 (got ${empty.status})`)
ok((await getCards()).length === 1, 'card count after empty PUT')

console.log('\n[2] PUT literal "null" -> 400, file untouched')
const nullBody = await put('null')
ok(nullBody.status === 400, `null body -> 400 (got ${nullBody.status})`)
const after_null = await getCards()
ok(after_null.length === 1, 'card count after null PUT')
ok(after_null[0].id === 'tst12345', 'seeded card id intact after null PUT')

console.log('\n[3] PUT {} (no cards array) -> 400, file untouched')
const noArr = await put('{}')
ok(noArr.status === 400, `no-array body -> 400 (got ${noArr.status})`)
ok((await getCards()).length === 1, 'card count after no-array PUT')

console.log('\n[4] PUT cards:"nope" (wrong type) -> 400, file untouched')
const wrongType = await put(JSON.stringify({ver:curVer(), cards:'nope'}))
ok(wrongType.status === 400, `wrong-type body -> 400 (got ${wrongType.status})`)
ok((await getCards()).length === 1, 'card count after wrong-type PUT')

console.log('\n[5] PUT valid -> 200, file written')
const valid = { ver: curVer(), columns: [{id:'todo',name:'To Do'}], cards: [{id:'valid123',title:'valid',colId:'todo'}] }
const okRes = await put(JSON.stringify(valid))
ok(okRes.status === 200, `valid PUT -> 200 (got ${okRes.status})`)
const after_ok = await getCards()
ok(after_ok.length === 1, 'card count after valid PUT')
ok(after_ok[0].id === 'valid123', 'valid card id written')

console.log('\n[6] SOURCE EQUALITY — guard strings present em api.ts')
import { readFileSync } from 'node:fs'
const apiSrc = readFileSync(new URL('../server/api.ts', import.meta.url), 'utf8')
ok(apiSrc.includes("if (!b || typeof b !== 'object')"), 'null-body guard present')
ok(apiSrc.includes("if (arrKey2 && !Array.isArray(b[arrKey2]))"), 'array-type guard present')

await a.close()

if (failures) { console.error(`\nFAIL: ${failures} failures`); process.exit(1) }
else { console.log('\nPASS: null-write-guard regression') }
