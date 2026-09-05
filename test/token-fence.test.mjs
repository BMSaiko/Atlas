// test/token-fence.test.mjs
//
// Cobre o fence anti-corrida (card iykn11lg): PUT /api/w/:slug/(notes|bundle|events) — kanban removido do fence
// exige X-Atlas-Token == cfg.wtoken OU remoteAddress loopback. Sem ambos -> 401.
//
// Estilo: vanilla node:assert (igual aos outros 8 testes). Counter de failures,
// process.exit(0|1) no fim. SOURCE EQUALITY guard apanha silenciosa divergencia
// do regex nas linhas 700-705 de server/api.ts.
//
// Run: node test/token-fence.test.mjs

import { readFileSync, mkdirSync } from 'node:fs'
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

console.log('\n[1] PUT fence: no token, non-loopback remote -> 401')
{
  const a = await spinAtlas()
  const token = await a.wtoken()
  // non-loopback remote: middleware checks socket.remoteAddress, so spoof via reqRaw
  const r = await a.reqRaw({ method:'PUT', url:'/api/w/x/notes', body:{ ver:0, items:[] }, remote:'10.0.0.1' })
  ok(r.status === 401, `PUT notes sem token + remote 10.0.0.1 -> 401 (got ${r.status})`)
  ok(r.json?.error?.includes('X-Atlas-Token'), `body menciona X-Atlas-Token (got ${JSON.stringify(r.json)})`)
  // kanban
  const r2 = await a.reqRaw({ method:'PUT', url:'/api/w/x/kanban', body:{ ver:0, columns:[], cards:[] }, remote:'10.0.0.1' })
  ok(r2.status === 401, `PUT kanban sem token + remote 10.0.0.1 -> 401 (got ${r2.status})`)
  // bundle
  const r3 = await a.reqRaw({ method:'PUT', url:'/api/w/x/bundle', body:{ meta:{}, notes:{}, kanban:{} }, remote:'10.0.0.1' })
  ok(r3.status === 401, `PUT bundle sem token + remote 10.0.0.1 -> 401 (got ${r3.status})`)
  await a.close()
}

console.log('\n[2] PUT fence: with token, non-loopback remote -> 200')
{
  const a = await spinAtlas()
  // ponytail: writeJ nao cria parent dirs (spinAtlas so' cria data/, nao data/<slug>/)
  mkdirSync(join(a.cwd, 'data', 'x'), { recursive: true })
  const token = await a.wtoken()
  const r = await a.reqRaw({ method:'PUT', url:'/api/w/x/notes', body:{ ver:0, items:[] }, remote:'10.0.0.1', headers:{'x-atlas-token': token} })
  ok(r.status === 200, `PUT notes c/ token + remote 10.0.0.1 -> 200 (got ${r.status})`)
  ok(r.json?.ok === true, `body ok=true (got ${JSON.stringify(r.json)})`)
  // bundle
  const r2 = await a.reqRaw({ method:'PUT', url:'/api/w/x/bundle', body:{ meta:{slug:'x'}, notes:{ver:0,items:[]}, kanban:{ver:0,columns:[],cards:[]} }, remote:'10.0.0.1', headers:{'x-atlas-token': token} })
  ok(r2.status === 200, `PUT bundle c/ token -> 200 (got ${r2.status})`)
  await a.close()
}

console.log('\n[3] PUT fence: loopback remote -> 200 sem token (bypass)')
{
  const a = await spinAtlas()
  // ponytail: writeJ nao cria parent dirs — pre-criar slugs do PUT loopback. safeRemote='127.0.0.1'->'127-0-0-1'->'loopback-127-0-0-1'; '::1'->'--1'->'loopback---1' (3 hifens); '::ffff:127.0.0.1'->'--ffff-127-0-0-1'->'loopback---ffff-127-0-0-1'
  for (const s of ['loop-fetch', 'loopback-127-0-0-1', 'loopback---1', 'loopback---ffff-127-0-0-1']) mkdirSync(join(a.cwd, 'data', s), { recursive: true })
  // fetch from 127.0.0.1 is loopback by definition. The middleware recognises
  // 127.0.0.1, ::1, ::ffff:127.0.0.1. No token needed.
  const r = await a.req('PUT', '/api/w/loop-fetch/notes', { ver:0, items:[] })
  ok(r.status === 200, `PUT notes via fetch (loopback) -> 200 (got ${r.status})`)
  // 6 outros formatos de loopback
  for (const remote of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    const safeRemote = remote.replace(/[^a-z0-9-]/g, '-')
    const r2 = await a.reqRaw({ method:'PUT', url:`/api/w/loopback-${safeRemote}/notes`, body:{ ver:0, items:[] }, remote })
    ok(r2.status === 200, `PUT notes remote=${remote} (loopback) -> 200 (got ${r2.status})`)
  }
  await a.close()
}

console.log('\n[4] GETs livres: wtoken/notes/kanban via non-loopback -> sem fence')
{
  const a = await spinAtlas()
  // GETs nao passam pelo fence (so PUTs). Spoof remote non-loopback para
  // confirmar que GETs sao publicos.
  const r1 = await a.reqRaw({ method:'GET', url:'/api/workdirs', remote:'10.0.0.1' })
  ok(r1.status === 200, `GET /api/workdirs non-loopback -> 200 (got ${r1.status})`)
  const r2 = await a.reqRaw({ method:'GET', url:'/api/w/get-test/notes', remote:'10.0.0.1' })
  ok(r2.status === 200, `GET /api/w/get-test/notes non-loopback -> 200 (got ${r2.status})`)
  const r3 = await a.reqRaw({ method:'GET', url:'/api/w/get-test/kanban', remote:'10.0.0.1' })
  ok(r3.status === 200, `GET /api/w/get-test/kanban non-loopback -> 200 (got ${r3.status})`)
  await a.close()
}

console.log('\n[5] Token wrong: remote non-loopback + wrong token -> 401')
{
  const a = await spinAtlas()
  const r = await a.reqRaw({ method:'PUT', url:'/api/w/x/notes', body:{ ver:0, items:[] }, remote:'10.0.0.1', headers:{'x-atlas-token': 'WRONG_TOKEN_xxxxxxxxxxxxxxxxxxxxxxxxxx'} })
  ok(r.status === 401, `PUT notes token errado + non-loopback -> 401 (got ${r.status})`)
  await a.close()
}

// SOURCE EQUALITY: o regex do fence + o body do erro nao devem ter mudado
// silenciosamente. Anchors cobrem a) o regex de matching, b) o branch
// loopback check, c) a string do erro.
console.log('\n[6] SOURCE EQUALITY — api.ts:700-704 (regex + loopback + 401)')
{
  // regex /^\/api\/w\/[^/]+\/(notes|kanban|bundle)$/
  ok(/\/\^\\\/api\\\/w\\\/\[\^\/\]\+\\\/\(notes\|bundle\|events\)\$\//.test(apiSrc), 'regex de match do fence presente (api.ts:700 — strip-kanban removeu kanban do fence)')
  // remote === '127.0.0.1' || '::1' || '::ffff:127.0.0.1'
  ok(apiSrc.includes("remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'"), 'loopback set check (api.ts:703)')
  // string exata do erro
  ok(apiSrc.includes("'unauthorized: missing or invalid X-Atlas-Token'"), 'string do erro 401 (api.ts:704)')
  // got !== cfg.wtoken gate
  ok(apiSrc.includes('got !== cfg.wtoken'), 'comparacao token vs cfg.wtoken (api.ts:704)')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
