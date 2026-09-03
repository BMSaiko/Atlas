// test/import-roadmap-pat.test.mjs
//
// Cobre /api/w/:slug/import-roadmap path-traversal allow-list: o path do body
// tem de viver dentro de <VAULT>/knowledge/projects/<slug>/. resolve() normaliza
// ../ antes do inside(). Sem isto, le ficheiros arbitrarios do disco.
//
// Complementa o test/roadmap-import.test.mjs existente (que cobre o parser +
// a path guard do P0). Aqui focamos: edge cases do allow-list (path absoluto,
// ../, symlink-equivalent, path inexistente, slug mismatch).
//
// Estilo: vanilla node:assert. SOURCE EQUALITY (api.ts:1156-1195).
//
// Run: node test/import-roadmap-pat.test.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { spinAtlas } from './_atlas-runtime.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const apiSrc = readFileSync(join(repoRoot, 'server', 'api.ts'), 'utf8')

let failures = 0
const ok = (cond, msg) => {
  if (cond) console.log('  ok:', msg)
  else { console.error('  FAIL:', msg); failures++ }
}

console.log('\n[1] path dentro do allowedRoot + md com tasks -> 200, adiciona cards+notas')
{
  const a = await spinAtlas()
  const projectDir = join(a.cwd, 'knowledge', 'projects', 'slug-a')
  mkdirSync(projectDir, { recursive: true })
  const mdPath = join(projectDir, 'roadmap.md')
  writeFileSync(mdPath, '# Roadmap\n- [ ] Fazer A\n- [ ] Fazer B\n')
  // cria workdir
  await a.req('POST', '/api/workdirs', { name: 'slug-a' })
  const r = await a.req('POST', '/api/w/slug-a/import-roadmap', { path: mdPath })
  ok(r.status === 200, `import-roadmap path valido -> 200 (got ${r.status})`)
  ok(r.json?.ok === true, `ok=true (got ${r.json})`)
  ok(r.json?.addedCards === 2, `2 cards adicionados (got ${r.json?.addedCards})`)
  ok(r.json?.addedNotes === 2, `2 notas adicionadas (got ${r.json?.addedNotes})`)
  await a.close()
}

console.log('\n[2] path-traversal ../ escapa do projeto -> 400 path outside project')
{
  const a = await spinAtlas()
  const projectDir = join(a.cwd, 'knowledge', 'projects', 'slug-b')
  mkdirSync(projectDir, { recursive: true })
  // cria um ficheiro FORA do projeto
  const outside = join(a.cwd, 'secret.md')
  writeFileSync(outside, '- [ ] LER isto e' )
  // tenta usar ../../<outside> que resolve para <outside>
  const evilPath = resolve(projectDir, '..', '..', 'secret.md')
  await a.req('POST', '/api/workdirs', { name: 'slug-b' })
  const r = await a.req('POST', '/api/w/slug-b/import-roadmap', { path: evilPath })
  ok(r.status === 400, `path-traversal -> 400 (got ${r.status})`)
  ok(r.json?.error?.includes('path outside project'), `body menciona 'path outside project' (got ${r.json?.error})`)
  await a.close()
}

console.log('\n[3] slug mismatch: path dentro de outro projeto -> 400')
{
  const a = await spinAtlas()
  // projeto slug-c existe, mas tenta usar path dentro de slug-d
  const projectD = join(a.cwd, 'knowledge', 'projects', 'slug-d')
  mkdirSync(projectD, { recursive: true })
  const mdPath = join(projectD, 'roadmap.md')
  writeFileSync(mdPath, '- [ ] X\n')
  await a.req('POST', '/api/workdirs', { name: 'slug-c' })
  const r = await a.req('POST', '/api/w/slug-c/import-roadmap', { path: mdPath })
  ok(r.status === 400, `slug mismatch -> 400 (got ${r.status})`)
  ok(r.json?.error?.includes('path outside project'), `body explica mismatch (got ${r.json?.error})`)
  await a.close()
}

console.log('\n[4] path absoluto FORA do vault -> 400')
{
  const a = await spinAtlas()
  await a.req('POST', '/api/workdirs', { name: 'slug-e' })
  const r = await a.req('POST', '/api/w/slug-e/import-roadmap', { path: 'C:/Windows/System32/drivers/etc/hosts' })
  ok(r.status === 400, `path absoluto fora do projeto -> 400 (got ${r.status})`)
  await a.close()
}

console.log('\n[5] path vazio / undefined / null -> 400 path required')
{
  const a = await spinAtlas()
  await a.req('POST', '/api/workdirs', { name: 'slug-f' })
  for (const bad of ['', undefined, null, 42, {}]) {
    const r = await a.req('POST', '/api/w/slug-f/import-roadmap', { path: bad })
    ok(r.status === 400, `path=${JSON.stringify(bad)} -> 400 (got ${r.status})`)
  }
  const r2 = await a.req('POST', '/api/w/slug-f/import-roadmap', {})
  ok(r2.status === 400, `sem path field -> 400 (got ${r2.status})`)
  await a.close()
}

console.log('\n[6] path nao existe -> 400 ficheiro nao encontrado (sem vazar existencia)')
{
  const a = await spinAtlas()
  const projectDir = join(a.cwd, 'knowledge', 'projects', 'slug-g')
  mkdirSync(projectDir, { recursive: true })
  await a.req('POST', '/api/workdirs', { name: 'slug-g' })
  const r = await a.req('POST', '/api/w/slug-g/import-roadmap', { path: join(projectDir, 'nao-existe.md') })
  ok(r.status === 400, `path inexistente -> 400 (got ${r.status})`)
  ok(r.json?.error?.includes('ficheiro nao encontrado'), `body explica (got ${r.json?.error})`)
  await a.close()
}

console.log('\n[7] slug invalido (com caracteres nao-SLUG) -> 400 bad request')
{
  const a = await spinAtlas()
  const r = await a.reqRaw({ method:'POST', url:'/api/w/bad..slug/import-roadmap', body: { path: 'whatever' } })
  ok(r.status === 400, `slug c/ '..' -> 400 (got ${r.status})`)
  await a.close()
}

console.log('\n[8] dedup: re-importar o mesmo md nao duplica (idempotente)')
{
  const a = await spinAtlas()
  const projectDir = join(a.cwd, 'knowledge', 'projects', 'slug-h')
  mkdirSync(projectDir, { recursive: true })
  const mdPath = join(projectDir, 'roadmap.md')
  writeFileSync(mdPath, '- [ ] Tarefa A\n- [ ] Tarefa B\n')
  await a.req('POST', '/api/workdirs', { name: 'slug-h' })
  const r1 = await a.req('POST', '/api/w/slug-h/import-roadmap', { path: mdPath })
  ok(r1.json?.addedCards === 2, `1a import: 2 cards (got ${r1.json?.addedCards})`)
  const r2 = await a.req('POST', '/api/w/slug-h/import-roadmap', { path: mdPath })
  ok(r2.json?.addedCards === 0, `2a import (mesmo md): 0 cards (got ${r2.json?.addedCards})`)
  ok(r2.json?.skipped === 2, `2a import: 2 skipped (got ${r2.json?.skipped})`)
  await a.close()
}

console.log('\n[9] tasks duplicadas no MESMO md: parseRoadmap deduplica (vai 3 linhas -> 2 tasks)')
{
  // ponytail: parseRoadmap tem o seu proprio dedup via `seen` Set (roadmap.ts:13-14).
  // O middleware nao precisa de contar 'skipped' para tasks duplicadas intra-md.
  // O `skipped` no output da API conta so contra cards JA existentes no board.
  const a = await spinAtlas()
  const projectDir = join(a.cwd, 'knowledge', 'projects', 'slug-i')
  mkdirSync(projectDir, { recursive: true })
  const mdPath = join(projectDir, 'roadmap.md')
  writeFileSync(mdPath, '- [ ] Mesma\n- [ ] Mesma\n- [ ] Outra\n')
  await a.req('POST', '/api/workdirs', { name: 'slug-i' })
  const r = await a.req('POST', '/api/w/slug-i/import-roadmap', { path: mdPath })
  ok(r.json?.total === 2, `parseRoadmap devolveu 2 tasks (3 linhas - 1 dup) (got total=${r.json?.total})`)
  ok(r.json?.addedCards === 2, `2 cards adicionados (got ${r.json?.addedCards})`)
  ok(r.json?.skipped === 0, `0 skipped (skipped so conta contra board pre-existente) (got ${r.json?.skipped})`)
  await a.close()
}

// SOURCE EQUALITY
console.log('\n[10] SOURCE EQUALITY — api.ts:1156-1195 (route + allow-list + resolve)')
{
  ok(apiSrc.includes("parts[2] === 'import-roadmap' && m === 'POST'"), 'guard: import-roadmap POST (api.ts:1157)')
  ok(apiSrc.includes("'path required'"), 'string 400 path required (api.ts:1163)')
  ok(apiSrc.includes("'path outside project'"), 'string 400 path outside (api.ts:1169)')
  ok(apiSrc.includes("const allowedRoot = join(VAULT, 'knowledge', 'projects', slug)"), 'allowedRoot = VAULT/knowledge/projects/<slug> (api.ts:1167)')
  ok(apiSrc.includes('path = resolve(path)'), 'resolve() normaliza ../ (api.ts:1168)')
  ok(apiSrc.includes('inside(allowedRoot, path)'), 'inside() check (api.ts:1169)')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
