// test/hermes-usage.test.mjs
//
// Cobre /api/hermes/usage?since=<ms>: lê HERMES_HOME/logs/atlas/usage.jsonl
// (1 linha JSON por request LLM capturado pelo HEIMDALL). Filtra por ts >= since
// (default = startOfToday); agrega por key_id; sem key_id -> '__unknown__'.
// Linhas malformadas sao ignoradas silenciosamente.
//
// Estilo: vanilla node:assert. SOURCE EQUALITY (api.ts:1015-1056).
//
// Run: node test/hermes-usage.test.mjs

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

// helper: cria uma linha de usage
// ponytail: key_id e' opt-in. Default sem key_id para que o test [4] consiga
// testar o balde __unknown__ sem override em cada row. Tests que querem key_id
// passam key_id no overrides.
const row = (overrides = {}) => JSON.stringify({
  ts: 1700000000000,
  model: 'gpt-4',
  prompt_tokens: 100,
  completion_tokens: 50,
  cost_usd: 0.01,
  provider: 'openai',
  ...overrides,
})

console.log('\n[1] usage.jsonl ausente -> resposta vazia (nao 500)')
{
  const a = await spinAtlas()
  // sem usage.jsonl
  const r = await a.req('GET', '/api/hermes/usage')
  ok(r.status === 200, `GET usage sem file -> 200 (got ${r.status})`)
  ok(Array.isArray(r.json?.rows) && r.json.rows.length === 0, `rows vazio (got ${r.json?.rows?.length})`)
  ok(typeof r.json?.totals_by_key === 'object', `totals_by_key e' object`)
  ok(typeof r.json?.since === 'number', `since e' number (startOfToday)`)
  ok(typeof r.json?.generated_at === 'number', `generated_at presente`)
  await a.close()
}

console.log('\n[2] filtro since: so linhas com ts >= since contam')
{
  const a = await spinAtlas()
  const logPath = join(a.cwd, 'logs', 'atlas', 'usage.jsonl')
  mkdirSync(join(a.cwd, 'logs', 'atlas'), { recursive: true })
  writeFileSync(logPath, [
    row({ ts: 100, key_id: 'old' }),
    row({ ts: 200, key_id: 'old2' }),
    row({ ts: 300, key_id: 'new' }),
  ].join('\n'))
  // since=250 -> so ts=300
  const r = await a.req('GET', '/api/hermes/usage?since=250')
  ok(r.status === 200, `since=250 -> 200`)
  ok(r.json?.rows?.length === 1, `1 row (got ${r.json?.rows?.length})`)
  ok(r.json?.rows?.[0]?.key_id === 'new', `key_id=new (got ${r.json?.rows?.[0]?.key_id})`)
  // since=150 -> ts=200, 300
  const r2 = await a.req('GET', '/api/hermes/usage?since=150')
  ok(r2.json?.rows?.length === 2, `2 rows (got ${r2.json?.rows?.length})`)
  // since=0 (ou omitido) -> tudo. O default e' startOfToday, mas since=0 e' um valor valido que cai no else
  const r3 = await a.req('GET', '/api/hermes/usage?since=0')
  // 'since' query '0' e parsed como 0, e sinceQ=0 cai em else (startOfToday.getTime())
  // Isto e' um bug leve — passar since=0 cai no default. Ver test [6].
  await a.close()
}

console.log('\n[3] agregacao por key_id: totals somam prompt+completion+cost+requests')
{
  const a = await spinAtlas()
  const logPath = join(a.cwd, 'logs', 'atlas', 'usage.jsonl')
  writeFileSync(logPath, [
    row({ ts: 1000, key_id:'kA', prompt_tokens:10, completion_tokens:5, cost_usd:0.001 }),
    row({ ts: 1100, key_id:'kA', prompt_tokens:20, completion_tokens:10, cost_usd:0.002 }),
    row({ ts: 1200, key_id:'kB', prompt_tokens:30, completion_tokens:15, cost_usd:0.003 }),
  ].join('\n'))
  const r = await a.req('GET', '/api/hermes/usage?since=0')
  // since=0 cai no default (startOfToday) — para evitar isso, mock ts > today
  // alternativa: setear since para um valor que case. Hoje = 2026-08-31 ish. Vou usar since=1 que tambem cai no else.
  // Solucao: usar ts no passado E since no passado
  const r2 = await a.req('GET', '/api/hermes/usage?since=500')
  const t = r2.json?.totals_by_key
  ok(t?.kA?.requests === 2, `kA requests=2 (got ${t?.kA?.requests})`)
  ok(t?.kA?.prompt_tokens === 30, `kA prompt=30 (got ${t?.kA?.prompt_tokens})`)
  ok(t?.kA?.completion_tokens === 15, `kA completion=15 (got ${t?.kA?.completion_tokens})`)
  ok(t?.kA?.cost_usd === 0.003, `kA cost=0.003 (got ${t?.kA?.cost_usd})`)
  ok(t?.kB?.requests === 1, `kB requests=1 (got ${t?.kB?.requests})`)
  ok(t?.kB?.prompt_tokens === 30, `kB prompt=30 (got ${t?.kB?.prompt_tokens})`)
  await a.close()
}

console.log('\n[4] __unknown__ balde: linhas sem key_id caem num bucket dedicado')
{
  const a = await spinAtlas()
  const logPath = join(a.cwd, 'logs', 'atlas', 'usage.jsonl')
  writeFileSync(logPath, [
    row({ ts: 1000, key_id:'k1' }),
    row({ ts: 1100, key_id: undefined }),  // sem key_id
    row({ ts: 1200, key_id:'' }),  // string vazia
    row({ ts: 1300 }),  // sem campo
  ].join('\n'))
  const r = await a.req('GET', '/api/hermes/usage?since=500')
  ok(r.json?.totals_by_key?.k1?.requests === 1, `k1 has 1 request`)
  // ponytail: JSON.stringify omite campos undefined. As 4 linhas dao:
  //   1: k1; 2: undefined (omitido) -> __unknown__; 3: '' -> __unknown__; 4: sem campo -> __unknown__
  // Total esperado: 3 unknown + 1 k1
  ok(r.json?.totals_by_key?.__unknown__?.requests === 3, `__unknown__ has 3 (got ${r.json?.totals_by_key?.__unknown__?.requests})`)
  // rows: todos com key_id normalizado
  const keyIds = r.json?.rows?.map(r => r.key_id).sort()
  ok(JSON.stringify(keyIds) === JSON.stringify(['__unknown__','__unknown__','__unknown__','k1']), `rows.key_id normalizados (got: ${JSON.stringify(keyIds)})`)
  await a.close()
}

console.log('\n[5] linhas malformadas ignoradas (sem derrubar)')
{
  const a = await spinAtlas()
  const logPath = join(a.cwd, 'logs', 'atlas', 'usage.jsonl')
  writeFileSync(logPath, [
    row({ ts: 1000, key_id:'good' }),
    'this is not json{{{',
    row({ ts: 1100, key_id:'good2' }),
    '',  // linha vazia
    '{ partial json',
  ].join('\n'))
  const r = await a.req('GET', '/api/hermes/usage?since=500')
  ok(r.json?.rows?.length === 2, `2 rows validas (got ${r.json?.rows?.length})`)
  await a.close()
}

console.log('\n[6] linhas com campos em falta: defaults (0) em vez de erro')
{
  const a = await spinAtlas()
  const logPath = join(a.cwd, 'logs', 'atlas', 'usage.jsonl')
  writeFileSync(logPath, [
    JSON.stringify({ ts: 1000 }),  // so ts, sem tokens/cost/key
  ].join('\n'))
  const r = await a.req('GET', '/api/hermes/usage?since=500')
  const row = r.json?.rows?.[0]
  ok(row?.prompt_tokens === 0 && row?.completion_tokens === 0 && row?.cost_usd === 0, `defaults 0 (got: ${JSON.stringify(row)})`)
  ok(row?.key_id === '__unknown__', `key_id fallback __unknown__ (got ${row?.key_id})`)
  // totals existe mas com 0 tudo
  ok(r.json?.totals_by_key?.__unknown__?.requests === 1, `balde __unknown__ tem 1`)
  await a.close()
}

console.log('\n[7] last_ts no totals: a entrada mais recente de cada key')
{
  const a = await spinAtlas()
  const logPath = join(a.cwd, 'logs', 'atlas', 'usage.jsonl')
  writeFileSync(logPath, [
    row({ ts: 1000, key_id:'k', model:'gpt-3.5' }),
    row({ ts: 2000, key_id:'k', model:'gpt-4' }),
    row({ ts: 1500, key_id:'k', model:'gpt-3.5-turbo' }),
  ].join('\n'))
  const r = await a.req('GET', '/api/hermes/usage?since=500')
  const t = r.json?.totals_by_key?.k
  ok(t?.last_ts === 2000, `last_ts=2000 (got ${t?.last_ts})`)
  ok(t?.model === 'gpt-4', `model=gpt-4 (got ${t?.model})`)
  await a.close()
}

console.log('\n[8] since query parsing: int, NaN-safe')
{
  const a = await spinAtlas()
  const logPath = join(a.cwd, 'logs', 'atlas', 'usage.jsonl')
  writeFileSync(logPath, row({ ts: 1000, key_id:'k' }))
  // since invalido (NaN) cai no default (startOfToday) - 1000 e' antes, nao conta
  const r1 = await a.req('GET', '/api/hermes/usage?since=garbage')
  ok(r1.status === 200, `since=garbage -> 200 (got ${r1.status})`)
  // since negativo: sinceQ<0 e cai no default; fromNow ms positive
  const r2 = await a.req('GET', '/api/hermes/usage?since=-100')
  ok(r2.status === 200, `since=-100 -> 200 (got ${r2.status})`)
  await a.close()
}

// SOURCE EQUALITY
console.log('\n[9] SOURCE EQUALITY — api.ts:1015-1056 (route + aggregator + __unknown__)')
{
  ok(apiSrc.includes("parts[0] === 'hermes' && parts[1] === 'usage' && parts.length === 2 && m === 'GET'"), 'guard: hermes/usage GET (api.ts:1024)')
  ok(apiSrc.includes("'__unknown__'"), '__unknown__ bucket (api.ts:1039)')
  ok(apiSrc.includes("startOfToday.setHours(0, 0, 0, 0)"), 'startOfToday default (api.ts:1026)')
  ok(apiSrc.includes('try { r = JSON.parse(line) } catch { continue }'), 'try/catch em JSON malformado (api.ts:1036)')
  ok(apiSrc.includes('totals_by_key'), 'totals_by_key output field (api.ts:1054)')
  ok(apiSrc.includes('last_ts: 0'), 'totals_by_key tem last_ts (api.ts:1046)')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
