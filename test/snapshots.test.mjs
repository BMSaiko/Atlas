// test/snapshots.test.mjs
// ponytail: round-trip — tick escreve, list le, restore copia, pre-restore slot é criado.
// Cobre o contrato do server/snapshots.ts. Reusa spinAtlas() que já existe em test/_atlas-runtime.mjs.
//
// Executar: node test/snapshots.test.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { spinAtlas } from './_atlas-runtime.mjs'

let fails = 0
const ok = (c, m) => { if (c) console.log('  ok:', m); else { console.error('  FAIL:', m); fails++ } }
const eq = (a, b, m) => ok(a === b, `${m}  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`)

const a = await spinAtlas()
const slug = 'snp1'
const dir = join(a.cwd, 'data', slug)
mkdirSync(dir, { recursive: true })

// seed: 1 nota + 1 card
const notesSeed = { ver: 0, items: [{ id: 'n1', title: 'T1', text: 'hello' }] }
const kanbanSeed = { ver: 0, columns: [{ id: 'todo', name: 'To Do' }], cards: [{ id: 'c1', title: 'C1', colId: 'todo' }] }  // ponytail: snapshot subsystem preserves kanban.json for restore-compat
writeFileSync(join(dir, 'notes.json'), JSON.stringify(notesSeed))
writeFileSync(join(dir, 'kanban.json'), JSON.stringify(kanbanSeed))

const base = `http://127.0.0.1:${a.port}`

console.log('\n[1] tick manual devolve 200 + slot')
const tickRes = await fetch(`${base}/api/w/${slug}/snapshots`, { method: 'POST' })
eq(tickRes.status, 200, 'tick 200')
const tick = await tickRes.json()
ok(typeof tick.slot === 'string' && /^\d{4}-\d{2}-\d{2}\/\d{2}-\d{2}$/.test(tick.slot), `slot shape ${tick.slot}`)
eq(tick.deduped, false, 'first tick not deduped')

console.log('\n[2] ficheiros no disco em data/_snapshots/<slug>/<slot>/')
const slotDir = join(a.cwd, 'data', '_snapshots', slug, tick.slot)
ok(existsSync(join(slotDir, 'notes.json')), 'notes.json exists on disk')
ok(existsSync(join(slotDir, 'kanban.json')), 'kanban.json preservado no snapshot (compat)')
ok(existsSync(join(slotDir, '_manifest.json')), '_manifest.json exists')

console.log('\n[3] list devolve >=1 snapshot')
const listRes = await fetch(`${base}/api/w/${slug}/snapshots`)
eq(listRes.status, 200, 'list 200')
const list = await listRes.json()
ok(list.length >= 1, `list size ${list.length}`)
ok(list[0].slot === tick.slot, 'first slot matches')
ok(list[0].files.notes && list[0].files.notes.size > 0, 'notes file size > 0')

console.log('\n[4] dedup: segundo tick com file inalterado devolve deduped=true')
const tick2 = await (await fetch(`${base}/api/w/${slug}/snapshots`, { method: 'POST' })).json()
// nota: tick2 corre o mesmo slot se chamado na mesma janela de 6h, OU um slot novo se passámos de hora.
// Em qualquer caso, os files são byte-iguais aos do tick anterior, então o dedup acontece em ambos.
ok(tick2.deduped === true, `tick2 deduped (got ${tick2.deduped})`)

console.log('\n[5] file endpoint devolve bytes do snapshot')
const fileRes = await fetch(`${base}/api/w/${slug}/snapshots/${encodeURIComponent(tick.slot)}/file/notes`)
eq(fileRes.status, 200, 'file 200')
eq(fileRes.headers.get('content-type'), 'application/json', 'file content-type')
const fileBody = await fileRes.json()
eq(fileBody.items[0].id, 'n1', 'file content matches seed')

console.log('\n[6] file endpoint rejeita name fora da whitelist')
const bad = await fetch(`${base}/api/w/${slug}/snapshots/${encodeURIComponent(tick.slot)}/file/../etc/passwd`)
eq(bad.status, 404, 'whitelist rejects traversal')

console.log('\n[7] restore: apaga estado actual, restaura snapshot, pre-restore slot criado')
// apaga notas (simula wipe)
writeFileSync(join(dir, 'notes.json'), JSON.stringify({ ver: 0, items: [] }))
const r = await fetch(`${base}/api/w/${slug}/snapshots/${encodeURIComponent(tick.slot)}/restore`, { method: 'POST' })
eq(r.status, 200, 'restore 200')
const rb = await r.json()
ok(rb.ok && rb.preRestoreSlot.startsWith('pre-restore-'), `pre-restore slot ${rb.preRestoreSlot}`)

// notas devem estar de volta
const restored = JSON.parse(readFileSync(join(dir, 'notes.json'), 'utf8'))
eq(restored.items.length, 1, 'notes restauradas (count)')
eq(restored.items[0].id, 'n1', 'notes restauradas (id)')

console.log('\n[8] list inclui o pre-restore slot')
const list2 = await (await fetch(`${base}/api/w/${slug}/snapshots`)).json()
const preSlot = list2.find((s) => s.slot === rb.preRestoreSlot)
ok(preSlot !== undefined, 'pre-restore slot visível na lista')
ok(preSlot.preRestoreOf === tick.slot, 'preRestoreOf aponta para o slot restaurado')

console.log('\n[9] wipe guard snapshot — simular wipe recusado para verificar writeWipeGuardSnapshot')
// wipe > threshold: 1 item -> 0 items
const wipeRes = await fetch(`${base}/api/w/${slug}/notes`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'X-Atlas-Token': (await a.wtoken()) },
  body: JSON.stringify({ ver: restored.ver, items: [] }),
})
// Como temos 1 item, threshold = max(5, floor(1*0.5)) = 5. loss=1, nao passa o threshold.
// Para testar o wipe guard, semeamos mais items.
writeFileSync(join(dir, 'notes.json'), JSON.stringify({ ver: 0, items: Array.from({ length: 20 }, (_, i) => ({ id: 'm' + i, title: 'M' + i, text: 'm' })) }))
const big = await (await fetch(`${base}/api/w/${slug}/notes`, { headers: { 'Content-Type': 'application/json', 'X-Atlas-Token': (await a.wtoken()) } })).json()
const bigWipe = await fetch(`${base}/api/w/${slug}/notes`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'X-Atlas-Token': (await a.wtoken()) },
  body: JSON.stringify({ ver: big.ver, items: [] }),
})
eq(bigWipe.status, 409, `wipe guard 409 (got ${bigWipe.status})`)
const wipeBody = await bigWipe.json()
ok(typeof wipeBody.guardPath === 'string' && wipeBody.guardPath.startsWith('_wipe-guard/'), `guardPath ${wipeBody.guardPath}`)
// ficheiro deve existir
const guardFullPath = join(a.cwd, 'data', '_snapshots', slug, wipeBody.guardPath, 'notes.json')
ok(existsSync(guardFullPath), 'wipe guard snapshot no disco')

await a.close()
console.log(fails === 0 ? '\nALL OK' : `\n${fails} FAIL`)
process.exit(fails === 0 ? 0 : 1)
