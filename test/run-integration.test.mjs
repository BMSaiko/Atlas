// test/run-integration.test.mjs
//
// Integration test REAL: spawn python + git worktree + close-handler doing->review.
// Substitui hermes_cli por fixtures/hermes_cli/ (PYTHONPATH). Cobre os 2 bugs reportados
// em 2026-09-01:
//
//   B1: card preso em doing (worker crashou ou esqueceu result)
//       -> [i2] forget_result mode: colId stays doing, no result
//       -> [i3] crash mode (exit 1): colId doing + result='ERRO: processo terminou com codigo 1'
//   B2: 'ERRO: processo terminou com codigo N' nao aparece
//       -> [i3] crash mode detecta regressao do ERRO marker
//
// Happy path [i1]: spawn OK + kanban.result set + promotion doing->review.
// Source equality [i4]: wrapperWithPane e argv indices inalterados (regressao do dee0c2d).
//
// 4 testes sequenciais partilham 1 atlasRepo (cwd sticky via _sharedCwd); isolamento
// entre eles = slug unico. Worktrees + branches diferentes por teste. Cleanup cross-test
// e' YAGNI (tmpdir apagado no fim do processo).
//
// Run: node test/run-integration.test.mjs

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spinAtlasHarness, waitForClose } from './_atlas-harness.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const apiSrc = readFileSync(join(here, '..', 'server', 'api.ts'), 'utf8')

let failures = 0
const ok = (cond, msg) => {
  if (cond) console.log('  ok:', msg)
  else { console.error('  FAIL:', msg); failures++ }
}

console.log('\n[i1] HAPPY PATH — fake worker escreve card.result, p.on(close) promove doing->review')
{
  const slug = 'int-i1', cardId = 'c-i1'
  const { a, boardPath, stPath, branch, wt } = await spinAtlasHarness({ slug, cardId, mode: 'write_result' })

  const r = await a.req('POST', `/api/w/${slug}/run`, { cardId })
  ok(r.status === 200, `POST /run 200 (got ${r.status}, body=${JSON.stringify(r.text).slice(0,200)})`)

  const { status, board: boardAfter } = await waitForClose(stPath, boardPath)
  const c = boardAfter.cards[0]

  ok(status?.state === 'done', `.status.state=done (got ${status?.state})`)
  ok(status?.code === 0, `.status.code=0 (got ${status?.code})`)
  ok(c?.colId === 'review', `card.colId=review (got ${c?.colId})`)
  ok(c?.result === 'worker done ok', `card.result='worker done ok' (got ${c?.result})`)
  ok(typeof c?.startedAt === 'number' && c.startedAt > 0, `card.startedAt set (got ${c?.startedAt})`)

  // ponytail: i1 = merge OK -> worktree removida no cleanup do wrapper (api.ts L437-438). Worktree mantida so' em i2 (B1 forget) e i3 (crash) p/ inspecao.
  ok(!existsSync(wt), `wt dir removida pelo wrapper apos merge OK (${wt})`)
  ok(!existsSync(join(wt, 'fake-worker-output.txt')), `wt/fake-worker-output.txt removido com wt (commit merged em dev)`)

  await a.close()
}

console.log('\n[i2] B1 forget_result — worker NAO grava result, card fica em doing (B1 detect)')
{
  const slug = 'int-i2', cardId = 'c-i2'
  const { a, boardPath, stPath, wt } = await spinAtlasHarness({ slug, cardId, mode: 'forget_result' })

  const r = await a.req('POST', `/api/w/${slug}/run`, { cardId })
  ok(r.status === 200, `POST /run 200 (got ${r.status})`)

  const { status, board: boardAfter } = await waitForClose(stPath, boardPath)
  const c = boardAfter.cards[0]

  ok(status?.state === 'done', `.status.state=done (got ${status?.state})`)
  ok(status?.code === 0, `.status.code=0 (got ${status?.code})`)
  ok(c?.colId === 'doing', `card.colId=doing (NAO promove sem result) (got ${c?.colId})`)
  ok(c?.result === undefined, `card.result vazio (got ${c?.result})`)
  // ponytail: forget_result deixa o wrapper entrar em cleanup (rc==0 → merge OK) — wt removida mesmo sem result.
  // B1 detect fia-se no colId=doing + !result (que e' o sintoma real). Verto BUG: em producao, wt devia ser preservada
  // para o user inspeccionar; por agora o teste reflecte o comportamento actual e documenta o gap.
  ok(!existsSync(wt), `wt dir removida (bug B1 conhecido: wt apagada sem result)`)

  await a.close()
}

console.log('\n[i3] B1+B2 crash — worker exit 1, ERRO marker gravado, card fica em doing')
{
  const slug = 'int-i3', cardId = 'c-i3'
  const { a, boardPath, stPath, wt } = await spinAtlasHarness({ slug, cardId, mode: 'crash' })

  const r = await a.req('POST', `/api/w/${slug}/run`, { cardId })
  ok(r.status === 200, `POST /run 200 (got ${r.status})`)

  const { status, board: boardAfter } = await waitForClose(stPath, boardPath)
  const c = boardAfter.cards[0]

  ok(status?.state === 'done', `.status.state=done (got ${status?.state})`)
  ok(status?.code !== 0, `.status.code!=0 (got ${status?.code})`)
  ok(c?.colId === 'doing', `card.colId=doing (NAO promove em falha) (got ${c?.colId})`)
  ok(typeof c?.result === 'string' && c.result.startsWith('ERRO: processo terminou com código 1'),
     `card.result='ERRO: processo terminou com código 1 ...' (got '${c?.result?.slice(0,60)}')`)

  await a.close()
}

console.log('\n[i4] SOURCE EQUALITY — wrapperWithPane/prelude e argv indices intactos')
{
  // Regressao do argv off-by-1 (commit DEe0c2d): wrapperWithPane DEVE gravar
  // {state:'running',pane,ts} em .status (prelude) ANTES de chamar o wrapper principal.
  // E o wrapper principal tem de ler argv[1..6] (nao argv[2..7]).
  ok(apiSrc.includes("pane=int(os.environ.get(\"WEZTERM_PANE\",\"-1\"))"), 'wrapperWithPane le WEZTERM_PANE')
  ok(apiSrc.includes("open(st,\"w\",encoding=\"utf-8\").write(json.dumps({\"state\":\"running\",\"pane\":pane,\"ts\":time.time()}))"),
     'wrapperWithPane grava .status={state:running,pane,ts} antes do wrapper principal')
  ok(apiSrc.includes("st=sys.argv[1]; wt=sys.argv[2]; branch=sys.argv[3]; repo=sys.argv[4]; prompt=sys.argv[5]; bb=sys.argv[6]"),
     'wrapper principal: argv[1..6] = st..bb (sem off-by-1)')
  ok(apiSrc.includes("os.chdir(repo)"), 'wrapper: chdir(repo) (NAO chdir(base) — typo antigo)')
  ok(apiSrc.includes("p.on('close', async (code) => {"), 'close handler (doing->review promotion) intacto')
  ok(apiSrc.includes("if (code !== 0) {"), 'close handler: branch code!=0')
  ok(apiSrc.includes("c.result = 'ERRO: processo terminou com código ' + code"), 'close handler: grava ERRO marker (B2 detect)')
  ok(apiSrc.includes("if (c2 && !c2.archived && c2.colId === 'doing' && code === 0 && !mergeFailed && c2.result) {"),
     'close handler: guard promocao doing->review (B1 detect: !c2.result => no promote)')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
