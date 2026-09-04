// server/lib/chat.mjs
// ponytail: history store + chat-runner para o main chat cross-mundo (`/c`).
// Reusa runHermesHeadless de run-card.mjs. NAO toca em syncVault (cross-mundo
// nao vai para a vault do atlas). paths: data/_chat/history.json + runs/<runId>.{log,status}.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { join, dirname } from 'node:path'
import { runHermesHeadless } from './run-card.mjs'
import { loadPrompt, interpolate } from '../prompts/index.ts'

const CHAT_DIR = '_chat'
const RUNS_DIR = '_chat/runs'
const HISTORY_FILE = '_chat/history.json'
export const CAP = 200  // ponytail: teto de mensagens; FIFO削 quando passa

// ponytail: readHistory devolve {messages:[]} se o ficheiro nao existe (default honesto,
// nao 404 nem inventa nada).
export async function readHistory(dataDir) {
  try {
    const raw = await readFile(join(dataDir, HISTORY_FILE), 'utf8')
    const j = JSON.parse(raw)
    if (Array.isArray(j?.messages)) return { messages: j.messages.slice(-CAP) }
    return { messages: [] }
  } catch {
    return { messages: [] }
  }
}

// ponytail: appendHistory escreve com 2 writeFile (tmp + final). Sem rename atomico (Windows
// fs.rename pode falhar cross-device), mas como o unico writer e este server, a janela de
// inconsistencia e zero. Cap FIFO削 messages[0] quando length > CAP.
export async function appendHistory(dataDir, msg) {
  const cur = await readHistory(dataDir)
  const messages = [...cur.messages, msg]
  while (messages.length > CAP) messages.shift()
  await mkdir(join(dataDir, CHAT_DIR), { recursive: true })
  const file = join(dataDir, HISTORY_FILE)
  await writeFile(file, JSON.stringify({ messages }, null, 2), 'utf8')
  return { messages }
}

export async function clearHistory(dataDir) {
  await mkdir(join(dataDir, CHAT_DIR), { recursive: true })
  await writeFile(join(dataDir, HISTORY_FILE), JSON.stringify({ messages: [] }, null, 2), 'utf8')
}

// ponytail: launchChat dispara 1 sessao hermes headless com o prompt cross-mundo montado
// em buildPrompt. Replica o shape de launchBrainstorm (fire-and-forget + .log/.status).
// NUNCA bloqueia. devolve {runId, logPath, stPath}.
export async function launchChat({ dataDir, cfg, userMsg, history, worlds }) {
  if (process.env.ATLAS_TEST_NO_SPAWN) {
    return { runId: 'r-no-spawn', logPath: '', stPath: '' }  // ponytail: tests gate — same as launchBrainstorm's ATLAS_TEST_NO_SPAWN escape
  }
  const runId = 'r-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
  const logPath = join(dataDir, RUNS_DIR, runId + '.log')
  const stPath = join(dataDir, RUNS_DIR, runId + '.status')
  await mkdir(dirname(logPath), { recursive: true })
  const prompt = await buildPrompt({ userMsg, history, worlds, apiBase: `http://localhost:${cfg.port}/api`, atlasToken: cfg.wtoken, logPath })
  await writeFile(stPath, JSON.stringify({ state: 'running', ts: Date.now() }, null, 2), 'utf8').catch(() => {})
  const ws = createWriteStream(logPath, { flags: 'w' })
  void runHermesHeadless({
    exe: cfg.hermesPy,
    args: ['-m', 'hermes_cli.main', '-z', prompt],
    env: { ...process.env, HERMES_HOME: cfg.hermesHome },
    logWs: ws,
  }).then((code) => {
    ws.end()
    return writeFile(stPath, JSON.stringify({ state: 'done', code, ts: Date.now() }, null, 2), 'utf8')
  }).catch(() => {
    ws.end()
    return writeFile(stPath, JSON.stringify({ state: 'done', code: 1, ts: Date.now() }, null, 2), 'utf8')
  })
  return { runId, logPath, stPath }
}

// ponytail: buildPrompt e' a unica parte 'magica' desta feature. Mantem-se uma funcao pura
// (sem I/O alem de loadPrompt) para que da para testar isolando o template.
export async function buildPrompt({ userMsg, history, worlds, apiBase, atlasToken, logPath }) {
  const tpl = await loadPrompt('chat')
  const historyText = (history || []).slice(-20).map((m) => `[${m.role}] ${m.text}`).join('\n')
  const worldsList = (worlds || []).map((w) => `- ${w.slug}: ${w.name} — ${(w.description || '').slice(0, 120)}`).join('\n')
  return interpolate(tpl, { userMsg, historyText, worldsList, apiBase, atlasToken, logPath })
}
