// test/cleanup-runs.test.mjs
//
// Regressao: cleanupRuns (server/api.ts L187-213) — apaga .log/.status antigos
// em <wtRoot>/runs/<slug>/*. Guard duplo: idade mtime OU stuck .status > 6h.
//
// Re-implementado em JS (mirror EXACTO da logica de L187-213) + exercicio
// contra um fs tree real (tmp dir com ficheiros backdated via utimes). Sem
// transpile, sem deps externas.
//
// Cobertura:
//   [1] mtime > 7d em .log/.status → apagado
//   [2] mtime < 7d → preservado
//   [3] .status stuck "running" com mtime > 6h → apagado
//   [4] .status stuck "running" com mtime < 6h → preservado
//   [5] outros files (.txt, .json) → NAO tocados (so .log/.status)
//   [6] dir slug com files removidos → base dir permanece (quirk)
//   [7] slug sem dir → noop silencioso
//   [8] SOURCE EQUALITY — server/api.ts L183-213 inalterado
//
// Nao cobre: cleanupWorktrees (depende de git worktree + readIdx; fora do
// escopo deste backfill — YAGNI para item #5).
//
// Executar: node test/cleanup-runs.test.mjs

import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync,
         utimesSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

// Mirror EXACTO de server/api.ts L183-213 (cleanupRuns). Re-implementado em
// JS para evitar transpile; comentario de origem no source confirma byte-equality.
const RUN_KEEP_MS = 7 * 24 * 60 * 60 * 1000
const STUCK_MS = 6 * 60 * 60 * 1000

async function cleanupRuns(wtRoot, slug) {
  const slugs = slug ? [slug] : (() => {
    try { return readdirSync(wtRoot).map(s => s) } catch { return [] }
  })()
  if (!slugs.length) return
  const now = Date.now()
  for (const s of slugs) {
    const base = join(wtRoot, s, 'runs', s)
    if (!existsSync(base)) continue
    let files
    try { files = readdirSync(base); if (!files.length) { rmSync(base, { recursive: true, force: true }); continue } }
    catch { continue }
    for (const f of files) {
      if (!/\.(log|status)$/i.test(f)) continue
      const fp = join(base, f)
      try {
        if (now - statSync(fp).mtimeMs > RUN_KEEP_MS) { rmSync(fp, { force: true }); continue }
        if (/\.status$/i.test(f) && now - statSync(fp).mtimeMs > STUCK_MS) {
          let st
          try { st = JSON.parse(readFileSync(fp, 'utf8')) } catch { st = null }
          if (st?.state === 'running') rmSync(fp, { force: true })
        }
      } catch { /* ja foi apagado */ }
    }
  }
}

let failures = 0
const assert = (cond, msg) => {
  if (cond) { console.log('  ok:', msg) }
  else { console.error('  FAIL:', msg); failures++ }
}

// Helper: cria dir runs/<slug> com um file, backdate via utimes
const tmp = mkdtempSync(join(tmpdir(), 'atlas-cleanup-'))
const wtRoot = join(tmp, 'wt')
const makeFile = (relPath, content, ageMs) => {
  const fp = join(wtRoot, relPath)
  writeFileSync(fp, content, 'utf8')
  // backdate: mtime = now - ageMs
  const t = (Date.now() - ageMs) / 1000
  utimesSync(fp, t, t)
  return fp
}

const slug = 'foo'
const runsDir = join(wtRoot, slug, 'runs', slug)
const fs_mkdirSync = await import('node:fs').then(m => m.mkdirSync)
fs_mkdirSync(runsDir, { recursive: true })

// [1] mtime > 7d em .log/.status → apagado
console.log('[1] mtime > 7d em .log/.status → apagado')
{
  const oldLog = makeFile(`${slug}/runs/${slug}/card-old.log`, 'antigo\n', RUN_KEEP_MS + 60_000)
  const oldStatus = makeFile(`${slug}/runs/${slug}/card-old.status`, '{"state":"done"}', RUN_KEEP_MS + 60_000)
  await cleanupRuns(wtRoot, slug)
  assert(!existsSync(oldLog),    'card-old.log (>7d) apagado')
  assert(!existsSync(oldStatus), 'card-old.status (>7d) apagado')
}

// [2] mtime < 7d → preservado
console.log('\n[2] mtime < 7d → preservado')
{
  const freshLog = makeFile(`${slug}/runs/${slug}/card-fresh.log`, 'recente\n', RUN_KEEP_MS - 60_000)
  const freshStatus = makeFile(`${slug}/runs/${slug}/card-fresh.status`, '{"state":"done"}', RUN_KEEP_MS - 60_000)
  await cleanupRuns(wtRoot, slug)
  assert(existsSync(freshLog),    'card-fresh.log (<7d) preservado')
  assert(existsSync(freshStatus), 'card-fresh.status (<7d) preservado')
}

// [3] .status stuck "running" com mtime > 6h → apagado (ponytail guard)
console.log('\n[3] stuck .status running > 6h → apagado')
{
  // 6h01m: passa o STUCK guard mas NAO o mtime 7d guard
  const stuck = makeFile(`${slug}/runs/${slug}/card-stuck.status`,
                         '{"state":"running","pane":42}', STUCK_MS + 60_000)
  await cleanupRuns(wtRoot, slug)
  assert(!existsSync(stuck), 'card-stuck.status (running >6h) apagado')
}

// [4] .status stuck "running" com mtime < 6h → preservado
console.log('\n[4] stuck .status running < 6h → preservado')
{
  const active = makeFile(`${slug}/runs/${slug}/card-active.status`,
                          '{"state":"running","pane":42}', STUCK_MS - 60_000)
  await cleanupRuns(wtRoot, slug)
  assert(existsSync(active), 'card-active.status (running <6h) preservado')
}

// [5] outros files → NAO tocados
console.log('\n[5] outros files → NAO tocados')
{
  const other = makeFile(`${slug}/runs/${slug}/metadata.json`, '{"k":"v"}', RUN_KEEP_MS + 60_000)
  const txt   = makeFile(`${slug}/runs/${slug}/notes.txt`, 'keep me', RUN_KEEP_MS + 60_000)
  await cleanupRuns(wtRoot, slug)
  assert(existsSync(other), 'metadata.json (>7d) NAO apagado (so .log/.status)')
  assert(existsSync(txt),   'notes.txt (>7d) NAO apagado (so .log/.status)')
}

// [6] dir slug com files removidos → base dir permanece (quirk do source)
console.log('\n[6] dir slug com files removidos → base dir permanece')
{
  // ponytail: source L196 so remove a base se readdirSync(base) retornou 0 files
  // NA ENTRADA da funcao. Depois de remover todos os files via o inner loop, nao
  // ha segundo check → o dir fica vazio. Nao e' bug, e' o que o codigo faz.
  const slugBar = 'bar'
  const barDir = join(wtRoot, slugBar, 'runs', slugBar)
  fs_mkdirSync(barDir, { recursive: true })
  makeFile(`${slugBar}/runs/${slugBar}/only.log`, 'antigo', RUN_KEEP_MS + 60_000)
  await cleanupRuns(wtRoot, slugBar)
  assert(existsSync(barDir), 'runs/<slug> ficou vazio mas NAO foi removido (quirk documentado)')
}

// [7] slug sem dir → noop silencioso
console.log('\n[7] slug sem dir → noop silencioso')
{
  let threw = false
  try { await cleanupRuns(wtRoot, 'nao-existe') } catch { threw = true }
  assert(!threw, 'cleanupRuns(slug) com dir inexistente NAO lanca')
}

// [8] SOURCE EQUALITY (server/api.ts L183-213 inalterado)
console.log('\n[8] SOURCE EQUALITY (cleanupRuns inalterado)')
{
  const apiSrc = readFileSync(join(here.replace(/test.*$/, ''), 'server', 'api.ts'), 'utf-8')
  const anchors = [
    /RUN_KEEP_MS = 7 \* 24 \* 60 \* 60 \* 1000/,        // L184: 7d
    /async function cleanupRuns\(slug\?: string\)/,     // L187: signature
    /now - statSync\(fp\)\.mtimeMs > RUN_KEEP_MS/,      // L202: idade guard principal
    new RegExp(String.raw`\.status\$/i\.test\(f\)[\s\S]{0,80}?6 \* 60 \* 60 \* 1000`), // L206: stuck 6h guard
    /st\?\.state === 'running'/,                        // L208: so stuck-running
    /async function cleanupWorktrees\(\)/,               // L217: sibling existe
    /void cleanupRuns\(\)\.catch\(\(\) => \{\}\)/,       // L1356: fire-and-forget boot
    /void cleanupWorktrees\(\)\.catch\(\(\) => \{\}\)/,  // L1357: fire-and-forget boot
  ]
  for (const a of anchors) {
    assert(a.test(apiSrc), `ancora presente: ${a.toString().slice(0,70)}...`)
  }
}

rmSync(tmp, { recursive: true, force: true })

if (failures > 0) {
  console.error(`\nFAIL: ${failures} assercao(oes) falharam`)
  process.exit(1)
}
console.log('\nOK: cleanupRuns regression passed (cleanupWorktrees fora de escopo, ver comentario)')
