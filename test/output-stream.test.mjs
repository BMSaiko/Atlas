// test/output-stream.test.mjs
//
// Cobre /api/w/:slug/output/:cardId?offset=N: stream do log do run headless.
// started=true sse existe .status. done=state!='running'. code so quando done.
// chunk = full.slice(offset). offset devolve nova posicao p/ o cliente pedir
// so o delta. Sem ficheiro .status: started=false, default running (NAO
// fantasma done).
//
// Estilo: vanilla node:assert. SOURCE EQUALITY (api.ts:1101-1122).
//
// Run: node test/output-stream.test.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
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

const repoPath = (a, slug) => join(a.cwd, 'data', '.wt', 'runs', slug)

async function setupRun(a, slug, cardId, { log = '', status = null } = {}) {
  const runsDir = repoPath(a, slug)
  mkdirSync(runsDir, { recursive: true })
  if (log) writeFileSync(join(runsDir, cardId + '.log'), log)
  if (status) writeFileSync(join(runsDir, cardId + '.status'), JSON.stringify(status))
}

console.log('\n[1] sem .log nem .status -> started=false, running, chunk vazio')
{
  const a = await spinAtlas()
  const r = await a.req('GET', '/api/w/never/output/orphans-1')
  ok(r.status === 200, `GET output sem files -> 200 (got ${r.status})`)
  ok(r.json?.started === false, `started=false (got ${r.json?.started})`)
  ok(r.json?.done === false, `done=false (got ${r.json?.done})`)
  ok(r.json?.code === null, `code=null (got ${r.json?.code})`)
  ok(r.json?.chunk === '', `chunk vazio (got '${r.json?.chunk}')`)
  ok(r.json?.offset === 0, `offset=0 (got ${r.json?.offset})`)
  ok(r.json?.size === 0, `size=0 (got ${r.json?.size})`)
  await a.close()
}

console.log('\n[2] .log com conteudo + .status running -> started=true, done=false')
{
  const a = await spinAtlas()
  await setupRun(a, 'r-1', 'card-1', { log: 'hello\nworld\n', status: { state: 'running' } })
  const r = await a.req('GET', '/api/w/r-1/output/card-1')
  ok(r.json?.started === true, `started=true`)
  ok(r.json?.done === false, `done=false`)
  ok(r.json?.code === null, `code=null (running)`)
  ok(r.json?.chunk === 'hello\nworld\n', `chunk completo (got '${r.json?.chunk}')`)
  ok(r.json?.offset === 12, `offset=12 (got ${r.json?.offset})`)
  ok(r.json?.size === 12, `size=12`)
  await a.close()
}

console.log('\n[3] .status state=done com code=0 -> done=true, code=0')
{
  const a = await spinAtlas()
  await setupRun(a, 'r-2', 'card-2', { log: 'finished OK', status: { state: 'done', code: 0 } })
  const r = await a.req('GET', '/api/w/r-2/output/card-2')
  ok(r.json?.done === true, `done=true`)
  ok(r.json?.code === 0, `code=0 (got ${r.json?.code})`)
  await a.close()
}

console.log('\n[4] .status state=error com code=1 -> done=true, code=1')
{
  const a = await spinAtlas()
  await setupRun(a, 'r-3', 'card-3', { log: 'failed!', status: { state: 'error', code: 1 } })
  const r = await a.req('GET', '/api/w/r-3/output/card-3')
  ok(r.json?.done === true && r.json?.code === 1, `done+code=1 (got done=${r.json?.done} code=${r.json?.code})`)
  await a.close()
}

console.log('\n[5] offset query: devolve chunk desde offset, novo offset = posicao')
{
  const a = await spinAtlas()
  const log = 'line1\nline2\nline3\n'
  await setupRun(a, 'r-4', 'card-4', { log, status: { state: 'running' } })
  // offset=6 ('line1\n' tem 6 chars)
  const r = await a.req('GET', '/api/w/r-4/output/card-4?offset=6')
  ok(r.json?.chunk === 'line2\nline3\n', `chunk desde offset=6 (got '${r.json?.chunk}')`)
  ok(r.json?.offset === 18, `novo offset=18 (got ${r.json?.offset})`)
  ok(r.json?.size === 18, `size=18`)
  await a.close()
}

console.log('\n[6] offset >= size: chunk vazio, offset mantem-se')
{
  const a = await spinAtlas()
  await setupRun(a, 'r-5', 'card-5', { log: 'short', status: { state: 'done', code: 0 } })
  const r = await a.req('GET', '/api/w/r-5/output/card-5?offset=100')
  ok(r.json?.chunk === '', `chunk vazio (got '${r.json?.chunk}')`)
  ok(r.json?.offset === 100, `offset mantem-se (got ${r.json?.offset})`)
  await a.close()
}

console.log('\n[7] offset negativo ou invalido -> clamp para 0 (chunk full, novo offset = size)')
{
  // ponytail: middleware devolve offset=offset+chunk.length (a nova posicao
  // para o cliente continuar). Com offset invalido clamped a 0 e log 'abc',
  // o chunk tem 3 chars, novo offset = 3. A assercao e' "novo offset == size"
  // (= chunk comecou em 0).
  const a = await spinAtlas()
  await setupRun(a, 'r-6', 'card-6', { log: 'abc', status: { state: 'done' } })
  const r1 = await a.req('GET', '/api/w/r-6/output/card-6?offset=-5')
  ok(r1.json?.chunk === 'abc' && r1.json?.offset === 3, `offset=-5 -> chunk=abc, novo offset=3 (got chunk='${r1.json?.chunk}' offset=${r1.json?.offset})`)
  const r2 = await a.req('GET', '/api/w/r-6/output/card-6?offset=garbage')
  ok(r2.json?.chunk === 'abc' && r2.json?.offset === 3, `offset=garbage -> chunk=abc, novo offset=3`)
  await a.close()
}

console.log('\n[8] .log mas SEM .status -> started=false (NUNCA lancado)')
{
  const a = await spinAtlas()
  await setupRun(a, 'r-7', 'card-7', { log: 'orphan log' })  // sem .status
  const r = await a.req('GET', '/api/w/r-7/output/card-7')
  ok(r.json?.started === false, `started=false (sem .status) (got ${r.json?.started})`)
  ok(r.json?.done === false, `done=false (NAO fantasma)`)
  await a.close()
}

console.log('\n[9] .status sem code + state=done -> code=0 (default)')
{
  const a = await spinAtlas()
  await setupRun(a, 'r-8', 'card-8', { log: 'x', status: { state: 'done' } })
  const r = await a.req('GET', '/api/w/r-8/output/card-8')
  ok(r.json?.done === true && r.json?.code === 0, `done+code=0 default (got ${r.json?.code})`)
  await a.close()
}

console.log('\n[10] slug invalido -> 400 (SLUG regex)')
{
  const a = await spinAtlas()
  const r = await a.reqRaw({ method:'GET', url:'/api/w/bad..slug/output/x' })
  ok(r.status === 400, `GET output c/ slug invalido -> 400 (got ${r.status})`)
  await a.close()
}

// SOURCE EQUALITY
console.log('\n[11] SOURCE EQUALITY — api.ts:1101-1122 (route + offset + default running)')
{
  ok(apiSrc.includes("parts[2] === 'output' && m === 'GET'"), 'guard: output GET (api.ts:1102)')
  ok(apiSrc.includes("const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0)"), 'offset clamp 0 (api.ts:1104)')
  ok(apiSrc.includes("const started = !!st"), 'started=!!st (api.ts:1113)')
  ok(apiSrc.includes("const st2 = st || { state: 'running' }"), 'default running (api.ts:1114)')
  ok(apiSrc.includes("const done = st2.state !== 'running'"), 'done derivation (api.ts:1117)')
  ok(apiSrc.includes("const chunk = full.slice(offset)"), 'slice desde offset (api.ts:1119)')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
