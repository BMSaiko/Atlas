// server/routes/w.ts
//
// ponytail: 20 routes under /api/w/* (Phase 2E of the backend refactor).
// Extracted verbatim from server/api.ts (baseline commit fc6331f). The
// bodies are 1:1 copies — no paraphrasing — so behaviour matches the
// pre-refactor middleware. Only the shell changed:
//   - the `if (parts[0] === 'w' && ...) { ... }` dispatch becomes a
//     Route entry in this table.
//   - inside the handler, the original locals (parts, req, send) are
//     re-bound from ctx at the top; everything below is unchanged.
//
// ORDER MATTERS. The first matching route wins (dispatcher is linear).
// The file order here matches the original inline order, so:
//   - /w/:slug/notes|kanban|bundle (the catch-all at #19) only fires
//     if no earlier specific block matched.
//   - /w/:slug meta (#20, length=2) is last; nothing else matches length 2.
//
// ponytail: handler bodies are NOT unit-tested here. The harness
// (test/_atlas-harness.mjs) drives real launchHermes/launchDp/launchBrainstorm
// paths; integration tests cover the rest. This file ships a smoke test
// (test/routes-w.test.mjs) that asserts ALL_ROUTES contains the 20 names
// and dispatch returns true for each — that catches the refactor's
// catastrophic failure modes (missing entry, wrong order, broken signature).

import type { Route } from "../routes"
import { mkdirSync, readdirSync, statSync, existsSync } from "node:fs"
import { rm, readFile, writeFile } from "node:fs/promises"
import { join, dirname, resolve, sep, delimiter, normalize, extname, relative } from "node:path"

export const ROUTES: Route[] = [
  {
    method: "POST",
    length: 4,
    match: ["w", null, "review", "approve-agent"],
    name: "w:review:approve-agent",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts, req, m, res } = ctx
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
          const slug = parts[1]
          if (!SLUG.test(slug)) { send(400, { error: 'bad slug' }); return }
          const b = (await deps.readJsonBody(req)) || {}
          const id = typeof b.cardId === 'string' ? b.cardId : ''
          const file = join(DATA, slug, 'kanban.json')
          if (!inside(DATA, file) || !id) { send(400, { error: 'bad request' }); return }
          const board = await readJ(file)
          const card = board?.cards?.find((c: any) => c.id === id)
          if (!card) { send(404, { error: 'card not found' }); return }
          if (card.archived) { send(409, { error: 'card archived' }); return }
          if (card.colId !== 'review') { send(409, { error: 'card not in review' }); return }
          const repo = await repoDir(slug)
          const gate = await runCIGate(repo)
          if (!gate.ok) { send(500, { error: 'CI gate falhou (' + gate.step + '): ' + gate.out }); return }
          // fecha pane wezterm cedo — runner nao toca em nada vivo (best-effort, idempotente)
          void killPaneForCard(slug, card.id)
          const title = 'Approve review: ' + (card.title || '')
          const logPath = join(wtRoot(repo), 'runs', slug, 'merge-approve.log')
          const stPath = join(wtRoot(repo), 'runs', slug, 'merge-approve.status')
          const prompt = interpolate(await loadPrompt('merge-approve'), {
            slug, repo, cardId: id, kanbanPath: file, apiUrl: '/api/w/' + slug + '/kanban', logPath, title,
          })
          void spawnHeadless(repo, logPath, stPath, title + ' — agente headless a arrancar…', prompt)
          send(200, { ok: true, mode: 'agent', logPath })
          return
    },
  },
  {
    method: "POST",
    length: 4,
    match: ["w", null, "review", null],
    name: "w:review",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts, req, m, res } = ctx
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
          const slug = parts[1], action = parts[3]
          if (action !== 'approve' && action !== 'reject') { send(400,{error:'bad action'}); return }
          const b = (await deps.readJsonBody(req)) || {}
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
    },
  },
  {
    method: "POST",
    length: 3,
    match: ["w", null, "run"],
    name: "w:run",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts, req, m, res } = ctx
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
          const slug = parts[1]
          const b = (await deps.readJsonBody(req)) || {}
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
    },
  },
  {
    method: "POST",
    length: 3,
    match: ["w", null, "brainstorm"],
    name: "w:brainstorm",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts, req, m, res } = ctx
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
          const slug = parts[1]
          if (!SLUG.test(slug)) { send(400, { error: 'bad request' }); return }
          void launchBrainstorm(slug).catch((e: any) => console.error('[brainstorm] ' + slug + ': ' + e.message))
          send(200, { ok: true }); return
    },
  },
  {
    method: "POST",
    length: 3,
    match: ["w", null, "dp"],
    name: "w:dp",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts, req, m, res } = ctx
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
          const slug = parts[1]
          if (!SLUG.test(slug)) { send(400, { error: 'bad request' }); return }
          const b = (await deps.readJsonBody(req)) || {}
          const id = typeof b.cardId === 'string' ? b.cardId : ''
          if (!id) { send(400, { error: 'cardId required' }); return }
          const file = join(DATA, slug, 'kanban.json')
          const board = await readJ(file)
          const card = board?.cards?.find((c: any) => c.id === id)
          if (!card) { send(404, { error: 'card not found' }); return }
          if (card.archived) { send(409, { error: 'card archived' }); return }
          void launchDp(slug, card).catch((e: any) => console.error('[dp] ' + slug + ': ' + e.message))
          send(200, { ok: true })
          return
    },
  },
  {
    method: "POST",
    length: 3,
    match: ["w", null, "cleanup"],
    name: "w:cleanup",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts, req, m, res } = ctx
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
          const slug = parts[1]
          if (!SLUG.test(slug)) { send(400, { error: 'bad request' }); return }
          await cleanupRuns(slug); await cleanupWorktrees()
          send(200, { ok: true }); return
    },
  },
  {
    method: "GET",
    length: 3,
    match: ["w", null, "orphans"],
    name: "w:orphans",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts, req, m, res } = ctx
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
          const slug = parts[1]
          if (!SLUG.test(slug)) { send(400, { error: 'bad request' }); return }
          const STALE_MS = 5 * 60 * 1000  // ponytail: 5min (era 90s) â workers lentos OK, o que para e nao escreve log no .log e crash real
          const now = Date.now()
          const board = await readJ(join(DATA, slug, 'kanban.json')).catch(() => null)
          if (!board) { send(200, { orphans: [] }); return }
          const repo = await repoDir(slug)
          const runsDir = join(wtRoot(repo), 'runs', slug)
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
            // ponytail: enriquecimento h1y3yfsy â logTail (5 linhas ou 500ch), lastHeartbeatAt (worker ainda
            // vivo?), orphanWorktreePath (worktree a inspeccionar), classification (string para o user),
            // statusState (eco do .status.state). Tudo read-only — classificacao aqui Ã© informativa; a
            // canonical classification vem do POST /orphans/ack (que escreve no card).
            let logTail = ''
            try {
              const txt = _sanitizeText(await readFile(logPath, 'utf8'))
              const lines = txt.split('\n')
              logTail = lines.slice(-5).join('\n').slice(-500)
            } catch { /* no log */ }
            const lastHeartbeatAt = typeof st.lastHeartbeatAt === 'number' ? st.lastHeartbeatAt : null
            const wtDir = join(wtRoot(repo), slug, c.id)
            const orphanWorktreePath = existsSync(wtDir) ? wtDir : null
            const classification = (() => {
              if (st.state === 'merge-failed') return 'CRASH_MERGE_FAILED'
              if (logSize === 0 && lastHeartbeatAt === null) return 'CRASH_WRAPPER_DIED'
              if (lastHeartbeatAt !== null && (now - lastHeartbeatAt) > STALE_MS) return 'CRASH_HERMES_STUCK'
              if (logSize > 0 && logMtime > 0 && (now - logMtime) > STALE_MS) return 'CRASH_HERMES_STUCK'
              // ponytail: card h1y3yfsy R2/Q5 — log vazio mas heartbeat fresco = wrapper arrancou mas worker nao escreveu. R2/Q5 chama isto CRASH_TRANSIENT.
              return 'CRASH_TRANSIENT'
            })()
            orphans.push({
              cardId: c.id,
              title: c.title,
              priority: c.priority,
              startedAt: c.startedAt,
              logSize,
              logMtime: logMtime || null,
              stMtime: stMtime || null,
              cardAgeMs: cardAge,
              statusState: st.state,
              lastHeartbeatAt,
              logTail,
              orphanWorktreePath,
              classification,
            })
          }
          send(200, { orphans }); return
    },
  },
  {
    method: "POST",
    length: 4,
    match: ["w", null, "orphans", "ack"],
    name: "w:orphans:ack",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts, req, m, res } = ctx
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
          const slug = parts[1]
          if (!SLUG.test(slug)) { send(400, { error: 'bad request' }); return }
          const b = await deps.readJsonBody(req)
          const cardIds = Array.isArray(b?.cardIds) ? b.cardIds.filter((x: any) => typeof x === 'string') : []
          if (!cardIds.length) { send(400, { error: 'cardIds required' }); return }
          const board = await readJ(join(DATA, slug, 'kanban.json')).catch(() => null)
          if (!board) { send(404, { error: 'board not found' }); return }
          const repo = await repoDir(slug)
          const runsDir = join(wtRoot(repo), 'runs', slug)
          const now = Date.now()
          const STALE_MS = 5 * 60 * 1000  // ponytail: 5min (mesmo threshold do GET /orphans)
          const results: any[] = []
          let mutated = false
          for (const cardId of cardIds) {
            const c = (board.cards || []).find((x: any) => x.id === cardId)
            if (!c) { results.push({ cardId, ok: false, reason: 'card not found' }); continue }
            if (c.archived) { results.push({ cardId, ok: false, reason: 'archived' }); continue }
            if (c.colId !== 'doing') { results.push({ cardId, ok: false, reason: 'not doing (idempotent skip)', currentColId: c.colId }); continue }
            const stPath = join(runsDir, c.id + '.status')
            const st = await readJ(stPath).catch(() => null)
            const logPath = join(runsDir, c.id + '.log')
            let logSize = 0, logMtime = 0
            try { const s = statSync(logPath); logSize = s.size; logMtime = s.mtimeMs } catch { /* no log */ }
            let logTail = ''
            try {
              const txt = _sanitizeText(await readFile(logPath, 'utf8'))
              logTail = txt.split('\n').slice(-5).join('\n').slice(-200)
            } catch { /* no log */ }
            const lastHeartbeatAt = typeof st?.lastHeartbeatAt === 'number' ? st.lastHeartbeatAt : null
            const wtDir = join(wtRoot(repo), slug, c.id)
            const orphanWorktreePath = existsSync(wtDir) ? wtDir : null
            const classification = (() => {
              if (st?.state === 'merge-failed') return 'CRASH_MERGE_FAILED'
              if (logSize === 0 && lastHeartbeatAt === null) return 'CRASH_WRAPPER_DIED'
              if (lastHeartbeatAt !== null && (now - lastHeartbeatAt) > STALE_MS) return 'CRASH_HERMES_STUCK'
              if (logSize > 0 && logMtime > 0 && (now - logMtime) > STALE_MS) return 'CRASH_HERMES_STUCK'
              // ponytail: card h1y3yfsy R2/Q5 — log vazio mas heartbeat fresco = wrapper arrancou mas worker nao escreveu. R2/Q5 chama isto CRASH_TRANSIENT.
              return 'CRASH_TRANSIENT'
            })()
            c.colId = 'todo'
            delete c.startedAt
            c.crashRetry = true
            c.crashAt = now
            if (orphanWorktreePath) c.orphanWorktreePath = orphanWorktreePath
            if (!c.result) c.result = classification + ': ' + (logTail || '(log vazio)')
            results.push({ cardId, ok: true, classification, orphanWorktreePath })
            mutated = true
          }
          if (mutated) { board.ver = (board.ver || 0) + 1; await writeJ(join(DATA, slug, 'kanban.json'), board) }
          send(200, { ok: true, results, mutated })
          return
    },
  },
  {
    method: "POST",
    length: 5,
    match: ["w", null, "cards", null, "clear-orphan"],
    name: "w:cards:clear-orphan",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts, req, m, res } = ctx
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
          const slug = parts[1], cardId = parts[3]
          if (!SLUG.test(slug)) { send(400, { error: 'bad request' }); return }
          const repo = await repoDir(slug)
          const file = join(DATA, slug, 'kanban.json')
          const board = await readJ(file).catch(() => null)
          if (!board) { send(404, { error: 'board not found' }); return }
          const c = (board.cards || []).find((x: any) => x.id === cardId)
          if (!c) { send(404, { error: 'card not found' }); return }
          const wt = c.orphanWorktreePath
          if (!wt) { send(404, { error: 'no orphan worktree on this card' }); return }
          // ponytail: reusa runGit/rmJunction (cleanupWorktrees ja' faz isto, mas so' para wt's merged).
          // Aqui o wt e' o'rf~ao (state=running no .status); remove a' mao com --force e apaga o junction.
          await rmJunction(join(wt, 'node_modules')).catch(() => {})
          await runGit(['worktree', 'remove', '--force', wt], repo).catch(() => {})
          await rm(wt, { recursive: true, force: true }).catch(() => {})
          await runGit(['worktree', 'prune'], repo).catch(() => {})
          delete c.orphanWorktreePath
          board.ver = (board.ver || 0) + 1
          await writeJ(file, board)
          send(200, { ok: true, cleared: wt })
          return
    },
  },
  {
    method: "GET",
    length: 4,
    match: ["w", null, "output", null],
    name: "w:output",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts, req, m, res } = ctx
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
          const url = new URL(req.url || '/', 'http://localhost')
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
          try { full = _sanitizeText(await readFile(logPath, 'utf8')) } catch { full = '' }
          const done = st2.state !== 'running'
          // ponytail: envia chunk desde o offset e reporta a posicao nova p/ o cliente pedir so o delta
          const chunk = full.slice(offset)
          send(200, { ok: true, started, done, code: done ? (st2.code ?? 0) : null, chunk, offset: offset + chunk.length, size: full.length })
          return
    },
  },
  {
    method: "POST",
    length: 4,
    match: ["w", null, "git", "merge-main"],
    name: "w:git:merge-main",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts, req, m, res } = ctx
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
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
          void launchGitOp(slug, 'merge-main', 'Merge dev->main', task).catch((e: any) => console.error('[git-merge] ' + slug + ': ' + e.message))
          send(200, { ok: true }); return
    },
  },
  {
    method: "POST",
    length: 4,
    match: ["w", null, "git", "resolve"],
    name: "w:git:resolve",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts, req, m, res } = ctx
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
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
          void launchGitOp(slug, 'resolve-conflict', 'Resolve merge conflito', task).catch((e: any) => console.error('[git-resolve] ' + slug + ': ' + e.message))
          send(200, { ok: true }); return
    },
  },
  {
    method: "POST",
    length: 3,
    match: ["w", null, "import-roadmap"],
    name: "w:import-roadmap",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts, req, m, res } = ctx
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
          const slug = parts[1]
          const file = join(DATA, slug, 'kanban.json')
          if (!SLUG.test(slug) || !inside(DATA, file)) { send(400, { error: 'bad request' }); return }
          const b = (await deps.readJsonBody(req)) || {}
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
    },
  },
  {
    method: "*",
    length: 3,
    match: ["w", null, "bundle"],
    name: "w:bundle",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts, req, m, res } = ctx
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
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
            const b = (await deps.readJsonBody(req)) || {}
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
    },
  },
  {
    method: "*",
    length: 3,
    match: ["w", null, "snapshots"],
    name: "w:snapshots",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts, req, m, res } = ctx
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
          const slug = parts[1]
          if (!SLUG.test(slug)) { send(400, { error: 'bad slug' }); return }
          if (m === 'GET') { send(200, await listSnapshots(slug)); return }
          send(200, await tickSnapshot(slug)); return
    },
  },
  {
    method: "POST",
    length: 5,
    match: ["w", null, "snapshots", null, "restore"],
    name: "w:snapshots:restore",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts, req, m, res } = ctx
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
          const slug = parts[1], slot = decodeURIComponent(parts[3])
          if (!SLUG.test(slug)) { send(400, { error: 'bad slug' }); return }
          const r = await restoreSnapshot(slug, slot)
          if (!r.ok) { send(404, { error: 'snapshot nao encontrado' }); return }
          syncVault()  // ponytail: commit do estado restaurado para a vault apanhar.
          send(200, r); return
    },
  },
  {
    method: "GET",
    length: 6,
    match: ["w", null, "snapshots", null, "file", null],
    name: "w:snapshots:file",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts, req, m, res } = ctx
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
          const slug = parts[1], slot = decodeURIComponent(parts[3]), name = parts[5]
          if (!SLUG.test(slug)) { send(400, { error: 'bad slug' }); return }
          const buf = await getSnapshotFile(slug, slot, name)
          if (!buf) { send(404, { error: 'file not found' }); return }
          res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.end(buf); return
    },
  },
  {
    method: "POST",
    length: 3,
    match: ["w", null, "export"],
    name: "w:export",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts, req, m, res } = ctx
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
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
    },
  },
  {
    method: "*",
    length: 3,
    match: ["w", null, null],
    name: "w:notes-kanban-bundle",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts, req, m, res } = ctx
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
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
        // ponytail: SP atlas-calendar-2026-09-05 — calendar events handler. Flat array, no `ver`,
        // no OT/wipe (events.json is user-private calendar data; lossy on PUT is fine — it's a
        // "save whole state" model). PUT body shape: {events: CalendarEvent[]}.
        if (kind === 'events') {
          const file = join(DATA, slug, 'events.json')
          if (!inside(DATA, file)) { send(400,{error:'bad path'}); return }
          if (m === 'GET') { send(200, (await readJ(file)) ?? { events: [] }); return }
          if (m === 'PUT') {
            const b = await deps.readJsonBody(req)
            if (!b || typeof b !== 'object' || !Array.isArray(b.events)) { send(400, { error: 'invalid body: expected {events: [...]}' }); return }
            await writeJ(file, { events: b.events }); send(200, { ok: true }); return
          }
          send(405, { error: 'method not allowed' }); return
        }
        if (!['notes','kanban','meta'].includes(kind)) { send(400,{error:'bad request'}); return }
          const file = join(DATA, slug, `${kind}.json`)
          if (!inside(DATA, file)) { send(400,{error:'bad path'}); return }
          if (m === 'GET') { send(200, (await readJ(file)) ?? (kind==='kanban'?{ver:0,columns:[],cards:[]}:{ver:0,items:[]})); return }
          if (m === 'PUT') {
            const b = await deps.readJsonBody(req)
            // ponytail: guarda contra PUT vazio/invalido (card null-write-fix) — body() devolve null quando
            // Content-Length=0 ou JSON parse falha; sem guard, writeJ grava 'null' (4 bytes) e wipea kanban.json
            // (backup pre-PUT tambem fica vitima porque le o ficheiro ja corrompido). Wipe real observado em
            // 2026-09-01T03:43 — kanban com 117 cards -> 0 cards por um PUT acidental com body vazio.
            // Posicao: ANTES do OT check (L1212) para que body invalido nao faca 409 confuso (era 409 mas
            // a razao era "ver mismatch" e nao "body invalido" — debug enganador).
            if (!b || typeof b !== 'object') { send(400, { error: 'invalid body — expected JSON object' }); return }
            const arrKey2 = kind === 'notes' ? 'items' : (kind === 'kanban' ? 'cards' : null)
            if (arrKey2 && !Array.isArray(b[arrKey2])) { send(400, { error: 'invalid body: missing or non-array ' + arrKey2 }); return }
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
                  // ponytail: snapshot do estado recusado em _wipe-guard/ (isento do prune) para o user
                  // poder inspecionar ou restaurar manualmente. Caminho devolvido na mensagem 409.
                  let guardPath = ''
                  try { guardPath = await writeWipeGuardSnapshot(slug, kind, cur) } catch { /* best-effort */ }
                  send(409, {
                    error: 'wipe detetado: ' + loss + ' ' + arrKey + ' perdidos (de ' + beforeCount + ' para ' + afterCount + ', threshold ' + threshold + '). Estado anterior guardado em data/_snapshots/' + slug + '/' + guardPath + '. Confirma com header X-Atlas-Confirm-Wipe: yes para prosseguir.',
                    before: beforeCount, after: afterCount, loss, threshold, guardPath
                  }); return
                }
              }
              // ponytail: pre-PUT backup removido. Snapshots sao cron-based (4/dia, retenção 7d, dedup por hash) — ver server/snapshots.ts. Wipe guard continua a fazer o seu one-time snapshot do estado recusado em _wipe-guard/.
            }
            // ponytail: defesa — brainstorm/import/PUT manual pode trazer items sem `id`; sem id os
            // handlers de click/data-id no cliente não resolvem nada. Sanitize em vez de 400.
            if (kind === 'notes' && Array.isArray(b.items)) {
              let missing = 0
              for (const it of b.items) {
                if (!it || typeof it !== 'object') continue
                if (!it.id || (typeof it.id === 'string' && !it.id.trim())) { it.id = nid(); missing++ }
              }
              if (missing) console.warn('[atlas] note sem id — sanitize:', slug, 'added=' + missing)
            }
            await writeJ(file, b); send(200,{ok:true, ver: (b && typeof b === 'object') ? (Number(b.ver) || 0) : 0}); return
          }
    },
  },
  {
    method: "GET",
    length: 2,
    match: ["w", null],
    name: "w:meta",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts, req, m, res } = ctx
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
          const slug = parts[1]; send(200, (await readJ(join(DATA, slug, 'meta.json'))) || { error:'not found' }); return
    },
  },
]