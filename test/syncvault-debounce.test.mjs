// Regression check for the syncVault debounce batching (server/api.ts).
// Mirrors flushVault/syncVault exactly with GIT/VAULT injectable. Uses a throwaway
// temp git repo so the real vault is never touched. Fails if a burst of writes
// produces more than one batch commit.
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const GIT = process.env.TEST_GIT
let VAULT = null

let vaultDirty = false
let vaultTimer = null
let vaultBusy = false
function flushVault() {
  if (!vaultDirty || vaultBusy) return
  vaultDirty = false; vaultBusy = true
  const c = spawn(GIT, ['-C', VAULT, 'add', '-A', '.'], { windowsHide: true, stdio: 'ignore' })
  c.on('close', () => {
    const d = spawn(GIT, ['-C', VAULT, 'commit', '--no-verify', '-m', 'atlas: live-data sync'], { windowsHide: true, stdio: 'ignore' })
    const revive = () => { vaultBusy = false; if (vaultDirty) vaultTimer = setTimeout(flushVault, 2000) }
    d.on('close', revive)
    d.on('error', revive)
  })
  c.on('error', () => { vaultBusy = false; if (vaultDirty) vaultTimer = setTimeout(flushVault, 2000) })
}
function syncVault() {
  vaultDirty = true
  if (vaultTimer) clearTimeout(vaultTimer)
  vaultTimer = setTimeout(flushVault, 2000)
}

const git = (a) => execFileSync(GIT, ['-C', VAULT, ...a], { encoding: 'utf8' }).trim()
const commits = () => Number(git(['rev-list', '--count', 'HEAD']))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function main() {
  VAULT = mkdtempSync(join(tmpdir(), 'vault-debounce-'))
  git(['init', '-q']); git(['config', 'user.email', 't@t']); git(['config', 'user.name', 't'])
  writeFileSync(join(VAULT, 'f.json'), '0')
  syncVault()
  await sleep(3200) // initial drain -> baseline commit
  const base = commits()
  // burst of 10 writes in <2s -> exactly +1 commit
  for (let i = 0; i < 10; i++) { writeFileSync(join(VAULT, 'f.json'), String(i)); syncVault(); await sleep(25) }
  await sleep(3200)
  const n = commits() - base
  console.log('burst additional commits =', n)
  if (n !== 1) { console.error('FAIL: expected 1 batch commit, got', n); process.exit(1) }
  console.log('PASS: 10 writes in burst -> 1 batch commit')
  process.exit(0)
}
main()
