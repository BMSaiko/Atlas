// test/_atlas-runtime.mjs
//
// Shared harness for atlas routes tests. Spins a Vite dev server in middleware
// mode + the real atlas-api plugin against a tempdir, returns a base URL +
// a req() helper. Teardown via closeServer(server).
//
// Why Vite (not a mirror): api.ts is the Vite plugin. Its middleware uses
// `s.middlewares.use(middleware)` from Vite's Connect instance, and the
// middleware itself is a const not exported. So the only way to call it
// is through Vite's configureServer. Vite + Node 22 strip-types is the
// lightest path; the alternative (mirror the whole middleware in tests)
// duplicates 1300 LOC.
//
// Why a TS loader: api.ts imports "./roadmap" and "./config" (no extension).
// Node 22 strip-types does not auto-resolve extensionless .ts. The
// _ts-loader.mjs hook rewrites those two specifiers to "./roadmap.ts" /
// "./config.ts" ONLY when the parent is server/api.ts. Belt-and-suspenders
// for tests that import api.ts; the other tests are unaffected because
// they import from .mjs.
//
// Why a per-test tempdir: cfg (server/config.ts) reads atlas.config.json
// from cwd. We write a minimal one pointing vault/hermesHome/atlasRepo at
// the tempdir, so each test sees an isolated filesystem and never touches
// the real vault. Defaults from config.ts point at real host paths; the
// config override is the only way to redirect them.
//
// Token-fence: middleware checks req.socket.remoteAddress. fetch from
// 127.0.0.1 is always loopback → PUT always passes. req() accepts a
// `remote` option that calls server.middlewares.handle() with a synthetic
// IncomingMessage whose .socket.remoteAddress is what the test wants.

import { register } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { IncomingMessage } from 'node:http'
import { Writable, PassThrough } from 'node:stream'

const here = dirname(fileURLToPath(import.meta.url))
// ponytail: only api.ts's ./roadmap|./config need rewriting; the rest of
// the repo's .ts files are imported by tests that pass .ts explicitly.
register(pathToFileURL(join(here, '_ts-loader.mjs')).href)

const vite = await import('vite')
let _apiModule = null
const apiUrl = new URL('./api.ts', `file:///${join(here, '..', 'server').replace(/\\/g, '/')}/`).href

// ponytail: real .ts files are loaded once per process. api.ts:11 captures
// `const DATA = join(process.cwd(), 'data')` at import time, so subsequent
// spinAtlas() calls reuse the same DATA. The first spinAtlas() chdir's to
// its tempdir; all later spinAtlas() calls in the same process re-use that
// tempdir as DATA. Tests within a .test.mjs share the tempdir but use
// distinct slugs to avoid OT cross-talk.
//
// upgrade path: if tests need full isolation, clear `import()` cache between
// spinAtlas() calls. Not needed today.

let _sharedCwd = null

export async function spinAtlas(opts = {}) {
  // ponytail: reusa tempdir por processo. mkdtempSync cria novo, mas
  // pomos _sharedCwd sticky para o primeiro spinAtlas. Tests que precisam
  // isolamento full podem passar {fresh: true}.
  let cwd
  if (_sharedCwd && !opts.fresh) { cwd = _sharedCwd }
  else { cwd = mkdtempSync(join(tmpdir(), opts.prefix || 'atlas-rt-')); _sharedCwd = cwd }
  mkdirSync(join(cwd, 'data'), { recursive: true })
  mkdirSync(join(cwd, 'public', 'icons'), { recursive: true })
  mkdirSync(join(cwd, 'logs', 'atlas'), { recursive: true })
  writeFileSync(join(cwd, 'atlas.config.json'), JSON.stringify({
    atlasRepo: opts.atlasRepo || cwd,
    vault: opts.vault || cwd,
    hermesHome: opts.hermesHome || cwd,
    wezterm: opts.wezterm || '',  // ponytail: empty -> /api/terms/open returns 503
  }))

  // ponytail: find a free port and pin it (strictPort). avoid 5173 collision
  // with a running dev server.
  const port = await new Promise((res, rej) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) })
    s.on('error', rej)
  })

  // ponytail: api.ts:11 -> const DATA = join(process.cwd(), 'data'). chdir
  // para o tempdir ANTES de importar api.ts. Em testes subsequentes (cwd
  // ja' e' o tempdir partilhado), o import vem do cache e DATA ja' e' o
  // tempdir. import() so e' chamado se a cache estiver vazia.
  const originalCwd = process.cwd()
  if (originalCwd !== cwd) process.chdir(cwd)
  let api
  if (!_apiModule) {
    _apiModule = await import(apiUrl)
  }
  api = _apiModule
  const server = await vite.createServer({
    root: cwd, configFile: false,
    server: { port, host: '127.0.0.1', strictPort: true, hmr: false },
    appType: 'custom', plugins: [api.default()],
  })
  await server.listen()
  const actualPort = server.httpServer.address().port
  const base = `http://127.0.0.1:${actualPort}`

  // ponytail: extract cfg.wtoken from the printed log line. api.ts logs
  // "[atlas] write token: <8chars>..." at boot. We could import api.ts
  // for cfg, but that hits module cache races between tests. The log scrape
  // is hacky but works without changing the source.
  // Better: poke the running server with /api/wtoken (loopback) and read token.
  // That's what we already do at test time.

  const handle = server.middlewares.handle.bind(server.middlewares)

  // fetch over real HTTP (loopback). Use this for any test where remoteAddress
  // doesn't matter (loopback bypasses token fence).
  async function req(method, path, body, headers = {}) {
    const opts = { method, headers: { ...headers } }
    if (body !== undefined) {
      opts.body = typeof body === 'string' ? body : JSON.stringify(body)
      opts.headers['content-type'] = opts.headers['content-type'] || 'application/json'
    }
    const r = await fetch(base + path, opts)
    let json = null
    const text = await r.text()
    try { json = JSON.parse(text) } catch {}
    return { status: r.status, json, text, headers: Object.fromEntries(r.headers) }
  }

  // In-process request with a spoofed remoteAddress. Use this for the
  // token fence and wtoken loopback tests, where the middleware reads
  // req.socket.remoteAddress.
  function reqRaw({ method, url, body, headers = {}, remote = '127.0.0.1' }) {
    return new Promise((resolve, reject) => {
      // ponytail: IncomingMessage needs a real Readable socket. Use a
      // PassThrough stream + .remoteAddress override. PassThrough is a
      // Readable that consumes the .push() calls below; its .destroy() is
      // a no-op so the IncomingMessage tears down cleanly.
      const fakeSocket = new PassThrough()
      fakeSocket.remoteAddress = remote
      const req = new IncomingMessage(fakeSocket)
      req.method = method
      req.url = url
      req.headers = { host: 'localhost', 'content-type': 'application/json', ...headers }
      // ponytail: middleware reads (req.socket as any).remoteAddress.
      const chunks = []
      const res = new Writable({ write(c, _e, cb) { chunks.push(c); cb() } })
      const out = { status: 0, headers: {}, body: '' }
      res.statusCode = 200
      res.setHeader = (k, v) => { out.headers[k.toLowerCase()] = v }
      res.writeHead = (code, hdrs) => { out.status = code; if (hdrs) for (const [k, v] of Object.entries(hdrs)) out.headers[k.toLowerCase()] = v }
      // ponytail: atlas middleware uses `res.statusCode = 401; res.end(JSON)`,
      // not `res.writeHead(401, ...)` (see send() at api.ts:694). Mirror
      // statusCode on end so out.status reflects reality (200 default too).
      res.write = (data, _enc, cb) => { chunks.push(Buffer.from(data)); if (cb) cb(); return true }
      const refreshStatus = () => { out.status = res.statusCode }
      res.writeHead = ((orig) => function(code, hdrs) { orig.call(res, code, hdrs); refreshStatus(); return res })(res.writeHead)
      res.end = (data) => {
        if (data) chunks.push(typeof data === 'string' ? Buffer.from(data) : data)
        refreshStatus()
        out.body = Buffer.concat(chunks).toString('utf8')
        try { out.json = JSON.parse(out.body) } catch {}
        resolve(out)
      }
      // ponytail: body() em api.ts faz `req.on('data', ...); req.on('end', ...)`. Esses
      // listeners adicionados DENTRO do middleware so recebem events se o stream
      // ainda estiver a fluir. PassThrough + push() upfront termina o stream antes
      // do middleware ver. Solucao: spawn um microtask que faz push DEPOIS do
      // handle() chamar a middleware (que adiciona listeners).
      const bodyBuf = body !== undefined ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) : null
      if (bodyBuf) {
        req.headers['content-length'] = String(bodyBuf.length)
        Promise.resolve().then(() => {
          if (bodyBuf) req.push(bodyBuf)
          req.push(null)
        })
      } else {
        Promise.resolve().then(() => req.push(null))
      }
      handle(req, res, (err) => {
        if (err) reject(err)
        else if (out.status === 0) resolve({ status: 0, headers: {}, body: '', json: null, note: 'next() — middleware did not respond' })
      })
    })
  }

  // ponytail: wtoken probe via /api/wtoken (loopback only). Captures the
  // current server's token. Tests that need it can re-fetch.
  async function wtoken() {
    const r = await req('GET', '/api/wtoken')
    return r.json?.token
  }

  async function close() {
    try { await server.close() } catch {}
    // ponytail: nao restauramos cwd — testes partilham o tempdir, e o
    // processo termina no fim. Se um test subsequente precisar de cwd
    // real, passa {fresh: true, prefix: 'atlas-iso-'}.
  }

  return { cwd, port: actualPort, base, req, reqRaw, wtoken, close }
}
