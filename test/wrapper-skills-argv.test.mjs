// test/wrapper-skills-argv.test.mjs
// Valida que api.ts ainda injecta --skills a partir de card.skills.
// (runCard e' burro sobre skills; o caller constroi os args.)

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const apiPath = join(here, '..', 'server', 'api.ts')
const apiSrc = readFileSync(apiPath, 'utf8')

let passed = 0, failed = 0
function ok(m) { passed++; console.log(`  ok: ${m}`) }
function fail(m) { failed++; console.log(`  NOT OK: ${m}`) }
function assert(c, m) { c ? ok(m) : fail(m) }

console.log('wrapper-skills-argv (api.ts source)')
assert(/ATLAS_CARD_SKILLS/.test(apiSrc), 'api.ts referencia ATLAS_CARD_SKILLS')
assert(/--skills/.test(apiSrc), 'api.ts injecta --skills nos args')
assert(/card\.skills/.test(apiSrc), 'api.ts le card.skills')
assert(/card\.skills.*filter.*map.*join/.test(apiSrc) || /card\.skills.*join/.test(apiSrc),
  'api.ts: card.skills -> comma-joined string')

const empty = ['', ' , '].every(s => !s.split(',').map(x => x.trim()).filter(Boolean).length)
assert(empty, 'env vazio/whitespace -> 0 skills')
const two = 'grill-me,grilling'.split(',').map(x => x.trim()).filter(Boolean)
assert(two.length === 2 && two[0] === 'grill-me' && two[1] === 'grilling', 'grill-me,grilling -> 2 skills')

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: wrapper-skills-argv (${passed} ok, ${failed} not ok)`)
process.exit(failed === 0 ? 0 : 1)
