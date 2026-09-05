// test/card-phase.test.mjs
//
// Phase 2 — Card.phase field + chip UI. Cobre:
// 1. Card interface tem phase?: MichiPhase (src/api.ts)
// 2. phaseChip(c) ou equivalente mapeia colId -> phase e renderiza chip
// 3. kcard template inclui o chip (src/views/kanban.ts:381)
//
// Style: source equality, vanilla node:assert. Sem spawn.
// Run: node test/card-phase.test.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const apiSrc = readFileSync(join(repoRoot, 'src', 'api.ts'), 'utf8')
const viewSrc = readFileSync(join(repoRoot, 'src', 'views', 'kanban-vanilla.ts'), 'utf8')

let failures = 0
const ok = (cond, msg) => {
  if (cond) console.log('  ok:', msg)
  else { console.error('  FAIL:', msg); failures++ }
}

console.log('\n[1] Card interface tem phase field (src/api.ts)')
ok(apiSrc.includes("phase?: MichiPhase"), 'phase?: MichiPhase declared')
ok(apiSrc.includes("type MichiPhase"), 'MichiPhase type exported')

console.log('\n[2] MichiPhase type tem 9 valores (todo/grill/dr/dp/da/gates/review/reflect/done)')
const phaseTypeMatch = apiSrc.match(/type MichiPhase = ([^;]+);/)
ok(phaseTypeMatch !== null, 'type MichiPhase found')
if (phaseTypeMatch) {
  const values = phaseTypeMatch[1].split('|').map(s => s.trim().replace(/^['"]|['"]$/g, ''))
  ok(values.length === 9, `9 phases (got ${values.length})`)
  for (const v of ['todo','grill','dr','dp','da','gates','review','reflect','done']) {
    ok(values.includes(v), `${v} present`)
  }
}

console.log('\n[3] phaseChip/colIdToPhase helper existe em views/kanban.ts')
ok(viewSrc.includes("function phaseChip") || viewSrc.includes("const phaseChip"),
   'phaseChip function defined')
ok(viewSrc.includes("function colIdToPhase") || viewSrc.includes("const colIdToPhase") || viewSrc.match(/colId.*phase/i) !== null,
   'colId -> phase mapping exists')

console.log('\n[4] kcard template renderiza o chip (L381 area)')
// phaseChip deve aparecer na kstates div
const kstatesArea = viewSrc.match(/<div class="kstates">[^<]*stateChip[^<]*/)
ok(kstatesArea !== null || viewSrc.includes('phaseChip(c)'),
   'kcard includes phaseChip call')

console.log('\n[5] CSS class para chip phase existe em styles/components.css')
const cssSrc = readFileSync(join(repoRoot, 'src', 'styles', 'components.css'), 'utf8')
ok(cssSrc.includes('.kbadge-phase') || cssSrc.includes('kbadge-phase'),
   '.kbadge-phase class defined')

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
