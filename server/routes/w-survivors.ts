// server/routes/w-survivors.ts
//
// ponytail: survivors of the former server/routes/w.ts after strip-kanban (2026-09-05).
// Only the /api/w/* routes that DON'T drive the (now removed) feature remain:
//   - w:bundle                *    /api/w/:slug/bundle
//   - w:snapshots             GET  /api/w/:slug/snapshots
//   - w:snapshots:restore     POST /api/w/:slug/snapshots/:slot/restore
//   - w:snapshots:file        GET  /api/w/:slug/snapshots/:slot/file/:name
//   - w:export                POST /api/w/:slug/export                 (notes -> docs/notas.md)
//   - w:notes-events-bundle   *    /api/w/:slug/{notes|templates|events|meta}
//                              ^ catches everything; rejects the legacy kind with 410.
//   - w:meta                  GET  /api/w/:slug                        (read meta.json)
//
// Removed routes (former feature + workflow): w:review*, w:run, w:runs:pid, w:kanban:*,
// w:brainstorm, w:dp, w:cleanup, w:orphans*, w:cards:clear-orphan, w:output, w:git:*, w:import-roadmap.
//
// ORDER preserved from original w.ts. w:notes-events-bundle is length-3 wildcard and runs after
// the more-specific matches (bundle/snapshots*/export). w:meta (length 2) runs last.

import type { Route } from "../routes"
import { mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { join, dirname } from "node:path"

export const ROUTES: Route[] = [
  {
    method: "*",
    length: 3,
    match: ["w", null, "bundle"],
    name: "w:bundle",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts, req, m, res } = ctx
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, killWorkerForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
          const slug = parts[1]
          if (!SLUG.test(slug)) { send(400, { error: 'bad request' }); return }
          const dir = join(DATA, slug)
          const metaFile = join(dir, 'meta.json'), notesFile = join(dir, 'notes.json'), kanbanFile = join(dir, 'kanban.json')
          if (!inside(DATA, metaFile) || !inside(DATA, notesFile) || !inside(DATA, kanbanFile)) { send(400, { error: 'bad path' }); return }
          if (m === 'GET') {
            const meta = await readJ(metaFile) || {}
            const notes = await readJ(notesFile) || { ver: 0, items: [] }
            // ponytail: kanban field kept in bundle response for restore-compat (old bundles still load).
            const kanban = await readJ(kanbanFile) || { ver: 0, columns: [], cards: [] }
            send(200, { slug, meta, notes, kanban, ts: Date.now() }); return
          }
          if (m === 'PUT') {
            const b = (await deps.readJsonBody(req)) || {}
            // ponytail: valida shape minimo (recusar bundle malformado NAO sobrescreve estado). Aceita
            // {meta, notes, kanban?} no payload. kanban e' opcional (compat). Faltar meta/notes -> 400.
            if (!b || typeof b !== 'object' || !('meta' in b) || !('notes' in b)) {
              send(400, { error: 'bundle invalido: requer meta+notes' }); return
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
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, killWorkerForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
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
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, killWorkerForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
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
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, killWorkerForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
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
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, killWorkerForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
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
    name: "w:notes-events-bundle",
    handler: async (ctx) => {
      const { deps = {} as any, send, parts, req, m, res } = ctx
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
          const slug = parts[1], kind = parts[2]
          if (!SLUG.test(slug)) { send(400,{error:'bad request'}); return }
        // ponytail: 2026-09-05 — legacy 'kanban' kind no longer served (feature removed); reject with 410 Gone.
        if (kind === 'kanban') { send(410, { error: 'feature descontinuada em 2026-09-05' }); return }
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
        if (!['notes','meta'].includes(kind)) { send(400,{error:'bad request'}); return }
          const file = join(DATA, slug, `${kind}.json`)
          if (!inside(DATA, file)) { send(400,{error:'bad path'}); return }
          if (m === 'GET') { send(200, (await readJ(file)) ?? {ver:0,items:[]}); return }
          if (m === 'PUT') {
            const b = await deps.readJsonBody(req)
            // ponytail: guarda contra PUT vazio/invalido (card null-write-fix) — body() devolve null quando
            // Content-Length=0 ou JSON parse falha; sem guard, writeJ grava 'null' (4 bytes) e wipea kanban.json
            // (backup pre-PUT tambem fica vitima porque le o ficheiro ja corrompido). Wipe real observado em
            // 2026-09-01T03:43 — kanban com 117 cards -> 0 cards por um PUT acidental com body vazio.
            // Posicao: ANTES do OT check (L1212) para que body invalido nao faca 409 confuso (era 409 mas
            // a razao era "ver mismatch" e nao "body invalido" — debug enganador).
            if (!b || typeof b !== 'object') { send(400, { error: 'invalid body — expected JSON object' }); return }
            const arrKey2 = 'items'
            if (arrKey2 && !Array.isArray(b[arrKey2])) { send(400, { error: 'invalid body: missing or non-array ' + arrKey2 }); return }
            // optimistic concurrency (card: optimistic concurrency no PUT): o client deve enviar o `ver`
            // que leu; se o ficheiro em disco ja avancou, outro escritor ganhou -> 409 p/ o client re-sync.
            // meta nao entra (nao e reescrito em corrida por agents) — so notes valida.
            if (kind === 'notes') {
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

              // ponytail: fence anti-wipe (card iykn11lg+) - detect drop drastico no numero de items/cards
              // e exige header X-Atlas-Confirm-Wipe para confirmar (defesa em profundidade: protege contra
              // PUTs de testes/scripts que mandam items/cards vazios e destroem o trabalho). Threshold:
              // - perdoa ate 5 items de perda (uso normal: arquivar 1-2 notas + delete 1 = OK)
              // - perdoa ate 50% de perda (uso normal: arquivar metade do backlog e OK)
              // - EXIGE confirmacao se perder mais de max(5, before*0.5) items. Auto-backup do estado
              //   anterior SEMPRE (rollback manual se o wipe foi acidental).
              const arrKey = 'items'
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
        const { DATA, HERMES_HOME, SLUG, VAULT, _sanitizeText, cleanupRuns, cleanupWorktrees, getSnapshotFile, inside, interpolate, killPaneForCard, killWorkerForCard, launchBrainstorm, launchDp, launchGitOp, launchHermes, listSnapshots, loadPrompt, mergeDevToMain, nid, parseRoadmap, readFile, readJ, repoDir, restoreSnapshot, rmJunction, runCIGate, runGit, sanitize, slotFor, spawnHeadless, syncVault, tickAll, tickSnapshot, writeJ, writeWipeGuardSnapshot, wtRoot } = deps
          const slug = parts[1]; send(200, (await readJ(join(DATA, slug, 'meta.json'))) || { error:'not found' }); return
    },
  }
]
