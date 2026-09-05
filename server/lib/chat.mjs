// server/lib/chat.mjs
// ponytail: multi-conversation history store + chat-runner para o main chat (/c).
// Reusa runHermesHeadless de chat-runner.mjs (extraido de run-card.mjs em 2026-09-05 strip-kanban). NAO toca em syncVault (cross-mundo
// nao vai para a vault do atlas).
// storage: data/_chat/history.json = { current: <id>, conversations: [{id,title,createdAt,updatedAt,messages:[]}] }
// runs: data/_chat/runs/<runId>.{log,status} (partilhado por todas as conversas; lookup por .log filename).

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { join, dirname } from 'node:path'
import { runHermesHeadless } from './chat-runner.mjs'
import { loadPrompt, interpolate } from '../prompts/index.ts'

const CHAT_DIR = '_chat'
const RUNS_DIR = '_chat/runs'
const HISTORY_FILE = '_chat/history.json'
export const CAP = 200  // ponytail: teto de mensagens POR CONVERSA; FIFO削 quando passa
const CONV_CAP = 50    // ponytail: teto de conversas mantidas; quando passa, a mais antiga (sem updatedAt recente) sai

// ponytail: schema novo. Migra do schema antigo {messages:[]} se encontrar. Sem migra = default vazio.
async function readStore(dataDir) {
  try {
    const raw = await readFile(join(dataDir, HISTORY_FILE), 'utf8')
    const j = JSON.parse(raw)
    // migrate: old shape {messages:[]}
    if (Array.isArray(j?.messages)) {
      const id = 'c-' + Date.now().toString(36)
      const now = Date.now()
      return {
        current: id,
        conversations: [{ id, title: j.messages[0]?.text?.slice(0, 60) || 'conversa', createdAt: now, updatedAt: now, messages: j.messages.slice(-CAP) }],
      }
    }
    if (Array.isArray(j?.conversations)) {
      return {
        current: typeof j.current === 'string' ? j.current : (j.conversations[0]?.id ?? ''),
        conversations: j.conversations,
      }
    }
  } catch { /* file missing or malformed — start fresh */ }
  return { current: '', conversations: [] }
}

async function writeStore(dataDir, store) {
  await mkdir(join(dataDir, CHAT_DIR), { recursive: true })
  await writeFile(join(dataDir, HISTORY_FILE), JSON.stringify(store, null, 2), 'utf8')
}

// ponytail: devolve a conversation atual com messages cap-FIFO. Se nao existir, cria 1 com titulo gerado.
export async function readHistory(dataDir) {
  const store = await readStore(dataDir)
  let conv = store.conversations.find((c) => c.id === store.current)
  if (!conv && store.conversations.length === 0) {
    // start fresh: cria 1 conversation vazia
    const id = 'c-' + Date.now().toString(36)
    const now = Date.now()
    conv = { id, title: 'Nova conversa', createdAt: now, updatedAt: now, messages: [] }
    store.conversations.push(conv)
    store.current = id
    await writeStore(dataDir, store)
  } else if (!conv) {
    conv = store.conversations[0]
    store.current = conv.id
    await writeStore(dataDir, store)
  }
  return { conversation: conv, messages: conv.messages.slice(-CAP), conversations: store.conversations, current: store.current }
}

// ponytail: appendHistory append à conversa ATUAL + bumpa updatedAt. Idempotencia do agent msg via runId ja e' checked no routes/chat.ts.
export async function appendHistory(dataDir, msg) {
  const store = await readStore(dataDir)
  let conv = store.conversations.find((c) => c.id === store.current)
  if (!conv) {
    const id = 'c-' + Date.now().toString(36)
    const now = Date.now()
    conv = { id, title: msg.text?.slice(0, 60) || 'conversa', createdAt: now, updatedAt: now, messages: [] }
    store.conversations.push(conv)
    store.current = id
  }
  conv.messages.push(msg)
  while (conv.messages.length > CAP) conv.messages.shift()
  conv.updatedAt = Date.now()
  // se a 1a msg do user acaba de entrar, o titulo e' o texto (max 60ch)
  if (msg.role === 'user' && (conv.title === 'Nova conversa' || !conv.title)) {
    conv.title = msg.text.slice(0, 60)
  }
  await writeStore(dataDir, store)
  return { conversation: conv, messages: conv.messages, conversations: store.conversations, current: store.current }
}

// ponytail: criar nova conversa (vazia). Retorna a store atualizada.
// Se a store estiver vazia, cria 1 default primeiro (mesmo contrato de readHistory).
export async function newConversation(dataDir) {
  let store = await readStore(dataDir)
  if (store.conversations.length === 0) {
    const did = 'c-' + Date.now().toString(36)
    const now = Date.now()
    store.conversations.push({ id: did, title: 'Nova conversa', createdAt: now, updatedAt: now, messages: [] })
    store.current = did
  }
  const id = 'c-' + Date.now().toString(36)
  const now = Date.now()
  store.conversations.unshift({ id, title: 'Nova conversa', createdAt: now, updatedAt: now, messages: [] })
  // cap conversations: descarta as mais antigas alem de CONV_CAP
  if (store.conversations.length > CONV_CAP) {
    store.conversations = store.conversations.slice(0, CONV_CAP)
  }
  store.current = id
  await writeStore(dataDir, store)
  return { conversation: store.conversations[0], messages: [], conversations: store.conversations, current: id }
}

// ponytail: switch conversa atual.
export async function switchConversation(dataDir, id) {
  const store = await readStore(dataDir)
  const conv = store.conversations.find((c) => c.id === id)
  if (!conv) return null
  store.current = id
  await writeStore(dataDir, store)
  return { conversation: conv, messages: conv.messages, conversations: store.conversations, current: id }
}

// ponytail: listar conversas (sidebar). Nao toca em messages.
export async function listConversations(dataDir) {
  const store = await readStore(dataDir)
  return store.conversations.map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, msgCount: c.messages.length }))
}

// ponytail: apagar 1 conversa. Se era a current, switch para a prox (ou cria nova).
export async function deleteConversation(dataDir, id) {
  const store = await readStore(dataDir)
  const idx = store.conversations.findIndex((c) => c.id === id)
  if (idx < 0) return null
  store.conversations.splice(idx, 1)
  if (store.current === id) {
    store.current = store.conversations[0]?.id || ''
    if (!store.current) {
      // start fresh
      const nid = 'c-' + Date.now().toString(36)
      const now = Date.now()
      store.conversations.push({ id: nid, title: 'Nova conversa', createdAt: now, updatedAt: now, messages: [] })
      store.current = nid
    }
  }
  await writeStore(dataDir, store)
  return { current: store.current, conversations: store.conversations }
}

export async function clearHistory(dataDir) {
  // ponytail: manter o conceito de "limpar thread" como soft-delete da conversa atual (mantem titulo).
  const store = await readStore(dataDir)
  const conv = store.conversations.find((c) => c.id === store.current)
  if (conv) {
    conv.messages = []
    conv.updatedAt = Date.now()
    await writeStore(dataDir, store)
  }
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
