import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

// Config do runner carregada no boot. Single source: atlas.config.json (raiz, gitignored).
// Precedencia: env > ficheiro > defaults. Defaults = comportamento anterior (Windows + 5173),
// para nao quebrar sem config file (backwards compatible).
export interface AtlasConfig {
  port: number
  git: string
  hermesPy: string
  hermesHome: string
  atlasRepo: string
  vault: string
  // ponytail: wezterm exe (path para wezterm-gui.exe). Usado p/ abrir pane visivel quando um card
  // entra em doing. CLI (wezterm.exe) vive na mesma pasta e e' resolvido por path-rewrite no killPane().
  // Card terminal-control: sem este binario o spawn cai em headless (mesmo comportamento de antes).
  wezterm: string
  // ponytail: token anti-corrida (card iykn11lg) — writers externos (PUT notes/kanban/bundle) tem de apresentar este
  // header. NUNCA persistido em disco (uma fuga de cfg no log já é debug) — random por boot ou ATLAS_WTOKEN.
  wtoken: string
}

const DEFAULTS: AtlasConfig = {
  port: 5173,
  git: 'C:\\Program Files\\Git\\bin\\git.exe',
  hermesPy: 'C:\\Users\\bruno\\Documents\\hermes-agent\\.venv\\Scripts\\python.exe',
  hermesHome: 'C:\\Users\\bruno\\AppData\\Local\\hermes',
  atlasRepo: 'C:\\Users\\bruno\\Documents\\Second-Brain\\knowledge\\projects\\atlas\\code',
  vault: 'C:\\Users\\bruno\\Documents\\Second-Brain',
  wezterm: 'C:\\Program Files\\WezTerm\\wezterm-gui.exe',
  wtoken: '',  // resolved at runtime: env ATLAS_WTOKEN -> randomBytes(32).hex (ver loadConfig)
}

function envNum(key: string, dflt: number): number {
  const v = process.env[key]
  if (!v) return dflt
  const n = Number(v)
  return Number.isFinite(n) ? n : dflt
}

function loadConfig(): AtlasConfig {
  const file = join(process.cwd(), 'atlas.config.json')
  const fromFile: Partial<AtlasConfig> = existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as Partial<AtlasConfig>)
    : {}
  return {
    port: envNum('ATLAS_PORT', fromFile.port ?? DEFAULTS.port),
    git: process.env.GIT_BIN || fromFile.git || DEFAULTS.git,
    hermesPy: process.env.HERMES_PY || fromFile.hermesPy || DEFAULTS.hermesPy,
    hermesHome: process.env.HERMES_LIVE_HOME || fromFile.hermesHome || DEFAULTS.hermesHome,
    atlasRepo: process.env.ATLAS_REPO || fromFile.atlasRepo || DEFAULTS.atlasRepo,
    vault: process.env.ATLAS_VAULT || fromFile.vault || DEFAULTS.vault,
    wezterm: process.env.WEZTERM_BIN || fromFile.wezterm || DEFAULTS.wezterm,
    // ponytail: wtoken — env fixa para setups persistentes; sem env, aleatório a cada boot (curta duração = janela curta de exposição).
    // Card iykn11lg: impresso 1x no boot para o BMS colar como ?token=... no URL do client.
    wtoken: process.env.ATLAS_WTOKEN || fromFile.wtoken || randomBytes(32).toString('hex'),
  }
}
const _cfg = loadConfig()
console.log('[atlas] write token:', _cfg.wtoken.slice(0,8) + '...')  // imprimido 1x (8 chars) p/ o utilizador copiar no client; resto via npm run dev:token (card iykn11lg)
export const cfg: AtlasConfig = _cfg
