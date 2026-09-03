// test/hermes-keys-redact.test.mjs
//
// Cobre /api/hermes/keys: lê HERMES_HOME/auth.json, censurando access_token.
// Whitelist explicita de campos + secret_fingerprint derivado de sha256 (10 chars).
// Status derivado: 429/quota/rate/exhaust -> exhausted; 4xx/5xx -> error;
// 2xx last_status -> active; else unknown. access_token NUNCA sai do atlas.
//
// Estilo: vanilla node:assert. SOURCE EQUALITY no fim (api.ts:968-1013).
//
// Run: node test/hermes-keys-redact.test.mjs

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

console.log('\n[1] auth.json ausente -> [] (nao derruba)')
{
  const a = await spinAtlas()
  const r = await a.req('GET', '/api/hermes/keys')
  ok(r.status === 200, `GET keys sem auth.json -> 200 (got ${r.status})`)
  ok(Array.isArray(r.json) && r.json.length === 0, `body e' [] (got ${JSON.stringify(r.json)})`)
  await a.close()
}

console.log('\n[2] auth.json malformado -> [] (try/catch)')
{
  const a = await spinAtlas()
  writeFileSync(join(a.cwd, 'auth.json'), 'this is not json{{{')
  const r = await a.req('GET', '/api/hermes/keys')
  ok(r.status === 200, `GET keys c/ auth.json malformado -> 200 (got ${r.status})`)
  ok(Array.isArray(r.json) && r.json.length === 0, `body e' [] (got ${JSON.stringify(r.json)})`)
  await a.close()
}

console.log('\n[3] access_token NUNCA aparece no output (security-critical)')
{
  const a = await spinAtlas()
  writeFileSync(join(a.cwd, 'auth.json'), JSON.stringify({
    credential_pool: {
      openrouter: [{
        id: 'key-1', label: 'main', source: 'manual', auth_type: 'bearer',
        base_url: 'https://openrouter.ai/api/v1', priority: 1,
        access_token: 'sk-or-v1-SUPERSECRETSHOULDNEVERLEAK-1234567890abcdef',
        last_status: 200, request_count: 42,
      }],
    },
  }))
  const r = await a.req('GET', '/api/hermes/keys')
  const text = JSON.stringify(r.json)
  ok(!text.includes('SUPERSECRET'), `output NAO contem 'SUPERSECRET' (got len=${text.length})`)
  ok(!text.includes('sk-or-v1'), `output NAO contem 'sk-or-v1' (prefixo do access_token)`)
  ok(!text.includes('access_token'), `output NAO contem a chave 'access_token'`)
  await a.close()
}

console.log('\n[4] secret_fingerprint = sha256(access_token).slice(0,10) (hex)')
{
  const a = await spinAtlas()
  writeFileSync(join(a.cwd, 'auth.json'), JSON.stringify({
    credential_pool: {
      openrouter: [{
        id: 'k', access_token: 'test-token-abc',
        last_status: 200,
      }],
    },
  }))
  const r = await a.req('GET', '/api/hermes/keys')
  // sha256('test-token-abc') = ...
  const crypto = await import('node:crypto')
  const expectedFp = crypto.createHash('sha256').update('test-token-abc').digest('hex').slice(0, 10)
  ok(r.json?.[0]?.secret_fingerprint === expectedFp, `fingerprint correto: ${r.json?.[0]?.secret_fingerprint} === ${expectedFp}`)
  ok(r.json?.[0]?.has_token === true, `has_token=true (got ${r.json?.[0]?.has_token})`)
  await a.close()
}

console.log('\n[5] status derivation: 429/quota/rate/exhaust -> exhausted')
{
  const a = await spinAtlas()
  const cases = [
    { last_error_code: 429, last_error_reason: 'rate limit hit', expected: 'exhausted' },
    { last_error_code: 429, last_error_reason: null, expected: 'exhausted' },
    { last_error_code: null, last_error_reason: 'quota exhausted', expected: 'exhausted' },
    { last_error_code: null, last_error_reason: 'rate-limit reached', expected: 'exhausted' },
    { last_error_code: 500, last_error_reason: 'internal', expected: 'error' },
    { last_error_code: 401, last_error_reason: 'unauthorized', expected: 'error' },
    { last_error_code: null, last_error_reason: null, last_status: 200, expected: 'active' },
    { last_error_code: null, last_error_reason: null, last_status: 250, expected: 'active' },
    { last_error_code: null, last_error_reason: null, last_status: null, expected: 'unknown' },
    // last_error_code >=400 sem reason mas last_status 2xx -> nao 'error' (a condicao e' code >= 400)
    { last_error_code: 401, last_error_reason: null, last_status: 200, expected: 'error' },
  ]
  writeFileSync(join(a.cwd, 'auth.json'), JSON.stringify({
    credential_pool: {
      p1: cases.map((c, i) => ({ id: 'k'+i, access_token: 't'+i, ...c })),
    },
  }))
  const r = await a.req('GET', '/api/hermes/keys')
  ok(r.json?.length === cases.length, `${cases.length} chaves (got ${r.json?.length})`)
  for (let i = 0; i < cases.length; i++) {
    const got = r.json?.[i]?.status
    const want = cases[i].expected
    ok(got === want, `  status[${i}]: last_error_code=${cases[i].last_error_code} reason='${cases[i].last_error_reason}' last_status=${cases[i].last_status} -> ${want} (got ${got})`)
  }
  await a.close()
}

console.log('\n[6] whitelist: so os 18 campos esperados no output (sem extras)')
{
  const a = await spinAtlas()
  writeFileSync(join(a.cwd, 'auth.json'), JSON.stringify({
    credential_pool: {
      openai: [{
        id:'k1', label:'main', source:'env', auth_type:'bearer',
        base_url:'https://api.openai.com/v1', priority:1,
        access_token:'secret-stays-here',
        last_status:200, last_status_at:1700000000000,
        last_error_code:null, last_error_reason:null, last_error_message:null,
        last_error_reset_at:null, request_count:5,
        // campos extras no input - devem ser ignorados
        notes:'private', extra_field:'hidden', created_by:'admin',
      }],
    },
  }))
  const r = await a.req('GET', '/api/hermes/keys')
  const expected = new Set(['provider','id','label','source','auth_type','base_url','priority','status','last_status','last_status_at','last_error_code','last_error_reason','last_error_message','last_error_reset_at','request_count','secret_fingerprint','has_token'])
  const got = new Set(Object.keys(r.json[0]))
  const extra = [...got].filter(k => !expected.has(k))
  const missing = [...expected].filter(k => !got.has(k))
  ok(extra.length === 0, `sem campos extra no output (got: ${extra.join(',') || 'none'})`)
  ok(missing.length === 0, `sem campos em falta (got: ${missing.join(',') || 'none'})`)
  // e os extras do input NAO vao sair
  const text = JSON.stringify(r.json)
  ok(!text.includes('notes'), `'notes' nao vazou`)
  ok(!text.includes('extra_field'), `'extra_field' nao vazou`)
  ok(!text.includes('created_by'), `'created_by' nao vazou`)
  await a.close()
}

console.log('\n[7] sort: provider asc, priority asc')
{
  const a = await spinAtlas()
  writeFileSync(join(a.cwd, 'auth.json'), JSON.stringify({
    credential_pool: {
      z: [{ id:'z2', priority: 2, access_token:'a' }, { id:'z1', priority: 1, access_token:'b' }],
      a: [{ id:'a1', priority: 1, access_token:'c' }, { id:'a2', priority: 5, access_token:'d' }],
    },
  }))
  const r = await a.req('GET', '/api/hermes/keys')
  const order = r.json.map(k => k.provider + ':' + k.id)
  ok(order[0] === 'a:a1' && order[1] === 'a:a2' && order[2] === 'z:z1' && order[3] === 'z:z2', `sort (got: ${order.join(',')})`)
  await a.close()
}

console.log('\n[8] has_token false quando access_token ausente')
{
  const a = await spinAtlas()
  writeFileSync(join(a.cwd, 'auth.json'), JSON.stringify({
    credential_pool: { x: [{ id:'no-tok' }] },  // sem access_token
  }))
  const r = await a.req('GET', '/api/hermes/keys')
  ok(r.json?.[0]?.has_token === false, `has_token=false (got ${r.json?.[0]?.has_token})`)
  ok(r.json?.[0]?.secret_fingerprint === null, `fingerprint=null (got ${r.json?.[0]?.secret_fingerprint})`)
  await a.close()
}

// SOURCE EQUALITY
console.log('\n[9] SOURCE EQUALITY — api.ts:968-1013 (route + whitelist + fingerprint)')
{
  ok(apiSrc.includes("parts[0] === 'hermes' && parts[1] === 'keys' && parts.length === 2 && m === 'GET'"), 'guard: hermes/keys GET (api.ts:972)')
  ok(apiSrc.includes("secret_fingerprint: fp"), 'campo secret_fingerprint presente (api.ts:1006)')
  ok(apiSrc.includes("has_token: !!tok"), 'has_token boolean (api.ts:1007)')
  ok(apiSrc.includes("createHash('sha256').update(tok).digest('hex').slice(0, 10)"), 'sha256(tok).slice(0,10) (api.ts:989)')
  ok(apiSrc.includes("status = 'exhausted'"), 'status = exhausted (api.ts:983)')
  // whitelist explicita (os 17 campos)
  ok(apiSrc.includes('secret_fingerprint:'), 'whitelist inclui secret_fingerprint (api.ts:1006)')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
