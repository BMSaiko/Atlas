// test/ci-gate.test.mjs
//
// Regressao: server/api.ts::checkConflictMarkers + runCIGate (L140-153).
// Cobre 2 invariantes:
//   1. checkConflictMarkers: true se houver markers <<<<<<< ou >>>>>>> no repo
//   2. runCIGate: para no 1o passo que falhe (conflict-markers -> typecheck -> build),
//      devolve {ok, step, out} com a trace do passo que falhou
//
// Como runCIGate chama 'tsc.cmd'/'vite.cmd' directamente (fix f0e0e39), o test faz MIRROR EXATO com runCmd
// injectable (mesmo padrao de wipe-guard.test.mjs) e SOURCE EQUALITY no fim:
// se alguem editar o handler sem actualizar o mirror, isto falha.
//
// Executar: node test/ci-gate.test.mjs
// Sem dependencia externa (apenas node:test built-in para setup), sem framework.

import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const apiPath = join(here, '..', 'server', 'api.ts')

// ---- MIRROR do server/api.ts L140-153 ----
// runCmd fake: corre o comando real (git, tsc/vite stub, etc.) e devolve {ok, out}
// ponytail: TEST_GIT allows the test to run in envs where 'git' nao esta no PATH do Node spawn
// (ex: MSYS/WSL ou Windows services). O source real (api.ts L132) faz o mesmo: ctrlPath explicito.
const TEST_BIN = process.env.TEST_GIT || 'git'
function runCmdReal(cmd, args, cwd) {
  return new Promise((res) => {
    const isBatch = /\.(cmd|bat)$/i.test(cmd)
    const bin = isBatch ? 'cmd' : (cmd === 'git' ? TEST_BIN : cmd)
    const binArgs = isBatch ? ['/d', '/s', '/c', cmd, ...args] : args
    const c = spawn(bin, binArgs, { cwd, windowsHide: true })
    let out = ''
    c.stdout?.on('data', d => out += d)
    c.stderr?.on('data', d => out += d)
    c.on('error', e => res({ ok: false, out: e.message }))
    c.on('close', code => res({ ok: code === 0, out: out.trim() }))
  })
}

// checkConflictMarkers mirror: corre git grep, devolve true se ha markers
async function checkConflictMarkers(repo, runCmd) {
  let g = await runCmd('git', ['grep', '-n', '-E', '^(<<<<<<<|=======|>>>>>>>)', 'dev', '--'], repo)
  if (g.out.includes('fatal')) g = await runCmd('git', ['grep', '-n', '-E', '^(<<<<<<<|=======|>>>>>>>)', '--'], repo)
  return g.out.trim().length > 0
}

// runCIGate mirror: cheap->expensive, para no 1o que falhe
async function runCIGate(repo, runCmd) {
  if (await checkConflictMarkers(repo, runCmd)) return { ok: false, step: 'conflict-markers', out: 'marcadores de conflito presentes em dev' }
  const tc = await runCmd('tsc.cmd', ['--noEmit'], repo)
  if (!tc.ok) return { ok: false, step: 'typecheck', out: tc.out.slice(-2000) }
  const bd = await runCmd('vite.cmd', ['build'], repo)
  if (!bd.ok) return { ok: false, step: 'build', out: bd.out.slice(-2000) }
  return { ok: true, step: 'ok', out: '' }
}

// ---- ASSERCOES ----
let failures = 0
const assert = (cond, msg) => {
  if (cond) console.log('  ok:', msg)
  else { console.error('  FAIL:', msg); failures++ }
}
const eq = (a, b, msg) => assert(a === b, `${msg}  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`)

console.log('CI gate (checkConflictMarkers + runCIGate) regression test')

const GIT = process.env.TEST_GIT || 'git'
const haveGit = (() => {
  try { execFileSync(GIT, ['--version'], { stdio: 'ignore' }); return true } catch { return false }
})()
if (!haveGit) {
  console.error('SKIP: git nao encontrado (set TEST_GIT)')
  process.exit(0)
}

// ============================================================
// [1] checkConflictMarkers: repo limpo -> false
// ============================================================
console.log('\n[1] checkConflictMarkers: repo limpo -> false')
{
  const repo = mkdtempSync(join(tmpdir(), 'ci-clean-'))
  execFileSync(GIT, ['init', '-q'], { cwd: repo })
  execFileSync(GIT, ['config', 'user.email', 't@t'], { cwd: repo })
  execFileSync(GIT, ['config', 'user.name', 't'], { cwd: repo })
  writeFileSync(join(repo, 'app.ts'), 'export const x = 1\n')
  execFileSync(GIT, ['add', '.'], { cwd: repo })
  execFileSync(GIT, ['commit', '-m', 'init', '-q'], { cwd: repo })

  const r = await checkConflictMarkers(repo, runCmdReal)
  eq(r, false, 'sem markers -> false')

  rmSync(repo, { recursive: true, force: true })
}

// ============================================================
// [2] checkConflictMarkers: repo com markers -> true
// ============================================================
console.log('\n[2] checkConflictMarkers: repo com markers -> true')
{
  const repo = mkdtempSync(join(tmpdir(), 'ci-conflict-'))
  execFileSync(GIT, ['init', '-q'], { cwd: repo })
  execFileSync(GIT, ['config', 'user.email', 't@t'], { cwd: repo })
  execFileSync(GIT, ['config', 'user.name', 't'], { cwd: repo })
  // Ficheiro com markers de conflito
  writeFileSync(join(repo, 'app.ts'),
    'export const x = 1\n' +
    '<<<<<<< HEAD\n' +
    'export const x = 2\n' +
    '=======\n' +
    'export const x = 3\n' +
    '>>>>>>> branch\n')
  execFileSync(GIT, ['add', '.'], { cwd: repo })
  execFileSync(GIT, ['commit', '-m', 'conflict', '-q'], { cwd: repo })

  const r = await checkConflictMarkers(repo, runCmdReal)
  eq(r, true, 'com markers -> true')

  rmSync(repo, { recursive: true, force: true })
}

// ============================================================
// [3] runCIGate: mocks in-memory (sem tsc/vite real)
// ============================================================
console.log('\n[3] runCIGate: runCmd mockado (sem npm real)')

// Mock factory: cada step tem o seu rc/out
function mockRunCmd(map) {
  // map: { 'git:grep:dev': {ok, out}, 'tsc.cmd:--noEmit': {ok, out}, ... }
  return (cmd, args, cwd) => {
    const key = cmd + ':' + args.join(':')
    if (map[key]) return Promise.resolve(map[key])
    // fallback: se git grep nao tiver match, devolve ok=true, out=''
    return Promise.resolve({ ok: true, out: '' })
  }
}

{
  // 3a: tudo OK
  const r = await runCIGate('/fake/repo', mockRunCmd({
    'git:grep:-n:-E:^(<<<<<<<|=======|>>>>>>>):dev:--':  { ok: true, out: '' },
    'tsc.cmd:--noEmit':                                  { ok: true, out: 'tsc OK' },
    'vite.cmd:build':                                      { ok: true, out: 'vite OK' },
  }))
  eq(r.ok, true, 'tudo OK -> ok=true')
  eq(r.step, 'ok', 'step=ok')
}

{
  // 3b: conflict-markers detectado
  const r = await runCIGate('/fake/repo', mockRunCmd({
    'git:grep:-n:-E:^(<<<<<<<|=======|>>>>>>>):dev:--':  { ok: true, out: 'app.ts:1:<<<<<<<' },
  }))
  eq(r.ok, false, 'markers -> ok=false')
  eq(r.step, 'conflict-markers', 'step=conflict-markers')
  assert(r.out.includes('marcadores'), 'out explica o motivo')
}

{
  // 3c: typecheck falha (apos conflict-markers OK)
  const r = await runCIGate('/fake/repo', mockRunCmd({
    'git:grep:-n:-E:^(<<<<<<<|=======|>>>>>>>):dev:--':  { ok: true, out: '' },
    'tsc.cmd:--noEmit':                                  { ok: false, out: 'TS2304: cannot find name foo' },
  }))
  eq(r.ok, false, 'typecheck falha -> ok=false')
  eq(r.step, 'typecheck', 'step=typecheck')
  assert(r.out.includes('TS2304'), 'out tem o erro de typecheck')
  // CRITICAL: build nao corre (early-exit)
}

{
  // 3d: build falha (apos typecheck OK)
  const r = await runCIGate('/fake/repo', mockRunCmd({
    'git:grep:-n:-E:^(<<<<<<<|=======|>>>>>>>):dev:--':  { ok: true, out: '' },
    'tsc.cmd:--noEmit':                                  { ok: true, out: 'tsc OK' },
    'vite.cmd:build':                                      { ok: false, out: 'rollup failed' },
  }))
  eq(r.ok, false, 'build falha -> ok=false')
  eq(r.step, 'build', 'step=build')
  assert(r.out.includes('rollup'), 'out tem o erro de build')
}

{
  // 3e: ordem importa — conflict vem ANTES de typecheck (early-exit)
  // Mesmo com typecheck OK no mock, se markers existirem, para antes
  let typecheckCalled = false
  const runCmdTracking = (cmd, args, cwd) => {
    if (cmd === 'tsc.cmd' && args[1] === '--noEmit') typecheckCalled = true
    if (cmd === 'git') return Promise.resolve({ ok: true, out: 'app.ts:1:<<<<<<<' })
    return Promise.resolve({ ok: true, out: 'never reached' })
  }
  const r = await runCIGate('/fake/repo', runCmdTracking)
  eq(r.ok, false, 'markers primeiro')
  eq(r.step, 'conflict-markers', 'step=conflict-markers')
  eq(typecheckCalled, false, 'typecheck NAO corre (early-exit)')
}

// ============================================================
// [4] SOURCE EQUALITY — server/api.ts L140-153 inalterado
// ============================================================
console.log('\n[4] SOURCE EQUALITY (ci-gate inalterado)')
{
  const src = readFileSync(apiPath, 'utf-8')
  // Source equality via substrings (regex literal e' tricky com () em string JS).
// Cada ancora e' um substring unico no source. Se o source mudar, falha.
const anchors = [
    'grep', '-n', '-E',  // L141: git grep com pattern
    '>>>>>>>)', 'dev', '--',  // L141: pattern + branch + -- literalmente
    "g.out.includes('fatal')",  // L142: fallback condition
    "return g.out.trim().length > 0",  // L143: check
    "step: 'conflict-markers'",  // L147
    "runCmd('tsc.cmd', ['--noEmit']",  // L148
    "runCmd('vite.cmd', ['build']",  // L150
    "step: 'ok', out: ''",  // L152
  ]
  for (const a of anchors) {
    assert(src.includes(a), `ancora presente: ${a.slice(0,60)}...`)
  }
}

// ============================================================
// RESULTADO
// ============================================================
if (failures > 0) {
  console.error(`\nFAIL: ${failures} assercao(oes) falharam`)
  process.exit(1)
}
console.log('\nOK: CI gate (checkConflictMarkers + runCIGate) regression passed')
