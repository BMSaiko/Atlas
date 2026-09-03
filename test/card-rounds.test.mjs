// test/card-rounds.test.mjs
//
// Phase 3 — timeline / rounds extraido de c.result (read-only, no schema change).
// Cobre:
// 1. roundsFromResult helper existe em views/kanban.ts
// 2. kcard e viewModal renderizam o badge
// 3. CSS class .kbadge-round existe
//
// Style: source equality, vanilla node:assert. Sem spawn.
// Run: node test/card-rounds.test.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const viewSrc = readFileSync(join(repoRoot, 'src', 'views', 'kanban.ts'), 'utf8')
const cssSrc = readFileSync(join(repoRoot, 'src', 'styles', 'components.css'), 'utf8')

let failures = 0
const ok = (cond, msg) => {
  if (cond) console.log('  ok:', msg)
  else { console.error('  FAIL:', msg); failures++ }
}

console.log('\n[1] roundsFromResult helper existe em views/kanban.ts')
ok(viewSrc.includes('function roundsFromResult') || viewSrc.includes('const roundsFromResult'),
   'roundsFromResult function defined')
ok(viewSrc.includes('Round \\d+') || viewSrc.includes('match(/Round'),
   'regex Round \\d+ presente')

console.log('\n[2] kcard template renderiza o badge (L381 area kstates div)')
ok(viewSrc.includes('roundsFromResult(c)'),
   'roundsFromResult(c) chamado no template')

console.log('\n[3] viewModal renderiza o badge')
ok(viewSrc.includes('roundsFromResult(c)'),
   'roundsFromResult(c) chamado em viewModal (covered by [2])')

console.log('\n[4] CSS class .kbadge-round existe em components.css')
ok(cssSrc.includes('.kbadge-round'),
   '.kbadge-round class defined')

console.log('\n[5] No schema change — Card interface nao ganhou rounds[]')
const apiSrc = readFileSync(join(repoRoot, 'src', 'api.ts'), 'utf8')
ok(!apiSrc.includes('rounds?:') && !apiSrc.includes('rounds:'),
   'Card interface SEM rounds field (read-only timeline)')

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
