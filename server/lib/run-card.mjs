// server/lib/run-card.mjs
// ponytail: replaces 5 inline `python -c "..."` wrappers in api.ts (launchHermes,
// launchDp, spawnHeadless, launchGitOp, launchBrainstorm). Same behaviour, no
// argv-shape gotchas (BUG 3b family), no Python for the wrapper. Hermes still
// runs as Python (`hermes_cli.main -z`). All invariants from the Python wrapper
// preserved: sanitize, ms units, pane!=-1 guard, merge-failed .status, retry
// on push fail. Stdlib only.

import { spawn, spawnSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

const C1_RE = /[-�]/g
function sanitizeBuf(d) {
  return Buffer.from(d.toString('utf8').replace(C1_RE, ''), 'utf8')
}
function nowMs() { return Date.now() }
async function writeStatus(stPath, obj) {
  try { await writeFile(stPath, JSON.stringify(obj), 'utf8') } catch {}
}

function startHeartbeat(stPath, pane) {
  const tick = () => writeStatus(stPath, {
    state: 'running', pane, lastHeartbeatAt: nowMs(), ts: nowMs(),
  })
  tick()
  return setInterval(tick, 60_000)  // ponytail: 60s = 1min (era 30s)
}

async function killPane(pane) {
  if (pane == null || pane === -1 || pane === '-1') return
  try {
    const p = spawn('wezterm', ['cli', 'kill-pane', '--pane-id', String(pane)],
                    { detached: true, stdio: 'ignore', windowsHide: true })
    p.unref()
  } catch {}
}

function runHermes({ exe, args, env, logWs }) {
  return new Promise((resolve) => {
    const child = spawn(exe, args, {
      detached: true, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'], env,
    })
    child.stdout?.on('data', (d) => logWs.write(sanitizeBuf(d)))
    child.stderr?.on('data', (d) => logWs.write(sanitizeBuf(d)))
    child.on('error', (e) => {
      logWs.write(Buffer.from(`\n[run-card] spawn error: ${e.message}\n`, 'utf8'))
      resolve({ code: 1, error: e.message })
    })
    child.on('close', (code) => resolve({ code: code ?? 1 }))
    child.unref()
  })
}

// ponytail: spawn auto-merge as DETACHED sub-process so the Vite dev server
// (parent) can die/restart without orphaning the merge. argv layout matches
// auto-merge.mjs expectations.
function spawnAutoMerge({ wt, branch, repo, baseBranch, stPath }) {
  try {
    const fileUrl = new URL('./auto-merge.mjs', import.meta.url)
    const child = spawn(process.execPath,
      [fileUrl.pathname.replace(/^\//, ''), wt, branch, repo, baseBranch, stPath],
      { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
  } catch (e) {
    console.error('[run-card] auto-merge spawn failed:', e instanceof Error ? e.message : String(e))
  }
}

export async function runCard(opts) {
  const { stPath, wt, branch, repo, prompt, baseBranch, exe, args, env, logWs, pane = null } = opts
  void prompt  // passed by caller in args; kept in signature for parity
  const hb = startHeartbeat(stPath, pane)
  let rc
  try {
    rc = (await runHermes({ exe, args, env, logWs })).code
  } finally {
    clearInterval(hb)
  }
  if (rc === 0 && baseBranch) {
    spawnAutoMerge({ wt, branch, repo, baseBranch, stPath })
  }
  await killPane(pane)
  return rc
}

export function runHermesHeadless({ exe, args, env, logWs }) {
  return new Promise((resolve) => {
    const child = spawn(exe, args, {
      detached: true, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'], env,
    })
    child.stdout?.on('data', (d) => logWs.write(sanitizeBuf(d)))
    child.stderr?.on('data', (d) => logWs.write(sanitizeBuf(d)))
    child.on('error', (e) => resolve({ code: 1, error: e.message }))
    child.on('close', (code) => resolve({ code: code ?? 1 }))
    child.unref()
  })
}
