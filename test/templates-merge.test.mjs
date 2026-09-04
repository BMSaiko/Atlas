// test/templates-merge.test.mjs
//
// Cobre /api/w/:slug/templates: merge global (data/templates.json) + workdir
// (data/<slug>/templates.json). Em colisao de id, workdir vence global.
// JSON malformado -> [] (nao 500). So GET; outros metodos -> 405.
//
// Estilo: vanilla node:assert. SOURCE EQUALITY (api.ts:1248-1258).
//
// Run: node test/templates-merge.test.mjs

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



// ponytail: data/templates.json e' partilhado entre tests (cwd sticky). Limpar
// antes de cada test que dependa do estado limpo.
function clearGlobalTemplates(a) {
  const p = join(a.cwd, 'data', 'templates.json')
  if (existsSync(p)) rmSync(p)
}
async function setupWorkdir(a, name) {
  // Limpar global templates.json - outros tests podem ter deixado data suja.
  clearGlobalTemplates(a)
  const c = await a.req('POST', '/api/workdirs', { name })
  return c.json.slug
}

console.log('\n[1] sem templates.json (nem global nem workdir) -> []')
{
  const a = await spinAtlas()
  const slug = await setupWorkdir(a, 'No Templates')
  const r = await a.req('GET', `/api/w/${slug}/templates`)
  ok(r.status === 200, `GET templates -> 200 (got ${r.status})`)
  ok(Array.isArray(r.json) && r.json.length === 0, `[] (got ${JSON.stringify(r.json)})`)
  await a.close()
}

console.log('\n[2] so global: devolve global')
{
  const a = await spinAtlas()
  const slug = await setupWorkdir(a, 'Global Only')
  writeFileSync(join(a.cwd, 'data', 'templates.json'), JSON.stringify([
    { id: 't1', name: 'T1', body: 'B1' },
    { id: 't2', name: 'T2', body: 'B2' },
  ]))
  const r = await a.req('GET', `/api/w/${slug}/templates`)
  ok(r.json?.length === 2, `2 templates (got ${r.json?.length})`)
  const ids = r.json.map(t => t.id).sort()
  ok(JSON.stringify(ids) === JSON.stringify(['t1','t2']), `ids: ${ids.join(',')}`)
  await a.close()
}

console.log('\n[3] so workdir: devolve workdir')
{
  const a = await spinAtlas()
  const slug = await setupWorkdir(a, 'Workdir Only')
  writeFileSync(join(a.cwd, 'data', slug, 'templates.json'), JSON.stringify([
    { id: 'w1', name: 'W1', body: 'WB' },
  ]))
  const r = await a.req('GET', `/api/w/${slug}/templates`)
  ok(r.json?.length === 1, `1 template (got ${r.json?.length})`)
  ok(r.json?.[0]?.id === 'w1', `w1 (got ${r.json?.[0]?.id})`)
  await a.close()
}

console.log('\n[4] merge global + workdir: union sem duplicar')
{
  const a = await spinAtlas()
  const slug = await setupWorkdir(a, 'Merge Test')
  writeFileSync(join(a.cwd, 'data', 'templates.json'), JSON.stringify([
    { id: 't1', name: 'T1' },
    { id: 't2', name: 'T2' },
  ]))
  writeFileSync(join(a.cwd, 'data', slug, 'templates.json'), JSON.stringify([
    { id: 'w1', name: 'W1' },
    { id: 'w2', name: 'W2' },
  ]))
  const r = await a.req('GET', `/api/w/${slug}/templates`)
  ok(r.json?.length === 4, `4 templates (got ${r.json?.length})`)
  await a.close()
}

console.log('\n[5] colisao de id: workdir vence global')
{
  const a = await spinAtlas()
  const slug = await setupWorkdir(a, 'Collision')
  writeFileSync(join(a.cwd, 'data', 'templates.json'), JSON.stringify([
    { id: 'shared', name: 'Global Version', body: 'global' },
  ]))
  writeFileSync(join(a.cwd, 'data', slug, 'templates.json'), JSON.stringify([
    { id: 'shared', name: 'Workdir Version', body: 'workdir' },
  ]))
  const r = await a.req('GET', `/api/w/${slug}/templates`)
  const shared = r.json.find(t => t.id === 'shared')
  ok(r.json?.length === 1, `1 template (workdir override global) (got ${r.json?.length})`)
  ok(shared?.name === 'Workdir Version', `workdir vence (got ${shared?.name})`)
  ok(shared?.body === 'workdir', `body workdir (got ${shared?.body})`)
  await a.close()
}

console.log('\n[6] JSON malformado num dos lados -> [] (nao 500)')
{
  const a = await spinAtlas()
  const slug = await setupWorkdir(a, 'Malformed')
  writeFileSync(join(a.cwd, 'data', 'templates.json'), 'this is not json{{{')
  const r1 = await a.req('GET', `/api/w/${slug}/templates`)
  ok(r1.status === 200, `global malformado -> 200 (got ${r1.status})`)
  ok(r1.json?.length === 0, `[] (got ${r1.json?.length})`)

  // Workdir malformado (global OK)
  writeFileSync(join(a.cwd, 'data', 'templates.json'), JSON.stringify([{ id: 'ok' }]))
  writeFileSync(join(a.cwd, 'data', slug, 'templates.json'), 'garbage')
  const r2 = await a.req('GET', `/api/w/${slug}/templates`)
  ok(r2.status === 200, `workdir malformado -> 200 (got ${r2.status})`)
  ok(r2.json?.length === 1, `so global OK (got ${r2.json?.length})`)
  await a.close()
}

console.log('\n[7] global nao-array (ex: object) -> tratado como []')
{
  const a = await spinAtlas()
  const slug = await setupWorkdir(a, 'Object Not Array')
  writeFileSync(join(a.cwd, 'data', 'templates.json'), JSON.stringify({ not: 'array' }))
  const r = await a.req('GET', `/api/w/${slug}/templates`)
  ok(r.status === 200 && r.json?.length === 0, `object -> [] (got len=${r.json?.length})`)
  await a.close()
}

console.log('\n[8] templates com id falsy (null, 0, undefined) sao ignorados')
{
  const a = await spinAtlas()
  const slug = await setupWorkdir(a, 'Falsy IDs')
  writeFileSync(join(a.cwd, 'data', 'templates.json'), JSON.stringify([
    { id: 'real', name: 'Real' },
    { id: null, name: 'Null' },
    { id: 0, name: 'Zero' },
    { name: 'No ID' },
    null,  // null item
  ]))
  const r = await a.req('GET', `/api/w/${slug}/templates`)
  ok(r.json?.length === 1, `so 'real' (got ${r.json?.length})`)
  ok(r.json?.[0]?.id === 'real', `id=real (got ${r.json?.[0]?.id})`)
  await a.close()
}

console.log('\n[9] outros metodos: POST/PUT/DELETE -> 405 method not allowed')
{
  const a = await spinAtlas()
  const slug = await setupWorkdir(a, 'Methods')
  for (const m of ['POST', 'PUT', 'DELETE']) {
    const r = await a.req(m, `/api/w/${slug}/templates`, m === 'DELETE' ? undefined : { foo: 'bar' })
    ok(r.status === 405, `${m} templates -> 405 (got ${r.status})`)
    ok(r.json?.error?.includes('method not allowed'), `body error`)
  }
  await a.close()
}

console.log('\n[10] slug invalido -> 400')
{
  const a = await spinAtlas()
  const r = await a.reqRaw({ method:'GET', url:'/api/w/bad..slug/templates' })
  ok(r.status === 400, `slug c/ '..' -> 400 (got ${r.status})`)
  await a.close()
}

// SOURCE EQUALITY
console.log('\n[11] SOURCE EQUALITY — api.ts:1248-1258 (merge global+workdir, workdir vence)')
{
  ok(apiSrc.includes("kind === 'templates'"), 'guard: templates (api.ts:1250)')
  ok(apiSrc.includes("if (m !== 'GET') { send(405"), '405 for non-GET (api.ts:1251)')
  ok(apiSrc.includes("'templates.json'"), 'global templates.json filename (api.ts:1252)')
  ok(apiSrc.includes("slug, 'templates.json'"), 'workdir templates.json filename (api.ts:1253)')
  ok(apiSrc.includes("byId.set(t.id, t)"), 'Map.set (api.ts:1255-1256)')
  ok(apiSrc.includes("[...byId.values()]"), 'output spread do map (api.ts:1257)')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
