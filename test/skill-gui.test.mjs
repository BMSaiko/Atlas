// test/skill-gui.test.mjs
//
// card grill-me-palette (e similares com skills interactivos) — server/api.ts::launchHermes
// precisa de spawnar pane GUI visivel (nao injectar num wezterm-gui minimizado/escondido).
// Cobertura (source-only, sem spawn real):
//   1. card.skills definido E cfg.wezterm existe  -> spawn wezterm-gui --always-new-process
//                                                    e windowsHide: false (janela visivel)
//   2. card.skills vazio                          -> continua a usar 'wezterm start --' (legado)
//                                                    e windowsHide: true (comportamento anterior)
//   3. cfg.wezterm vazio                          -> cai no headless (VENV_PY directo, sem janela)
//
// Regressao: se a condicao skillGui sair, o grill-me volta a correr invisivel.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const apiPath = join(dirname(here), 'server', 'api.ts')
const apiSrc = readFileSync(apiPath, 'utf8')

// helper: extrai o bloco que contem `headless = !cfg.wezterm` ate ao p.on('error') correspondente
const idx = apiSrc.indexOf('  const headless = !cfg.wezterm')
assert.ok(idx > -1, 'snippet launchHermes (const headless) nao encontrado em server/api.ts')
const endMarker = "void fail((headless ? 'spawn headless' : skillGui ? 'spawn wezterm-gui' : 'spawn wezterm') + ' falhou: ' + e.message) })"
const endIdx = apiSrc.indexOf(endMarker, idx)
assert.ok(endIdx > -1, 'snippet launchHermes (fail msg) nao encontrado — branch skillGui foi removido?')
const block = apiSrc.slice(idx, endIdx + endMarker.length)

// [1] skillGui existe
assert.ok(/const\s+skillGui\s*=\s*!headless\s*&&\s*Array\.isArray\(card\.skills\)\s*&&\s*card\.skills\.length\s*>\s*0/.test(block),
  'skillGui tem de ser !headless && Array.isArray(card.skills) && length>0')

// [2] quando skillGui, args tem 'start --always-new-process -- VENV_PY ...' (argv completo do wezterm-gui.exe)
//     Em wezterm-gui --always-new-process e' sub-opcao de 'start' (NÃO flag directa do GUI, como no wezterm CLI).
const skillGuiBranch = block.match(/skillGui\s*\?\s*(\[[\s\S]*?\])\s*:\s*\[/)
assert.ok(skillGuiBranch, 'branch skillGui nao encontrada nos args')
const argv = skillGuiBranch[1]
assert.ok(/'start'/.test(argv),               'skillGui branch deve chamar wezterm-gui subcomando start')
assert.ok(/'--always-new-process'/.test(argv),'skillGui branch deve usar --always-new-process (pane GUI nova, fora do mux)')
assert.ok(/VENV_PY/.test(argv),              'skillGui branch deve delegar no VENV_PY + wrapper')

// [3] o ramo antigo 'start' (sem skillGui) tem de continuar a existir
assert.ok(/'start',\s*'--',\s*VENV_PY/.test(block),
  'branch legada "wezterm start --" tem de continuar a existir para cards sem skills')

// [4] windowsHide so e' false quando skillGui
assert.ok(/windowsHide:\s*!skillGui/.test(block),
  'windowsHide tem de ser !skillGui (false = visivel para skills interactivos)')

// [5] mensagem de erro distingue os 3 modos (debugging)
assert.ok(block.includes("'spawn headless'") && block.includes("'spawn wezterm-gui'") && block.includes("'spawn wezterm'"),
  'fail() deve distinguir headless/wezterm-gui/wezterm para debugging')

console.log('PASS: skill-gui (3 branches: headless | skillGui | legacy wezterm start)')
