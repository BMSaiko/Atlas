// server/lib/auto-merge.mjs
// ponytail: detached sub-process for the post-hermes auto-merge. Runs as its
// own Node process so the Vite dev server (parent) can die/restart without
// orphaning the merge. Invocation from run-card.mjs:
//
//   spawn(process.execPath, [auto-merge.mjs, wt, branch, repo, baseBranch, stPath],
//         { detached: true, stdio: 'ignore', windowsHide: true }).unref()
//
// argv: [wt, branch, repo, baseBranch, stPath] (skipping node + this file)
// Replicates the Python wrapper lines 433-454 verbatim. Stdlib only.

import { spawnSync } from 'node:child_process'
import { writeFile, rmdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const GIT = process.env.GIT_BIN || 'C:\\Program Files\\Git\\bin\\git.exe'
const [, , wt, branch, repo, baseBranch, stPath] = process.argv

async function writeStatus(obj) {
  try { await writeFile(stPath, JSON.stringify(obj), 'utf8') } catch {}
}

try {
  const cwdSave = process.cwd()
  try {
    process.chdir(repo)
    const co = spawnSync(GIT, ['checkout', baseBranch])
    if (co.status !== 0) {
      console.log(`NAO consigo ir para o branch base (${baseBranch}) - aborta merge. Worktree mantida.`)
      process.exit(0)
    }
    spawnSync(GIT, ['fetch', 'origin', baseBranch])
    spawnSync(GIT, ['merge', `origin/${baseBranch}`, '--no-edit'])
    let mg = spawnSync(GIT, ['merge', branch, '--no-edit'])
    if (mg.status === 0) {
      let ps = spawnSync(GIT, ['push', 'origin', baseBranch])
      if (ps.status !== 0) {
        // BUG 3e: retry once
        spawnSync(GIT, ['fetch', 'origin', baseBranch])
        spawnSync(GIT, ['merge', `origin/${baseBranch}`, '--no-edit'])
        spawnSync(GIT, ['merge', branch, '--no-edit'])
        ps = spawnSync(GIT, ['push', 'origin', baseBranch])
      }
      if (ps.status === 0) {
        const nj = join(wt, 'node_modules')
        try { await rmdir(nj) } catch { try { await rm(nj, { recursive: true, force: true }) } catch {} }
        spawnSync(GIT, ['worktree', 'remove', '--force', wt])
        spawnSync(GIT, ['branch', '-D', branch])
      } else {
        await writeStatus({ state: 'merge-failed', branch,
          log: (mg.stderr?.toString('utf8') || ''), ts: Date.now() })
        console.log(`MERGE ${baseBranch}<-${branch} FALHOU apos retry. Worktree mantido.`)
      }
    } else {
      await writeStatus({ state: 'merge-failed', branch,
        log: (mg.stderr?.toString('utf8') || ''), ts: Date.now() })
    }
  } finally {
    process.chdir(cwdSave)
  }
} catch (e) {
  console.log(`AUTO-CLEANUP FALHOU: ${String(e)} - push/merge incompleto. Worktree e branch mantidas p/ inspecao.`)
}
