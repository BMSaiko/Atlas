// test/bundle-roundtrip.test.mjs
//
// Cobre /api/w/:slug/bundle: GET serializa {meta, notes, kanban}, PUT restaura
// sem validar `ver` (operação destrutiva — replace completo). Recusa shape
// invalido (400 sem tocar em disco). Confirma integridade do roundtrip.
//
// Estilo: vanilla node:assert. Counter de failures, process.exit(0|1).
// SOURCE EQUALITY no fim apanha silenciosa divergencia (api.ts:1196-1224).
//
// Run: node test/bundle-roundtrip.test.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spinAtlas } from './_atlas-runtime.mjs'

// ponytail: o bundle PUT assume o workdir existe (e' criado por POST /api/workdirs).
// Em vez de monkey-patch mkdirSync, sigo o flow real: crio via API.
async function makeWorkdir(a, name) {
  const r = await a.req('POST', '/api/workdirs', { name })
  if (r.status !== 201) throw new Error('workdir create failed: ' + r.status + ' ' + r.text)
  return r.json.slug
}


const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const apiSrc = readFileSync(join(repoRoot, 'server', 'api.ts'), 'utf8')

let failures = 0
const ok = (cond, msg) => {
  if (cond) console.log('  ok:', msg)
  else { console.error('  FAIL:', msg); failures++ }
}

console.log('\n[1] GET /api/w/:slug/bundle com slug inexistente -> 200 com shape vazio')
{
  const a = await spinAtlas()
  const r = await a.req('GET', '/api/w/no-such-slug/bundle')
  ok(r.status === 200, `GET bundle slug vazio -> 200 (got ${r.status})`)
  ok(r.json?.slug === 'no-such-slug', `body.slug presente (got ${r.json?.slug})`)
  ok(r.json?.meta && typeof r.json.meta === 'object', `body.meta e' object (got ${typeof r.json?.meta})`)
  ok(Array.isArray(r.json?.notes?.items), `body.notes.items e' array (got ${typeof r.json?.notes?.items})`)
  ok(Array.isArray(r.json?.kanban?.cards), `body.kanban.cards e' array (got ${typeof r.json?.kanban?.cards})`)
  ok(typeof r.json?.ts === 'number', `body.ts e' number (got ${typeof r.json?.ts})`)
  await a.close()
}

console.log('\n[2] PUT /api/w/:slug/bundle shape valido -> 200, dados persistem')
{
  const a = await spinAtlas()
  const slug = await makeWorkdir(a, 'Test Bundle')
  const payload = {
    meta: { slug, name:'Test Bundle', description:'d', createdAt: 1234 },
    notes: { ver: 0, items: [{ id:'n1', title:'Hello', text:'world', ts: 1000 }] },
    kanban: { ver: 0, columns:[{id:'todo',name:'To Do'}], cards:[{id:'c1',colId:'todo',title:'card1'}] },
  }
  const r = await a.req('PUT', `/api/w/${slug}/bundle`, payload)
  ok(r.status === 200, `PUT bundle shape valido -> 200 (got ${r.status})`)
  ok(r.json?.ok === true, `body.ok=true (got ${JSON.stringify(r.json)})`)
  // GET confirma que gravou
  const r2 = await a.req('GET', `/api/w/${slug}/bundle`)
  ok(r2.json?.notes?.items?.[0]?.title === 'Hello', `nota 'Hello' persistida (got ${r2.json?.notes?.items?.[0]?.title})`)
  ok(r2.json?.kanban?.cards?.[0]?.title === 'card1', `card 'card1' persistido (got ${r2.json?.kanban?.cards?.[0]?.title})`)
  ok(r2.json?.meta?.name === 'Test Bundle', `meta.name persistido (got ${r2.json?.meta?.name})`)
  await a.close()
}

console.log('\n[3] PUT bundle shape invalido -> 400, NAO toca em disco')
{
  const a = await spinAtlas()
  await makeWorkdir(a, 'Bad Shape')
  // cria estado bom
  await a.req('PUT', '/api/w/bad-shape/bundle', {
    meta: { slug:'bad-shape' }, notes: { ver:0, items:[{id:'keep', title:'keep'}] }, kanban: { ver:0, columns:[], cards:[] }
  })
  // tenta meter shape invalido (faltam chaves)
  const r1 = await a.req('PUT', '/api/w/bad-shape/bundle', { meta:{} })
  ok(r1.status === 400, `PUT bundle sem notes/kanban -> 400 (got ${r1.status})`)
  ok(r1.json?.error?.includes('bundle invalido'), `body menciona 'bundle invalido' (got ${r1.json?.error})`)
  // estado intacto
  const r2 = await a.req('GET', '/api/w/bad-shape/bundle')
  ok(r2.json?.notes?.items?.[0]?.title === 'keep', `nota previa intacta apos 400 (got ${r2.json?.notes?.items?.[0]?.title})`)
  // outra forma: bundle null
  const r3 = await a.req('PUT', '/api/w/bad-shape/bundle', null)
  ok(r3.status === 400, `PUT bundle null -> 400 (got ${r3.status})`)
  // bundle como string
  const r4 = await a.req('PUT', '/api/w/bad-shape/bundle', 'garbage')
  ok(r4.status === 400, `PUT bundle string -> 400 (got ${r4.status})`)
  await a.close()
}

console.log('\n[4] PUT bundle replace: substituir por estado novo apaga tudo')
{
  const a = await spinAtlas()
  await makeWorkdir(a, 'Replace')
  await a.req('PUT', '/api/w/replace/bundle', {
    meta:{slug:'replace'}, notes:{ver:0,items:[{id:'a',title:'A'},{id:'b',title:'B'}]},
    kanban:{ver:0,columns:[],cards:[{id:'c1',colId:'todo',title:'C1'}]}
  })
  // PUT sem OT check, com 1 item so - tudo limpo
  const r = await a.req('PUT', '/api/w/replace/bundle', {
    meta:{slug:'replace',name:'replaced'}, notes:{ver:0,items:[{id:'z',title:'Z'}]},
    kanban:{ver:0,columns:[],cards:[]}
  })
  ok(r.status === 200, `PUT bundle replace (sem OT) -> 200 (got ${r.status})`)
  const r2 = await a.req('GET', '/api/w/replace/bundle')
  ok(r2.json?.notes?.items?.length === 1, `notes tem 1 item apos replace (got ${r2.json?.notes?.items?.length})`)
  ok(r2.json?.notes?.items?.[0]?.title === 'Z', `so' o Z restou (got ${r2.json?.notes?.items?.[0]?.title})`)
  ok(r2.json?.kanban?.cards?.length === 0, `kanban vazio (got ${r2.json?.kanban?.cards?.length} cards)`)
  ok(r2.json?.meta?.name === 'replaced', `meta substituido (got ${r2.json?.meta?.name})`)
  await a.close()
}

console.log('\n[5] method not allowed: POST -> 405')
{
  const a = await spinAtlas()
  await makeWorkdir(a, 'Method Test')
  const r = await a.req('POST', '/api/w/method-test/bundle', { foo: 'bar' })
  ok(r.status === 405, `POST bundle -> 405 (got ${r.status})`)
  ok(r.json?.error?.includes('method not allowed'), `body menciona 'method not allowed' (got ${r.json?.error})`)
  await a.close()
}

console.log('\n[6] slug invalido (com caracteres nao-SLUG) -> 400')
{
  const a = await spinAtlas()
  // reqRaw com url encode porque connect middleware pode rejeitar : no path
  const r = await a.reqRaw({ method:'GET', url:'/api/w/bad..slug/bundle' })
  // 'bad..slug' contem '..' que NAO casa SLUG /^[a-z0-9-]+$/
  ok(r.status === 400 || r.status === 404, `GET bundle slug com '..' -> 400/404 (got ${r.status})`)
  await a.close()
}

// SOURCE EQUALITY
console.log('\n[7] SOURCE EQUALITY — api.ts:1196-1224 (route + shape check + restore)')
{
  ok(apiSrc.includes("parts[0] === 'w' && parts.length === 3 && parts[2] === 'bundle'"), 'guard: bundle route (api.ts:1199)')
  ok(apiSrc.includes("'bundle invalido: requer meta+notes+kanban'"), 'string do 400 shape invalido (api.ts:1216)')
  ok(apiSrc.includes("send(405, { error: 'method not allowed' })"), '405 method not allowed (api.ts:1223)')
  // inside check para os 3 ficheiros
  ok(apiSrc.includes("!inside(DATA, metaFile) || !inside(DATA, notesFile) || !inside(DATA, kanbanFile)"), 'inside() check dos 3 paths (api.ts:1204)')
  // no OT verification on PUT (ponytail: operação destrutiva)
  ok(apiSrc.includes("if (m === 'PUT') {"), 'PUT branch sem OT (api.ts:1211)')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
