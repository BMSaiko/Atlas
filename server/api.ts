import type { Plugin, Connect } from 'vite'
import { existsSync, mkdirSync } from 'node:fs'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join, normalize, extname, relative, sep } from 'node:path'

const DATA = join(process.cwd(), 'data')
const SLUG = /^[a-z0-9-]+$/
const INDEX = 'index.json'
const WEZTERM = process.env.WEZTERM || 'C:\\Program Files\\WezTerm\\wezterm-gui.exe'
const VENV_PY = process.env.HERMES_PY || 'C:\\Users\\bruno\\Documents\\hermes-agent\\.venv\\Scripts\\python.exe'
const HERMES_CWD = process.env.HERMES_CWD || 'C:\\Users\\bruno\\Documents\\hermes-agent'
const HERMES_HOME = process.env.HERMES_LIVE_HOME || 'C:\\Users\\bruno\\AppData\\Local\\hermes'


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
function body(req: any) { return new Promise<any>(res => { let d=''; req.on('data', (c: Buffer)=>d+=c); req.on('end', ()=>{ try{res(JSON.parse(d||'null'))}catch{res(null)} }) }) }
async function readJ(p: string) { try { return JSON.parse(await readFile(p,'utf8')) } catch { return null } }
async function writeJ(p: string, v: any) { await writeFile(p, JSON.stringify(v,null,2), 'utf8') }
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
          await writeJ(join(d,'kanban.json'), { columns:[{id:'todo',name:'To Do'},{id:'doing',name:'Em Curso'},{id:'done',name:'Concluído'}], cards:[] })
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
        await writeJ(file, board)
        const prompt = [
          'Tu es um agente autonomo. Executa o trabalho abaixo do card de kanban e atualiza o estado.',
          `Workdir: ${slug}`,
          `Kanban JSON (em disco): ${join(DATA, slug, 'kanban.json')}`,
          `Kanban API (para updates): http://localhost:5173/api/w/${slug}/kanban`,
          '',
          `CARTAO: ${card.title}`,
          '',
          'TAREFA:',
          card.description || '(sem descricao)',
          '',
          'REGRAS:',
          '- A inicios marca o teu card como "doing" (ja feito) e mantem-no ai.',
          '- Durante o progresso, atualiza o kanban.json/API para refletir o estado real.',
          '- NUNCA marques o teu card como "done"/concluido. So o BMS conclui apos validar na branch dev.',
          '- No fim, ATUALIZA o teu card no kanban.json com um campo `result`: um resumo breve do que fizeste. Deixa o card em "doing".',
        ].join('\n')
        const p = spawn(WEZTERM, ['start', '--', VENV_PY, '-m', 'hermes_cli.main', '-z', prompt],
          { cwd: HERMES_CWD, detached: true, stdio: 'ignore', env: { ...process.env, HERMES_HOME } })
        p.unref()
        send(200, { ok: true })
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
