// test/_atlas-harness.mjs
//
// Integration harness para o caminho REAL de launchHermes: spawn python + git worktree
// + close-handler doing->review. Usa um fake hermes_cli (test/fixtures/hermes_cli/) em vez
// do Hermes real; o python wrapper do api.ts e' o de producao (sem mock).
//
// spinAtlasHarness({ slug, cardId, mode }) -> { a, board, boardPath, stPath, branch, wt, runsDir, repo }
//   a         : handle normal de spinAtlas (req, reqRaw, wtoken, close)
//   board     : kanban.json pre-escrito (1 card em todo)
//   boardPath : path completo do kanban.json
//   stPath    : caminho do .status file (<repo>/data/.wt/runs/<slug>/<cardId>.status)
//   branch    : 'feature/<slug>-<cardId>'
//   wt        : caminho do worktree (<repo>/data/.wt/<slug>/<cardId>)
//   runsDir   : caminho dos runs files (<repo>/data/.wt/runs/<slug>)
//   repo      : atlasRepo (= a.cwd, partilhado entre tests via _sharedCwd sticky)
// waitForClose(stPath, boardPath, timeoutMs=30000) -> { status, board }
//
// mode em { write_result, forget_result, crash } -> HERMES_FAKE_MODE.
// 4 testes sequenciais partilham 1 atlasRepo (cwd sticky do _atlas-runtime.mjs); isolamento
// entre eles = slug unico (cada um cria worktree + branch + runs dir proprios).

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spinAtlas } from './_atlas-runtime.mjs'

const here = dirname(fileURLToPath(import.meta.url))
// ponytail: PYTHONPATH inclui test/fixtures/ -> `python -m hermes_cli.main` encontra o stub.
const FIXTURES_DIR = join(here, 'fixtures')

// hasGit: skip defensivo (CI sem git). tests/* ja' exigem git noutros sitios.
// ponytail: probe 'git' (PATH-resolved; works on Linux/macOS + Windows-with-Git\cmd-on-PATH)
// then fall back to known Windows install. GIT_BIN env overrides both. Cached.
const _gitBin = (() => {
  if (process.env.GIT_BIN) return process.env.GIT_BIN
  for (const c of ['git', 'C:\\Program Files\\Git\\bin\\git.exe']) {
    try { execFileSync(c, ['--version'], { stdio: 'ignore' }); return c } catch {}
  }
  return null
})()
function gitBin() { return _gitBin || 'git' }
const hasGit = (() => {
  try { execFileSync(gitBin(), ['--version'], { stdio: 'ignore' }); return true } catch { return false }
})()

// gitInitRepo: idempotente — 1o test init, seguintes reutilizam; garante branch 'dev'.
function gitInitRepo(repoDir) {
  if (!existsSync(join(repoDir, '.git'))) {
    execFileSync(gitBin(), ['-C', repoDir, 'init', '-q', '-b', 'dev'], { stdio: 'ignore' })
  }
  execFileSync(gitBin(), ['-C', repoDir, 'config', 'user.email', 'fake@x'], { stdio: 'ignore' })
  execFileSync(gitBin(), ['-C', repoDir, 'config', 'user.name', 'fake'], { stdio: 'ignore' })
  execFileSync(gitBin(), ['-C', repoDir, 'config', 'commit.gpgsign', 'false'], { stdio: 'ignore' })
  if (!existsSync(join(repoDir, 'README.md'))) {
    writeFileSync(join(repoDir, 'README.md'), '# fake atlas repo\n', 'utf8')
    execFileSync(gitBin(), ['-C', repoDir, 'add', 'README.md'], { stdio: 'ignore' })
    execFileSync(gitBin(), ['-C', repoDir, 'commit', '-q', '-m', 'init'], { stdio: 'ignore' })
  }
  // ponytail: bare remote local em <repo>/.fake-remote.git — wrapper python faz `git push origin dev`
  // que sem remote falhava e gravava `merge-failed` no .status, mascarando o close handler (Node via
  // `code===0 && mergeFailed` saltava a promocao doing->review). Custo 5 LOC, idempotente.
  const bareDir = join(repoDir, '.fake-remote.git')
  if (!existsSync(bareDir)) {
    execFileSync(gitBin(), ['init', '-q', '--bare', bareDir], { stdio: 'ignore' })
    execFileSync(gitBin(), ['-C', repoDir, 'remote', 'add', 'origin', bareDir], { stdio: 'ignore' })
    execFileSync(gitBin(), ['-C', repoDir, 'push', '-q', 'origin', 'dev'], { stdio: 'ignore' })
  }
}

export async function spinAtlasHarness({ slug, cardId, mode }) {
  if (!hasGit) throw new Error('git nao encontrado no PATH (precisa para integration harness)')

  // 4 testes partilham o mesmo atlasRepo + DATA via _sharedCwd (sticky cwd).
  // module-cache DATA em api.ts:11 fica pinned no 1o tmpdir do processo; testes seguintes
  // reusam esse tmpdir (a.cwd = _sharedCwd). Isolamento entre testes = slug unico.
  const a = await spinAtlas({
    wezterm: '',                                    // headless: spawn directo de VENV_PY
    env: {
      PYTHONPATH: FIXTURES_DIR,                    // python -m hermes_cli.main -> fixtures
      HERMES_FAKE_MODE: mode,
      HERMES_FAKE_SLUG: slug,
      HERMES_FAKE_CARDID: cardId,
      // HERMES_FAKE_WT / HERMES_FAKE_REPO adicionados abaixo (dependem do cwd).
    },
  })

  // git init o atlasRepo (= cwd). 1 commit em dev + node_modules dir (para a junction do
  // launchHermes nao falhar — mklink /J exige o target a existir).
  const repo = a.cwd
  mkdirSync(join(repo, 'node_modules'), { recursive: true })
  gitInitRepo(repo)

  // Pre-writes do board (1 card em todo). O /run handler vai move-lo para doing.
  mkdirSync(join(a.cwd, 'data', slug), { recursive: true })
  const board = {
    ver: 1,
    columns: [{ id: 'todo' }, { id: 'doing' }, { id: 'review' }, { id: 'done' }],
    cards: [{ id: cardId, colId: 'todo', title: `Integration test ${slug}`, description: 'fake prompt' }],
  }
  const boardPath = join(a.cwd, 'data', slug, 'kanban.json')
  writeFileSync(boardPath, JSON.stringify(board))

  // Paths deterministas (iguais aos do launchHermes em server/api.ts).
  const wtRoot = join(repo, 'data', '.wt')
  const wt = join(wtRoot, slug, cardId)
  const runsDir = join(wtRoot, 'runs', slug)
  const stPath = join(runsDir, cardId + '.status')
  const branch = `feature/${slug}-${cardId}`

  // Injeta WT + REPO no env. So' agora sabemos cwd (= repo).
  process.env.HERMES_FAKE_WT = wt
  process.env.HERMES_FAKE_REPO = repo

  return { a, board, boardPath, stPath, branch, wt, runsDir, repo }
}

// waitForClose: poll stPath ate' state==='done' (sinal que p.on('close') correu).
// Backoff 50ms->1s ate' 30s. Tambem sai se card arquivado.
export async function waitForClose(stPath, boardPath, timeoutMs = 30000) {
  const start = Date.now()
  let delay = 50
  let lastStatus = null
  let lastBoard = null
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, delay))
    delay = Math.min(delay * 2, 1000)
    try { lastStatus = JSON.parse(readFileSync(stPath, 'utf8')) } catch {}
    try { lastBoard = JSON.parse(readFileSync(boardPath, 'utf8')) } catch {}
    if (lastStatus?.state === 'done') return { status: lastStatus, board: lastBoard }
    if (lastBoard?.cards?.[0]?.archived) return { status: lastStatus, board: lastBoard }
  }
  throw new Error(`waitForClose timeout ${timeoutMs}ms (last status=${JSON.stringify(lastStatus)})`)
}
