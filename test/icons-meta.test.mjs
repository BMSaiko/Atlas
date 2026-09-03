// test/icons-meta.test.mjs
//
// Cobre /api/icons e /api/w/:slug (meta.json GET).
// Estilo: vanilla node:assert. SOURCE EQUALITY (api.ts:807, 1346-1348).
//
// Run: node test/icons-meta.test.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
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

console.log('\n[1] GET /api/icons — sorted .svg only')
{
  const a = await spinAtlas()
  // spinAtlas ja' criou public/icons vazio
  writeFileSync(join(a.cwd, 'public', 'icons', 'zebra.svg'), '<svg/>')
  writeFileSync(join(a.cwd, 'public', 'icons', 'apple.svg'), '<svg/>')
  writeFileSync(join(a.cwd, 'public', 'icons', 'noise.png'), Buffer.from([0]))
  const r = await a.req('GET', '/api/icons')
  ok(r.status === 200, `200 (got ${r.status})`)
  ok(Array.isArray(r.json?.icons), `icons array (got ${typeof r.json?.icons})`)
  ok(r.json?.icons?.length === 2, `2 svgs, png filtrado (got ${r.json?.icons?.length})`)
  ok(r.json?.icons?.[0] === 'apple.svg' && r.json?.icons?.[1] === 'zebra.svg', `sorted (got ${JSON.stringify(r.json?.icons)})`)
  await a.close()
}

console.log('\n[2] GET /api/icons — dir vazio')
{
  const a = await spinAtlas()
  // spinAtlas garante dir existe; removemos tudo
  try { const fs = await import('node:fs'); fs.rmSync(join(a.cwd, 'public', 'icons'), { recursive: true, force: true }); fs.mkdirSync(join(a.cwd, 'public', 'icons'), { recursive: true }) } catch {}
  const r = await a.req('GET', '/api/icons')
  ok(r.status === 200, `200 (got ${r.status})`)
  ok(r.json?.icons?.length === 0, `empty (got ${JSON.stringify(r.json?.icons)})`)
  await a.close()
}

console.log('\n[3] GET /api/w/:slug — sem dir -> error not found')
{
  const a = await spinAtlas()
  const r = await a.req('GET', '/api/w/naoexiste')
  ok(r.status === 200, `200 (got ${r.status})`)
  ok(r.json?.error === 'not found', `error not found (got ${JSON.stringify(r.json)})`)
  await a.close()
}

console.log('\n[4] GET /api/w/:slug — com meta.json devolve conteudo')
{
  const a = await spinAtlas()
  mkdirSync(join(a.cwd, 'data', 'proja'), { recursive: true })
  writeFileSync(join(a.cwd, 'data', 'proja', 'meta.json'), JSON.stringify({ name: 'Proj A', description: 'desc', createdAt: 1700000000000, icon: 'a.svg' }))
  const r = await a.req('GET', '/api/w/proja')
  ok(r.status === 200, `200 (got ${r.status})`)
  ok(r.json?.name === 'Proj A', `name (got ${r.json?.name})`)
  ok(r.json?.icon === 'a.svg', `icon (got ${r.json?.icon})`)
  await a.close()
}

console.log('\n[5] SOURCE EQUALITY — iconCatalog + meta endpoint')
{
  ok(apiSrc.includes("function iconCatalog(): string[]"), 'iconCatalog() existe')
  ok(apiSrc.includes("if (parts[0] === 'icons' && parts.length === 1 && m === 'GET')"), 'GET /api/icons dispatch')
  ok(apiSrc.includes("if (parts[0] === 'w' && parts.length === 2 && m === 'GET')"), 'GET /api/w/:slug dispatch')
  ok(apiSrc.includes("send(200, (await readJ(join(DATA, slug, 'meta.json'))) || { error:'not found' })"), 'meta not-found default')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
