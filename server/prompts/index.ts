// server/prompts/index.ts
//
// Loader unico para os prompts LLM usados pelo runner. Os textos vivem em
// ficheiros .md vizinhos para serem faceis de editar (sem tocar em TS,
// sem typos em strings interpoladas) e reutilizaveis em testes.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const DIR = dirname(fileURLToPath(import.meta.url))

export type PromptKey = 'run-card' | 'brainstorm' | 'dp' | 'git-op'

const cache = new Map<PromptKey, string>()

export async function loadPrompt(key: PromptKey): Promise<string> {
  let s = cache.get(key)
  if (s !== undefined) return s
  s = await readFile(join(DIR, `${key}.md`), 'utf8')
  cache.set(key, s)
  return s
}

// Substitui ${k} por vars[k] numa unica pass. Erro explicito se faltar
// alguma var para um caller detectar typos no prompt em vez de mandar
// "${cardId}" literal ao LLM.
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (m, k) => {
    const v = vars[k]
    if (v === undefined) throw new Error(`interpolate: var "${k}" nao definida`)
    return v
  })
}
