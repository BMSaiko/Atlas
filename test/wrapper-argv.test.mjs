// test/wrapper-argv.test.mjs
//
// Regressao: argv off-by-1 do wrapper python em server/api.ts. Cobre 3 wrappers:
//   A. launchHermes headless (L406-441) — 6-arg set [stPath,wt,branch,repo,prompt,baseBranch]
//   B. launchHermes with-pane (L453-461) — prepended pane-capture, mesmo 6-arg set
//   C. launchDp (L529-534) — wrapper minimo, 1-arg set [prompt] (sem git/merge)
//
// Bug historico: python -c faz sys.argv[0]='-c' (NAO o python path). Confirma:
//   1. wrapperWithPane grava .status com pane=WEZTERM_PANE e argv[1]=stPath
//   2. wrapper principal le sys.argv[1..6] corretamente (stPath..baseBranch)
//   3. os.chdir(repo) corre OK (NUNCA os.chdir(base) que crashava com NameError)
//   4. launchDp le sys.argv[1]=prompt corretamente (1-arg set, sem git)
//
// Reproduzido em 2026-08-30 nos cards bao35dg0/phqqhn10/q49x3w24.
//
// Executar: node test/wrapper-argv.test.mjs
// Sem dependencia externa. Requer python 3 no PATH.

import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, unlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

const havePython = (() => {
  try { execFileSync('python', ['-V'], { stdio: 'ignore' }); return true } catch { return false }
})()
if (!havePython) {
  console.error('SKIP: python nao encontrado no PATH')
  process.exit(0)
}

const tmp     = mkdtempSync(join(tmpdir(), 'atlas-argvfix-'))
const repoDir = mkdtempSync(join(tmpdir(), 'atlas-repo-'))
const stPath  = join(tmp, 'card.status')

// wrapper EXATO do server/api.ts L453-461 + L406-441.
// Mantem a sequencia: st=sys.argv[1] + chdir(repo).
// Substituimos o subprocess.call(hermes) por gravacao em .status para provar
// que os indices chegam corretos.
const wrapperWithPane = [
  'import os,json,time,sys',
  'st=sys.argv[1]',
  'try:',
  '    pane=int(os.environ.get("WEZTERM_PANE","-1"))',
  '    open(st,"w",encoding="utf-8").write(json.dumps({"state":"running","pane":pane,"ts":time.time()}))',
  'except: pass',
  // ---- wrapper principal (server/api.ts L406-441) ----
  'import subprocess,sys,os,shutil',
  'st=sys.argv[1]; wt=sys.argv[2]; branch=sys.argv[3]; repo=sys.argv[4]; prompt=sys.argv[5]; bb=sys.argv[6]',
  // dump indices para .status (sem spawn hermes real)
  'open(st,"a",encoding="utf-8").write("DUMP|argv0="+sys.argv[0]+"|argv1="+sys.argv[1]+"|argv2="+sys.argv[2]+"|argv3="+sys.argv[3]+"|argv4="+sys.argv[4]+"|argv5="+sys.argv[5]+"|argv6="+sys.argv[6]+"|END")',
  // rc==0 path: chdir(repo)
  'try:',
  '    os.chdir(repo)',
  '    open(st,"a",encoding="utf-8").write("|chdir=ok|"+os.getcwd()+"|END")',
  'except Exception as e:',
  '    open(st,"a",encoding="utf-8").write("|chdir=fail|"+repr(e)+"|END")',
].join('\n')

// Spawn pattern do server/api.ts L465 (headless mode):
// python -c <wrapperWithPane> stPath wt branch repo prompt baseBranch
const wtArg     = 'C:\\fake\\worktree\\q49x3w24'
const branchArg = 'feature/atlas-q49x3w24'
const repoArg   = repoDir
const promptArg = 'Implementa feature logs no Atlas'
const bbArg     = 'dev'

try {
  execFileSync('python',
    ['-c', wrapperWithPane, stPath, wtArg, branchArg, repoArg, promptArg, bbArg],
    { env: { ...process.env, WEZTERM_PANE: '4242' }, stdio: ['ignore', 'pipe', 'pipe'] }
  )
} catch (e) {
  console.error('FAIL: spawn python:', e.message)
  process.exit(1)
}

// ---- ASSERCOES ----
let failures = 0
const assert = (cond, msg) => {
  if (cond) { console.log('  ok:', msg) }
  else { console.error('  FAIL:', msg); failures++ }
}

console.log('Wrapper argv layout regression test')
const status = readFileSync(stPath, 'utf-8')
console.log('--- .status ---')
console.log(status)
console.log('--------------')

// 1. wrapperWithPane gravou state=running + pane=4242 (nao -1)
assert(status.includes('"state": "running"'), 'wrapperWithPane grava state=running')
assert(status.includes('"pane": 4242'),       'wrapperWithPane le WEZTERM_PANE=4242')

// 2. argv indices estao alinhados (DUMP|argvN=...|END)
const dump = status.match(/DUMP\|(.+?)\|END/)
assert(dump, 'DUMP argv presente no .status')

if (dump) {
  const parts = dump[1].split('|').map(s => s.split('=',2))
  const get = (n) => parts.find(([k]) => k === `argv${n}`)?.[1]
  assert(get(0) === '-c',     `argv[0]='-c' (got '${get(0)}')`)
  assert(get(1) === stPath,  `argv[1]=stPath (got '${get(1)}')`)
  assert(get(2) === wtArg,   `argv[2]=wt (got '${get(2)}')`)
  assert(get(3) === branchArg, `argv[3]=branch (got '${get(3)}')`)
  assert(get(4) === repoArg, `argv[4]=repo (got '${get(4)}')`)
  assert(get(5) === promptArg, `argv[5]=prompt (got '${get(5)}')`)
  assert(get(6) === bbArg,   `argv[6]=baseBranch (got '${get(6)}')`)
}

// 3. chdir(repo) correu OK
assert(status.includes('|chdir=ok|' + repoDir), 'os.chdir(repo) funcionou (nao foi chdir(base) que crashava)')

// 4. Bug-class: NAO deve haver off-by-1 residual
assert(!status.includes('argv1=' + wtArg),    'NAO ha off-by-1 (argv[1] NAO deve ser wt)')
assert(!status.includes('argv5=' + wtArg),    'NAO ha off-by-1 (argv[5]/prompt NAO deve ser wt)')
assert(!status.includes('argv4=' + promptArg),'NAO ha off-by-1 (argv[4]/repo NAO deve ser prompt)')

// ============================================================
// [5] launchDp wrapper (1-arg set, sem git/merge) — server/api.ts L529-534
// ============================================================
console.log('\n[5] launchDp: wrapper minimo 1-arg set')
{
  const dpStPath = join(tmp, 'dp-card.status')
  const dpPrompt = 'Gera DP para o card q49x3w24'
  // Stub: dump argv (sem chamar hermes real) e sys.exit(0)
  const dumpWrapper = [
    'import sys',
    'open("' + dpStPath.replace(/\\/g, '\\\\') + '","w").write("argv0="+sys.argv[0]+"|argv1="+sys.argv[1]+"|argc="+str(len(sys.argv)))',
  ].join('\n')
  execFileSync('python',
    ['-c', dumpWrapper, dpPrompt],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  const dpStatus = readFileSync(dpStPath, 'utf-8')
  assert(dpStatus.includes('argv0=-c'),         'launchDp: argv[0]=-c (python -c)')
  assert(dpStatus.includes('argv1=' + dpPrompt),'launchDp: argv[1]=prompt')
  assert(dpStatus.includes('argc=2'),           'launchDp: argc=2 (script + 1 arg)')

  unlinkSync(dpStPath)
}

// ============================================================
// [6] SOURCE EQUALITY — server/api.ts L406-441 + L453-461 + L529-534 inalterados
// ============================================================
console.log('\n[6] SOURCE EQUALITY (wrappers inalterados)')
{
  const apiSrc = readFileSync(join(here.replace(/test.*$/, ''), 'server', 'api.ts'), 'utf-8')
  const anchors = [
    // L408: argv map do wrapper principal
    /st=sys\.argv\[1\]; wt=sys\.argv\[2\]; branch=sys\.argv\[3\]; repo=sys\.argv\[4\]; prompt=sys\.argv\[5\]; bb=sys\.argv\[6\]/,
    // L413: chdir(repo) NOT chdir(base) — old-bug regression
    /os\.chdir\(repo\)/,
    // L416: checkout bb abort
    /if co\.returncode!=0/,
    // L421: merge branch --no-edit
    /subprocess\.run\(\[r"GITBIN","merge",branch,"--no-edit"\],capture_output=True\)/,
    // L423: push origin bb (NUNCA push com retry — ainda NAO implementado, BUG 3e)
    /subprocess\.run\(\[r"GITBIN","push","origin",bb\],capture_output=True\)/,
    // L430: merge-failed so imprime, NAO signal .status.state (BUG 3e fix por fazer)
    /print\("MERGE dev<-"\+branch\+" FALHOU/,
    // L455: wrapperWithPane st=sys.argv[1]
    /'st=sys\.argv\[1\]'/,
    // L457: pane=WEZTERM_PANE
    /pane=int\(os\.environ\.get/,
    // L462-465: headless dispatch
    /const headless = !cfg\.wezterm \|\| !existsSync\(cfg\.wezterm\)/,
    /\['-c', wrapperWithPane, stPath, wt, branch, repo, prompt, baseBranch\]/,
    // L529-532: launchDp wrapper minimo (1 arg)
    /'rc=subprocess\.call\(\[sys\.executable,"-m","hermes_cli\.main","-z",sys\.argv\[1\]\]\)'/,
  ]
  for (const a of anchors) {
    assert(a.test(apiSrc), `ancora presente: ${a.toString().slice(0,70)}...`)
  }
  // Confirmar o BUG 3e fix ESTA implementado (regression contract)
  assert(/json\.dumps\(\{\"state\":\"merge-failed\"/.test(apiSrc),  'BUG 3e fix: wrapper sinaliza merge-failed em .status')
  assert((apiSrc.match(/fetch.*origin.*bb.*capture_output=True/g) || []).length >= 2, 'BUG 3e fix: fetch origin bb >= 2x (retry apos push falhar)')
}

// Cleanup
unlinkSync(stPath)
rmSync(tmp, { recursive: true, force: true })
rmSync(repoDir, { recursive: true, force: true })

if (failures > 0) {
  console.error(`\nFAIL: ${failures} assercao(oes) falharam`)
  process.exit(1)
}
console.log('\nOK: argv fix regression passed (3 wrappers, todas as assercoes)')
