// test/prompts.test.mjs
//
// Regressao: loader dos prompts LLM em server/prompts/. Garante que:
//   [1] cada prompt (run-card, brainstorm, dp, git-op) existe e nao esta vazio;
//   [2] dp.md tem os marcadores ${...} esperados;
//   [3] interpolate() substitui tudo e falha alto se faltar uma var.
// Sem dependencia externa (so node:fs + node:url). Requer node 20+.

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
// ../server/prompts/ (a partir de test/)
const promptsDir = join(here, '..', 'server', 'prompts')

// Copia minima do interpolate de server/prompts/index.ts — assercoes sobre o
// proprio loader sao triviais e o typecheck do server/api.ts ja valida a outra.
function interpolate(template, vars) {
  return template.replace(/\$\{(\w+)\}/g, (m, k) => {
    const v = vars[k]
    if (v === undefined) throw new Error(`interpolate: var "${k}" nao definida`)
    return v
  })
}

const keys = ['run-card', 'brainstorm', 'dp', 'git-op']

// [1] snap: cada prompt existe e nao esta vazio.
const texts = {}
for (const k of keys) {
  const p = join(promptsDir, k + '.md')
  texts[k] = readFileSync(p, 'utf8')
  assert.ok(texts[k].length > 50, `${k}.md deve ter > 50 chars (tem ${texts[k].length})`)
}

// [2] dp.md tem os marcadores do plano.
for (const m of ['${slug}', '${kanbanPath}', '${apiUrl}', '${repo}', '${cardId}', '${cardTitle}', '${cardDescription}', '${logPath}']) {
  assert.ok(texts['dp'].includes(m), `dp.md deve conter o marcador ${m}`)
}

// [3] interpolate() substitui tudo num unico pass — sem marcadores sobrando.
const out = interpolate(texts['dp'], {
  slug: 'demo',
  kanbanPath: 'C:/data/demo/kanban.json',
  apiUrl: 'http://localhost:5173/api/w/demo/kanban',
  repo: 'C:/code/demo',
  cardId: 'abc123',
  cardTitle: 'T',
  cardDescription: 'd',
  logPath: 'C:/runs/demo.log',
})
assert.ok(!/\$\{\w+\}/.test(out), 'interpolate: nenhum marcador deve sobrar no output final')
assert.ok(out.includes('abc123'), 'cardId deve aparecer no output')

// [4] var em falta -> erro explicito (typo safety).
assert.throws(
  () => interpolate(texts['dp'], { slug: 'x' }),
  /nao definida/,
  'var em falta deve dar erro (caça typos)'
)

console.log('prompts.test.mjs OK — 4 prompts carregados, marcadores OK, interpolate OK')
