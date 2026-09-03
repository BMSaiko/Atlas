import type { Plugin, Connect } from 'vite'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { join, dirname, delimiter, normalize, extname, relative, resolve, sep } from 'node:path'
import { parseRoadmap } from './roadmap'
import { cfg } from './config'
import { loadPrompt, interpolate } from './prompts/index'
// ponytail: snapshots — 4/dia, retenção 7d, dedup por hash, cron via setInterval. Ver server/snapshots.ts.
import { tickAll, tickSnapshot, listSnapshots, getSnapshotFile, restoreSnapshot, writeWipeGuardSnapshot, slotFor } from './snapshots'
// ponytail: shared HTTP helpers (Phase 1 of the backend refactor). See server/lib/http.ts.
import { isLoopback, makeSend, readJsonBody } from './lib/http'
// ponytail: shared domain types (Phase 2C). WD used by workdirs handlers + index.
import type { WD } from './lib/types'
// ponytail: route table + dispatcher (Phase 2A of the backend refactor).
// See server/routes.ts. Empty table for now; the dispatcher is a no-op
// until routes are added in Phase 2B+ (per-domain files).
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
// ponytail: fast-forward-only merge dev->main (sem checkout -> nao choca com data/ sujo)
async function resolveMainTip(repo: string): Promise<string | null> {
  const lo = await runGit(['rev-parse', '--verify', '--quiet', 'refs/heads/main'], repo)
  if (lo.ok) return lo.out
  const lo2 = await runGit(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'], repo)
  return lo2.ok ? lo2.out : null
}

async function mergeDevToMain(repo: string) {
  if (process.env.ATLAS_TEST_MERGE_OK) return { ok: true, out: 'test-shim' }
  // ponytail: local main pode NAO existir no clone (só nasce no update-ref do 1º approve) ->
  // resolver o tip real (local || remote); sem tip, main nunca existiu -> ff trivial, deixar mergear.
  const tip = await resolveMainTip(repo)
  if (tip) {
    const anc = await runGit(['merge-base', '--is-ancestor', tip, 'dev'], repo)
    if (!anc.ok) return { ok: false, out: 'main e dev divergentes — merge manual necessario (dev deveria estar a frente de main)' }
  }
  const devSha = await runGit(['rev-parse', 'dev'], repo)
  if (!devSha.ok) return { ok: false, out: 'falha a obter dev' }
  const upd = await runGit(['update-ref', 'refs/heads/main', devSha.out], repo)
  if (!upd.ok) return { ok: false, out: 'falha a mover main para dev' }
  const push = await runGit(['push', 'origin', 'main'], repo)
  return { ok: true, out: 'main = dev (fast-forward); push ' + (push.ok ? 'ok' : ('falhou: ' + push.out)) }
}

// ---- CI gate no approve review (DR rn9w9tsw) ----
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
async function runCIGate(repo: string): Promise<{ ok: boolean; step: string; out: string }> {
  if (process.env.ATLAS_TEST_CI_OK) return { ok: true, step: 'ok', out: '' }
  if (await checkConflictMarkers(repo)) return { ok: false, step: 'conflict-markers', out: 'marcadores de conflito presentes em dev' }
  // ponytail: invoca tsc/vite directamente via node_modules/.bin (ctrlPath de runCmd ja' expoe essa dir).
  // npm.cmd nao e' confiavel ??? vive ao lado de node.exe que pode estar via nvm/launcher, fora do PATH que
  // construimos. Os binarios do .bin sao deps reais, instaladas pelo npm install, e resolvem em qualquer maquina.
  const tc = await runCmd('tsc.cmd', ['--noEmit'], repo)
  if (!tc.ok) return { ok: false, step: 'typecheck', out: tc.out.slice(-2000) }
  const bd = await runCmd('vite.cmd', ['build'], repo)
  if (!bd.ok) return { ok: false, step: 'build', out: bd.out.slice(-2000) }
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

// ---- limpeza periodica de runs/worktrees orfas (card zp46swqm) ----
const RUN_KEEP_MS = 7 * 24 * 60 * 60 * 1000  // runs antigos: apagar .log/.status com >7 dias
// cleanupRuns: apaga .log/.status antigos em data/.wt/runs/<slug>. O guard e a idade (mtime):
// um run em andamento tem log/status com mtime recente -> nunca e apagado. Sem slug -> todos os slugs.
async function cleanupRuns(slug?: string): Promise<void> {
  let slugs: string[]
  try { slugs = slug ? [slug] : (await readIdx()).map(w => w.slug) } catch { return }
  if (!slugs.length) return
  const now = Date.now()
  for (const s of slugs) {
    const base = join(wtRoot(await repoDir(s)), 'runs', s)
    if (!existsSync(base)) continue
    let files: string[]
    try { files = readdirSync(base); if (!files.length) { await rm(base, { recursive: true, force: true }).catch(() => {}); continue } }
    catch { continue }
    for (const f of files) {
      if (!/\.(log|status)$/i.test(f)) continue
      const fp = join(base, f)
      try {
        if (now - statSync(fp).mtimeMs > RUN_KEEP_MS) { await rm(fp, { force: true }).catch(() => {}); continue }
        // ponytail: stuck .status (state=running sem o wrapper fechar) — apaga apos 6h. O log
        // companheiro (se existir) preserva o output para inspecao. Patch wrapper (card
        // fix/dp-promotion) ja' fecha a pane via kill-pane, mas runs antigos ficam orfaos.
        if (/\.status$/i.test(f) && now - statSync(fp).mtimeMs > 6 * 60 * 60 * 1000) {
          const st = await readJ(fp).catch(() => null)
          if (st?.state === 'running') await rm(fp, { force: true }).catch(() => {})
        }
      } catch { /* ja foi apagado */ }
    }
  }
}
// cleanupWorktrees: desregistar/remover worktrees orfas cujo trabalho JA esta em dev. Duplo guard:
// (1) branch merged em dev (`--is-ancestor <branch> dev` rc0) -> trabalho nao se perde; (2) o run
// correspondente NAO esta 'running' -> um card ATIVO (branch recém-criada == dev, por isso "merged") fica vivo.
async function cleanupWorktrees(): Promise<void> {
  let worlds: WD[]
  try { worlds = await readIdx() } catch { return }
  for (const wd of worlds) {
    const slug = wd.slug
    const repo = await repoDir(slug)
    await runGit(['worktree', 'prune'], repo)
    const slugDir = join(wtRoot(repo), slug)
    if (!existsSync(slugDir)) continue
    let ids: string[]
    try { ids = readdirSync(slugDir) } catch { continue }
    for (const id of ids) {
      const wtDir = join(slugDir, id)
      const branch = 'feature/' + slug + '-' + id
      const anc = await runGit(['merge-base', '--is-ancestor', branch, 'dev'], repo)
      if (!anc.ok) continue  // trabalho nao-merged nesta branch -> NAO apagar
      const st = await readJ(join(wtRoot(repo), 'runs', slug, id + '.status')).catch(() => null)
      if (st?.state === 'running') continue  // card ativo -> preservar worktree e branch
      await rmJunction(join(wtDir, 'node_modules'))
      await runGit(['worktree', 'remove', '--force', wtDir], repo)  // desregistar (ignora 'not a working tree')
      await rm(wtDir, { recursive: true, force: true }).catch(() => {})
    }
    let rest: string[]
    try { rest = readdirSync(slugDir); if (!rest.length) await rm(slugDir, { recursive: true, force: true }).catch(() => {}) } catch {}
  }
}

// ponytail: kill-on-transition + master kill (card terminal-control). .status file = fonte de verdade:
// cada card em doing grava {state, pane, ts} em data/.wt/runs/<slug>/<cardId>.status. pane vem da
// env WEZTERM_PANE injetada pelo WezTerm na pane filha. Sem pane (= legacy headless ou spawn pre-feature)
// os helpers sao no-op silenciosos, igual ao kill-pane do CLI em pane inexistente.
function killPane(pane: number | undefined): void {
  if (typeof pane !== 'number' || pane < 0) return
  // CLI vive na mesma pasta do GUI (wezterm-gui.exe -> wezterm.exe). Path-rewrite evita cfg extra.
  const cli = cfg.wezterm.replace(/wezterm-gui\.exe$/i, 'wezterm.exe')
  try { spawn(cli, ['cli', 'kill-pane', '--pane-id', String(pane)], { detached: true, stdio: 'ignore', windowsHide: true }).unref() } catch { /* pane ja morta = OK */ }
}

async function killPaneForCard(slug: string, cardId: string): Promise<void> {
  if (process.env.ATLAS_TEST_NO_SPAWN) return
  // ponytail: card terminal-control-v2 — kill sempre reseta doing->todo se o worker nao promoveu
  // (master kill / pane morta a mao). O transition-detector do PUT kanban ja' e' idempotente
  // (mata pane duas vezes = noop), por isso o PUT fire-and-forget aqui e' seguro.
  // fallback gracioso: sem wezterm-gui.exe, .status nao tem pane, ou dir inexistente = noop.
  try {
    const repo = await repoDir(slug)
    const stPath = join(wtRoot(repo), 'runs', slug, cardId + '.status')
    const st = await readJ(stPath).catch(() => null)
    if (st && typeof st.pane === 'number') killPane(st.pane)
    const file = join(DATA, slug, 'kanban.json')
    const board = await readJ(file).catch(() => null)
    const c = board?.cards?.find((x: any) => x.id === cardId)
    if (c && !c.archived && c.colId === 'doing') {
      c.colId = 'todo'
      delete c.startedAt
      await writeJ(file, board).catch(() => {})
    }
  } catch { /* best-effort */ }
}

async function killAllPanesForSlug(slug: string): Promise<{ killed: number; checked: number }> {
  let killed = 0, checked = 0
  try {
    const repo = await repoDir(slug)
    const runsDir = join(wtRoot(repo), 'runs', slug)
    if (!existsSync(runsDir)) return { killed, checked }
    for (const f of readdirSync(runsDir).filter(x => x.endsWith('.status'))) {
      checked++
      const st = await readJ(join(runsDir, f)).catch(() => null)
      if (st && st.state === 'running' && typeof st.pane === 'number') {
        killPane(st.pane)
        void killPaneForCard(slug, f.replace(/\.status$/, ''))  // ponytail: reset doing->todo (sibling de killAllPanesAtlas)
        killed++
      }
    }
  } catch { /* dir nao existe = 0 panes */ }
  return { killed, checked }
}

// ponytail: card terminal-control-v2 — cross-workdir. Itera index.json (lista de mundos) e
// para cada slug mata panes running do seu runs/. Reusa killPaneForCard (que faz reset doing->todo).
async function killAllPanesAtlas(): Promise<{ killed: number; checked: number; worlds: number }> {
  let killed = 0, checked = 0, worlds = 0
  const idx = await readJ(join(DATA, INDEX)).catch(() => null)
  if (!Array.isArray(idx)) return { killed, checked, worlds }
  for (const w of idx) {
    if (!w || !w.slug) continue
    const repo = await repoDir(w.slug).catch(() => null)
    if (!repo) continue
    worlds++
    const runsDir = join(wtRoot(repo), 'runs', w.slug)
    if (!existsSync(runsDir)) continue
    for (const f of readdirSync(runsDir).filter(x => x.endsWith('.status'))) {
      checked++
      const st = await readJ(join(runsDir, f)).catch(() => null)
      if (st && st.state === 'running' && typeof st.pane === 'number') {
        killPane(st.pane)
        void killPaneForCard(w.slug, f.replace(/\.status$/, ''))
        killed++
      }
    }
  }
  return { killed, checked, worlds }
}

async function launchHermes(slug: string, card: any) {
  if (process.env.ATLAS_TEST_NO_SPAWN) return
  const repo = await repoDir(slug)
  const branch = `feature/${slug}-${card.id}`
  const wt = join(wtRoot(repo), slug, card.id)
  // ponytail: base branch do repo do MUNDO (repos nao-atlas usam master/main, nao 'dev').
  // Prefere dev quando existe (fluxo atlas), senao a branch ativa do repo (garagem->master).
  const devOk = await runGit(['rev-parse', '--verify', 'dev'], repo)
  let baseBranch = devOk.ok ? 'dev' : 'main'
  if (!devOk.ok) { const hb = await runGit(['symbolic-ref', '--short', 'HEAD'], repo); baseBranch = hb.ok ? hb.out.trim() : 'main' }
  // ponytail: log de progresso por card (canal de 'ver o hermes a trabalhar' e de debug/erros) — o
  // ficheiro vive cedo o suficiente p/ ser referido no prompt (runs antigos isolados c/ flags 'w').
  const runsDir = join(wtRoot(repo), 'runs', slug)
  mkdirSync(runsDir, { recursive: true })
  const logPath = join(runsDir, card.id + '.log')
  // ponytail: no canvas de feedback quando NAO abre janela, o unico canal e o card -> grava ERRO em result
  const fail = async (msg: string) => {
    console.error(`[run:${slug}:${card.id}] ${msg}`)
    const ff = join(DATA, slug, 'kanban.json')
    const board = await readJ(ff)
    const c = board?.cards?.find((x: any) => x.id === card.id)
    if (c) { c.result = 'ERRO: ' + msg + ' — clica Correr para tentar de novo.'; await writeJ(ff, board) }
  }
  // ponytail: worktree isolado por card -> varios cards rodam em paralelo sem colidir no mesmo checkout.
  // limpa junction/node_modules ANTES do rm recursivo (senao rm segue o junction e apaga o node_modules base).
  await runGit(['worktree', 'prune'], repo)
  await rmJunction(join(wt, 'node_modules'))
  await killWtLockers(wt)  // pane de run anterior tbm segura o wt -> EBUSY no rm abaixo
  // ponytail: re-tentar remove+rm p/ vencer EBUSY do Windows. O taskkill e assincrono e a pane
  // do run anterior pode ainda segurar handles; o antigo `try{rm}` era catch-&-silent -> dir + registo
  // orfaos sobreviviam e o `worktree add` a seguir rebentava em 'already exists'. Aqui removemos com retry
  // e fazemos `prune` DEPOIS do dir sumir (prune so limpa registos cujo dir ja nao existe).
  for (let attempt = 0; attempt < 3; attempt++) {
    await runGit(['worktree', 'prune'], repo)
    await runGit(['worktree', 'remove', '--force', wt], repo)  // desregistar a worktree orfa (git-native)
    try { await rm(wt, { recursive: true, force: true }); break }  // limpa residuo do dir, se sobrar
    catch { await new Promise(r => setTimeout(r, 500)) }  // lock da pane ainda nao solto -> retry
  }
  await runGit(['worktree', 'prune'], repo)  // limpa qualquer registo orfao residuo antes de recriar
  const addOut = await runGit(['worktree', 'add', '-B', branch, wt, baseBranch], repo)
  if (!addOut.ok) { await fail('git worktree add falhou: ' + addOut.out); return }
  const linked = await addJunction(join(wt, 'node_modules'), join(repo, 'node_modules'))
  if (!linked) { await fail('nao consegui ligar node_modules partilhado (mklink)'); return }
  const cardDp = card.dp
    ? 'DP (Design Plan) ja gerado p/ este card — LE-O ANTES de implementar e segue-o:\n\n' + card.dp + '\n'
    : 'SEM DP — escreve um breve plano (objetivo, abordagem, ficheiros afetados) antes de implementar.'
  const prompt = interpolate(await loadPrompt('run-card'), {
    slug,
    kanbanPath: join(DATA, slug, 'kanban.json'),
    apiUrl: `http://localhost:${cfg.port}/api/w/${slug}/kanban`,
    wt,
    branch,
    cardTitle: card.title,
    cardDescription: card.description || '(sem descricao)',
    cardDp,
    logPath,
  })
  // ponytail: terminal em modo headless — NAO abre janela WezTerm. O wrapper python corre direto
  // como processo de fundo (detached, windowsHide) e a saida (stdout+stderr) e capturada para um log
  // por card. "Ver o terminal" na UI faz stream desse log (offset-based) — debugging/erros incluidos.
  // Em sucesso (rc==0): merge branch->dev + push dev (a partir do repo base, sem conflito de checkout),
  // remove a junction node_modules (rmdir NAO segue), remove a worktree e a branch -> auto-cleanup do card.
  // Em falha: log fica gravado em disco p/ o BMS ver; worktree mantida p/ resolver.
  const wrapper = [
    'import subprocess,sys,os,shutil,json,time',
    // ponytail: python -c faz sys.argv[0]='-c' (nao python path), argv[1]=stPath..argv[6]=baseBranch. Spawn: ['-c', wrapperWithPane, stPath, wt, branch, repo, prompt, baseBranch]
    "st=sys.argv[1]; wt=sys.argv[2]; branch=sys.argv[3]; repo=sys.argv[4]; prompt=sys.argv[5]; bb=sys.argv[6]",
    '# ponytail: card grill-me-palette — ATLAS_CARD_SKILLS="grill-me,grilling" injectado pelo spawn -> passa --skills ao hermes_cli.main',
    "_sk=os.environ.get('ATLAS_CARD_SKILLS','')",
    "_sa=[('--skills',s) for s in (x.strip() for x in _sk.split(',')) if s]",
    '# ponytail: card h1y3yfsy \xe2\x80\x94 heartbeat daemon (30s) grava lastHeartbeatAt no .status para distinguir wrapper nunca arrancou de hermes travou. Thread daemon morre com o processo (sys.exit). Custo zero. Units: ms (consistente com Date.now() no resto do codebase).',
    "import threading as _th, time as _t",
    "def _hb():",
    "\x20\x20\x20\x20while True:",
    "\x20\x20\x20\x20\x20\x20\x20try: open(st,'w',encoding='utf-8').write(json.dumps({'state':'running','pane':(os.environ.get('WEZTERM_PANE') or None),'lastHeartbeatAt':int(_t.time()*1000),'ts':int(_t.time()*1000)}))",
    "\x20\x20\x20\x20\x20\x20\x20except: pass",
    "\x20\x20\x20\x20\x20\x20\x20_t.sleep(30)",
    "_th.Thread(target=_hb,daemon=True).start()",
    'rc=subprocess.call([sys.executable,"-m","hermes_cli.main","-z",prompt]+[a for p in _sa for a in p])',
    'if rc==0:',
    '\x20\x20\x20\x20try:',
    '\x20\x20\x20\x20\x20\x20\x20\x20os.chdir(repo)',
    // ponytail: merge SEMPRE em dev — nunca na branch atual do base. Se o repo estiver em main o 'git merge' iria p/ main sem approve.
    '\x20\x20\x20\x20\x20\x20\x20\x20co=subprocess.run([r"GITBIN","checkout",bb],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20if co.returncode!=0:',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20print("NAO consigo ir para o branch base - aborta merge p/ nao tocar em main. Worktree mantida.")',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20sys.exit(0)',
    '\x20\x20\x20\x20\x20\x20\x20\x20subprocess.run([r"GITBIN","fetch","origin",bb],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20co2=subprocess.run([r"GITBIN","merge","origin/"+bb,"--no-edit"],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20mg=subprocess.run([r"GITBIN","merge",branch,"--no-edit"],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20if mg.returncode==0:',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20ps=subprocess.run([r"GITBIN","push","origin",bb],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20if ps.returncode!=0:',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20subprocess.run([r"GITBIN","fetch","origin",bb],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20subprocess.run([r"GITBIN","merge","origin/"+bb,"--no-edit"],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20subprocess.run([r"GITBIN","merge",branch,"--no-edit"],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20ps=subprocess.run([r"GITBIN","push","origin",bb],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20if ps.returncode==0:',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20nj=os.path.join(wt,"node_modules")',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20try: os.rmdir(nj)',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20except OSError: shutil.rmtree(nj,ignore_errors=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20subprocess.run([r"GITBIN","worktree","remove","--force",wt],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20subprocess.run([r"GITBIN","branch","-D",branch],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20else:',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20try: open(st,"w",encoding="utf-8").write(json.dumps({"state":"merge-failed","branch":branch,"log":(mg.stderr or b"").decode("utf-8","replace"),"ts":time.time()}))',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20except: pass',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20print("MERGE dev<-"+branch+" FALHOU apos retry (conflito real?) - worktree mantido, verifica.")',
    '    except Exception as e:',
    '\x20\x20\x20\x20\x20\x20\x20\x20print("AUTO-CLEANUP FALHOU: %r - push/merge incompleto. Worktree e branch mantidas p/ inspecao." % (e,))',
    // ponytail: kill-pane o wrapper para o wezterm-gui sair -> p.on('close) do Node corre ->
    // promotion doing->review + .status=done. Sem isto a pane fica aberta e o card preso em doing.
    'try:',
    '\x20\x20\x20\x20import os',
    '\x20\x20\x20\x20p=os.environ.get("WEZTERM_PANE")',
    '\x20\x20\x20\x20if p and p!="-1": os.system("wezterm cli kill-pane --pane-id "+p+" 2>nul")',
    'except: pass',
    'sys.exit(rc)',
  ].join('\n').replaceAll('GITBIN', GIT)
  const stPath = join(runsDir, card.id + '.status')
  const ws = createWriteStream(logPath, { flags: 'w' })
  writeFile(stPath, JSON.stringify({ state: 'running', ts: Date.now() }), 'utf8').catch(() => {})
  // ponytail: card terminal-control — spawn via `wezterm start --` para abrir pane visivel
  // (assim o user ve o hermes a trabalhar). A env WEZTERM_PANE e' injetada pelo WezTerm na pane
  // filha; o wrapper python grava-a no .status (stPath = argv[1]) antes de chamar o hermes, para
  // o kill-on-transition saber qual pane fechar. Fallback headless: se cfg.wezterm nao existir
  // (sem WezTerm instalado) spawna o python direto, p.on('error') cai no fail() antigo.
  // argv do wrapper: [stPath, wt, branch, repo, prompt, baseBranch] (igual ao wrapper antigo +
  // stPath como 1o argv). Wrapper prepende 2 linhas (captura pane + re-escreve .status) sem
  // tocar no resto (auto-merge/cleanup identico ao commit de12033).
  const wrapperWithPane = [
    'import os,json,time,sys',
    'st=sys.argv[1]',
    'try:',
    '\x20\x20\x20\x20pane=int(os.environ.get("WEZTERM_PANE","-1"))',
    '\x20\x20\x20\x20open(st,"w",encoding="utf-8").write(json.dumps({"state":"running","pane":pane,"ts":time.time()}))',
    'except: pass',
    wrapper,
  ].join('\n')
  const headless = !cfg.wezterm || !existsSync(cfg.wezterm)
  const exe: string = headless ? VENV_PY : cfg.wezterm
  const args: string[] = headless
    ? ['-c', wrapperWithPane, stPath, wt, branch, repo, prompt, baseBranch]
    : ['start', '--', VENV_PY, '-c', wrapperWithPane, stPath, wt, branch, repo, prompt, baseBranch]
  // ponytail: card grill-me-palette — propaga card.skills ao wrapper Python via env (sem mudar argv indices)',
  const _skillsEnv = Array.isArray(card.skills) ? card.skills.filter((s:any)=>typeof s==='string'&&s.trim()).map((s:string)=>s.trim()).join(',') : ''
  const p = spawn(exe, args, { cwd: repo, detached: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HERMES_HOME, ...(_skillsEnv ? { ATLAS_CARD_SKILLS: _skillsEnv } : {}) } })
  // ponytail: termwiz drop C1 (sanitize em readJ)
  p.stdout?.on('data', d => ws.write(sanitize(d)))
  p.stderr?.on('data', d => ws.write(sanitize(d)))
  p.on('error', e => { ws.end(); void fail((headless ? 'spawn headless' : 'spawn wezterm') + ' falhou: ' + e.message) })
  p.on('close', async (code) => {
    ws.end()
      // ponytail: BUG 3e — se o wrapper sinalizou merge-failed no .status, NAO promover doing->review (worktree mantida para inspecao)
      const stRun = await readJ(stPath).catch(() => null)
      const mergeFailed = stRun?.state === 'merge-failed'
    await writeFile(stPath, JSON.stringify({ state: 'done', code, ts: Date.now() }), 'utf8').catch(() => {})
    const ff = join(DATA, slug, 'kanban.json')
    // ponytail: em falha deixa um marcador ERRO no card p/ a UI saber que terminou com erro (debug facil)
    if (code !== 0) {
      const board = await readJ(ff).catch(() => null)
      const c = board?.cards?.find((x: any) => x.id === card.id)
      if (c && !c.result) { c.result = 'ERRO: processo terminou com código ' + code + ' — abre o terminal/card para ver o log.'; await writeJ(ff, board).catch(() => {}) }
    }
    // ponytail: promove doing->review quando o run terminou OK e deixou result (worker's last report);
    // idempotente — se o user ja mexeu no card (review/done) o guard salta. code!=0 ou sem result ficam em doing
    // p/ o user ler o log e decidir refazer/refinar. writeJ e fire-and-forget (race com PUT do front: 409
    // no PUT apanha a inconsistencia; em ultimo caso o pollTimer/watchReviewTransitions resolvem).
    const board2 = await readJ(ff).catch(() => null)
    const c2 = board2?.cards?.find((x: any) => x.id === card.id)
      if (mergeFailed && c2 && !c2.result) {
      c2.result = 'MERGE FALHOU apos retry (conflito real ou divergencia). Abre o log do card para inspecao — worktree mantida.'
      await writeJ(ff, board2).catch(() => {})
      }
    if (c2 && !c2.archived && c2.colId === 'doing' && code === 0 && !mergeFailed && c2.result) {
      void killPaneForCard(slug, card.id)  // card terminal-control: fecha pane do run antes de promover
      c2.colId = 'review'
      await writeJ(ff, board2).catch(() => {})
    }
  })
  p.unref()
}
async function launchBrainstorm(slug: string) {
  if (process.env.ATLAS_TEST_NO_SPAWN) return
  // ponytail: brainstorm/SWOT nao toca em codigo nem kanban -> sem worktree/merge. So corre
  // o hermes headless com um prompt de analise e ele ESCREVE notas novas no workdir. Log/status
  // partilhados com o mecanismo /output do run-card (id ficticio "brainstorm").
  const repo = await repoDir(slug)
  const runsDir = join(wtRoot(repo), 'runs', slug)
  mkdirSync(runsDir, { recursive: true })
  const logPath = join(runsDir, 'brainstorm.log')
  const stPath = join(runsDir, 'brainstorm.status')
  const meta = (await readJ(join(DATA, slug, 'meta.json')) || { name: slug, description: '' })
  const metaDesc = (meta.description || 'sem descricao').replace(/\n/g, ' ').slice(0, 120)
  const prompt = interpolate(await loadPrompt('brainstorm'), {
    slug,
    metaName: meta.name,
    metaDesc,
    apiUrl: `http://localhost:${cfg.port}/api/w/${slug}/notes`,
    repo,
    logPath,
  })
  const ws = createWriteStream(logPath, { flags: 'w' })
  writeFile(stPath, JSON.stringify({ state: 'running', ts: Date.now() }), 'utf8').catch(() => {})
  // ponytail: wrapper minimo (sem git) — hermes oneshot grava notas via API, sai com rc do processo
  const wrapper = [
    'import subprocess,sys',
    '# ponytail: sem cwd embutido (herda o cwd do spawn=ATLAS_REPO) -> evita SyntaxError \\U no literal Python em Windows',
    'rc=subprocess.call([sys.executable,"-m","hermes_cli.main","-z",sys.argv[1]])',
    'sys.exit(rc)',
  ].join('\n')
  const p = spawn(VENV_PY, ['-c', wrapper, prompt],
    { cwd: repo, detached: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HERMES_HOME } })
  // ponytail: termwiz drop C1 (sanitize em readJ)
  p.stdout?.on('data', (d: Buffer) => ws.write(sanitize(d)))
  p.stderr?.on('data', (d: Buffer) => ws.write(sanitize(d)))
  p.on('error', () => { ws.end(); writeFile(stPath, JSON.stringify({ state: 'done', code: 1, ts: Date.now() }), 'utf8').catch(() => {}) })
  p.on('close', (code: number) => { ws.end(); writeFile(stPath, JSON.stringify({ state: 'done', code, ts: Date.now() }), 'utf8').catch(() => {}) })
  p.unref()
}
// launchDp: gera um DP (design plan) para um card SEM tocar em codigo nem worktree.
// ponytail: espelha o launchBrainstorm — uma sessao hermes headless recebe title+desc do card,
// escreve um DP em markdown e GRAVA-O no proprio card via API (card.dp). Log/status partilhados
// com o mecanismo /output do run-card (id ficticio "dp-"+cardId) p/ a UI streamear o terminal.
async function launchDp(slug: string, card: any) {
  if (process.env.ATLAS_TEST_NO_SPAWN) return
  const repo = await repoDir(slug)
  const runsDir = join(wtRoot(repo), 'runs', slug)
  mkdirSync(runsDir, { recursive: true })
  const rid = 'dp-' + card.id
  const logPath = join(runsDir, rid + '.log')
  const stPath = join(runsDir, rid + '.status')
  const fail = async (msg: string) => {
    console.error(`[dp:${slug}:${card.id}] ${msg}`)
    const ff = join(DATA, slug, 'kanban.json')
    const board = await readJ(ff)
    const c = board?.cards?.find((x: any) => x.id === card.id)
    if (c) { c.dp = 'ERRO: ' + msg; await writeJ(ff, board) }
  }
  const prompt = interpolate(await loadPrompt('dp'), {
    slug,
    kanbanPath: join(DATA, slug, 'kanban.json'),
    apiUrl: `http://localhost:${cfg.port}/api/w/${slug}/kanban`,
    repo,
    cardId: card.id,
    cardTitle: card.title,
    cardDescription: card.description || '(sem descricao)',
    logPath,
  })
  const ws = createWriteStream(logPath, { flags: 'w' })
  writeFile(stPath, JSON.stringify({ state: 'running', ts: Date.now() }), 'utf8').catch(() => {})
  const wrapper = [
    'import subprocess,sys',
    'rc=subprocess.call([sys.executable,"-m","hermes_cli.main","-z",sys.argv[1]])',
    'sys.exit(rc)',
  ].join('\n')
  const p = spawn(VENV_PY, ['-c', wrapper, prompt],
    { cwd: repo, detached: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HERMES_HOME } })
  // ponytail: termwiz drop C1 (sanitize em readJ)
  p.stdout?.on('data', (d: Buffer) => ws.write(sanitize(d)))
  p.stderr?.on('data', (d: Buffer) => ws.write(sanitize(d)))
  p.on('error', () => { ws.end(); writeFile(stPath, JSON.stringify({ state: 'done', code: 1, ts: Date.now() }), 'utf8').catch(() => {}); void fail('spawn DP falhou') })
  p.on('close', async (code: number) => {
    ws.end()
    await writeFile(stPath, JSON.stringify({ state: 'done', code, ts: Date.now() }), 'utf8').catch(() => {})
    // ponytail: DP termina com code=0 e grava card.dp -> promove para review. O DP arranca com o card
    // em todo (handler /dp nao move) ou em doing (ciclo de orquestracao ja' moveu); promover se nao
    // esta' arquivado nem em done. Idempotente: se o user ja moveu para review/done, salta.
    const ff = join(DATA, slug, 'kanban.json')
    const board = await readJ(ff).catch(() => null)
    const c = board?.cards?.find((x: any) => x.id === card.id)
    if (c && !c.archived && c.colId !== 'done' && code === 0 && c.dp) {
      c.colId = 'review'
      await writeJ(ff, board).catch(() => {})
    }
  })
  p.unref()
}
// launchGitOp: operacoes git de TOPO de repo (merge dev->main, resolver conflito) via hermes
// headless — mesmo padrao do launchDp (sessao oneshot hermes_cli.main -z, cwd=ATLAS_REPO, detached,
// log/status por id ficticio `op` p/ a UI streamear via /api/w/:slug/output/<op>). NAO usa worktree
// nem meu no kanban: so corre git na repo base. O prompt forcA o ramo alvo explicitamente (a wrapper
// launchHermes mergea na branch atual do base — aqui o agente corre git checkout dev/main por conta propria).
// spawnHeadless: spawn hermes headless detached com prompt pre-renderizado, log + status partilhados.
// Usado por launchGitOp (prompt 'git-op') e pelo handler /review/approve-agent (prompt 'merge-approve').
async function spawnHeadless(repo: string, logPath: string, stPath: string, banner: string, prompt: string) {
  if (process.env.ATLAS_TEST_NO_SPAWN) return
  await writeFile(logPath, '◆ ' + banner + '\n', 'utf8')
  const ws = createWriteStream(logPath, { flags: 'a' })
  writeFile(stPath, JSON.stringify({ state: 'running', ts: Date.now() }), 'utf8').catch(() => {})
  const wrapper = [
    'import subprocess,sys',
    'rc=subprocess.call([sys.executable,"-m","hermes_cli.main","-z",sys.argv[1]])',
    'sys.exit(rc)',
  ].join('\n')
  const p = spawn(VENV_PY, ['-c', wrapper, prompt],
    { cwd: repo, detached: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HERMES_HOME } })
  // ponytail: termwiz drop C1 (sanitize em readJ)
  p.stdout?.on('data', (d: Buffer) => ws.write(sanitize(d)))
  p.stderr?.on('data', (d: Buffer) => ws.write(sanitize(d)))
  p.on('error', () => { ws.end(); writeFile(stPath, JSON.stringify({ state: 'done', code: 1, ts: Date.now() }), 'utf8').catch(() => {}) })
  p.on('close', (code: number) => { ws.end(); writeFile(stPath, JSON.stringify({ state: 'done', code, ts: Date.now() }), 'utf8').catch(() => {}) })
  p.unref()
}

async function launchGitOp(slug: string, op: string, title: string, task: string) {
  const repo = await repoDir(slug)  // repo do mundo (nao so ATLAS_REPO) — top de repo corre no codigo desse mundo
  const runsDir = join(wtRoot(repo), 'runs', slug)
  mkdirSync(runsDir, { recursive: true })
  const logPath = join(runsDir, op + '.log')
  const stPath = join(runsDir, op + '.status')
  const prompt = interpolate(await loadPrompt('git-op'), { slug, repo, task, title, logPath })
  // banner imediato no log -> o term-view mostra feedback logo no 1o poll (hermes headless leva
  // ~min a produzir a 1a linha; sem isto o terminal fica mudo e parece que o botao nao funciona).
  void spawnHeadless(repo, logPath, stPath, title + ' — gestor git headless a arrancar…', prompt)
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
      if (m === 'PUT' && /^\/api\/w\/[^/]+\/(notes|kanban|bundle)$/.test(p)) {
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

      // /api/orchestrator/start[/<slug>] -> passa TODO(s) nao arquivados (de um mundo, se slug) para doing
      // ponytail: so move colIds (nao dispara runs headless nem toca review/done/archived)

      // /api/w/:slug/{notes,kanban,meta}
      // /api/w/:slug/review/approve-agent -> gate sync + spawna hermes headless (prompt 'merge-approve').
      // Decisao R3.Q2: git-op.md fica magro (merge ad-hoc, resolve conflict); este endpoint e' especializado
      // para o approve do workflow Review — alem de git ff + push, atualiza o card no kanban via API e
// ponytail: route table (Phase 2A). Empty for now; becomes the
      // primary dispatcher in Phase 2B+ as handlers move out of api.ts.
      // ponytail: deps bag — every module-level helper a route might need.
      // Keep it lean: only what routes actually use, not speculative exports.
      if (await dispatch({ req, res, send, parts, m, deps: {
        SLUG, DATA, INDEX, cfg, readIdx, readJ, writeJ, syncVault, repoDir, wtRoot,
        killPane, killPaneForCard, killAllPanesForSlug, killAllPanesAtlas,
        launchHermes, launchBrainstorm, launchDp, launchGitOp, spawnHeadless,
        pickIcon, toSlug, runGit, runCmd, runCIGate, checkConflictMarkers,
        resolveMainTip, mergeDevToMain, tickAll, tickSnapshot, listSnapshots,
        getSnapshotFile, restoreSnapshot, writeWipeGuardSnapshot, slotFor,
        parseRoadmap, loadPrompt, interpolate, readJsonBody, createHash, readFile,
        _sanitizeText, inside, nid, rmJunction, HERMES_HOME,
      } })) return
            send(404, { error:'not found' })
    } catch (e:any) { send(500, { error: e.message }) }
  }
  return {
    name: 'atlas-api',
    configureServer(s) {
      s.middlewares.use(middleware)
      void cleanupRuns().catch(() => {})      // fire-and-forget no boot: limpa runs antigos
      void cleanupWorktrees().catch(() => {}) // e worktrees orfas (ponto unico, nao bloqueia o arranque)
    },
    configurePreviewServer(s) { s.middlewares.use(middleware) },
  }
}
