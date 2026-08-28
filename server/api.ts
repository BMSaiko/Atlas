import type { Plugin, Connect } from 'vite'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname, delimiter, normalize, extname, relative, sep } from 'node:path'
import { parseRoadmap } from './roadmap'

const DATA = join(process.cwd(), 'data')
const SLUG = /^[a-z0-9-]+$/
const INDEX = 'index.json'
const WEZTERM = process.env.WEZTERM || 'C:\\Program Files\\WezTerm\\wezterm-gui.exe'
const WEZTERM_CLI = process.env.WEZTERM_CLI || 'C:\\Program Files\\WezTerm\\wezterm.exe'
const VENV_PY = process.env.HERMES_PY || 'C:\\Users\\bruno\\Documents\\hermes-agent\\.venv\\Scripts\\python.exe'
const HERMES_CWD = process.env.HERMES_CWD || 'C:\\Users\\bruno\\Documents\\hermes-agent'
const HERMES_HOME = process.env.HERMES_LIVE_HOME || 'C:\\Users\\bruno\\AppData\\Local\\hermes'
const GIT = process.env.GIT_BIN || 'C:\\Program Files\\Git\\bin\\git.exe'
const VAULT = 'C:\\Users\\bruno\\Documents\\Second-Brain' // ponytail: datas locais (live-data) versionadas na vault -> auto-backup a cada escrita
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
const ATLAS_REPO = process.env.ATLAS_REPO || 'C:\\Users\\bruno\\Documents\\Second-Brain\\knowledge\\projects\\atlas\\code'
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
      try { if (now - statSync(fp).mtimeMs > RUN_KEEP_MS) await rm(fp, { force: true }).catch(() => {}) } catch { /* ja foi apagado */ }
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

async function launchHermes(slug: string, card: any) {
  const repo = await repoDir(slug)
  const branch = `feature/${slug}-${card.id}`
  const wt = join(wtRoot(repo), slug, card.id)
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
  const addOut = await runGit(['worktree', 'add', '-B', branch, wt, 'dev'], repo)
  if (!addOut.ok) { await fail('git worktree add falhou: ' + addOut.out); return }
  const linked = await addJunction(join(wt, 'node_modules'), join(repo, 'node_modules'))
  if (!linked) { await fail('nao consegui ligar node_modules partilhado (mklink)'); return }
  const prompt = [
    'Tu es um agente autonomo. Executa o trabalho abaixo do card de kanban e atualiza o estado.',
    `Workdir: ${slug}`,
    `Kanban JSON (em disco): ${join(DATA, slug, 'kanban.json')}`,
    `Kanban API (para updates): http://localhost:5173/api/w/${slug}/kanban`,
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
    "wt=sys.argv[1]; branch=sys.argv[2]; base=sys.argv[3]",
    'rc=subprocess.call([sys.executable,"-m","hermes_cli.main","-z",sys.argv[4]])',
    'if rc==0:',
    '\x20\x20\x20\x20try:',
    '\x20\x20\x20\x20\x20\x20\x20\x20os.chdir(base)',
    // ponytail: merge SEMPRE em dev — nunca na branch atual do base. Se o repo estiver em main o 'git merge' iria p/ main sem approve.
    '\x20\x20\x20\x20\x20\x20\x20\x20co=subprocess.run([r"GITBIN","checkout","dev"],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20if co.returncode!=0:',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20print("NAO consigo ir para dev - aborta merge p/ nao tocar em main. Worktree mantida.")',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20sys.exit(0)',
    '\x20\x20\x20\x20\x20\x20\x20\x20subprocess.run([r"GITBIN","fetch","origin","dev"],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20co2=subprocess.run([r"GITBIN","merge","origin/dev","--no-edit"],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20mg=subprocess.run([r"GITBIN","merge",branch,"--no-edit"],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20if mg.returncode==0:',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20subprocess.run([r"GITBIN","push","origin","dev"],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20nj=os.path.join(wt,"node_modules")',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20try: os.rmdir(nj)',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20except OSError: shutil.rmtree(nj,ignore_errors=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20subprocess.run([r"GITBIN","worktree","remove","--force",wt],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20subprocess.run([r"GITBIN","branch","-D",branch],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20else:',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20print("MERGE dev<-"+branch+" FALHOU (conflito?) - worktree mantido, verifica.")',
    '    except Exception as e:',
    '\x20\x20\x20\x20\x20\x20\x20\x20print("AUTO-CLEANUP FALHOU: %r - push/merge incompleto. Worktree e branch mantidas p/ inspecao." % (e,))',
    'sys.exit(rc)',
  ].join('\n').replaceAll('GITBIN', GIT)
  const stPath = join(runsDir, card.id + '.status')
  const ws = createWriteStream(logPath, { flags: 'w' })
  writeFile(stPath, JSON.stringify({ state: 'running', ts: Date.now() }), 'utf8').catch(() => {})
  // ponytail: spawn com pipe e reencaminha p/ o log — evita a corrida do fd (WriteStream{fd:null} no stdio)
  const p = spawn(VENV_PY, ['-c', wrapper, wt, branch, repo, prompt],
    { cwd: repo, detached: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HERMES_HOME } })
  p.stdout?.on('data', d => ws.write(d))
  p.stderr?.on('data', d => ws.write(d))
  p.on('error', e => { ws.end(); void fail('spawn headless falhou: ' + e.message) })
  p.on('close', async (code) => {
    ws.end()
    await writeFile(stPath, JSON.stringify({ state: 'done', code, ts: Date.now() }), 'utf8').catch(() => {})
    // ponytail: em falha deixa um marcador ERRO no card p/ a UI saber que terminou com erro (debug facil)
    if (code !== 0) {
      const ff = join(DATA, slug, 'kanban.json')
      const board = await readJ(ff).catch(() => null)
      const c = board?.cards?.find((x: any) => x.id === card.id)
      if (c && !c.result) { c.result = 'ERRO: processo terminou com código ' + code + ' — abre o terminal/card para ver o log.'; await writeJ(ff, board) }
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
    `API notas (get/put): http://localhost:5173/api/w/${slug}/notes`,
    `Source-tree do projeto a analisar: ${repo}`,
    '',
    'TAREFA:',
    '- Le o source-tree e o estado do workdir para perceberes o projeto.',
    '- Faz uma analise SWOT (forcas, fraquezas, oportunidades, ameacas).',
    '- Faz um brainstorm de coisas que podemos implementar (features, melhorias, correcoes).',
    '- Cria notas novas nesse workdir: uma nota por ideia + uma nota com o SWOT. Para gravar, faz GET da lista atual em /api/w/' + slug + '/notes (devolve {ver, items}), preserva o ver lido, faz append das novas em items e faz PUT com o objeto completo enviando o mesmo ver. Se receberes 409 (conflito de versao), re-faz GET e re-aplica.',
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
    `Kanban API (para gravar o DP): http://localhost:5173/api/w/${slug}/kanban`,
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
      if (!p.startsWith('/api/')) return next()   // static handled by vite, preview fallback below
      const parts = p.replace(/^\/api\//,'').split('/').filter(Boolean)

      // /api/orchestrator/start[/<slug>] -> passa TODO(s) nao arquivados (de um mundo, se slug) para doing
      // ponytail: so move colIds (nao dispara runs headless nem toca review/done/archived)
      if (parts[0] === 'orchestrator' && parts[1] === 'start' && (parts.length === 2 || parts.length === 3) && m === 'POST') {
        const only = parts.length === 3 ? decodeURIComponent(parts[2]) : ''
        const worldIdx = await readIdx()
        const targets = only ? worldIdx.filter(w => w.slug === only) : worldIdx
        if (only && targets.length === 0) { send(404, { error: 'mundo nao encontrado' }); return }
        let moved = 0
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
          }
          if (dirty) await writeJ(file, board)
        }
        send(200, { ok: true, moved }); return
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
      // /api/w/:slug/import-roadmap -> migra tarefas abertas de um roadmap md (notas+cards)
      if (parts[0] === 'w' && parts.length === 3 && parts[2] === 'import-roadmap' && m === 'POST') {
        const slug = parts[1]
        const file = join(DATA, slug, 'kanban.json')
        if (!SLUG.test(slug) || !inside(DATA, file)) { send(400, { error: 'bad request' }); return }
        const b = (await body(req)) || {}
        const path = typeof b.path === 'string' ? b.path : ''
        if (!path) { send(400, { error: 'path required' }); return }
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
      if (parts[0] === 'w' && parts.length === 3) {
        const slug = parts[1], kind = parts[2]
        if (!SLUG.test(slug) || !['notes','kanban','meta'].includes(kind)) { send(400,{error:'bad request'}); return }
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