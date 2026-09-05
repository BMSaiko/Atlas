// server/lib/chat-runner.mjs
//
// ponytail: 2026-09-05 strip-kanban — extracted runHermesHeadless de run-card.mjs (que foi
// apagado com o kanban). Chat (cross-mundo) e' o unico consumidor; mantem-se so' a variante
// sem pane/heartbeat/auto-merge. Stdlib only. Mesmo invariants do original: sanitize,
// ms units, child.unref(), resolved on close.
import { spawn } from 'node:child_process'

const C1_RE = /[\u0080-\u009F\uFFFD]/g
function sanitizeBuf(d) {
  return Buffer.from(d.toString('utf8').replace(C1_RE, ''), 'utf8')
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
