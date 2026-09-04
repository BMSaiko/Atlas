// test/wrapper-argv.test.mjs
//
// Regressao: runCard() deve
//   1. propagar rc do child (sem auto-merge se baseBranch undefined)
//   2. NAO tentar auto-merge em rc!=0
//   3. spawn auto-merge.mjs detached em rc==0 + baseBranch
//   4. chamar killPane so se pane != -1 e != null
//   5. heartbeat em ms (60s interval), pane default null
//   6. sanitise C1 (0x80-0x9F + U+FFFD) no .log stream
//   7. auto-merge.mjs: chdir(repo), git flow com retry on push fail
//
// Substitui o antigo wrapper-argv.test.mjs (que testava o python -c SCRIPT).
// Stdlib only. Sem hermes real (child = `node -e "process.exit(0)"`).

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const libDir = join(here, '..', 'server', 'lib')
const runCard = (await import(pathToFileURL(join(libDir, 'run-card.mjs')).href)).runCard
const autoMergeSrc = readFileSync(join(libDir, 'auto-merge.mjs'), 'utf8')
const runCardSrc = readFileSync(join(libDir, 'run-card.mjs'), 'utf8')

let passed = 0, failed = 0
function ok(m) { passed++; console.log(`  ok: ${m}`) }
function fail(m) { failed++; console.log(`  NOT OK: ${m}`) }
function assert(c, m) { c ? ok(m) : fail(m) }

function fakeHermes(rc, stderrText = '') {
  return {
    exe: process.execPath,
    args: ['-e', `process.stderr.write(${JSON.stringify(stderrText)}); process.exit(${rc})`],
    env: process.env,
  }
}
function makeLogWs() {
  let buf = ''
  return { write(c) { buf += c.toString('utf8') }, end() {}, get buf() { return buf } }
}

console.log('runCard argv contract test')

// 1. rc==0 propagado, heartbeat escreveu .status
{
  const tmp = mkdtempSync(join(tmpdir(), 'rc0-'))
  const st = join(tmp, 's.status')
  const r = await runCard({
    stPath: st, wt: tmp, branch: 'feature/x', repo: tmp, prompt: 'p',
    baseBranch: undefined, ...fakeHermes(0), logWs: makeLogWs(),
  })
  assert(r === 0, 'rc==0 propagado pelo runCard')
  const status = JSON.parse(readFileSync(st, 'utf8'))
  assert(status.state === 'running' || status.lastHeartbeatAt, 'heartbeat escreveu .status')
  rmSync(tmp, { recursive: true, force: true })
}

// 2. rc!=0 propagado, NAO tenta auto-merge
{
  const tmp = mkdtempSync(join(tmpdir(), 'rc1-'))
  const st = join(tmp, 's.status')
  const logWs = makeLogWs()
  const r = await runCard({
    stPath: st, wt: tmp, branch: 'feature/x', repo: tmp, prompt: 'p',
    baseBranch: 'dev', ...fakeHermes(1, 'fake err'), logWs,
  })
  assert(r === 1, 'rc!=0 propagado pelo runCard')
  assert(!logWs.buf.includes('NAO consigo ir para o branch base'), 'NAO tentou auto-merge em rc!=0')
  rmSync(tmp, { recursive: true, force: true })
}

// 3. pane guard
{
  assert(/pane == null \|\| pane === -1 \|\| pane === '-1'/.test(runCardSrc),
    'killPane guard: pane null/-1/"-1" salta cedo')
}

// 4. heartbeat shape: ms + pane=null
{
  const tmp = mkdtempSync(join(tmpdir(), 'hb-'))
  const st = join(tmp, 's.status')
  const child = { exe: process.execPath, args: ['-e', 'setTimeout(()=>{}, 200)'], env: process.env }
  await runCard({
    stPath: st, wt: tmp, branch: 'feature/x', repo: tmp, prompt: 'p',
    baseBranch: undefined, ...child, logWs: makeLogWs(),
  })
  const status = JSON.parse(readFileSync(st, 'utf8'))
  assert(typeof status.lastHeartbeatAt === 'number', 'lastHeartbeatAt is number')
  assert(status.lastHeartbeatAt > 1.7e12, 'lastHeartbeatAt is ms (>= 2024 epoch)')
  assert(status.pane === null, 'pane default null')
  rmSync(tmp, { recursive: true, force: true })
}

// 5. C1 sanitise
{
  const tmp = mkdtempSync(join(tmpdir(), 'c1-'))
  const st = join(tmp, 's.status')
  const logWs = makeLogWs()
  const c1Payload = 'A\x80B\x9fC�D\n'
  const child = {
    exe: process.execPath,
    args: ['-e', `process.stdout.write(${JSON.stringify(c1Payload)}); process.exit(0)`],
    env: process.env,
  }
  await runCard({
    stPath: st, wt: tmp, branch: 'feature/x', repo: tmp, prompt: 'p',
    baseBranch: undefined, ...child, logWs,
  })
  assert(!logWs.buf.includes('\x80'), 'C1 0x80 dropped')
  assert(!logWs.buf.includes('\x9f'), 'C1 0x9f dropped')
  assert(!logWs.buf.includes('�'), 'U+FFFD dropped')
  assert(logWs.buf.includes('A') && logWs.buf.includes('B') && logWs.buf.includes('C') && logWs.buf.includes('D'),
    'bytes validos preservados')
  rmSync(tmp, { recursive: true, force: true })
}

// 6. auto-merge detached spawn (source-only)
{
  assert(/spawnAutoMerge\(/.test(runCardSrc), 'runCard chama spawnAutoMerge no rc==0 path')
  assert(/spawn\(process\.execPath/.test(runCardSrc), 'auto-merge spawn usa process.execPath (node)')
  assert(/detached: true/.test(runCardSrc), 'auto-merge spawn detached')
  assert(/\.unref\(\)/.test(runCardSrc), 'auto-merge spawn unref')
  // auto-merge.mjs shape
  assert(/wt, branch, repo, baseBranch, stPath/.test(autoMergeSrc), 'auto-merge.mjs argv matches runCard')
  assert(/chdir\(repo\)/.test(autoMergeSrc), 'auto-merge: chdir(repo)')
  assert(/checkout.*baseBranch/.test(autoMergeSrc), 'auto-merge: checkout baseBranch')
  assert(/merge.*branch.*--no-edit/.test(autoMergeSrc), 'auto-merge: merge feature branch')
  assert(/push.*origin.*baseBranch/.test(autoMergeSrc), 'auto-merge: push origin baseBranch')
  assert(/state.*merge-failed/.test(autoMergeSrc), 'auto-merge: merge-failed em .status')
  assert(/worktree.*remove.*--force/.test(autoMergeSrc), 'auto-merge: cleanup worktree')
  assert(/branch.*-D.*branch/.test(autoMergeSrc), 'auto-merge: cleanup branch')
  assert(/ps\.status !== 0[\s\S]{0,400}ps = spawnSync.*push/.test(autoMergeSrc), 'BUG 3e: retry push')
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: wrapper-argv (${passed} ok, ${failed} not ok)`)
process.exit(failed === 0 ? 0 : 1)
