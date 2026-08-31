import type { Plugin, Connect } from 'vite'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { join, dirname, delimiter, normalize, extname, relative, resolve, sep } from 'node:path'
import { parseRoadmap } from './roadmap'
import { cfg } from './config'

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
  if (await checkConflictMarkers(repo)) return { ok: false, step: 'conflict-markers', out: 'marcadores de conflito presentes em dev' }
  const tc = await runCmd('npm.cmd', ['run', 'typecheck'], repo)
  if (!tc.ok) return { ok: false, step: 'typecheck', out: tc.out.slice(-2000) }
  const bd = await runCmd('npm.cmd', ['run', 'build'], repo)
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
  const prompt = [
    'Tu es um agente autonomo. Executa o trabalho abaixo do card de kanban e atualiza o estado.',
    `Workdir: ${slug}`,
    `Kanban JSON (em disco): ${join(DATA, slug, 'kanban.json')}`,
    `Kanban API (para updates): http://localhost:${cfg.port}/api/w/${slug}/kanban`,
    `Repo de codigo (source-tree): ${wt} — working-tree isolada deste card. Edita SO nela (ja esta na branch ${branch}).`,
    '',
    `CARTAO: ${card.title}`,
    '',
    'TAREFA:',
    card.description || '(sem descricao)',
    '',
    (card.dp
      ? ['DP (Design Plan) ja gerado p/ este card — LE-O ANTES de implementar e segue-o:', '', card.dp, ''].join('\n')
      : 'SEM DP — escreve um breve plano (objetivo, abordagem, ficheiros afetados) antes de implementar.'),
    '',
    'GIT WORKFLOW:',
    `  - Ja estas na branch ${branch} criada a partir de dev (worktree isolada). NAO mudes de branch, NAO corras git checkout/dev nem git pull.`,
    '  - Trabalha em ./ e a cada passo faz commit local.',
    `  - O merge ${branch} -> dev e o push dev sao feitos AUTOMATICAMENTE quando terminares (pelo runner). Nao o facas tu.`,
    '  - NUNCA cometes para main — main muda so no approve do Review.',
    '',
    'REGRAS:',
    '- node_modules e PARTILHADO (junction -> repo base). NAO corras npm install / npm ci.',
    '- So termina depois de tsc --noEmit sem erros e vite build ok (funciona sem install, deps partilhadas).',
    '- A inicios marca o teu card como "doing" (ja feito) e mantem-no ai.',
    '- Durante o progresso, atualiza o kanban.json/API para refletir o estado real.',
    '- NUNCA marques o teu card como "done"/concluido. So o BMS conclui apos validar na branch dev.',
    '- Apos concluires, coloca o teu card na coluna "review" (colId "review") no kanban.json — a task executada vai para review final.',
    '- No fim, ATUALIZA o teu card com um campo `result`: um resumo breve do que fizeste.',
    '',
    'PROGRESSO AO VIVO (OBRIGATORIO):',
    `  - O utilizador ve o teu trabalho AO VIVO num terminal. A cada passo significativo, anexa 1 linha curta de progresso ao ficheiro de log: ${logPath}`,
    '  - Formato da linha: [hh:mm] <descricao curta>  (ex.: [14:05] A ler server/api.ts  ·  [14:07] A editar viewTerminal  ·  [14:11] A correr tsc --noEmit).',
    '  - Faz append UTF-8 ao ficheiro com a tua tool terminal/execute_code (ex.: python -c "open(<logPath>, \'a\', encoding=\'utf-8\').write(...)").',
    '  - No fim anexa 1 linha com o resumo final. NAO e opcional: sem estas linhas o terminal fica mudo e o utilizador nao ve o teu progresso. E o teu canal de debug/erros visivel.',
  ].join('\n')
  // ponytail: terminal em modo headless — NAO abre janela WezTerm. O wrapper python corre direto
  // como processo de fundo (detached, windowsHide) e a saida (stdout+stderr) e capturada para um log
  // por card. "Ver o terminal" na UI faz stream desse log (offset-based) — debugging/erros incluidos.
  // Em sucesso (rc==0): merge branch->dev + push dev (a partir do repo base, sem conflito de checkout),
  // remove a junction node_modules (rmdir NAO segue), remove a worktree e a branch -> auto-cleanup do card.
  // Em falha: log fica gravado em disco p/ o BMS ver; worktree mantida p/ resolver.
  const wrapper = [
    'import subprocess,sys,os,shutil',
    // ponytail: python -c faz sys.argv[0]='-c' (nao python path), argv[1]=stPath..argv[6]=baseBranch. Spawn: ['-c', wrapperWithPane, stPath, wt, branch, repo, prompt, baseBranch]
    "st=sys.argv[1]; wt=sys.argv[2]; branch=sys.argv[3]; repo=sys.argv[4]; prompt=sys.argv[5]; bb=sys.argv[6]",
    'rc=subprocess.call([sys.executable,"-m","hermes_cli.main","-z",prompt])',
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
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20subprocess.run([r"GITBIN","push","origin",bb],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20nj=os.path.join(wt,"node_modules")',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20try: os.rmdir(nj)',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20except OSError: shutil.rmtree(nj,ignore_errors=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20subprocess.run([r"GITBIN","worktree","remove","--force",wt],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20subprocess.run([r"GITBIN","branch","-D",branch],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20else:',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20print("MERGE dev<-"+branch+" FALHOU (conflito?) - worktree mantido, verifica.")',
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
  const p = spawn(exe, args, { cwd: repo, detached: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HERMES_HOME } })
  p.stdout?.on('data', d => ws.write(d))
  p.stderr?.on('data', d => ws.write(d))
  p.on('error', e => { ws.end(); void fail((headless ? 'spawn headless' : 'spawn wezterm') + ' falhou: ' + e.message) })
  p.on('close', async (code) => {
    ws.end()
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
    if (c2 && !c2.archived && c2.colId === 'doing' && code === 0 && c2.result) {
      void killPaneForCard(slug, card.id)  // card terminal-control: fecha pane do run antes de promover
      c2.colId = 'review'
      await writeJ(ff, board2).catch(() => {})
    }
  })
  p.unref()
}
async function launchBrainstorm(slug: string) {
  // ponytail: brainstorm/SWOT nao toca em codigo nem kanban -> sem worktree/merge. So corre
  // o hermes headless com um prompt de analise e ele ESCREVE notas novas no workdir. Log/status
  // partilhados com o mecanismo /output do run-card (id ficticio "brainstorm").
  const repo = await repoDir(slug)
  const runsDir = join(wtRoot(repo), 'runs', slug)
  mkdirSync(runsDir, { recursive: true })
  const logPath = join(runsDir, 'brainstorm.log')
  const stPath = join(runsDir, 'brainstorm.status')
  const meta = (await readJ(join(DATA, slug, 'meta.json')) || { name: slug, description: '' })
  const prompt = [
    'Tu es um agente autonomo. Faz um brainstorm e um SWOT ao projeto e cria notas com ideias para implementar.',
    `Workdir: ${slug} («${meta.name}» — ${(meta.description || 'sem descricao').replace(/\n/g, ' ').slice(0, 120)})`,
    `API notas (get/put): http://localhost:${cfg.port}/api/w/${slug}/notes`,
    `Source-tree do projeto a analisar: ${repo}`,
    '',
    'TAREFA:',
    '- Le o source-tree e o estado do workdir para perceberes o projeto.',
    '- Faz uma analise SWOT (forcas, fraquezas, oportunidades, ameacas).',
    '- Faz um brainstorm de coisas que podemos implementar (features, melhorias, correcoes).',
    '- Cria notas novas nesse workdir: uma nota por ideia + uma nota com o SWOT. Para gravar, faz GET da lista atual em /api/w/' + slug + '/notes (devolve {ver, items}), preserva o ver lido, faz append das novas em items (cada item NOVO DEVE incluir um `id` curto alfanumerico, ex. "a1b2c3d4" — reutiliza o `uid()` do cliente ou gera tu proprio; sem `id` o cliente nao consegue clicar nas notas) e faz PUT com o objeto completo enviando o mesmo ver. Se receberes 409 (conflito de versao), re-faz GET e re-aplica.',
    '',
    'REGRAS:',
    '- NAO apagues nem alteres notas existentes — so adiciona notas novas (append no array).',
    '- NAO facas git commits, NAO mexas no kanban, NAO marques nada como done.',
    '- No fim responde com um resumo curto do que criaste (quantas notas).',
    '',
    'PROGRESSO AO VIVO:',
    `  - Anexa 1 linha curta de progresso por passo ([hh:mm] <descricao>) ao ficheiro de log: ${logPath}`,
    '  - Faz append UTF-8. No fim, 1 linha de resumo.',
  ].join('\n')
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
  p.stdout?.on('data', (d: Buffer) => ws.write(d))
  p.stderr?.on('data', (d: Buffer) => ws.write(d))
  p.on('error', () => { ws.end(); writeFile(stPath, JSON.stringify({ state: 'done', code: 1, ts: Date.now() }), 'utf8').catch(() => {}) })
  p.on('close', (code: number) => { ws.end(); writeFile(stPath, JSON.stringify({ state: 'done', code, ts: Date.now() }), 'utf8').catch(() => {}) })
  p.unref()
}
// launchDp: gera um DP (design plan) para um card SEM tocar em codigo nem worktree.
// ponytail: espelha o launchBrainstorm — uma sessao hermes headless recebe title+desc do card,
// escreve um DP em markdown e GRAVA-O no proprio card via API (card.dp). Log/status partilhados
// com o mecanismo /output do run-card (id ficticio "dp-"+cardId) p/ a UI streamear o terminal.
async function launchDp(slug: string, card: any) {
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
  const prompt = [
    'Tu es um agente autonomo. Escreve um DP (Design Plan / Plano de Desenvolvimento) para o card de kanban abaixo.',
    `Workdir: ${slug}`,
    `Kanban JSON (em disco): ${join(DATA, slug, 'kanban.json')}`,
    `Kanban API (para gravar o DP): http://localhost:${cfg.port}/api/w/${slug}/kanban`,
    `Source-tree do projeto a analisar: ${repo}`,
    '',
    `CARTAO ID: ${card.id}`,
    `TITULO: ${card.title}`,
    'DESCRICAO:',
    card.description || '(sem descricao)',
    '',
    'TAREFA:',
    '- Le o source-tree e o estado atual para perceberes o pedido do card.',
    '- Escreve um DP em markdown: objetivo, contexto/estado atual, abordagem proposta (passos com ficheiros afetados), criterios de aceite e riscos/consideracoes.',
    '- Grava o DP no card: faz GET de /api/w/' + slug + '/kanban, encontra o card pelo id acima, define o campo `dp` com o markdown completo e faz PUT com o board inteiro.',
    '',
    'REGRAS:',
    '- NAO mudes colId, NAO apagues result/descricao/outros campos do card.',
    '- NAO facas git commits, NAO mexas no kanban exceto o campo dp deste card, NAO marques nada como done.',
    '- No fim responde com 1 linha a resumir o DP (o que se vai implementar).',
    '',
    'PROGRESSO AO VIVO:',
    `  - Anexa 1 linha curta de progresso por passo ([hh:mm] <descricao>) ao ficheiro de log: ${logPath}`,
    '  - Faz append UTF-8 (open(<logPath>, \'a\', encoding=\'utf-8\')). No fim, 1 linha de resumo.',
  ].join('\n')
  const ws = createWriteStream(logPath, { flags: 'w' })
  writeFile(stPath, JSON.stringify({ state: 'running', ts: Date.now() }), 'utf8').catch(() => {})
  const wrapper = [
    'import subprocess,sys',
    'rc=subprocess.call([sys.executable,"-m","hermes_cli.main","-z",sys.argv[1]])',
    'sys.exit(rc)',
  ].join('\n')
  const p = spawn(VENV_PY, ['-c', wrapper, prompt],
    { cwd: repo, detached: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HERMES_HOME } })
  p.stdout?.on('data', (d: Buffer) => ws.write(d))
  p.stderr?.on('data', (d: Buffer) => ws.write(d))
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
async function launchGitOp(slug: string, op: string, title: string, task: string) {
  const repo = await repoDir(slug)  // repo do mundo (nao so ATLAS_REPO) — top de repo corre no codigo desse mundo
  const runsDir = join(wtRoot(repo), 'runs', slug)
  mkdirSync(runsDir, { recursive: true })
  const logPath = join(runsDir, op + '.log')
  const stPath = join(runsDir, op + '.status')
  const prompt = [
    'Tu es um agente autonomo. Executa a operacao git de topo de repo abaixo usando o terminal headless do Hermes.',
    `Workdir: ${slug}`,
    `Source-tree (repo base, raiz do repositorio): ${repo}`,
    '',
    'TAREFA:',
    task,
    '',
    'REGRAS:',
    '- Roda na repo base (' + repo + ') — NAO em worktree, NAO toques em data/.wt. Forca o ramo alvo explicitamente (`git checkout dev`/`git checkout main`), nunca confies na branch atual.',
    '- NUNCA uses --force, `git reset`, rebase destrutivo nem forcas para main. Divergencia nao-resolvivel -> reporta e para.',
    '- NUNCA corras npm install / npm ci (node_modules e partilhado). So npm run typecheck / vite build com deps ja instaladas.',
    '- Ficheiros TS/CSS resolvidos: normaliza EOL para CRLF (repo usa CRLF) p/ nao gerar diff fantasma.',
    '- No fim responde com 1 linha a resumir o que fizeste e o estado final.',
    '',
    'PROGRESSO AO VIVO:',
    `  - Anexa 1 linha curta de progresso por passo ([hh:mm] <descricao>) ao ficheiro de log: ${logPath}`,
    '  - Faz append UTF-8 (open(<logPath>, \'a\', encoding=\'utf-8\')). No fim, 1 linha de resumo.',
    `Titulo da operacao: ${title}`,
  ].join('\n')
  // banner imediato no log -> o term-view mostra feedback logo no 1o poll (hermes headless leva
  // ~min a produzir a 1a linha; sem isto o terminal fica mudo e parece que o botao nao funciona).
  await writeFile(logPath, '◆ ' + title + ' — gestor git headless a arrancar…\n', 'utf8')
  const ws = createWriteStream(logPath, { flags: 'a' })
  writeFile(stPath, JSON.stringify({ state: 'running', ts: Date.now() }), 'utf8').catch(() => {})
  const wrapper = [
    'import subprocess,sys',
    'rc=subprocess.call([sys.executable,"-m","hermes_cli.main","-z",sys.argv[1]])',
    'sys.exit(rc)',
  ].join('\n')
  const p = spawn(VENV_PY, ['-c', wrapper, prompt],
    { cwd: repo, detached: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HERMES_HOME } })
  p.stdout?.on('data', (d: Buffer) => ws.write(d))
  p.stderr?.on('data', (d: Buffer) => ws.write(d))
  p.on('error', () => { ws.end(); writeFile(stPath, JSON.stringify({ state: 'done', code: 1, ts: Date.now() }), 'utf8').catch(() => {}) })
  p.on('close', (code: number) => { ws.end(); writeFile(stPath, JSON.stringify({ state: 'done', code, ts: Date.now() }), 'utf8').catch(() => {}) })
  p.unref()
}

function body(req: any) { return new Promise<any>(res => { let d=''; req.on('data', (c: Buffer)=>d+=c); req.on('end', ()=>{ try{res(JSON.parse(d||'null'))}catch{res(null)} }) }) }
async function readJ(p: string) { try { return JSON.parse(await readFile(p,'utf8')) } catch { return null } }
// ponytail: ETag por ficheiro — TODA escrita via writeJ avanca `ver` (1 ponto, nao um guard por escritor).
// index.json/meta.json nao tem `ver` -> `'ver' in v` cobre-os (nada a fazer).
function bumpVer(v: any) { if (v && typeof v === 'object' && ('ver' in v)) v.ver = (Number(v.ver) || 0) + 1; return v }
async function writeJ(p: string, v: any) { await writeFile(p, JSON.stringify(bumpVer(v),null,2), 'utf8'); syncVault() }
interface WD { slug: string; name: string; description: string; createdAt: number; icon?: string; repo?: string }
async function readIdx(): Promise<WD[]> { return (await readJ(join(DATA, INDEX))) || [] }

export default function atlasApi(): Plugin {
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://localhost')
    const p = url.pathname
    const m = req.method || 'GET'
    const send = (code: number, v: any) => { res.statusCode=code; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(v)) }
    try {
      if (!p.startsWith('/api/')) return next()   // static handled by vite, preview fallback (ex: dist/index.html em produção)
      // ponytail: fence anti-corrida (card iykn11lg) — writers externos (PUT notes/kanban/bundle) tem de apresentar
      // X-Atlas-Token a bater com cfg.wtoken. Sem token -> 401. Escritas internas (writeJ chamado pelo proprio
      // server em launchHermes/dp worker) NAO passam pelo middleware HTTP, ficam trusted. GETs livre (UI+meta).
      if (m === 'PUT' && /^\/api\/w\/[^/]+\/(notes|kanban|bundle)$/.test(p)) {
        const got = (req.headers['x-atlas-token'] || '') as string
        const remote = (req.socket as any)?.remoteAddress || ''
        const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
        if (!loopback && got !== cfg.wtoken) { send(401, { error: 'unauthorized: missing or invalid X-Atlas-Token' }); return }
      }
      const parts = p.replace(/^\/api\//,'').split('/').filter(Boolean)

      // ponytail: devolve cfg.wtoken ao client loopback sem auth. UI chama no boot e guarda em localStorage.
      // Sem este endpoint, abrir localhost:5173 sem ?token=... cai em 401 permanente ate o utilizador adivinhar
      // o token impresso no console. Loopback-only = mesma proteccao que o PUT (fence).
      if (parts[0] === 'wtoken' && parts.length === 1 && m === 'GET') {
        const remote = (req.socket as any)?.remoteAddress || ''
        const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
        if (!loopback) { send(403, { error: 'forbidden' }); return }
        res.setHeader('Cache-Control', 'no-store')
        send(200, { token: cfg.wtoken }); return
      }

      // ponytail: card terminal-control — /api/terms/kill-all -> mata todos os panes WezTerm
      // abertos por cards em doing do slug dado no body. Loopback-only (mesma proteccao que wtoken/
      // PUTs). Master button no workspace chama isto com confirm-dialog antes.
      if (parts[0] === 'terms' && parts[1] === 'kill-all' && m === 'POST') {
        const b2 = (await body(req)) || {}
        const slug = typeof b2.slug === 'string' ? b2.slug : ''
        if (!SLUG.test(slug)) { send(400, { error: 'slug required' }); return }
        const r = await killAllPanesForSlug(slug)
        send(200, { ok: true, killed: r.killed, checked: r.checked }); return
      }
      // ponytail: card terminal-control-v2 — cross-workdir. Mata panes de todos os mundos.
      if (parts[0] === 'terms' && parts[1] === 'kill-all-atlas' && m === 'POST') {
        const r = await killAllPanesAtlas()
        send(200, { ok: true, killed: r.killed, checked: r.checked, worlds: r.worlds }); return
      }
      // ponytail: card terminal-control-v2 — abre um wezterm-gui.exe start -- cmd.exe no workdir
      // ativo (palette Ctrl+K). Sem hermes, sem prompt; so' a pane visivel. cwd preferido: worktree do
      // primeiro card running (se houver), senao repo root do mundo, senao ATLAS_REPO.
      if (parts[0] === 'terms' && parts[1] === 'open' && m === 'POST') {
        const b2 = (await body(req)) || {}
        const slug = typeof b2.slug === 'string' ? b2.slug : ''
        if (!SLUG.test(slug)) { send(400, { error: 'slug required' }); return }
        if (!cfg.wezterm || !existsSync(cfg.wezterm)) { send(503, { error: 'wezterm nao instalado' }); return }
        const repo = await repoDir(slug)
        let cwd = repo
        try {
          const runsDir = join(wtRoot(repo), 'runs', slug)
          if (existsSync(runsDir)) {
            for (const f of readdirSync(runsDir).filter(x => x.endsWith('.status'))) {
              const st = await readJ(join(runsDir, f)).catch(() => null)
              if (st?.state === 'running') {
                const wt = join(wtRoot(repo), slug, f.replace(/\.status$/, ''))
                if (existsSync(wt)) { cwd = wt; break }
              }
            }
          }
        } catch { /* fallback repo */ }
        try {
          // ponytail: se ja' ha um wezterm-gui a correr, adiciona tab (focus fica no wezterm
          // existente que o user ja' tem a frente); senao abre janela nova. Sem isto, o user
          // via' o toast mas tinha de clicar na nova janela para usar.
          // Use tasklist para detectar: 'wezterm-gui.exe' sem arg de comando = o GUI host.
          const probe = spawn('tasklist', ['/FI', 'IMAGENAME eq wezterm-gui.exe', '/NH'],
            { stdio: ['ignore', 'pipe', 'ignore'] })
          let hasInstance = false
          probe.stdout.on('data', (d: Buffer) => { if (/wezterm-gui\.exe/i.test(d.toString())) hasInstance = true })
          await new Promise<void>(r => probe.on('close', () => r()))
          const args = hasInstance
            ? ['start', '--cwd', cwd, '--', 'cmd.exe']                                  // tab no mux existente
            : ['start', '--always-new-process', '--cwd', cwd, '--', 'cmd.exe']          // janela nova
          spawn(cfg.wezterm, args, { detached: true, stdio: 'ignore' }).unref()
          send(200, { ok: true, cwd, reused: hasInstance }); return
        } catch (e: any) {
          send(500, { error: 'wezterm start falhou: ' + e.message }); return
        }
      }

      // /api/orchestrator/start[/<slug>] -> passa TODO(s) nao arquivados (de um mundo, se slug) para doing
      // ponytail: so move colIds (nao dispara runs headless nem toca review/done/archived)
      if (parts[0] === 'orchestrator' && parts[1] === 'start' && (parts.length === 2 || parts.length === 3) && m === 'POST') {
        const only = parts.length === 3 ? decodeURIComponent(parts[2]) : ''
        const worldIdx = await readIdx()
        const targets = only ? worldIdx.filter(w => w.slug === only) : worldIdx
        if (only && targets.length === 0) { send(404, { error: 'mundo nao encontrado' }); return }
        let moved = 0
        const launched: { slug: string; card: any }[] = []
        for (const wd of targets) {
          const file = join(DATA, wd.slug, 'kanban.json')
          if (!inside(DATA, file)) continue
          const board = await readJ(file)
          if (!board || !Array.isArray(board.cards)) continue
          let dirty = false
          for (const card of board.cards) {
            if (card.archived || card.colId !== 'todo') continue
            card.colId = 'doing'
            card.startedAt = Date.now()
            delete card.result
            delete card.reviewed
            moved++; dirty = true
            launched.push({ slug: wd.slug, card })
          }
          if (dirty) await writeJ(file, board)
        }
        // ponytail: orquestrador tambem lanca o agente (run headless) por card movido — fire-and-forget, em paralelo.
        for (const l of launched) void launchHermes(l.slug, l.card).catch((e: any) => console.error('[orchestrator:' + l.slug + ':' + l.card.id + '] ' + (e?.message || e)))
        send(200, { ok: true, moved, launched: launched.length }); return
      }

if (parts[0] === 'icons' && parts.length === 1 && m === 'GET') { send(200, { icons: iconCatalog() }); return }
      // workdirs list / create
      if (parts[0] === 'workdirs' && parts.length === 1) {
        if (m === 'GET') { send(200, await readIdx()); return }
        if (m === 'PUT') {
          const b = await body(req) || {}
          const order = Array.isArray(b.order) ? b.order.filter((x: any) => typeof x === 'string') : null
          if (!order) { send(400,{error:'order required'}); return }
          const idx = await readIdx()
          const bySlug = new Map(idx.map(w => [w.slug, w]))
          const next: WD[] = []
          for (const sl of order) { const w = bySlug.get(sl); if (w && !next.includes(w)) next.push(w) }
          for (const w of idx) if (!next.includes(w)) next.push(w)
          await writeJ(join(DATA, INDEX), next)
          send(200, next); return
        }
        if (m === 'POST') {
          const b = await body(req)
          if (!b || typeof b.name !== 'string' || !b.name.trim()) { send(400,{error:'name required'}); return }
          const idx = await readIdx()
          let slug = toSlug(b.name) || 'workdir'; let base = slug, i = 1
          while (idx.some(w => w.slug === base)) base = `${slug}-${i++}`
          const wd = { slug: base, name: b.name.trim(), description: (b.description||'').trim(), icon: pickIcon(idx), createdAt: Date.now(), repo: typeof b.repo === 'string' ? (b.repo.trim() || undefined) : undefined } as WD
          idx.push(wd); await writeJ(join(DATA, INDEX), idx)
          const d = join(DATA, base); mkdirSync(d, { recursive: true })
          const meta0: Record<string, any> = { slug: base, name: wd.name, description: wd.description, icon: wd.icon, createdAt: wd.createdAt }
          if (wd.repo) meta0.repo = wd.repo
          await writeJ(join(d,'meta.json'), meta0)
          // ver:0 -> bumpVer na 1a escrita grava ver:1 (shape {ver,items}/{ver,columns,cards})
          await writeJ(join(d,'notes.json'), { ver: 0, items: [] })
          await writeJ(join(d,'kanban.json'), { ver: 0, columns:[{id:'todo',name:'To Do'},{id:'doing',name:'Em Curso'},{id:'review',name:'Review/Revisão'},{id:'done',name:'Concluído'}], cards:[] })
          send(201, wd); return
        }
      }
      // workdirs/:slug patch/delete
      if (parts[0] === 'workdirs' && parts.length === 2) {
        const slug = parts[1]; const idx = await readIdx(); const wd = idx.find(w=>w.slug===slug)
        if (!wd) { send(404,{error:'not found'}); return }
        const dir = join(DATA, slug)
        if (m === 'PATCH') {
          const b = await body(req) || {}
          if (typeof b.name === 'string' && b.name.trim()) wd.name = b.name.trim()
          if (typeof b.description === 'string') wd.description = b.description.trim()
          if (typeof b.icon === 'string' && iconCatalog().includes(b.icon)) wd.icon = b.icon
          if (typeof b.repo === 'string') wd.repo = b.repo.trim() || undefined
          await writeJ(join(DATA, INDEX), idx)
          const meta: Record<string, any> = (await readJ(join(dir,'meta.json'))) || {}
          meta.name = wd.name; meta.description = wd.description
          if (wd.icon) meta.icon = wd.icon
          if (wd.repo) meta.repo = wd.repo; else delete meta.repo
          await writeJ(join(dir,'meta.json'), meta)
          send(200, wd); return
        }
        if (m === 'DELETE') { await rm(dir, { recursive:true, force:true }); await writeJ(join(DATA, INDEX), idx.filter(w=>w.slug!==slug)); send(200,{ok:true}); return }
      }
      // /api/w/:slug/{notes,kanban,meta}
      // /api/w/:slug/review/{approve,reject} -> workflow Review (done c/ merge dev->main | refinar+voltar a doing)
      if (parts[0] === 'w' && parts.length === 4 && parts[2] === 'review' && m === 'POST') {
        const slug = parts[1], action = parts[3]
        if (action !== 'approve' && action !== 'reject') { send(400,{error:'bad action'}); return }
        const b = (await body(req)) || {}
        const id = typeof b.cardId === 'string' ? b.cardId : ''
        const file = join(DATA, slug, 'kanban.json')
        if (!inside(DATA, file) || !id) { send(400, { error: 'bad request' }); return }
        const board = await readJ(file)
        const card = board?.cards?.find((c: any) => c.id === id)
        if (!card) { send(404, { error: 'card not found' }); return }
        if (card.archived) { send(409, { error: 'card archived' }); return }
        if (action === 'reject') {
          // template scaffold no modal refinar — overrides opcionais aplicados antes da nota
          if (typeof b.title === 'string' && b.title.trim()) card.title = b.title.trim()
          if (typeof b.description === 'string') card.description = b.description
          if (typeof b.priority === 'string' && ['urgent','high','medium','low'].includes(b.priority)) card.priority = b.priority
          const note = typeof b.note === 'string' ? b.note.trim() : ''
          if (note) {
            // ponytail: guarda o refinamento como expansa da descricao (prompt original + nota)
            const now = new Date().toLocaleDateString('pt-PT')
            card.description = [
              card.description || '',
              ``,
              '*Refinamento pedido (' + now + ')*',
              note,
            ].join('\n')
          }
          card.colId = 'doing'
          card.startedAt = Date.now()
          // ponytail: limpa output/estado anteriores p/ a animacao de 'doing' reaparecer (so mostra se nao tem result)
          delete card.result
          delete card.reviewed
          await writeJ(file, board)
          await launchHermes(slug, card)
          send(200, { ok: true }); return
        }
        // approve -> so de 'review'; CI gate antes de mergear dev->main
        if (card.colId !== 'review') { send(409, { error: 'card not in review' }); return }
        const repo = await repoDir(slug)
        const gate = await runCIGate(repo)
        if (!gate.ok) { send(500, { error: 'CI gate falhou (' + gate.step + '): ' + gate.out }); return }
        const mgr = await mergeDevToMain(repo)
        if (!mgr.ok) { send(500, { error: 'merge dev->main falhou: ' + mgr.out }); return }
        void killPaneForCard(slug, card.id)  // card terminal-control: fecha pane antes de done
        card.colId = 'done'
        card.reviewed = true
        await writeJ(file, board)
        send(200, { ok: true, merge: mgr.out })
        return
      }

      // /api/w/:slug/run -> marca doing + abre wezterm com hermes (tarefa = description)
      if (parts[0] === 'w' && parts.length === 3 && parts[2] === 'run' && m === 'POST') {
        const slug = parts[1]
        const b = (await body(req)) || {}
        const id = typeof b.cardId === 'string' ? b.cardId : ''
        const file = join(DATA, slug, 'kanban.json')
        if (!inside(DATA, file) || !id) { send(400, { error: 'bad request' }); return }
        const board = await readJ(file)
        const card = board?.cards?.find((c: any) => c.id === id)
        if (!card) { send(404, { error: 'card not found' }); return }
        if (card.colId === 'done' || card.archived) { send(409, { error: 'card done or archived' }); return }
        card.colId = 'doing'
        card.startedAt = Date.now()
        // ponytail: re-come쀎7ar a tarefa limpa o output anterior — doing nao deve carregar resultado passado
        delete card.result
        delete card.reviewed
        await writeJ(file, board)
        await launchHermes(slug, card)
        send(200, { ok: true })
        return
      }

      // /api/w/:slug/brainstorm -> brainstorm + SWOT do projeto, escreve notas novas no workdir (headless)
      if (parts[0] === 'w' && parts.length === 3 && parts[2] === 'brainstorm' && m === 'POST') {
        const slug = parts[1]
        if (!SLUG.test(slug)) { send(400, { error: 'bad request' }); return }
        void launchBrainstorm(slug).catch(e => console.error('[brainstorm] ' + slug + ': ' + e.message))
        send(200, { ok: true }); return
      }
      // /api/w/:slug/dp -> gera/reescreve o DP de um card (headless, nao toca em codigo/worktree)
      if (parts[0] === 'w' && parts.length === 3 && parts[2] === 'dp' && m === 'POST') {
        const slug = parts[1]
        if (!SLUG.test(slug)) { send(400, { error: 'bad request' }); return }
        const b = (await body(req)) || {}
        const id = typeof b.cardId === 'string' ? b.cardId : ''
        if (!id) { send(400, { error: 'cardId required' }); return }
        const file = join(DATA, slug, 'kanban.json')
        const board = await readJ(file)
        const card = board?.cards?.find((c: any) => c.id === id)
        if (!card) { send(404, { error: 'card not found' }); return }
        if (card.archived) { send(409, { error: 'card archived' }); return }
        void launchDp(slug, card).catch(e => console.error('[dp] ' + slug + ': ' + e.message))
        send(200, { ok: true })
        return
      }
      // /api/w/:slug/cleanup -> limpeza manual de runs/worktrees orfas (trigger redundante ao boot)
      if (parts[0] === 'w' && parts.length === 3 && parts[2] === 'cleanup' && m === 'POST') {
        const slug = parts[1]
        if (!SLUG.test(slug)) { send(400, { error: 'bad request' }); return }
        await cleanupRuns(slug); await cleanupWorktrees()
        send(200, { ok: true }); return
      }

      // /api/hermes/keys -> lista as API keys configuradas no Hermes (lê auth.json, censura access_token).
      // ponytail: status derivado do último erro (auth.json NAO carrega estado "exhausted" canónico — usamos
      // 429/401 + reason conhecido como proxy de "esgotada"; 5xx/other = "error"; tudo null = "unknown").
      // access_token NUNCA sai do atlas (whitelist de campos + fingerprint derivado).
      if (parts[0] === 'hermes' && parts[1] === 'keys' && parts.length === 2 && m === 'GET') {
        const auth = await readJ(join(HERMES_HOME, 'auth.json'))
        const cp = (auth && typeof auth === 'object' && auth.credential_pool && typeof auth.credential_pool === 'object') ? auth.credential_pool : {}
        const out: any[] = []
        for (const [provider, list] of Object.entries(cp)) {
          if (!Array.isArray(list)) continue
          for (const k of list) {
            if (!k || typeof k !== 'object') continue
            const code = typeof k.last_error_code === 'number' ? k.last_error_code : null
            const reason = typeof k.last_error_reason === 'string' ? k.last_error_reason : null
            let status: 'active' | 'exhausted' | 'error' | 'unknown' = 'unknown'
            if (code === 429 || /quota|rate.?limit|exhaust/i.test(reason || '')) status = 'exhausted'
            else if (code && code >= 400) status = 'error'
            else if (typeof k.last_status === 'number' && k.last_status >= 200 && k.last_status < 300) status = 'active'
            // ponytail: deriva fingerprint do token SEM o enviar. sha256(access_token).slice(0,10).
            // whitelist abaixo é a única coisa que sai — access_token omitido por construção.
            const tok = typeof (k as any).access_token === 'string' ? (k as any).access_token : ''
            const fp = tok ? createHash('sha256').update(tok).digest('hex').slice(0, 10) : null
            out.push({
              provider,
              id: typeof k.id === 'string' ? k.id : null,
              label: typeof k.label === 'string' ? k.label : null,
              source: typeof k.source === 'string' ? k.source : null,
              auth_type: typeof k.auth_type === 'string' ? k.auth_type : null,
              base_url: typeof k.base_url === 'string' ? k.base_url : null,
              priority: typeof k.priority === 'number' ? k.priority : null,
              status,
              last_status: typeof k.last_status === 'number' ? k.last_status : null,
              last_status_at: k.last_status_at ?? null,
              last_error_code: code,
              last_error_reason: reason,
              last_error_message: typeof k.last_error_message === 'string' ? k.last_error_message : null,
              last_error_reset_at: k.last_error_reset_at ?? null,
              request_count: typeof k.request_count === 'number' ? k.request_count : 0,
              secret_fingerprint: fp,
              has_token: !!tok,
            })
          }
        }
        out.sort((a, b) => (a.provider.localeCompare(b.provider)) || ((a.priority ?? 999) - (b.priority ?? 999)))
        send(200, out); return
      }

      // /api/hermes/usage -> agregacao por key_id do JSONL capturado pelo HEIMDALL em cada pedido LLM
      // (HERMES_HOME/logs/atlas/usage.jsonl, 1 linha por request).
      // Schema esperado por linha: { ts:number, model:string, prompt_tokens:number, completion_tokens:number,
      //   cost_usd:number, key_id:string, provider?:string }. Linhas malformadas ou campos em falta sao
      // ignoradas silenciosamente — 1 request corrupta nao derruba o dashboard. Linhas sem key_id caem
      // no balde '__unknown__' para nao se misturarem com chaves reais.
      // Captura (escrita no JSONL) e da responsabilidade do HEIMDALL; este endpoint e read-only.
      // ponytail: leitura inteira do ficheiro por GET e O(N) em memoria — aceitavel ate dezenas de milhar
      // de linhas (meses de uso). Upgrade path: tail + line-count se passar disso.
      if (parts[0] === 'hermes' && parts[1] === 'usage' && parts.length === 2 && m === 'GET') {
        const sinceQ = parseInt(url.searchParams.get('since') || '0', 10)
        const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
        const since = Number.isFinite(sinceQ) && sinceQ > 0 ? sinceQ : startOfToday.getTime()
        const rows: any[] = []
        const totals: Record<string, any> = {}
        const file = join(HERMES_HOME, 'logs', 'atlas', 'usage.jsonl')
        try {
          const text = await readFile(file, 'utf8')
          for (const line of text.split('\n')) {
            if (!line) continue
            let r: any
            try { r = JSON.parse(line) } catch { continue }
            const ts = typeof r?.ts === 'number' ? r.ts : 0
            if (!ts || ts < since) continue
            const keyId = typeof r?.key_id === 'string' && r.key_id ? r.key_id : '__unknown__'
            const pt = typeof r?.prompt_tokens === 'number' ? r.prompt_tokens : 0
            const ct = typeof r?.completion_tokens === 'number' ? r.completion_tokens : 0
            const cost = typeof r?.cost_usd === 'number' ? r.cost_usd : 0
            const model = typeof r?.model === 'string' ? r.model : undefined
            const provider = typeof r?.provider === 'string' ? r.provider : undefined
            rows.push({ ts, key_id: keyId, model, prompt_tokens: pt, completion_tokens: ct, cost_usd: cost, provider })
            const t = totals[keyId] || (totals[keyId] = { requests: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, last_ts: 0, model, provider })
            t.requests += 1
            t.prompt_tokens += pt
            t.completion_tokens += ct
            t.cost_usd += cost
            if (ts > t.last_ts) { t.last_ts = ts; if (model) t.model = model; if (provider) t.provider = provider }
          }
        } catch { /* ficheiro ausente / ilegivel -> resposta vazia, dashboard cai para "—" */ }
        send(200, { rows, totals_by_key: totals, since, generated_at: Date.now() })
        return
      }

      // /api/w/:slug/orphans -> cards em 'doing' com .status.state=running e log parado > 90s (worker crash).
      // ponytail: heuristica simples - 90s sem actividade no log OU mtime do .status em 'running' ha > 90s
      // e log vazio. O front-end usa isto para notificar + resetar doing->todo. Idempotente: GET nao muta.
      if (parts[0] === 'w' && parts.length === 3 && parts[2] === 'orphans' && m === 'GET') {
        const slug = parts[1]
        if (!SLUG.test(slug)) { send(400, { error: 'bad request' }); return }
        const STALE_MS = 5 * 60 * 1000  // ponytail: 5min (era 90s) — workers lentos OK, o que para e nao escreve log no .log e crash real
        const now = Date.now()
        const board = await readJ(join(DATA, slug, 'kanban.json')).catch(() => null)
        if (!board) { send(200, { orphans: [] }); return }
        const runsDir = join(wtRoot(await repoDir(slug)), 'runs', slug)
        const orphans: any[] = []
        for (const c of (board.cards || [])) {
          if (c.archived || c.colId !== 'doing' || !c.startedAt) continue
          const stPath = join(runsDir, c.id + '.status')
          const st = await readJ(stPath).catch(() => null)
          if (!st || st.state !== 'running') continue
          const logPath = join(runsDir, c.id + '.log')
          let logSize = 0, logMtime = 0
          try { const s = statSync(logPath); logSize = s.size; logMtime = s.mtimeMs } catch { /* no log = nao arrancou */ }
          const stMtime = (() => { try { return statSync(stPath).mtimeMs } catch { return 0 } })()
          // 2 caminhos para 'crash': (a) wrapper morreu antes do hermes escrever no log, (b) hermes
          // parou de escrever no log (travou, perdeu rede, OOM). Heuristica: status em running + log
          // vazio OU logMtime > STALE_MS. startedAt > STALE_MS atras (card novo demais = ainda a
          // arrancar - espera). 90s e' generoso; o user pode disparar de proposito.
          const cardAge = now - c.startedAt
          if (cardAge < STALE_MS) continue
          const logStale = logMtime === 0 || (now - logMtime) > STALE_MS
          if (!logStale) continue
          orphans.push({
            cardId: c.id,
            title: c.title,
            priority: c.priority,
            startedAt: c.startedAt,
            logSize,
            logMtime: logMtime || null,
            stMtime: stMtime || null,
            cardAgeMs: cardAge,
          })
        }
        send(200, { orphans }); return
      }

      // /api/w/:slug/output/:cardId -> stream do log do run headless (offset-based, p/ debugging/erros)
      if (parts[0] === 'w' && parts.length === 4 && parts[2] === 'output' && m === 'GET') {
        const slug = parts[1], cardId = parts[3]
        const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0)
        if (!SLUG.test(slug)) { send(400, { error: 'bad request' }); return }
        const runsDir = join(wtRoot(await repoDir(slug)), 'runs', slug)
        const logPath = join(runsDir, cardId + '.log')
        const stPath = join(runsDir, cardId + '.status')
        const st = (await readJ(stPath).catch(() => null)) || null
        // ponytail: sem ficheiro .status = NUNCA lancado (honesto, NAO fantasma done). O default
        // running em vez de done evita inventar 'concluido'. Campo `started` deixa a UI distinguir
        // 'ainda nao lancado' de 'em curso'.
        const started = !!st
        const st2 = st || { state: 'running' }
        let full = ''
        try { full = await readFile(logPath, 'utf8') } catch { full = '' }
        const done = st2.state !== 'running'
        // ponytail: envia chunk desde o offset e reporta a posicao nova p/ o cliente pedir so o delta
        const chunk = full.slice(offset)
        send(200, { ok: true, started, done, code: done ? (st2.code ?? 0) : null, chunk, offset: offset + chunk.length, size: full.length })
        return
      }
            // /api/w/:slug/git/merge-main -> merge dev->main + push origin (headless, repo base)
      if (parts[0] === 'w' && parts.length === 4 && parts[2] === 'git' && parts[3] === 'merge-main' && m === 'POST') {
        const slug = parts[1]
        if (!SLUG.test(slug)) { send(400, { error: 'bad request' }); return }
        const task = [
          'Merge dev -> main e push para origin. Na repo base do mundo (vê o Source-tree no prompt do runner):',
          '1. `git fetch origin`.',
          '2. Verifica se dev esta sincronizado com origin/dev (`git rev-parse dev` vs `git rev-parse origin/dev`).',
          '3. No-op (dev \u2286 main, main a frente): se `git merge-base --is-ancestor dev main` rc0, main ja contem dev -> so `git push origin main`.',
          '4. Senao: `git checkout main`, `git merge dev --no-edit` (fast-forward ou merge normal), e `git push origin main`.',
          '5. NUNCA forces, nunca rebase destrutivo nem `git reset`. Se a divergencia nao for resolvivel por merge normal, reporta explicitamente e NAO forces para main.',
          '6. No fim reporta `git log --oneline main..dev` / diff resumido e o estado final do push.',
        ].join('\n')
        void launchGitOp(slug, 'merge-main', 'Merge dev->main', task).catch(e => console.error('[git-merge] ' + slug + ': ' + e.message))
        send(200, { ok: true }); return
      }
      // /api/w/:slug/git/resolve -> resolver merge conflict em dev (headless, repo base)
      if (parts[0] === 'w' && parts.length === 4 && parts[2] === 'git' && parts[3] === 'resolve' && m === 'POST') {
        const slug = parts[1]
        if (!SLUG.test(slug)) { send(400, { error: 'bad request' }); return }
        const task = [
          'Resolver o merge conflict existente em dev (repo base do mundo — vê o Source-tree no prompt do runner).',
          '1. `git checkout dev` (forca o ramo alvo; nunca confies na branch atual do base).',
          '2. `git status` / verifica MERGE_HEAD para localizar o merge em curso e os ficheiros UU (both modified).',
          '3. Para cada UU: resolve mantendo os lados ADITIVOS (re-injeta tails partilhados, verifica balanco de `{}` / parentesis). Se o conflito nao for resolvivel automaticamente, deixa dev em conflito e reporta — NAO forces.',
          '4. Verifica zero marcadores: `git grep -c -E \'^(<<<<<<<|=======|>>>>>>>)\'` == 0 (em todo o arvore).',
          '5. `git add` dos ficheiros resolvidos e termina o merge (`git merge --continue` / commit).',
          '6. Valida: `npm run typecheck` E `npm run build` (vite) verdes.',
          '7. NAO auto-push para main — o merge fica em dev p/ BMS validar/rever.',
        ].join('\n')
        void launchGitOp(slug, 'resolve-conflict', 'Resolve merge conflito', task).catch(e => console.error('[git-resolve] ' + slug + ': ' + e.message))
        send(200, { ok: true }); return
      }
      // /api/w/:slug/import-roadmap -> migra tarefas abertas de um roadmap md (notas+cards)
      if (parts[0] === 'w' && parts.length === 3 && parts[2] === 'import-roadmap' && m === 'POST') {
        const slug = parts[1]
        const file = join(DATA, slug, 'kanban.json')
        if (!SLUG.test(slug) || !inside(DATA, file)) { send(400, { error: 'bad request' }); return }
        const b = (await body(req)) || {}
        let path = typeof b.path === 'string' ? b.path : ''
        if (!path) { send(400, { error: 'path required' }); return }
        // ponytail: allow-list ao readFile — o path do body tem de viver dentro de
        // <VAULT>/knowledge/projects/<slug>/. Sem isto, /import-roadmap le ficheiros
        // arbitrarios do disco (path-traversal). resolve() normaliza ../ antes do inside().
        const allowedRoot = join(VAULT, 'knowledge', 'projects', slug)
        path = resolve(path)
        if (!inside(allowedRoot, path)) { send(400, { error: 'path outside project' }); return }
        let md: string
        try { md = await readFile(path, 'utf8') } catch { send(400, { error: 'ficheiro nao encontrado: ' + path }); return }
        const tasks = parseRoadmap(md)
        const board = (await readJ(file)) || { columns: [], cards: [] }
        // notas agora sao {ver, items} (optimistic concurrency) — unshift em items, ver sobe no writeJ
        const notesDoc = (await readJ(join(DATA, slug, 'notes.json'))) || { ver: 0, items: [] }
        const notes = notesDoc.items || []
        if (!board.columns.some((c: any) => c.id === 'todo')) board.columns.unshift({ id: 'todo', name: 'To Do' })
        const now = Date.now()
        let addedCards = 0, addedNotes = 0, skipped = 0
        const titles = new Set(board.cards.map((c: any) => c.title.toLowerCase()))
        const noteTitles = new Set(notes.map((n: any) => n.title.toLowerCase()))
        for (const t of tasks) {
          if (titles.has(t.title.toLowerCase())) { skipped++; continue }
          board.cards.push({ id: nid(), colId: 'todo', title: t.title, description: t.detail || t.raw, priority: t.priority, ts: now, archived: false })
          titles.add(t.title.toLowerCase()); addedCards++
          if (!noteTitles.has(t.title.toLowerCase())) {
            notes.unshift({ id: nid(), title: t.title, text: 'Origem: roadmap (import).\n\n' + t.raw, ts: now })
            noteTitles.add(t.title.toLowerCase()); addedNotes++
          }
        }
        await writeJ(file, board)
        await writeJ(join(DATA, slug, 'notes.json'), notesDoc)
        send(200, { ok: true, addedCards, addedNotes, skipped, total: tasks.length })
        return
      }
      // /api/w/:slug/bundle -> snapshot portatil do workdir inteiro (meta+notes+kanban).
      // GET serializa os 3 ficheiros; PUT restaura sem validar `ver` (operação destrutiva — replace completo).
      // Uso: portabilidade manual e backup fora do git (imune a git reset / corrupção do repo).
      if (parts[0] === 'w' && parts.length === 3 && parts[2] === 'bundle') {
        const slug = parts[1]
        if (!SLUG.test(slug)) { send(400, { error: 'bad request' }); return }
        const dir = join(DATA, slug)
        const metaFile = join(dir, 'meta.json'), notesFile = join(dir, 'notes.json'), kanbanFile = join(dir, 'kanban.json')
        if (!inside(DATA, metaFile) || !inside(DATA, notesFile) || !inside(DATA, kanbanFile)) { send(400, { error: 'bad path' }); return }
        if (m === 'GET') {
          const meta = await readJ(metaFile) || {}
          const notes = await readJ(notesFile) || { ver: 0, items: [] }
          const kanban = await readJ(kanbanFile) || { ver: 0, columns: [], cards: [] }
          send(200, { slug, meta, notes, kanban, ts: Date.now() }); return
        }
        if (m === 'PUT') {
          const b = (await body(req)) || {}
          // ponytail: valida shape minimo (recusar bundle malformado NAO sobrescreve estado). Aceita
          // {meta, notes, kanban} no payload. Faltar qualquer um -> 400 sem tocar em disco.
          if (!b || typeof b !== 'object' || !('meta' in b) || !('notes' in b) || !('kanban' in b)) {
            send(400, { error: 'bundle invalido: requer meta+notes+kanban' }); return
          }
          await writeJ(metaFile, b.meta)
          await writeJ(notesFile, b.notes)
          await writeJ(kanbanFile, b.kanban)
          send(200, { ok: true }); return
        }
        send(405, { error: 'method not allowed' }); return
      }
      // /api/w/:slug/export -> exporta notas não-arquivadas para markdown na vault (docs/notas.md)
      if (parts[0] === 'w' && parts.length === 3 && parts[2] === 'export' && m === 'POST') {
        const slug = parts[1]
        if (!SLUG.test(slug)) { send(400, { error: 'bad request' }); return }
        const doc = (await readJ(join(DATA, slug, 'notes.json'))) || { items: [] }
        const active = (doc.items || []).filter((n: any) => !n.archived).sort((a: any, b: any) => (a.ts || 0) - (b.ts || 0))
        if (!active.length) { send(200, { ok: true, count: 0 }); return }
        const md = active.map((n: any) => {
          const tags = Array.isArray(n.tags) && n.tags.length ? `\ntags: [${n.tags.map((t: string) => t.includes(' ') ? `"${t}"` : t).join(', ')}]` : ''
          const criado = n.ts ? new Date(n.ts).toISOString() : ''
          return `---\nid: ${n.id}${tags}\ncriado: ${criado}\n---\n# ${n.title}\n\n${n.text}`
        }).join('\n\n---\n\n')
        const target = join(VAULT, 'knowledge', 'projects', slug, 'docs', 'notas.md')
        try {
          mkdirSync(dirname(target), { recursive: true })
          await writeFile(target, md, 'utf8')
        } catch (e: any) { send(500, { error: 'falha ao exportar notas: ' + e.message }); return }
        send(200, { ok: true, count: active.length })
        return
      }
      if (parts[0] === 'w' && parts.length === 3) {
        const slug = parts[1], kind = parts[2]
        if (!SLUG.test(slug)) { send(400,{error:'bad request'}); return }
      // templates: read-only — merge global (data/templates.json) + workdir (data/<slug>/templates.json);
      // em colisao de id, o do workdir vence o global. JSON malformado -> lista vazia (nao 500).
      if (kind === 'templates') {
        if (m !== 'GET') { send(405, { error: 'method not allowed' }); return }
        const globRaw = await readJ(join(DATA, 'templates.json'))
        const wdRaw = await readJ(join(DATA, slug, 'templates.json'))
        const byId = new Map<string, any>()
        for (const t of Array.isArray(globRaw) ? globRaw : []) if (t && t.id) byId.set(t.id, t)
        for (const t of Array.isArray(wdRaw) ? wdRaw : []) if (t && t.id) byId.set(t.id, t)
        send(200, [...byId.values()]); return
      }
      if (!['notes','kanban','meta'].includes(kind)) { send(400,{error:'bad request'}); return }
        const file = join(DATA, slug, `${kind}.json`)
        if (!inside(DATA, file)) { send(400,{error:'bad path'}); return }
        if (m === 'GET') { send(200, (await readJ(file)) ?? (kind==='kanban'?{ver:0,columns:[],cards:[]}:{ver:0,items:[]})); return }
        if (m === 'PUT') {
          const b = await body(req)
          // optimistic concurrency (card: optimistic concurrency no PUT): o client deve enviar o `ver`
          // que leu; se o ficheiro em disco ja avancou, outro escritor ganhou -> 409 p/ o client re-sync.
          // meta nao entra (nao e reescrito em corrida por agents) — so notes/kanban validam.
          if (kind === 'notes' || kind === 'kanban') {
            const cur = await readJ(file)
            const storedVer = cur?.ver ?? 0
            const inVer = (b && typeof b === 'object') ? (Number(b.ver) || 0) : 0
            if (storedVer !== 0 && inVer !== storedVer) {
              send(409, { error: 'conflito de versao — re-faz GET e re-aplica as tuas mudancas', ver: storedVer }); return
            }
            // ponytail: card terminal-control — kill-on-transition. Detecta cards que estavam
            // em 'doing' no estado anterior e agora estao noutra coluna (ou arquivados) e mata a
            // pane WezTerm respetiva. Fire-and-forget: o PUT nao espera pelo kill-pane (que e'
            // instantaneo), e' idempotente se a pane ja tiver morrido.
            if (kind === 'kanban') {
              const beforeMap = new Map<string, any>((Array.isArray(cur?.cards) ? cur.cards : []).map((c: any) => [c.id, c]))
              for (const a of (Array.isArray(b?.cards) ? b.cards : [])) {
                const b4 = beforeMap.get(a?.id)
                if (!b4 || b4.colId !== 'doing') continue
                if (a.archived || (a.colId && a.colId !== 'doing')) {
                  void killPaneForCard(slug, a.id)
                }
              }
            }
            // ponytail: fence anti-wipe (card iykn11lg+) - detect drop drastico no numero de items/cards
            // e exige header X-Atlas-Confirm-Wipe para confirmar (defesa em profundidade: protege contra
            // PUTs de testes/scripts que mandam items/cards vazios e destroem o trabalho). Threshold:
            // - perdoa ate 5 items de perda (uso normal: arquivar 1-2 notas + delete 1 = OK)
            // - perdoa ate 50% de perda (uso normal: arquivar metade do backlog e OK)
            // - EXIGE confirmacao se perder mais de max(5, before*0.5) items. Auto-backup do estado
            //   anterior SEMPRE (rollback manual se o wipe foi acidental).
            const arrKey = kind === 'notes' ? 'items' : 'cards'
            const beforeCount = Array.isArray(cur?.[arrKey]) ? cur[arrKey].length : 0
            const afterCount = (b && Array.isArray(b[arrKey])) ? b[arrKey].length : 0
            const loss = beforeCount - afterCount
            const threshold = Math.max(5, Math.floor(beforeCount * 0.5))
            if (loss > threshold) {
              const confirm = (req.headers['x-atlas-confirm-wipe'] || '') as string
              if (confirm !== 'yes') {
                // backup automatico para o utilizador poder fazer rollback sem perder tudo
                const backupDir = join(DATA, slug, '.backup')
                try {
                  mkdirSync(backupDir, { recursive: true })
                  const ts = new Date().toISOString().replace(/[:.]/g, '-')
                  await writeFile(join(backupDir, kind + '-' + ts + '.json'), JSON.stringify(cur, null, 2), 'utf8')
                } catch { /* best-effort */ }
                send(409, {
                  error: 'wipe detetado: ' + loss + ' ' + arrKey + ' perdidos (de ' + beforeCount + ' para ' + afterCount + ', threshold ' + threshold + '). Backup feito em .backup/. Confirma com header X-Atlas-Confirm-Wipe: yes para prosseguir.',
                  before: beforeCount, after: afterCount, loss, threshold, backupDir: '.backup'
                }); return
              }
            }
            // backup pre-PUT (sempre, mesmo sem wipe) - guarda as ultimas 10 versoes para rollback
            // manual. Custo: 1 write extra por PUT. Custo aceitavel para imensidao do beneficio.
            try {
              const backupDir = join(DATA, slug, '.backup')
              mkdirSync(backupDir, { recursive: true })
              const ts = new Date().toISOString().replace(/[:.]/g, '-')
              await writeFile(join(backupDir, kind + '-' + ts + '.json'), JSON.stringify(cur, null, 2), 'utf8')
              // prune: manter so as ultimas 10 versoes (ordenadas alfabeticamente por ts ISO).
              // readdirSync/unlinkSync ja vem do import 'node:fs' no topo.
              try {
                const files = readdirSync(backupDir).filter(f => f.startsWith(kind + '-') && f.endsWith('.json')).sort()
                while (files.length > 10) { try { unlinkSync(join(backupDir, files.shift()!)) } catch {} }
              } catch { /* best-effort */ }
            } catch { /* best-effort */ }
          }
          // ponytail: defesa — brainstorm/import/PUT manual pode trazer items sem `id`; sem id os
          // handlers de click/data-id no cliente não resolvem nada. Sanitize em vez de 400.
          if (kind === 'notes' && b && Array.isArray(b.items)) {
            let missing = 0
            for (const it of b.items) {
              if (!it || typeof it !== 'object') continue
              if (!it.id || (typeof it.id === 'string' && !it.id.trim())) { it.id = nid(); missing++ }
            }
            if (missing) console.warn('[atlas] note sem id — sanitize:', slug, 'added=' + missing)
          }
          await writeJ(file, b); send(200,{ok:true, ver: (b && typeof b === 'object') ? (Number(b.ver) || 0) : 0}); return
        }
      }
      // /api/w/:slug meta get
      if (parts[0] === 'w' && parts.length === 2 && m === 'GET') {
        const slug = parts[1]; send(200, (await readJ(join(DATA, slug, 'meta.json'))) || { error:'not found' }); return
      }
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