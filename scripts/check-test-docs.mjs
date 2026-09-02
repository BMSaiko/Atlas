#!/usr/bin/env node
// scripts/check-test-docs.mjs
//
// Parity check: para cada test/<stem>.test.mjs existe docs/test/<stem>/README.md?
// Falha visivelmente se faltar (RC=1) com a lista de stems em falta.
// Uso: node scripts/check-test-docs.mjs
//
// ponytail: pass-through de filesystem stdlib. Sem deps. Unico check do michi
// "docs para os testes" (2026-09-02). Adicionar verificacao de conteudo se a
// gate passar a ser menos trivial (verifica atualmente so a presenca do ficheiro).

import { readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = dirname(here) // scripts/ -> repo root
const testDir = join(repo, 'test')
const docsDir = join(repo, 'docs', 'test')

function stemsWithTest(dir) {
  return readdirSync(dir)
    .filter(f => f.endsWith('.test.mjs'))
    .map(f => f.replace(/\.test\.mjs$/, ''))
    .sort()
}

const existing = stemsWithTest(testDir)
const missing = []
for (const stem of existing) {
  const doc = join(docsDir, stem, 'README.md')
  if (!existsSync(doc)) missing.push(`${stem}.test.mjs -> docs/test/${stem}/README.md`)
}

if (missing.length) {
  console.error(`FAIL: ${missing.length} test(s) sem doc:`)
  for (const m of missing) console.error(`  - ${m}`)
  process.exit(1)
}

console.log(`OK: ${existing.length} testes, todos com doc.`)
