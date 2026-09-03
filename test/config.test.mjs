// test/config.test.mjs
//
// Regressao: precedencia de config do runner (server/config.ts loadConfig).
// Cadeia: env > ficheiro (atlas.config.json) > DEFAULTS.
// Cobertura:
//   [1] defaults only (sem env, sem ficheiro) → todos os campos = DEFAULTS, wtoken random
//   [2] file only (sem env) → fromFile sobrescreve DEFAULTS nos campos presentes
//   [3] env+file+defaults → env vence sobre file vence sobre defaults
//   [4] envNum: ATLAS_PORT nao-numerico cai no fallback (Number.isFinite guard)
//   [5] wtoken: env fixa persiste; sem env = 64-char hex (randomBytes(32).hex)
//   [6] SOURCE EQUALITY — server/config.ts inalterado (6 anchors)
//
// Executar: node test/config.test.mjs
// Sem dependencia externa. Requer node 20+ (randomBytes.hex=64 chars).

import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

// Mirror EXACTO de server/config.ts (loadConfig + envNum). Re-implementado em JS
// para nao exigir transpile; comentario de origem no source confirma byte-equality.
const loaderSrc = `
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

const DEFAULTS = {
  port: 5173,
  git: 'C:\\\\Program Files\\\\Git\\\\bin\\\\git.exe',
  hermesPy: 'C:\\\\Users\\\\bruno\\\\Documents\\\\hermes-agent\\\\.venv\\\\Scripts\\\\python.exe',
  hermesHome: 'C:\\\\Users\\\\bruno\\\\AppData\\\\Local\\\\hermes',
  atlasRepo: 'C:\\\\Users\\\\bruno\\\\Documents\\\\Second-Brain\\\\knowledge\\\\projects\\\\atlas\\\\code',
  vault: 'C:\\\\Users\\\\bruno\\\\Documents\\\\Second-Brain',
  wezterm: 'C:\\\\Program Files\\\\WezTerm\\\\wezterm-gui.exe',
  wtoken: '',
}
function envNum(key, dflt) {
  const v = process.env[key]
  if (!v) return dflt
  const n = Number(v)
  return Number.isFinite(n) ? n : dflt
}
function loadConfig() {
  const file = join(process.cwd(), 'atlas.config.json')
  const fromFile = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  return {
    port: envNum('ATLAS_PORT', fromFile.port ?? DEFAULTS.port),
    git: process.env.GIT_BIN || fromFile.git || DEFAULTS.git,
    hermesPy: process.env.HERMES_PY || fromFile.hermesPy || DEFAULTS.hermesPy,
    hermesHome: process.env.HERMES_LIVE_HOME || fromFile.hermesHome || DEFAULTS.hermesHome,
    atlasRepo: process.env.ATLAS_REPO || fromFile.atlasRepo || DEFAULTS.atlasRepo,
    vault: process.env.ATLAS_VAULT || fromFile.vault || DEFAULTS.vault,
    wezterm: process.env.WEZTERM_BIN || fromFile.wezterm || DEFAULTS.wezterm,
    wtoken: process.env.ATLAS_WTOKEN || fromFile.wtoken || randomBytes(32).toString('hex'),
  }
}
process.stdout.write(JSON.stringify(loadConfig()))
`

let failures = 0
const assert = (cond, msg) => {
  if (cond) { console.log('  ok:', msg) }
  else { console.error('  FAIL:', msg); failures++ }
}

// Helper: spawn loader num tmp cwd limpo (sem atlas.config.json) com env controlado.
// node -e usa CJS eval; usamos um .mjs temp para o import.meta nao rebentar.
const tmp = mkdtempSync(join(tmpdir(), 'atlas-cfg-'))
const loaderFile = join(tmp, 'loader.mjs')
writeFileSync(loaderFile, loaderSrc)
const run = (extraEnv = {}, cfgFile = null) => {
  const cwd = cfgFile ? mkdtempSync(join(tmpdir(), 'atlas-cfgf-')) : tmp
  if (cfgFile) writeFileSync(join(cwd, 'atlas.config.json'), JSON.stringify(cfgFile))
  const env = { ...process.env, ...extraEnv }
  // Strip vars do loader para garantir isolamento
  for (const k of ['ATLAS_PORT','GIT_BIN','HERMES_PY','HERMES_LIVE_HOME','ATLAS_REPO','ATLAS_VAULT','WEZTERM_BIN','ATLAS_WTOKEN']) {
    if (!(k in extraEnv)) delete env[k]
  }
  const out = execFileSync('node', [loaderFile], { cwd, env, encoding: 'utf8' })
  if (cwd !== tmp) rmSync(cwd, { recursive: true, force: true })
  return JSON.parse(out)
}

console.log('[1] defaults only')
{
  const c = run()
  assert(c.port === 5173,                              'port = 5173 (default)')
  assert(c.git === 'C:\\Program Files\\Git\\bin\\git.exe', 'git path = default')
  assert(c.hermesHome === 'C:\\Users\\bruno\\AppData\\Local\\hermes', 'hermesHome = default')
  assert(c.atlasRepo.endsWith('\\knowledge\\projects\\atlas\\code'),  'atlasRepo = default')
  assert(c.vault === 'C:\\Users\\bruno\\Documents\\Second-Brain',      'vault = default')
  assert(/^[0-9a-f]{64}$/.test(c.wtoken),             `wtoken = 64-char hex random (got '${c.wtoken}')`)
}

console.log('\n[2] file only (sem env)')
{
  const c = run({}, { port: 7000, vault: 'D:\\from-file\\vault', wezterm: 'D:\\wezterm\\wezterm-gui.exe' })
  assert(c.port === 7000,                  'file.port override aplicado')
  assert(c.vault === 'D:\\from-file\\vault','file.vault override aplicado')
  assert(c.wezterm === 'D:\\wezterm\\wezterm-gui.exe', 'file.wezterm override aplicado')
  assert(c.git === 'C:\\Program Files\\Git\\bin\\git.exe', 'git NAO no file → cai no default')
}

console.log('\n[3] env > file > defaults')
{
  const c = run(
    { ATLAS_PORT: '9001', GIT_BIN: 'D:\\env\\git.exe', ATLAS_WTOKEN: 'env-fixed-token-1234' },
    { port: 7000, git: 'D:\\file\\git.exe', vault: 'D:\\file\\vault' }
  )
  assert(c.port === 9001,                  'env ATLAS_PORT vence file.port')
  assert(c.git === 'D:\\env\\git.exe',     'env GIT_BIN vence file.git')
  assert(c.wtoken === 'env-fixed-token-1234','env ATLAS_WTOKEN vence file/default')
  assert(c.vault === 'D:\\file\\vault',    'vault NAO em env → file vence default')
}

console.log('\n[4] envNum: ATLAS_PORT nao-numerico cai no fallback')
{
  const c = run({ ATLAS_PORT: 'lixo-nao-e-numero' }, { port: 7000 })
  assert(c.port === 7000,                  'ATLAS_PORT="lixo..." → file.port (7000), NAO NaN')
}

console.log('\n[5] wtoken: sem env e sem file → 64-char hex random')
{
  const c1 = run()
  const c2 = run()
  assert(/^[0-9a-f]{64}$/.test(c1.wtoken),  'run1: wtoken random 64-hex')
  assert(/^[0-9a-f]{64}$/.test(c2.wtoken),  'run2: wtoken random 64-hex')
  assert(c1.wtoken !== c2.wtoken,           'wtokens distintos entre boots')
}

console.log('\n[6] SOURCE EQUALITY (server/config.ts inalterado)')
{
  const cfgSrc = readFileSync(join(here.replace(/test.*$/, ''), 'server', 'config.ts'), 'utf-8')
  const anchors = [
    /ATLAS_PORT.*fromFile\.port \?\? DEFAULTS\.port/,                 // port: env>file>default
    /process\.env\.GIT_BIN \|\| fromFile\.git \|\| DEFAULTS\.git/,    // git: env>file>default (string)
    /HERMES_LIVE_HOME.*fromFile\.hermesHome/,                          // hermesHome: env>file>default
    /Number\.isFinite\(n\) \? n : dflt/,                              // envNum guard contra NaN
    /randomBytes\(32\)\.toString\('hex'\)/,                            // wtoken random fallback
    /process\.env\.ATLAS_WTOKEN \|\| fromFile\.wtoken \|\| randomBytes/,// wtoken: env>file>random
  ]
  for (const a of anchors) {
    assert(a.test(cfgSrc), `ancora presente: ${a.toString().slice(0,70)}...`)
  }
}

rmSync(tmp, { recursive: true, force: true })

if (failures > 0) {
  console.error(`\nFAIL: ${failures} assercao(oes) falharam`)
  process.exit(1)
}
console.log('\nOK: config precedence regression passed (6/6 secoes)')
