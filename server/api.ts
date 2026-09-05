import type { Plugin, Connect } from 'vite'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { join, dirname, delimiter, normalize, extname, relative, resolve, sep } from 'node:path'
import { cfg } from './config'
import { loadPrompt, interpolate } from './prompts/index'
// ponytail: snapshots — 4/dia, retenção 7d, dedup por hash, cron via setInterval. Ver server/snapshots.ts.
import { tickAll, tickSnapshot, listSnapshots, getSnapshotFile, restoreSnapshot, writeWipeGuardSnapshot, slotFor } from './snapshots'
// ponytail: shared HTTP helpers (Phase 1 of the backend refactor). See server/lib/http.ts.
import { isLoopback, makeSend, readJsonBody } from './lib/http'
// ponytail: shared domain types (Phase 2C). WD used by workdirs handlers + index.
import type { WD } from './lib/types'
import { dispatch } from './routes'

const DATA = join(process.cwd(), 'data')
const SLUG = /^[a-z0-9-]+$/
const INDEX = 'index.json'
// paths/porta externos do runner vivem em server/config.ts (atlas.config.json + env sobreposicao).
// WEZTERM/WEZTERM_CLI/HERMES_CWD removidos — codigo morto (modo headless substituiu a janela WezTerm);
// re-adicionar como key de config se o modo interactivo WezTerm voltar.
const VENV_PY = cfg.hermesPy
const HERMES_HOME = cfg.hermesHome
const GIT = cfg.git
const VAULT = cfg.vault // ponytail: datas locais (live-data) versionadas na vault -> auto-backup a cada escrita
let vaultDirty = false  // ha escrita pendente de commit
let vaultTimer: ReturnType<typeof setTimeout> | null = null  // handle do debounce
let vaultBusy = false  // guarda de overlap: add+commit em curso
function flushVault() {  // ponytail: 1 commit por lote (debounce trailing); .wt ignorado na vault
  if (!vaultDirty || vaultBusy) return
  vaultDirty = false; vaultBusy = true
  const c = spawn(GIT, ['-C', VAULT, 'add', '-A', 'knowledge/projects/atlas/live-data', '--'], { windowsHide: true, stdio: 'ignore' })
  c.on('close', () => {
    const d = spawn(GIT, ['-C', VAULT, 'commit', '--no-verify', '-m', 'atlas: live-data sync (data.json)', '--', 'knowledge/projects/atlas/live-data'], { windowsHide: true, stdio: 'ignore' })
    // ponytail: escritas que chegaram a meio do commit ficam em vaultDirty -> commit de arrasto
    const revive = () => { vaultBusy = false; if (vaultDirty) vaultTimer = setTimeout(flushVault, 2000) }
    d.on('close', revive)
    d.on('error', revive)
  })
  c.on('error', () => { vaultBusy = false; if (vaultDirty) vaultTimer = setTimeout(flushVault, 2000) })
}
function syncVault() {  // ponytail: debounce trailing 2s -> rajada de N escritas = 1 commit; ficheiro fica ja em disco (writeJ nao muda)
  vaultDirty = true
  if (vaultTimer) clearTimeout(vaultTimer)
  vaultTimer = setTimeout(flushVault, 2000)
}
const ATLAS_REPO = cfg.atlasRepo
// repoDir: repo (.git / source-tree) do mundo -> worktrees, merge, CI e push correm no codigo do mundo,
// NAO no do atlas. ponytail: fallback ATLAS_REPO p/ mundos sem `repo` (atlas, heimdall) -> comportamento actual.
async function repoDir(slug: string): Promise<string> {
  const meta = await readJ(join(DATA, slug, 'meta.json'))
  if (meta && typeof meta.repo === 'string' && meta.repo.trim()) return meta.repo.trim()
  return ATLAS_REPO
}
// wtRoot: .wt (worktrees + runs) de um mundo vive dentro do repo desse mundo.
function wtRoot(repo: string): string { return join(repo, 'data', '.wt') }
const nid = () => Math.random().toString(36).slice(2, 10)  // id curto p/ notas/cards
// catalog de icons por workdir -> cada tab da sidebar mostra um icon diferente.
function iconCatalog(): string[] {
  const dir = join(process.cwd(), 'public', 'icons')
  try { return readdirSync(dir).filter(f => f.endsWith('.svg')).sort() } catch { return [] }
}
// icon distinto por workdir: escolhe o primeiro ainda nao usado (cai para hash se todos ocupados)
function pickIcon(idx: WD[]): string {
  const cat = iconCatalog()
  if (!cat.length) return ''
  const used = new Set(idx.map(w => w.icon).filter(Boolean))
  const free = cat.find(c => !used.has(c))
  return free || cat[idx.length % cat.length]
}

function initIndex() {
  mkdirSync(DATA, { recursive: true })
  const f = join(DATA, INDEX)
  if (!existsSync(f)) writeFile(f, '[]', 'utf8')
}
initIndex()

// ponytail: snapshot cron — 1 tick por hora, alinhado ao slot (00/06/12/18 UTC). tickAll é best-effort;
// falha num slug nao derruba os outros. Sem este interval, snapshots só acontecem com POST manual.
let _snapLastSlot = slotFor()
setInterval(async () => {
  const cur = slotFor()
  if (cur === _snapLastSlot) return   // já correu este slot, espera o próximo tick
  _snapLastSlot = cur
  const idx = await readIdx()
  void tickAll(idx.map(w => w.slug))
}, 60 * 60 * 1000)  // 1h — slotFor() deduplica se ainda dentro do mesmo slot

// ponytail: tick no boot para o user nao esperar 1h ate ao primeiro snapshot visivel.
;(async () => { const idx = await readIdx(); void tickAll(idx.map(w => w.slug)) })()

function inside(root: string, p: string) {
  const rel = relative(root, p)
  return rel !== '' && !rel.startsWith('..') && !rel.includes(sep + '..')
}
function toSlug(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
function runGit(args: string[], cwd: string = ATLAS_REPO): Promise<{ ok: boolean; out: string }> {
  return new Promise(res => {
    const c = spawn(GIT, args, { cwd, windowsHide: true })
    let out = ''; c.stdout?.on('data', (d: Buffer) => out += d); c.stderr?.on('data', (d: Buffer) => out += d)
    c.on('error', e => res({ ok: false, out: e.message }))
    c.on('close', code => res({ ok: code === 0, out: out.trim() }))
  })
}
/// ---- CI gate no approve review (DR rn9w9tsw) ----
// runCmd: spawn promissificado p/ executar comandos no repo base (mesmo padrao de runGit).
function runCmd(cmd: string, args: string[], cwd: string): Promise<{ ok: boolean; out: string }> {
  return new Promise(res => {
    // ponytail: .cmd/.bat nao sao lançaveis por CreateProcess (so binarios PE) -> spawn EINVAL no Windows.
    // rodar via cmd.exe preservando os args (/d /s /c).
    const isBatch = /\.(cmd|bat)$/i.test(cmd)
    const bin = isBatch ? 'cmd' : cmd
    const binArgs = isBatch ? ['/d', '/s', '/c', cmd, ...args] : args
    // ponytail: PATH host gigante (>8k) estoura o limite da linha de comando do cmd.exe (~8191) ->
    // npm corre scripts com PATH vazio -> 'tsc/vite is not recognized'. Passar PATH controlado curto
    // (dirnode + node_modules/.bin + SystemRoot) p/ resolver tsc/vite em qualquer ambiente.
    const root = process.env.SystemRoot
    const ctrlPath = [
      dirname(process.execPath),          // nodejs (npm.cmd, node)
      join(cwd, 'node_modules', '.bin'),  // tsc, vite
      ...(root ? [root + '\\System32', root] : [])
    ].join(delimiter)
    const c = spawn(bin, binArgs, { cwd, windowsHide: true, env: { ...process.env, PATH: ctrlPath } })
    let out = ''; c.stdout?.on('data', (d: Buffer) => out += d); c.stderr?.on('data', (d: Buffer) => out += d)
    c.on('error', e => res({ ok: false, out: e.message }))
    c.on('close', code => res({ ok: code === 0, out: out.trim() }))
  })
}
// checkConflictMarkers: git grep sobre a arvore de dev; se 'dev' nao existir, cai p/ working tree.
// rc 1 = sem matches (limpo, out vazio); rc 0 = achou markers; fatal = erro -> trunca como falha.
async function checkConflictMarkers(repo: string): Promise<boolean> {
  let g = await runCmd(GIT, ['grep', '-n', '-E', '^(<<<<<<<|=======|>>>>>>>)', 'dev', '--'], repo)
  if (g.out.includes('fatal')) g = await runCmd(GIT, ['grep', '-n', '-E', '^(<<<<<<<|=======|>>>>>>>)', '--'], repo)
  return g.out.trim().length > 0
}
// runCIGate: barato->caro; para no 1o que falhe. build escreve dist/ (gitignored) -> nao suja git status.
// runCIGate: barrier pre-merge em dev->main. Aceita wtDir opcional para BC: se ausente, corre no repo base
// (comportamento original — preservado para callers que nao sabem de worktrees). Com wtDir, corre o
// typecheck + build no worktree isolado, deixando o repo base (onde corre `npm run dev`) intocado.
// ponytail: `vite build --outDir .ci-gate/<ts>` isola o output para nao colidir com o dist/ que o dev
// server tem aberto. Limpa no fim (best-effort) senao fica lixo. Sem npm install por run — o junction
// partilhado garante que .bin resolve.
async function runCIGate(repo: string, wtDir?: string): Promise<{ ok: boolean; step: string; out: string }> {
  if (process.env.ATLAS_TEST_CI_OK) return { ok: true, step: 'ok', out: '' }
  const ciRoot = wtDir || repo  // BC: wtDir ausente = repo (comportamento original)
  if (await checkConflictMarkers(repo)) return { ok: false, step: 'conflict-markers', out: 'marcadores de conflito presentes em dev' }
  const tc = await runCmd('tsc.cmd', ['--noEmit'], ciRoot)
  if (!tc.ok) return { ok: false, step: 'typecheck', out: tc.out.slice(-2000) }
  // vite build escreve dist/ — em wtDir podemos usar o nome default (isolado). No repo base usamos
  // .ci-gate/<ts> para nao colidir com o dist/ do vite dev.
  let outDir: string | null = null
  if (!wtDir) {
    outDir = join(repo, '.ci-gate', String(Date.now()))
    const bd = await runCmd('vite.cmd', ['build', '--outDir', outDir], repo)
    if (!bd.ok) return { ok: false, step: 'build', out: bd.out.slice(-2000) }
  } else {
    const bd = await runCmd('vite.cmd', ['build'], ciRoot)
    if (!bd.ok) return { ok: false, step: 'build', out: bd.out.slice(-2000) }
  }
  // cleanup best-effort
  if (outDir) {
    try { await rm(outDir, { recursive: true, force: true }) } catch {}
  }
  return { ok: true, step: 'ok', out: '' }
}

// rmJunction: remove SO o junction (nao segue para o target). rmdir elimina um reparse point
// juncão sem tocar no conteudo do repo base. Previne `rm -r` seguir o junction e apagar o node_modules base.
function rmJunction(dir: string): Promise<void> {
  return new Promise((res) => {
    const c = spawn('cmd', ['/c', 'rmdir', dir], { windowsHide: true })
    c.on('close', () => res()); c.on('error', () => res())
  })
}
// addJunction: junction partilhado p/ o node_modules do repo base -> SEM npm install por card (cold 45MB x cada).
function addJunction(dir: string, target: string): Promise<boolean> {
  return new Promise((res) => {
    const c = spawn('cmd', ['/c', 'mklink', '/J', dir, target], { windowsHide: true })
    c.on('close', (code) => res(code === 0)); c.on('error', () => res(false))
  })
}
// killWtLockers: o rm() da worktree rebenta em EBUSY (Windows) se uma pane WezTerm de um
// run anterior ainda tiver cwd/handles la dentro. Matar por cmdline que referencia o wt —
// e o unico hook fiavel (o spawn do WezTerm carrega o path do wt nos args, e o OpenConsole filho herda).
// ponytail: taskkill /T /F reapa a arvore (pane + OpenConsole + eventuais filhos).
function killWtLockers(wt: string): Promise<void> {
  return new Promise((res) => {
    const esc = wt.replace(/[\\']/g, '\\$&')
    const ps = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '${esc}' } | ForEach-Object { taskkill /PID $_.ProcessId /T /F *> $null }`
    const c = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, stdio: 'ignore' })
    c.on('close', () => res()); c.on('error', () => res())
  })
}

// ponytail: body() moved to lib/http as readJsonBody (Phase 1).
async function readJ(p: string) { try { return JSON.parse(await readFile(p,'utf8')) } catch { return null } }
// ponytail: termwiz drop C1 0x80-0x9F (latin1->utf8 mal-codado no child Python) + U+FFFD (substituicao que o decoder UTF-8 do node aplica a bytes invalidos). Mantem C0 0x00-0x1F (\n/\t) e tudo >= 0xA0 (UTF-8 multi-byte intacto).
function sanitize(d: Buffer): Buffer { return Buffer.from(d.toString('utf8').replace(/[\u0080-\u009F\uFFFD]/g, ''), 'utf8') }
// ponytail: card t02krhls — string variant do sanitize() para re-leituras do .log file (endpoints GET que devolvem o log a UI).
function _sanitizeText(s: string): string { return s.replace(/[\u0080-\u009F\uFFFD]/g, '') }
// ponytail: ETag por ficheiro — TODA escrita via writeJ avanca `ver` (1 ponto, nao um guard por escritor).
// index.json/meta.json nao tem `ver` -> `'ver' in v` cobre-os (nada a fazer).
function bumpVer(v: any) { if (v && typeof v === 'object' && ('ver' in v)) v.ver = (Number(v.ver) || 0) + 1; return v }
async function writeJ(p: string, v: any) { mkdirSync(dirname(p), { recursive: true }); await writeFile(p, JSON.stringify(bumpVer(v),null,2), 'utf8'); syncVault() }
// ponytail: WD type moved to lib/types (Phase 2C of the backend refactor).
async function readIdx(): Promise<WD[]> { return (await readJ(join(DATA, INDEX))) || [] }

export default function atlasApi(): Plugin {
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://localhost')
    const p = url.pathname
    const m = req.method || 'GET'
    const send = makeSend(res)
    try {
      if (!p.startsWith('/api/')) return next()   // static handled by vite, preview fallback (ex: dist/index.html em produção)
      // ponytail: fence anti-corrida (card iykn11lg) — writers externos (PUT notes/kanban/bundle) tem de apresentar
      // X-Atlas-Token a bater com cfg.wtoken. Sem token -> 401. Escritas internas (writeJ chamado pelo proprio
      // server em launchHermes/dp worker) NAO passam pelo middleware HTTP, ficam trusted. GETs livre (UI+meta).
      if (m === 'PUT' && /^\/api\/w\/[^/]+\/(notes|bundle|events)$/.test(p)) {
        const got = (req.headers['x-atlas-token'] || '') as string
        const loopback = isLoopback(req)
        if (!loopback && got !== cfg.wtoken) { send(401, { error: 'unauthorized: missing or invalid X-Atlas-Token' }); return }
      }
      const parts = p.replace(/^\/api\//,'').split('/').filter(Boolean)

      // ponytail: devolve cfg.wtoken ao client loopback sem auth. UI chama no boot e guarda em localStorage.
      // Sem este endpoint, abrir localhost:5173 sem ?token=... cai em 401 permanente ate o utilizador adivinhar
      // o token impresso no console. Loopback-only = mesma proteccao que o PUT (fence).
      if (parts[0] === 'wtoken' && parts.length === 1 && m === 'GET') {
        const loopback = isLoopback(req)
        if (!loopback) { send(403, { error: 'forbidden' }); return }
        res.setHeader('Cache-Control', 'no-store')
        send(200, { token: cfg.wtoken }); return
      }

// ponytail: dispatcher + deps bag. Per-domain route tables live under server/routes/*.ts;
      // see server/routes/index.ts for the ALL_ROUTES concat. Deps bag stays lean: only
      // what routes actually use, not speculative exports.
      if (await dispatch({ req, res, send, parts, m, deps: {
        SLUG, DATA, INDEX, cfg, readIdx, readJ, writeJ, syncVault, repoDir, wtRoot, existsSync, readFileSync, statSync,
        pickIcon, toSlug, runGit, runCmd, runCIGate, checkConflictMarkers,
        tickAll, tickSnapshot, listSnapshots,
        getSnapshotFile, restoreSnapshot, writeWipeGuardSnapshot, slotFor,
        loadPrompt, interpolate, readJsonBody, createHash, readFile,
        _sanitizeText, inside, nid, rmJunction, HERMES_HOME,
      } })) return
            send(404, { error:'not found' })
    } catch (e:any) { send(500, { error: e.message }) }
  }
  return {
    name: 'atlas-api',
    configureServer(s) {
      s.middlewares.use(middleware)
    },
    configurePreviewServer(s) { s.middlewares.use(middleware) },
  }
}
