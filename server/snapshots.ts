// server/snapshots.ts
// ponytail: snapshot engine — 4 slots/dia @ 00/06/12/18 UTC, retenção 7d, dedup por hash.
// Stack: stdlib only. setInterval no server/api.ts chama tickAll() a cada hora; tickAll()
// distribui por slug. Wipe guard escreve em _wipe-guard/ no mesmo root (prune exclui essa dir).
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = join(process.cwd(), 'data', '_snapshots')   // um sitio so, prune num loop
const DATA = join(process.cwd(), 'data')
const KINDS = ['meta', 'notes', 'kanban'] as const  // ponytail: kanban kept for restore-compat (old slots still restore this file)
export type Kind = typeof KINDS[number]
const KEEP_SLOTS = 28  // 4 slots/dia × 7 dias

export function slotFor(d = new Date()): string {
  // UTC para alinhar com a hora do servidor; slot = 4 janelas de 6h.
  const h = d.getUTCHours()
  const slot = h < 6 ? '00-00' : h < 12 ? '06-00' : h < 18 ? '12-00' : '18-00'
  return `${d.toISOString().slice(0, 10)}/${slot}`
}

async function hashFile(p: string): Promise<string> {
  // ponytail: 16 hex chars (64 bits) é collision-safe para ≤4B ficheiros; 32 chars era paranoia.
  return createHash('sha256').update(await readFile(p)).digest('hex').slice(0, 16)
}

async function writeSlot(slug: string, slot: string, preRestoreOf?: string): Promise<{ deduped: boolean; size: number }> {
  const dir = join(ROOT, slug, slot)
  mkdirSync(dir, { recursive: true })
  let deduped = true, size = 0
  const files: Record<string, any> = {}
  for (const k of KINDS) {
    const src = join(DATA, slug, `${k}.json`)
    if (!existsSync(src)) { files[k] = null; continue }
    const dst = join(dir, `${k}.json`)
    const h1 = await hashFile(src)
    if (existsSync(dst) && (await hashFile(dst)) === h1) {
      // ponytail: hash dedup = 0 bytes se nada mudou no file.
      const sz = statSync(dst).size; files[k] = { hash: h1, size: sz }; size += sz
      continue
    }
    // ponytail: atomic-ish — escreve para tmp e renomeia. Sem isto, crash a meio deixa
    // snapshot meio-escrito e o restore fica silenciosamente corrupto.
    const tmp = dst + '.tmp'
    const buf = await readFile(src); await writeFile(tmp, buf); await rename(tmp, dst)
    files[k] = { hash: h1, size: buf.length }; size += buf.length
    deduped = false
  }
  const manifest: any = { slot, ts: Date.now(), files }
  if (preRestoreOf) manifest.preRestoreOf = preRestoreOf
  await writeFile(join(dir, '_manifest.json'), JSON.stringify(manifest))
  return { deduped, size }
}

export async function tickSnapshot(slug: string): Promise<{ ok: boolean; slot: string; deduped: boolean; pruned: number }> {
  const slot = slotFor()
  const r = await writeSlot(slug, slot)
  const pruned = await prune(slug)
  return { ok: true, slot, deduped: r.deduped, pruned }
}

// ponytail: itera todos os workdirs no boot e a cada 1h. setInterval fica no api.ts.
export async function tickAll(slugs: string[]): Promise<void> {
  for (const s of slugs) await tickSnapshot(s).catch(() => { /* best-effort */ })
}

async function prune(slug: string): Promise<number> {
  // ponytail: _wipe-guard/ é isenta — guarda o snapshot do wipe recusado até limpeza manual.
  const slugDir = join(ROOT, slug)
  if (!existsSync(slugDir)) return 0
  const all: { path: string; mtime: number }[] = []
  for (const day of readdirSync(slugDir)) {
    if (day === '_wipe-guard') continue
    const dayDir = join(slugDir, day)
    if (!statSync(dayDir).isDirectory()) continue
    for (const slot of readdirSync(dayDir)) {
      const p = join(dayDir, slot)
      try { all.push({ path: p, mtime: statSync(p).mtimeMs }) } catch {}
    }
  }
  all.sort((a, b) => b.mtime - a.mtime)
  let n = 0
  for (const s of all.slice(KEEP_SLOTS)) { try { await rm(s.path, { recursive: true, force: true }); n++ } catch {} }
  return n
}

export interface SnapEntry {
  slot: string          // "YYYY-MM-DD/HH-MM"
  ts: number            // epoch ms do manifest
  size: number          // soma dos 3 files
  files: Record<Kind, { hash: string; size: number } | null>
  preRestoreOf?: string // presente nos slots criados por restoreSnapshot
}

export async function listSnapshots(slug: string): Promise<SnapEntry[]> {
  // ponytail: itera recursivamente à procura de _manifest.json. Cada hit = 1 snapshot.
  // Caminho do slot = path do parent dir do manifest, normalizado (pre-restore = leaf, day/slot = nested).
  const slugDir = join(ROOT, slug)
  if (!existsSync(slugDir)) return []
  const out: SnapEntry[] = []
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const name of readdirSync(dir)) {
      if (name === '_wipe-guard') continue
      const p = join(dir, name)
      let st; try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) await walk(p, prefix ? `${prefix}/${name}` : name)
      else if (name === '_manifest.json') {
        try {
          const m = JSON.parse(await readFile(p, 'utf8'))
          let size = 0
          for (const v of Object.values(m.files)) if (v) size += (v as any).size
          out.push({ slot: prefix, ts: m.ts, size, files: m.files, preRestoreOf: m.preRestoreOf })
        } catch { /* manifest corrupto: skip */ }
      }
    }
  }
  await walk(slugDir, '')
  out.sort((a, b) => b.ts - a.ts)  // mais recente primeiro
  return out
}

export async function getSnapshotFile(slug: string, slot: string, name: string): Promise<Buffer | null> {
  if (!(KINDS as readonly string[]).includes(name)) return null  // trust boundary: whitelist
  const p = join(ROOT, slug, slot, `${name}.json`)
  if (!existsSync(p)) return null
  return await readFile(p)
}

export async function restoreSnapshot(slug: string, slot: string): Promise<{ ok: boolean; preRestoreSlot: string }> {
  const srcDir = join(ROOT, slug, slot)
  if (!existsSync(srcDir)) return { ok: false, preRestoreSlot: '' }
  // 1) pre-restore: snapshot do estado atual antes de aplicar (Q15: undo do undo)
  const preSlot = `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`
  await writeSlot(slug, preSlot, slot)
  // 2) copia o snapshot de volta para data/<slug>/
  for (const k of KINDS) {
    const src = join(srcDir, `${k}.json`)
    const dst = join(DATA, slug, `${k}.json`)
    if (existsSync(src)) {
      const tmp = dst + '.tmp'
      const buf = await readFile(src); await writeFile(tmp, buf); await rename(tmp, dst)
    }
  }
  return { ok: true, preRestoreSlot: preSlot }
}

// Wipe guard chama isto em vez do antigo .backup/. Devolve o path relativo para a mensagem de erro.
export async function writeWipeGuardSnapshot(slug: string, kind: Kind, content: any): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = join(ROOT, slug, '_wipe-guard', `${kind}-${stamp}`)
  mkdirSync(dir, { recursive: true })
  await writeFile(join(dir, `${kind}.json`), JSON.stringify(content, null, 2), 'utf8')
  return `_wipe-guard/${kind}-${stamp}`
}
