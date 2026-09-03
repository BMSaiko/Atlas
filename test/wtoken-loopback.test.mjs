// test/wtoken-loopback.test.mjs
//
// Cobre /api/wtoken: devolve cfg.wtoken ao client loopback, 403 non-loopback.
// Sem este endpoint, abrir localhost:5173 sem ?token=... cai em 401 permanente
// ate o utilizador adivinhar o token impresso no console.
//
// Estilo: vanilla node:assert (igual aos outros 9 testes). Counter de failures,
// process.exit(0|1) no fim. SOURCE EQUALITY guard no fim apanha silenciosa
// divergencia do regex nas linhas 711-717 de server/api.ts.
//
// Run: node test/wtoken-loopback.test.mjs

import { readFileSync } from 'node:fs'
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

console.log('\n[1] GET /api/wtoken loopback -> 200 + token')
{
  const a = await spinAtlas()
  // fetch from 127.0.0.1 is loopback
  const r = await a.req('GET', '/api/wtoken')
  ok(r.status === 200, `GET /api/wtoken loopback -> 200 (got ${r.status})`)
  ok(typeof r.json?.token === 'string' && r.json.token.length === 64, `token e' hex 64 chars (got len=${r.json?.token?.length})`)
  ok(/^[0-9a-f]{64}$/.test(r.json?.token || ''), `token matches /^[0-9a-f]{64}$/ (randomBytes(32).toString('hex'))`)
  await a.close()
}

console.log('\n[2] GET /api/wtoken non-loopback -> 403')
{
  const a = await spinAtlas()
  // 10.0.0.1 - non-loopback IPv4
  const r1 = await a.reqRaw({ method:'GET', url:'/api/wtoken', remote:'10.0.0.1' })
  ok(r1.status === 403, `GET /api/wtoken remote=10.0.0.1 -> 403 (got ${r1.status})`)
  ok(r1.json?.error === 'forbidden', `body error='forbidden' (got ${JSON.stringify(r1.json)})`)
  // 192.168.0.1 - LAN non-loopback
  const r2 = await a.reqRaw({ method:'GET', url:'/api/wtoken', remote:'192.168.0.1' })
  ok(r2.status === 403, `GET /api/wtoken remote=192.168.0.1 -> 403 (got ${r2.status})`)
  // ::ffff:1.2.3.4 - IPv4-mapped IPv6 non-loopback
  const r3 = await a.reqRaw({ method:'GET', url:'/api/wtoken', remote:'::ffff:1.2.3.4' })
  ok(r3.status === 403, `GET /api/wtoken remote=::ffff:1.2.3.4 -> 403 (got ${r3.status})`)
  // 2001:db8::1 - IPv6 non-loopback
  const r4 = await a.reqRaw({ method:'GET', url:'/api/wtoken', remote:'2001:db8::1' })
  ok(r4.status === 403, `GET /api/wtoken remote=2001:db8::1 -> 403 (got ${r4.status})`)
  await a.close()
}

console.log('\n[3] loopback variants aceitas -> 200')
{
  const a = await spinAtlas()
  // 3 formatos de loopback que o codigo aceita
  for (const remote of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    const r = await a.reqRaw({ method:'GET', url:'/api/wtoken', remote })
    ok(r.status === 200, `GET /api/wtoken remote=${remote} -> 200 (got ${r.status})`)
    ok(typeof r.json?.token === 'string' && r.json.token.length === 64, `  token shape valido (got len=${r.json?.token?.length})`)
  }
  await a.close()
}

console.log('\n[4] cache control: no-store no response (anti-cache do token)')
{
  const a = await spinAtlas()
  const r = await a.req('GET', '/api/wtoken')
  ok(r.headers['cache-control'] === 'no-store', `Cache-Control: no-store (got ${r.headers['cache-control']})`)
  await a.close()
}

console.log('\n[5] token estavel durante o ciclo do server (sessoes consecutivas dao mesmo token)')
{
  const a = await spinAtlas()
  const t1 = await a.wtoken()
  const t2 = await a.wtoken()
  const t3 = await a.wtoken()
  ok(t1 === t2 && t2 === t3, `wtoken estavel durante o server (t1==t2==t3)`)
  await a.close()
}

// SOURCE EQUALITY: o branch do wtoken endpoint + check loopback + string 403
// nao devem ter mudado silenciosamente. Anchors cobrem:
//  a) partes[0] === 'wtoken' guard
//  b) loopback check (mesmo set que o PUT fence)
//  c) string 'forbidden' do 403
//  d) Cache-Control: no-store
console.log('\n[6] SOURCE EQUALITY — api.ts:711-717 (route + loopback + 403 + no-store)')
{
  ok(apiSrc.includes("parts[0] === 'wtoken' && parts.length === 1 && m === 'GET'"), 'guard: parts[0]==wtoken && length==1 && GET')
  ok(apiSrc.includes("remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'"), 'loopback set check (api.ts:713)')
  ok(apiSrc.includes("send(403, { error: 'forbidden' })"), '403 + body forbidden (api.ts:714)')
  ok(apiSrc.includes("res.setHeader('Cache-Control', 'no-store')"), 'no-store header (api.ts:715)')
  ok(apiSrc.includes("send(200, { token: cfg.wtoken })"), '200 com cfg.wtoken (api.ts:716)')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
