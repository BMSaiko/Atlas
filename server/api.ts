import type { Plugin, Connect } from 'vite'
import { existsSync, mkdirSync } from 'node:fs'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join, normalize, extname, relative, sep } from 'node:path'
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
let vaultSyncing = false
function syncVault() { // ponytail: git commit fire-and-forget a cada escrita (nao bloqueia a rota); .wt ignorado na vault
  if (vaultSyncing) return; vaultSyncing = true
  const c = spawn(GIT, ['-C', VAULT, 'add', '-A', 'knowledge/projects/atlas/live-data', '--'], { windowsHide: true, stdio: 'ignore' })
  c.on('close', () => {
    const d = spawn(GIT, ['-C', VAULT, 'commit', '--no-verify', '-m', 'atlas: live-data sync (data.json)', '--', 'knowledge/projects/atlas/live-data'], { windowsHide: true, stdio: 'ignore' })
    d.on('close', () => { vaultSyncing = false })
    d.on('error', () => { vaultSyncing = false })
  })
  c.on('error', () => { vaultSyncing = false })
}
const ATLAS_REPO = process.env.ATLAS_REPO || 'C:\\Users\\bruno\\Documents\\Second-Brain\\knowledge\\projects\\atlas\\code'
const WT_ROOT = join(ATLAS_REPO, 'data', '.wt')  // ponytail: worktrees por card -> N cards em paralelo sem colidir no checkout
const nid = () => Math.random().toString(36).slice(2, 10)  // id curto p/ notas/cards


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
function runGit(args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise(res => {
    const c = spawn(GIT, args, { cwd: process.cwd(), windowsHide: true })
    let out = ''; c.stdout?.on('data', (d: Buffer) => out += d); c.stderr?.on('data', (d: Buffer) => out += d)
    c.on('error', e => res({ ok: false, out: e.message }))
    c.on('close', code => res({ ok: code === 0, out: out.trim() }))
  })
}
// ponytail: fast-forward-only merge dev->main (sem checkout -> nao choca com data/ sujo)
async function resolveMainTip(): Promise<string | null> {
  const lo = await runGit(['rev-parse', '--verify', '--quiet', 'refs/heads/main'])
  if (lo.ok) return lo.out
  const lo2 = await runGit(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'])
  return lo2.ok ? lo2.out : null
}

async function mergeDevToMain() {
  // ponytail: local main pode NAO existir no clone (só nasce no update-ref do 1º approve) ->
  // resolver o tip real (local || remote); sem tip, main nunca existiu -> ff trivial, deixar mergear.
  const tip = await resolveMainTip()
  if (tip) {
    const anc = await runGit(['merge-base', '--is-ancestor', tip, 'dev'])
    if (!anc.ok) return { ok: false, out: 'main e dev divergentes — merge manual necessario (dev deveria estar a frente de main)' }
  }
  const devSha = await runGit(['rev-parse', 'dev'])
  if (!devSha.ok) return { ok: false, out: 'falha a obter dev' }
  const upd = await runGit(['update-ref', 'refs/heads/main', devSha.out])
  if (!upd.ok) return { ok: false, out: 'falha a mover main para dev' }
  const push = await runGit(['push', 'origin', 'main'])
  return { ok: true, out: 'main = dev (fast-forward); push ' + (push.ok ? 'ok' : ('falhou: ' + push.out)) }
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

async function launchHermes(slug: string, card: any) {
  const branch = `feature/${slug}-${card.id}`
  const wt = join(WT_ROOT, slug, card.id)
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
  await runGit(['worktree', 'prune'])
  await rmJunction(join(wt, 'node_modules'))
  await killWtLockers(wt)  // pane de run anterior tbm segura o wt -> EBUSY no rm abaixo
  // ponytail: worktree remove --force e o caminho git-native p/ desregistar uma worktree orfa (dir + reg + branch);
  // rm() manual nao remove node_modules real (WinError 145) nem desregistar. --force cobre branch nao-merged + sujo.
  try { await runGit(['worktree', 'remove', '--force', wt]) } catch { /* dir ja nao existe, ok */ }
  try { await rm(wt, { recursive: true, force: true }) } catch { /* queda do node_modules real; add -B limpa */ }
  const addOut = await runGit(['worktree', 'add', '-B', branch, wt, 'dev'])
  if (!addOut.ok) { await fail('git worktree add falhou: ' + addOut.out); return }
  const linked = await addJunction(join(wt, 'node_modules'), join(ATLAS_REPO, 'node_modules'))
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
  ].join('\n')
  // ponytail: global wezterm.lua forces exit_behavior=Hold; CLI override is unreliable when a GUI is already running.
  // So the task pane closes ITS OWN window: wezterm injects WEZTERM_PANE into the pane env, and
  // `wezterm cli kill-pane` (no --pane-id) targets that env pane. Only the associated terminal closes.
  // Em sucesso (rc==0): merge branch->dev + push dev (a partir do repo base, sem conflito de checkout),
  // remove a junction node_modules (rmdir NAO segue), remove a worktree e a branch -> auto-cleanup do card.
  // Falha: pane fica aberta (Hold) p/ o BMS ver. Merge com conflito: worktree mantido p/ resolver.
  const wrapper = [
    'import subprocess,sys,os,shutil',
    'wt=sys.argv[1]; branch=sys.argv[2]; base=sys.argv[3]',
    'rc=subprocess.call([sys.executable,"-m","hermes_cli.main","-z",sys.argv[4]])',
    'if rc==0:',
    '\x20\x20\x20\x20try:',
    '\x20\x20\x20\x20\x20\x20\x20\x20os.chdir(base)',
    '\x20\x20\x20\x20\x20\x20\x20\x20mg=subprocess.run([r"GITBIN","merge",branch,"--no-edit"],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20if mg.returncode==0:',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20subprocess.run([r"GITBIN","push","origin","dev"],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20nj=os.path.join(wt,"node_modules")',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20try: os.rmdir(nj)',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20except OSError: shutil.rmtree(nj,ignore_errors=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20subprocess.run([r"GITBIN","worktree","remove","--force",wt],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20subprocess.run([r"GITBIN","branch","-D",branch],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20subprocess.run([r"WEZTERM_CLI_PLACEHOLDER","cli","kill-pane"],capture_output=True)',
    '\x20\x20\x20\x20\x20\x20\x20\x20else:',
    '\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20print("MERGE dev<-"+branch+" FALHOU (conflito?) - worktree mantido, verifica.")',
    '    except Exception as e:',
    '\x20\x20\x20\x20\x20\x20\x20\x20print("AUTO-CLEANUP FALHOU: %r - push/merge incompleto. Worktree e branch mantidas p/ inspecao." % (e,))',
    'sys.exit(rc)',
  ].join('\n').replace('WEZTERM_CLI_PLACEHOLDER', WEZTERM_CLI)
  const p = spawn(WEZTERM, ['start', '--', VENV_PY, '-c', wrapper.replace('GITBIN', GIT), wt, branch, ATLAS_REPO, prompt],
    { cwd: wt, detached: true, stdio: 'ignore', env: { ...process.env, HERMES_HOME } })
  p.on('error', e => { void fail('spawn wezterm falhou: ' + e.message) })
  p.unref()
}
function body(req: any) { return new Promise<any>(res => { let d=''; req.on('data', (c: Buffer)=>d+=c); req.on('end', ()=>{ try{res(JSON.parse(d||'null'))}catch{res(null)} }) }) }
async function readJ(p: string) { try { return JSON.parse(await readFile(p,'utf8')) } catch { return null } }
async function writeJ(p: string, v: any) { await writeFile(p, JSON.stringify(v,null,2), 'utf8'); syncVault() }
interface WD { slug: string; name: string; description: string; createdAt: number }
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

      // workdirs list / create
      if (parts[0] === 'workdirs' && parts.length === 1) {
        if (m === 'GET') { send(200, await readIdx()); return }
        if (m === 'POST') {
          const b = await body(req)
          if (!b || typeof b.name !== 'string' || !b.name.trim()) { send(400,{error:'name required'}); return }
          const idx = await readIdx()
          let slug = toSlug(b.name) || 'workdir'; let base = slug, i = 1
          while (idx.some(w => w.slug === base)) base = `${slug}-${i++}`
          const wd = { slug: base, name: b.name.trim(), description: (b.description||'').trim(), createdAt: Date.now() }
          idx.push(wd); await writeJ(join(DATA, INDEX), idx)
          const d = join(DATA, base); mkdirSync(d, { recursive: true })
          await writeJ(join(d,'meta.json'), { slug: base, name: wd.name, description: wd.description, createdAt: wd.createdAt })
          await writeJ(join(d,'notes.json'), [])
          await writeJ(join(d,'kanban.json'), { columns:[{id:'todo',name:'To Do'},{id:'doing',name:'Em Curso'},{id:'review',name:'Review/Revisão'},{id:'done',name:'Concluído'}], cards:[] })
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
          await writeJ(join(DATA, INDEX), idx)
          const meta = (await readJ(join(dir,'meta.json'))) || {}
          meta.name = wd.name; meta.description = wd.description
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
        // approve -> so de 'review'; merge dev->main antes de done
        if (card.colId !== 'review') { send(409, { error: 'card not in review' }); return }
        const mgr = await mergeDevToMain()
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
        const notes = (await readJ(join(DATA, slug, 'notes.json'))) || []
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
        await writeJ(join(DATA, slug, 'notes.json'), notes)
        send(200, { ok: true, addedCards, addedNotes, skipped, total: tasks.length })
        return
      }
      if (parts[0] === 'w' && parts.length === 3) {
        const slug = parts[1], kind = parts[2]
        if (!SLUG.test(slug) || !['notes','kanban','meta'].includes(kind)) { send(400,{error:'bad request'}); return }
        const file = join(DATA, slug, `${kind}.json`)
        if (!inside(DATA, file)) { send(400,{error:'bad path'}); return }
        if (m === 'GET') { send(200, (await readJ(file)) ?? (kind==='kanban'?{columns:[],cards:[]}:[])); return }
        if (m === 'PUT') { const b = await body(req); await writeJ(file, b); send(200,{ok:true}); return }
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
    configureServer(s) { s.middlewares.use(middleware) },
    configurePreviewServer(s) { s.middlewares.use(middleware) },
  }
}
