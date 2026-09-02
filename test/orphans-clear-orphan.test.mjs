// test/orphans-clear-orphan.test.mjs
//
// Cobre POST /api/w/:slug/cards/:cardId/clear-orphan (card h1y3yfsy).
// 1 caller: kanban.ts viewModal "Limpar worktree o'rf~a'" -> api.run.clearOrphan (src/api.ts).
//
// Estilo: vanilla node:assert + spinAtlas. SOURCE EQUALITY ancorando o handler.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
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

// helper: cria board com 1 card "doing" + .orphanWorktreePath setado + wt dir existente
async function setupCard(a, slug, cardId, { withWt = true } = {}) {
  mkdirSync(join(a.cwd, 'data', slug), { recursive: true })
  const wtPath = withWt ? join(a.cwd, 'data', '.wt', slug, cardId) : null
  if (wtPath) mkdirSync(wtPath, { recursive: true })
  const board = { ver: 1, columns: [{id:'todo',name:'To Do'},{id:'doing',name:'Doing'}], cards: [{
    id: cardId, colId: 'doing', title: 'Card ' + cardId, priority: 'medium', ts: 0, archived: false,
    startedAt: Date.now() - 6*60*1000,
    crashRetry: true, crashAt: Date.now() - 60000,
    ...(wtPath ? { orphanWorktreePath: wtPath } : {}),
  }] }
  writeFileSync(join(a.cwd, 'data', slug, 'kanban.json'), JSON.stringify(board, null, 2))
  return { wtPath, board }
}

console.log('\n[1] POST clear-orphan sem orphanWorktreePath -> 404')
{
  const a = await spinAtlas()
  const { wtPath: _ } = await setupCard(a, 'no-wt', 'card-x', { withWt: false })
  const r = await a.req('POST', '/api/w/no-wt/cards/card-x/clear-orphan')
  ok(r.status === 404, '404 (got ' + r.status + ')')
  ok(r.json?.error?.includes('no orphan'), 'mensagem menciona "no orphan" (got ' + r.json?.error + ')')
  await a.close()
}

console.log('\n[2] POST clear-orphan card inexistente -> 404')
{
  const a = await spinAtlas()
  const r = await a.req('POST', '/api/w/no-board/cards/nope/clear-orphan')
  ok(r.status === 404, '404 (got ' + r.status + ')')
  await a.close()
}

console.log('\n[3] POST clear-orphan com wt existente -> 200, wt apagado, campo limpo, ver++')
{
  const a = await spinAtlas()
  const { wtPath } = await setupCard(a, 'wt-ok', 'card-w', { withWt: true })
  ok(existsSync(wtPath), 'wt existe pre')
  // cria ficheiro dentro do wt para confirmar remocao real
  writeFileSync(join(wtPath, 'dummmy.txt'), 'x')
  const r = await a.req('POST', '/api/w/wt-ok/cards/card-w/clear-orphan')
  ok(r.status === 200, '200 (got ' + r.status + ')')
  ok(r.json?.ok === true, 'ok=true')
  ok(r.json?.cleared === wtPath, 'cleared=' + wtPath + ' (got ' + r.json?.cleared + ')')
  ok(!existsSync(wtPath), 'wt apagado do disco')
  // card no disco
  const board = JSON.parse(readFileSync(join(a.cwd, 'data', 'wt-ok', 'kanban.json'), 'utf8'))
  const c = board.cards[0]
  ok(!c.orphanWorktreePath, 'c.orphanWorktreePath removido (got ' + c.orphanWorktreePath + ')')
  ok(c.crashRetry === true, 'c.crashRetry preservado (nao toca no resto)')
  ok(board.ver >= 2, 'ver bumped >=2 (got ' + board.ver + ')')
  await a.close()
}

console.log('\n[4] POST clear-orphan idempotente (segunda chamada -> 404, card sem wt)')
{
  const a = await spinAtlas()
  const { wtPath } = await setupCard(a, 'idem', 'card-i', { withWt: true })
  await a.req('POST', '/api/w/idem/cards/card-i/clear-orphan')
  const r = await a.req('POST', '/api/w/idem/cards/card-i/clear-orphan')
  ok(r.status === 404, '404 (got ' + r.status + ')')
  ok(r.json?.error?.includes('no orphan'), 'no orphan (got ' + r.json?.error + ')')
  await a.close()
}

console.log('\n[5] POST clear-orphan com wt ja inexistente no disco (succeeded any way)')
{
  const a = await spinAtlas()
  const { wtPath } = await setupCard(a, 'gone', 'card-g', { withWt: true })
  rmSync(wtPath, { recursive: true, force: true })
  // card ainda tem orphanWorktreePath (apontando para algo que nao existe)
  const r = await a.req('POST', '/api/w/gone/cards/card-g/clear-orphan')
  ok(r.status === 200, '200 (rm/wt prune silenciosos) (got ' + r.status + ')')
  const board = JSON.parse(readFileSync(join(a.cwd, 'data', 'gone', 'kanban.json'), 'utf8'))
  ok(!board.cards[0].orphanWorktreePath, 'campo limpo mesmo sem wt em disco')
  await a.close()
}

console.log('\n[6] POST clear-orphan nao toca em crashRetry/startedAt')
{
  const a = await spinAtlas()
  const { wtPath } = await setupCard(a, 'keep-state', 'card-k')
  const r = await a.req('POST', '/api/w/keep-state/cards/card-k/clear-orphan')
  const c = JSON.parse(readFileSync(join(a.cwd, 'data', 'keep-state', 'kanban.json'), 'utf8')).cards[0]
  ok(c.crashRetry === true, 'crashRetry preservado')
  ok(typeof c.crashAt === 'number', 'crashAt preservado')
  ok(c.colId === 'doing', 'colId NAO tocado (wt-remove nao mexe no flow) (got ' + c.colId + ')')
  await a.close()
}

console.log('\n[7] POST clear-orphan com card archived (orphanWorktreePath setado) -> ainda funciona')
{
  const a = await spinAtlas()
  const { wtPath } = await setupCard(a, 'arch', 'card-a', { withWt: true })
  // arquivar manualmente
  const fp = join(a.cwd, 'data', 'arch', 'kanban.json')
  const board = JSON.parse(readFileSync(fp, 'utf8'))
  board.cards[0].archived = true
  writeFileSync(fp, JSON.stringify(board, null, 2))
  const r = await a.req('POST', '/api/w/arch/cards/card-a/clear-orphan')
  ok(r.status === 200, '200 mesmo arquivado (got ' + r.status + ')')
  await a.close()
}

console.log('\n[8] SOURCE EQUALITY ancorando o handler')
{
  ok(apiSrc.includes("parts[4] === 'clear-orphan'"), 'guard: parts[4]===\'clear-orphan\'')
  ok(apiSrc.includes("m === 'POST'") && apiSrc.includes("'clear-orphan'"), 'method POST')
  ok(apiSrc.includes("await rmJunction(join(wt, 'node_modules'))"), 'rmJunction node_modules')
  ok(apiSrc.includes("runGit(['worktree', 'remove', '--force', wt]"), 'worktree remove --force')
  ok(apiSrc.includes("runGit(['worktree', 'prune']"), 'worktree prune')
  ok(apiSrc.includes("delete c.orphanWorktreePath"), 'limpa c.orphanWorktreePath')
  ok(apiSrc.includes("send(200, { ok: true, cleared: wt })"), 'resposta 200 { ok, cleared }')
  ok(apiSrc.includes("'no orphan worktree on this card'"), 'mensagem 404')
}

console.log('\n' + (failures === 0 ? 'PASS' : 'FAIL') + ': ' + failures + ' failures')
process.exit(failures === 0 ? 0 : 1)
