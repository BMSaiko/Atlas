import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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
}

const DEFAULTS: AtlasConfig = {
  port: 5173,
  git: 'C:\\Program Files\\Git\\bin\\git.exe',
  hermesPy: 'C:\\Users\\bruno\\Documents\\hermes-agent\\.venv\\Scripts\\python.exe',
  hermesHome: 'C:\\Users\\bruno\\AppData\\Local\\hermes',
  atlasRepo: 'C:\\Users\\bruno\\Documents\\Second-Brain\\knowledge\\projects\\atlas\\code',
  vault: 'C:\\Users\\bruno\\Documents\\Second-Brain',
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
  }
}

export const cfg: AtlasConfig = loadConfig()
