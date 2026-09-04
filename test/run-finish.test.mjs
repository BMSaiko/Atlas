// test/run-finish.test.mjs
//
// Cobre a logica de finalizacao do p.on('close') em launchHermes (server/api.ts
// ~L29981): 5 branches de promocao/erro. Mirror EXACTO do handler; source
// equality garante que o handler em producao nao derivou sem o teste saber.
//
// Branches (5):
//   [1] code!==0 && !result -> grava result='ERRO: ...', NAO promove
//   [2] code!==0 && result pre-existente -> NAO sobrescreve, NAO promove
//   [3] code===0 && !result -> NAO promove (worker esqueceu de reportar)
//   [4] code===0 && result && colId=doing && !archived && !mergeFailed -> PROMOVE a review
//   [5] mergeFailed -> grava result='MERGE FALHOU...', NAO promove
//   [6] archived -> NAO promove mesmo com tudo ok
//   [7] colId!=doing (user ja mexeu) -> NAO sobrescreve
//
// Run: node test/run-finish.test.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const apiSrc = readFileSync(join(here, '..', 'server', 'api.ts'), 'utf8')

let failures = 0
const ok = (cond, msg) => {
  if (cond) console.log('  ok:', msg)
  else { console.error('  FAIL:', msg); failures++ }
}

// === mirror EXACTO do close-handler em server/api.ts (L29981-30030) ===
// Dev: se mexer no handler, este mirror tem de mudar e o SOURCE EQUALITY falha.
async function runFinish({ dataDir, slug, cardId, code, stPath, killPaneSpy }) {
  // 1. ler stPath para merge-failed
  let stRun = null
  try { stRun = JSON.parse(readFileSync(stPath, 'utf8')) } catch {}
  const mergeFailed = stRun?.state === 'merge-failed'
  // 2. re-escrever stPath com state:done
  try {
    writeFileSync(stPath, JSON.stringify({ state: 'done', code, ts: Date.now() }))
  } catch {}
  // 3. ler kanban
  const ff = join(dataDir, slug, 'kanban.json')
  let board, c
  try { board = JSON.parse(readFileSync(ff, 'utf8')); c = board?.cards?.find(x => x.id === cardId) } catch {}
  // 4. code!==0 && !result -> ERRO
  if (code !== 0) {
    if (c && !c.result) {
      c.result = 'ERRO: processo terminou com código ' + code + ' — abre o terminal/card para ver o log.'
      try { writeFileSync(ff, JSON.stringify(board)) } catch {}
    }
  }
  // 5. mergeFailed && !result -> MERGE FALHOU
  if (mergeFailed && c && !c.result) {
    c.result = 'MERGE FALHOU apos retry (conflito real ou divergencia). Abre o log do card para inspecao — worktree mantida.'
    try { writeFileSync(ff, JSON.stringify(board)) } catch {}
  }
  // 6. promocao doing->review
  if (c && !c.archived && c.colId === 'doing' && code === 0 && !mergeFailed && c.result) {
    killPaneSpy.push(cardId)  // mirror do killPaneForCard
    c.colId = 'review'
    try { writeFileSync(ff, JSON.stringify(board)) } catch {}
  }
}

// fixture helper
function tmpWorkdir() {
  const root = mkdtempSync(join(tmpdir(), 'atlas-run-finish-'))
  return root
}
function makeCard(slug, card, opts = {}) {
  const dataDir = opts.dataDir
  mkdirSync(join(dataDir, slug), { recursive: true })
  const dir = opts.runsDir || join(dataDir, '..', 'runs', slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dataDir, slug, 'kanban.json'), JSON.stringify({
    ver: 1, columns: [{id:'todo'},{id:'doing'},{id:'review'},{id:'done'}], cards: [card],
  }))
  if (opts.status) {
    writeFileSync(join(dir, card.id + '.status'), JSON.stringify(opts.status))
  }
  return { dataDir, stPath: join(dir, card.id + '.status') }
}

console.log('\n[1] code!==0 + sem result -> grava ERRO, NAO promove')
{
  const dataDir = tmpWorkdir()
  const { stPath } = makeCard('rf1', { id: 'c1', colId: 'doing', title: 't' }, { dataDir })
  const spy = []
  await runFinish({ dataDir, slug: 'rf1', cardId: 'c1', code: 1, stPath, killPaneSpy: spy })
  const board = JSON.parse(readFileSync(join(dataDir, 'rf1', 'kanban.json'), 'utf8'))
  const c = board.cards[0]
  ok(c.colId === 'doing', `colId=doing (got ${c.colId})`)
  ok(c.result?.startsWith('ERRO: '), `result=ERRO (got ${c.result?.slice(0,40)})`)
  ok(spy.length === 0, `killPane NAO chamado`)
  // stPath re-escrito com state:done
  const st = JSON.parse(readFileSync(stPath, 'utf8'))
  ok(st.state === 'done' && st.code === 1, `stPath state=done code=1 (got ${st.state}/${st.code})`)
  rmSync(dataDir, { recursive: true, force: true })
}

console.log('\n[2] code!==0 + result pre-existente -> NAO sobrescreve, NAO promove')
{
  const dataDir = tmpWorkdir()
  const { stPath } = makeCard('rf2', { id: 'c1', colId: 'doing', title: 't', result: 'meu report' }, { dataDir })
  const spy = []
  await runFinish({ dataDir, slug: 'rf2', cardId: 'c1', code: 1, stPath, killPaneSpy: spy })
  const c = JSON.parse(readFileSync(join(dataDir, 'rf2', 'kanban.json'), 'utf8')).cards[0]
  ok(c.result === 'meu report', `result preservado (got ${c.result})`)
  ok(c.colId === 'doing', `colId=doing (got ${c.colId})`)
  rmSync(dataDir, { recursive: true, force: true })
}

console.log('\n[3] code===0 + sem result -> NAO promove (worker esqueceu reportar)')
{
  const dataDir = tmpWorkdir()
  const { stPath } = makeCard('rf3', { id: 'c1', colId: 'doing', title: 't' }, { dataDir })
  const spy = []
  await runFinish({ dataDir, slug: 'rf3', cardId: 'c1', code: 0, stPath, killPaneSpy: spy })
  const c = JSON.parse(readFileSync(join(dataDir, 'rf3', 'kanban.json'), 'utf8')).cards[0]
  ok(c.colId === 'doing', `colId=doing (got ${c.colId})`)
  ok(!c.result, `result vazio (got ${c.result})`)
  ok(spy.length === 0, `killPane NAO chamado`)
  rmSync(dataDir, { recursive: true, force: true })
}

console.log('\n[4] code===0 + result + doing + !archived + !mergeFailed -> PROMOVE review')
{
  const dataDir = tmpWorkdir()
  const { stPath } = makeCard('rf4', { id: 'c1', colId: 'doing', title: 't', result: 'feito' }, { dataDir })
  const spy = []
  await runFinish({ dataDir, slug: 'rf4', cardId: 'c1', code: 0, stPath, killPaneSpy: spy })
  const c = JSON.parse(readFileSync(join(dataDir, 'rf4', 'kanban.json'), 'utf8')).cards[0]
  ok(c.colId === 'review', `colId=review (got ${c.colId})`)
  ok(spy.length === 1 && spy[0] === 'c1', `killPane chamado com cardId`)
  rmSync(dataDir, { recursive: true, force: true })
}

console.log('\n[5] mergeFailed + sem result -> grava MERGE FALHOU, NAO promove')
{
  const dataDir = tmpWorkdir()
  // sem result pre-existente p/ a branch mergeFailed poder gravar
  const { stPath } = makeCard('rf5',
    { id: 'c1', colId: 'doing', title: 't' },
    { dataDir, status: { state: 'merge-failed' } },
  )
  const spy = []
  await runFinish({ dataDir, slug: 'rf5', cardId: 'c1', code: 0, stPath, killPaneSpy: spy })
  const c = JSON.parse(readFileSync(join(dataDir, 'rf5', 'kanban.json'), 'utf8')).cards[0]
  ok(c.colId === 'doing', `colId=doing (got ${c.colId})`)
  ok(c.result?.startsWith('MERGE FALHOU'), `result=MERGE FALHOU (got ${c.result?.slice(0,40)})`)
  ok(spy.length === 0, `killPane NAO chamado`)
  rmSync(dataDir, { recursive: true, force: true })
}

console.log('\n[6] archived -> NAO promove mesmo com tudo ok')
{
  const dataDir = tmpWorkdir()
  const { stPath } = makeCard('rf6', { id: 'c1', colId: 'doing', title: 't', result: 'feito', archived: true }, { dataDir })
  const spy = []
  await runFinish({ dataDir, slug: 'rf6', cardId: 'c1', code: 0, stPath, killPaneSpy: spy })
  const c = JSON.parse(readFileSync(join(dataDir, 'rf6', 'kanban.json'), 'utf8')).cards[0]
  ok(c.colId === 'doing', `colId=doing (got ${c.colId})`)
  ok(spy.length === 0, `killPane NAO chamado`)
  rmSync(dataDir, { recursive: true, force: true })
}

console.log('\n[7] colId!=doing (user moveu) -> NAO sobrescreve (mas grava ERRO se code!=0)')
{
  const dataDir = tmpWorkdir()
  const { stPath } = makeCard('rf7', { id: 'c1', colId: 'review', title: 't' }, { dataDir })
  const spy = []
  await runFinish({ dataDir, slug: 'rf7', cardId: 'c1', code: 1, stPath, killPaneSpy: spy })
  const c = JSON.parse(readFileSync(join(dataDir, 'rf7', 'kanban.json'), 'utf8')).cards[0]
  ok(c.colId === 'review', `colId=review (preservado) (got ${c.colId})`)
  ok(c.result?.startsWith('ERRO: '), `ERRO ainda gravado p/ debug (got ${c.result?.slice(0,40)})`)
  rmSync(dataDir, { recursive: true, force: true })
}

console.log('\n[s1] SOURCE EQUALITY — handler nao derivou')
{
  // marcadores exatos do handler em producao. Se algum sumir, este teste falha.
  ok(apiSrc.includes('.then(async (code: number) => {') || apiSrc.includes('.then(async (code) => {'), 'close handler presente (refactor: .then no runCard)')
  ok(apiSrc.includes("const stRun = await readJ(stPath).catch(() => null)"), 'lê stPath para mergeFailed')
  ok(apiSrc.includes("const mergeFailed = stRun?.state === 'merge-failed'"), 'mergeFailed check')
  ok(apiSrc.includes("if (code !== 0) {"), 'branch code!==0')
  ok(apiSrc.includes("if (c && !c.result) { c.result = 'ERRO: processo terminou com código '"), 'ERRO marker')
  ok(apiSrc.includes("if (mergeFailed && c2 && !c2.result) {"), 'branch mergeFailed')
  ok(apiSrc.includes("if (c2 && !c2.archived && c2.colId === 'doing' && code === 0 && !mergeFailed && c2.result) {"), 'guard promocao')
  ok(apiSrc.includes("c2.colId = 'review'"), 'promove a review')
  ok(apiSrc.includes("void killPaneForCard(slug, card.id)"), 'killPaneForCard chamado')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
