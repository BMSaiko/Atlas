// test/export-md.test.mjs
//
// Cobre /api/w/:slug/export: exporta notas nao-arquivadas para markdown em
// <VAULT>/knowledge/projects/<slug>/docs/notas.md. Ordena por ts asc. Formata
// tags (quoted se com espaco) e front-matter (id, criado ISO).
//
// Estilo: vanilla node:assert. SOURCE EQUALITY (api.ts:1225-1244).
//
// Run: node test/export-md.test.mjs

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
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

const readWorkdir = (a, slug, kind) => JSON.parse(readFileSync(join(a.cwd, 'data', slug, kind + '.json'), 'utf8'))

async function setupWorkdir(a, name) {
  const c = await a.req('POST', '/api/workdirs', { name })
  return c.json.slug
}

console.log('\n[1] sem notas ativas -> 200 count=0, NAO cria ficheiro')
{
  const a = await spinAtlas()
  const slug = await setupWorkdir(a, 'No Notes')
  const r = await a.req('POST', `/api/w/${slug}/export`)
  ok(r.status === 200, `POST export -> 200 (got ${r.status})`)
  ok(r.json?.count === 0, `count=0 (got ${r.json?.count})`)
  const docsPath = join(a.cwd, 'knowledge', 'projects', slug, 'docs', 'notas.md')
  ok(!existsSync(docsPath), `notas.md NAO foi criado (got exists=${existsSync(docsPath)})`)
  await a.close()
}

console.log('\n[2] notas ativas -> cria notas.md com front-matter + body')
{
  const a = await spinAtlas()
  const slug = await setupWorkdir(a, 'Has Notes')
  // 2 notas via PUT direto (mais facil que ir pela API)
  writeFileSync(join(a.cwd, 'data', slug, 'notes.json'), JSON.stringify({
    ver: 1,
    items: [
      { id: 'n1', title: 'First', text: 'Content of first', ts: 1000 },
      { id: 'n2', title: 'Second', text: 'Content of second', ts: 2000 },
    ],
  }))
  const r = await a.req('POST', `/api/w/${slug}/export`)
  ok(r.status === 200, `export -> 200 (got ${r.status})`)
  ok(r.json?.count === 2, `count=2 (got ${r.json?.count})`)
  const md = readFileSync(join(a.cwd, 'knowledge', 'projects', slug, 'docs', 'notas.md'), 'utf8')
  ok(md.includes('id: n1'), 'md tem id: n1')
  ok(md.includes('id: n2'), 'md tem id: n2')
  ok(md.includes('# First'), 'md tem # First')
  ok(md.includes('# Second'), 'md tem # Second')
  ok(md.includes('Content of first'), 'body de first')
  ok(md.includes('Content of second'), 'body de second')
  await a.close()
}

console.log('\n[3] sort por ts asc (ordem cronologica)')
{
  const a = await spinAtlas()
  const slug = await setupWorkdir(a, 'Sort Test')
  // Inserir em ordem inversa - o source tem que ordenar
  writeFileSync(join(a.cwd, 'data', slug, 'notes.json'), JSON.stringify({
    ver: 1,
    items: [
      { id: 'later', title: 'Later', text: 'L', ts: 2000 },
      { id: 'earlier', title: 'Earlier', text: 'E', ts: 1000 },
    ],
  }))
  await a.req('POST', `/api/w/${slug}/export`)
  const md = readFileSync(join(a.cwd, 'knowledge', 'projects', slug, 'docs', 'notas.md'), 'utf8')
  const idxEarlier = md.indexOf('# Earlier')
  const idxLater = md.indexOf('# Later')
  ok(idxEarlier > 0 && idxLater > 0 && idxEarlier < idxLater, `Earlier antes de Later (idx: ${idxEarlier} < ${idxLater})`)
  await a.close()
}

console.log('\n[4] notas arquivadas sao excluidas')
{
  const a = await spinAtlas()
  const slug = await setupWorkdir(a, 'Archive Test')
  writeFileSync(join(a.cwd, 'data', slug, 'notes.json'), JSON.stringify({
    ver: 1,
    items: [
      { id: 'active', title: 'Active', text: 'A', ts: 1000 },
      { id: 'arch', title: 'Archived', text: 'B', ts: 2000, archived: true },
    ],
  }))
  const r = await a.req('POST', `/api/w/${slug}/export`)
  ok(r.json?.count === 1, `count=1 (so active) (got ${r.json?.count})`)
  const md = readFileSync(join(a.cwd, 'knowledge', 'projects', slug, 'docs', 'notas.md'), 'utf8')
  ok(md.includes('# Active'), 'Active no md')
  ok(!md.includes('# Archived'), 'Archived NAO no md')
  await a.close()
}

console.log('\n[5] tags: array e quoted quando tem espaco')
{
  const a = await spinAtlas()
  const slug = await setupWorkdir(a, 'Tags')
  writeFileSync(join(a.cwd, 'data', slug, 'notes.json'), JSON.stringify({
    ver: 1,
    items: [
      { id: 'n1', title: 'T1', text: 'A', ts: 1000, tags: ['simple', 'with space', 'other'] },
      { id: 'n2', title: 'T2', text: 'B', ts: 2000 },  // sem tags
    ],
  }))
  await a.req('POST', `/api/w/${slug}/export`)
  const md = readFileSync(join(a.cwd, 'knowledge', 'projects', slug, 'docs', 'notas.md'), 'utf8')
  // 'simple' e 'other' sem aspas; 'with space' com aspas
  ok(md.includes('tags: [simple, "with space", other]'), `tags formatados (got: ${md.match(/tags:.*/)?.[0]?.slice(0,80)})`)
  // n2 nao tem tags: - sem a linha
  ok(!md.match(/id: n2\ntags:/), 'n2 sem linha tags')
  await a.close()
}

console.log('\n[6] front-matter criado: ISO e id')
{
  const a = await spinAtlas()
  const slug = await setupWorkdir(a, 'Frontmatter')
  writeFileSync(join(a.cwd, 'data', slug, 'notes.json'), JSON.stringify({
    ver: 1,
    items: [
      { id: 'n-ts', title: 'TS', text: 'X', ts: 1700000000000 },
    ],
  }))
  await a.req('POST', `/api/w/${slug}/export`)
  const md = readFileSync(join(a.cwd, 'knowledge', 'projects', slug, 'docs', 'notas.md'), 'utf8')
  ok(md.includes('---'), 'front-matter delimiters ---')
  ok(md.includes('id: n-ts'), 'id: n-ts')
  // 2023-11-14T22:13:20.000Z
  ok(/criado: 2023-11-14T22:13:20\.000Z/.test(md), `criado: ISO (got: ${md.match(/criado:.*/)?.[0]})`)
  await a.close()
}

console.log('\n[7] slug invalido -> 400')
{
  const a = await spinAtlas()
  const r = await a.reqRaw({ method:'POST', url:'/api/w/bad..slug/export' })
  ok(r.status === 400, `slug c/ '..' -> 400 (got ${r.status})`)
  await a.close()
}

console.log('\n[8] re-export sobrescreve o ficheiro (idempotente)')
{
  const a = await spinAtlas()
  const slug = await setupWorkdir(a, 'Re-export')
  writeFileSync(join(a.cwd, 'data', slug, 'notes.json'), JSON.stringify({
    ver: 1, items: [{ id: 'a', title: 'A', text: 'A', ts: 1000 }],
  }))
  await a.req('POST', `/api/w/${slug}/export`)
  const md1 = readFileSync(join(a.cwd, 'knowledge', 'projects', slug, 'docs', 'notas.md'), 'utf8')
  // mudar a nota
  writeFileSync(join(a.cwd, 'data', slug, 'notes.json'), JSON.stringify({
    ver: 2, items: [{ id: 'b', title: 'B', text: 'B', ts: 2000 }],
  }))
  await a.req('POST', `/api/w/${slug}/export`)
  const md2 = readFileSync(join(a.cwd, 'knowledge', 'projects', slug, 'docs', 'notas.md'), 'utf8')
  ok(!md1.includes('# B') && md2.includes('# B'), `re-export substitui (md1 tem A so, md2 tem B)`)
  await a.close()
}

// SOURCE EQUALITY
console.log('\n[9] SOURCE EQUALITY — api.ts:1225-1244 (export route + markdown shape)')
{
  ok(apiSrc.includes("parts[2] === 'export' && m === 'POST'"), 'guard: export POST (api.ts:1226)')
  ok(apiSrc.includes("n.archived"), 'filtra archived (api.ts:1230)')
  ok(apiSrc.includes('(a.ts || 0) - (b.ts || 0)') || apiSrc.includes('a.ts - b.ts'), 'sort por ts asc (api.ts:1230)')
  ok(apiSrc.includes('`\\ntags: [${'), 'tag list template (api.ts:1233)')
  ok(apiSrc.includes("join(VAULT, 'knowledge', 'projects', slug, 'docs', 'notas.md')"), 'target path (api.ts:1237)')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
