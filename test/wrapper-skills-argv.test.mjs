// test/wrapper-skills-argv.test.mjs
//
// card grill-me-palette — wrapper python (server/api.ts L406-441) propaga
// ATLAS_CARD_SKILLS=grill-me,grilling ao hermes_cli.main como args --skills X --skills Y.
// Cobertura:
//   1. SOURCE EQUALITY: a source do wrapper tem de casar com o contrato (le env, monta pares)
//   2. Comportamento: extrai o wrapper REAL e executa-o, capturando os args que passaria a hermes_cli.main
//      - sem env: 5 args (backward compat)
//      - com env 'grill-me': 7 args
//      - com env 'grill-me,grilling': 9 args
//      - com env empty / whitespace: 5 args (filtrado)
//
// Sem dependencia externa. Requer python 3 no PATH.

import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = dirname(here)
const apiPath = join(repoRoot, 'server', 'api.ts')

const havePython = (() => {
  try { execFileSync('python', ['-V'], { stdio: 'ignore' }); return true } catch { return false }
})()
if (!havePython) {
  console.error('SKIP: python nao encontrado no PATH')
  process.exit(0)
}

const apiSrc = readFileSync(apiPath, 'utf8')

// [1] SOURCE EQUALITY — wrapper tem de ler env + montar pares
assert.ok(/_sk=os\.environ\.get\('ATLAS_CARD_SKILLS'/.test(apiSrc),
  'wrapper deve ler ATLAS_CARD_SKILLS do env')
assert.ok(/_sa=\[\(\'--skills\'/.test(apiSrc),
  'wrapper deve montar pares --skills X')
assert.ok(/\[a for p in _sa for a in p\]/.test(apiSrc),
  'subprocess.call deve fazer spread de _sa')
console.log('  ok: source tem leitura de env + montagem de pares --skills')

// Extrai o wrapper real (entre 'const wrapper = [' ate '].join(...)') a partir do import "subprocess,sys,os,shutil,json,time"
// Procurar a string wrapper, extrair linhas entre aspas, e fazer .join('\n') em Python
function extractWrapperPy() {
  const importMarker = "'import subprocess,sys,os,shutil,json,time'"
  const i = apiSrc.indexOf(importMarker)
  if (i < 0) throw new Error('wrapper principal nao encontrado em api.ts')
  // volta para o "const wrapper = [" imediatamente antes
  const start = apiSrc.lastIndexOf('const wrapper = [', i)
  // avanca ate ].join('\n')
  const endMarker = "].join('\\n')"
  const end = apiSrc.indexOf(endMarker, i) + endMarker.length
  if (end < 0) throw new Error('].join(\'\\n\') nao encontrado')
  // Extrai a substring, depois faz um parse linha-a-linha pegando strings literais
  const block = apiSrc.slice(start, end)
  const lines = block.split('\n')
  const pyLines = []
  for (const ln of lines) {
    const s = ln.trim()
    if (s.endsWith(',')) {
      const inner = s.slice(0, -1).trim()
      if (inner.length >= 2 && inner[0] === inner[inner.length - 1] && (inner[0] === "'" || inner[0] === '"')) {
        try { pyLines.push(inner.slice(1, -1).split(String.fromCharCode(92, 120)).map((p, k) => k === 0 ? p : String.fromCharCode(parseInt(p.slice(0, 2), 16)) + p.slice(2)).join('')) }
        catch { pyLines.push(inner.slice(1, -1)) }
      }
    }
  }
  return pyLines.join('\n').replace(/GITBIN/g, 'git')
}

function argsFromWrapper(env) {
  const tmp = mkdtempSync(join(tmpdir(), 'atlas-skills-'))
  const dump = join(tmp, 'args.json')
  let py = extractWrapperPy()
  // patch: em vez de subprocess.call real, dump args
  const targetRe = /rc=subprocess\.call\(\[sys\.executable,"-m","hermes_cli\.main","-z",prompt\]\+\[a for p in _sa for a in p\]\)/
  if (!targetRe.test(py)) throw new Error('wrapper subprocess.call nao bateu (mudou o source?)')
  py = py.replace(
    targetRe,
    `import json as __j\nopen(${JSON.stringify(dump)}, 'w').write(__j.dumps([sys.executable, '-m', 'hermes_cli.main', '-z', prompt] + [a for p in _sa for a in p]))\nrc=0`
  )
  // skip post-rc (git worktree/merge/cleanup)
  py = py.replace(/if rc==0:[\s\S]+?worktree e branch mantidas p\. inspecao\./, 'pass')
  const argv = ['_st', '_wt', '_branch', '_repo', 'PROMPT', '_bb']
  execFileSync('python', ['-c', py, ...argv], { env: { ...process.env, ...env }, cwd: repoRoot })
  const out = JSON.parse(readFileSync(dump, 'utf8'))
  rmSync(tmp, { recursive: true, force: true })
  return out
}

// [2] sem env: backward compat — exatamente como antes
{
  const args = argsFromWrapper({})
  assert.equal(args.length, 5, 'baseline 5 args')
  assert.deepEqual(args.slice(1), ['-m', 'hermes_cli.main', '-z', 'PROMPT'])
  console.log('  ok: sem env -> 5 args (backward compat)')
}

// [3] single
{
  const args = argsFromWrapper({ ATLAS_CARD_SKILLS: 'grill-me' })
  assert.deepEqual(args.slice(-2), ['--skills', 'grill-me'])
  console.log('  ok: env=grill-me -> injecta 1 par --skills')
}

// [4] multi
{
  const args = argsFromWrapper({ ATLAS_CARD_SKILLS: 'grill-me,grilling' })
  assert.deepEqual(args.slice(-4), ['--skills', 'grill-me', '--skills', 'grilling'])
  console.log('  ok: env=grill-me,grilling -> injecta 2 pares')
}

// [5] empty / whitespace
{
  const args1 = argsFromWrapper({ ATLAS_CARD_SKILLS: '' })
  assert.equal(args1.length, 5, 'empty env nao injecta')
  const args2 = argsFromWrapper({ ATLAS_CARD_SKILLS: ' , grill-me , ' })
  assert.deepEqual(args2.slice(-2), ['--skills', 'grill-me'], 'whitespace filtrado')
  console.log('  ok: env vazio / whitespace -> 5 args')
}

console.log('PASS: wrapper-skills-argv')
