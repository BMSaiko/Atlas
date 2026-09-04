// src/views/main-chat.ts
// ponytail: cross-mundo chat. composer + thread + poll output. Reusa api.chat.* e o pattern
// de tick (kanban.ts): setInterval 1s, cap 30min, abort em done. Sem SSE/WebSocket — over-engineering.

import { api, ChatMsg } from '../api'
import { icon } from '../ui/icons'
import { toast } from '../ui/toast'

const POLL_MS = 1000
const MAX_POLL_MS = 30 * 60 * 1000  // 30 min cap (mesmo do kanban.ts)
const STALL_MS = 60 * 1000          // 60s sem bytes novos = toast "sem resposta"
const DRAFT_KEY = 'atlas.chat.draft'

export async function renderMainChat(panel: HTMLElement) {
  // ponytail: focus-on-route-change (ui-ux-pro-max §1) — composer focado ao montar.
  const thread: ChatMsg[] = (await api.chat.history().catch(() => ({ messages: [] }))).messages
  panel.innerHTML = `
    <div class="chat">
      <header class="chat-head">
        <h1>${icon('chat', 16)} Chat</h1>
        <p class="chat-sub">Fala com o agente. <b>Refere sempre o mundo</b> ("em atlas, …"). Sem mundo, o agente pergunta.</p>
        <div class="chat-actions">
          <button class="btn btn-ghost" id="chat-clear" title="Apagar toda a thread">${icon('trash', 14)} Limpar thread</button>
        </div>
      </header>
      <ol class="chat-thread" id="chat-thread" aria-live="polite"></ol>
      <div class="chat-typing" id="chat-typing" hidden><span class="dot"></span><span class="dot"></span><span class="dot"></span> a responder…</div>
      <form class="chat-composer" id="chat-composer" autocomplete="off">
        <textarea id="chat-input" rows="2" placeholder='Ex: "em atlas, lista as 3 últimas notas"' aria-label="Mensagem para o agente"></textarea>
        <button class="btn btn-primary" id="chat-send" type="submit">${icon('play', 14)} Enviar</button>
      </form>
    </div>`
  paint(panel, thread)

  const input = panel.querySelector<HTMLTextAreaElement>('#chat-input')!
  const form = panel.querySelector<HTMLFormElement>('#chat-composer')!
  const clearBtn = panel.querySelector<HTMLButtonElement>('#chat-clear')!
  // ponytail: state-preservation (ui-ux-pro-max §8) — auto-save do composer 300ms debounced.
  try { input.value = localStorage.getItem(DRAFT_KEY) || '' } catch {}
  let saveT = 0
  input.addEventListener('input', () => { clearTimeout(saveT); saveT = window.setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, input.value) } catch {} }, 300) })
  // ponytail: Ctrl+Enter submete (ui-ux-pro-max §1 — keyboard nav). Esc foca o composer.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); (form.querySelector('#chat-send') as HTMLButtonElement).click() }
    else if (e.key === 'Escape') { input.focus() }
  })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const text = input.value.trim()
    if (!text) return
    input.value = ''
    try { localStorage.removeItem(DRAFT_KEY) } catch {}
    input.disabled = true; (form.querySelector('#chat-send') as HTMLButtonElement).disabled = true
    try {
      const { runId } = await api.chat.send(text)
      // optimistically append user message + place agent placeholder
      thread.push({ role: 'user', text, ts: Date.now() })
      thread.push({ role: 'agent', text: '', ts: Date.now(), runId })
      paint(panel, thread)
      pollOutput(panel, thread, runId)
    } catch (err: any) {
      toast('Atlas offline — ' + (err?.message || 'erro'))
    } finally {
      input.disabled = false; (form.querySelector('#chat-send') as HTMLButtonElement).disabled = false
      input.focus()
    }
  })
  clearBtn.addEventListener('click', async () => {
    if (!confirm('Limpar toda a thread? (não afeta os mundos)')) return
    try { await api.chat.clear(); thread.length = 0; paint(panel, thread) } catch { toast('Erro a limpar') }
  })
  // ponytail: focus-on-route-change
  setTimeout(() => input.focus(), 0)
}

// ponytail: pollOutput — fetch incremental com offset, append ao thread, scroll-to-bottom.
// Stops em done, OU timeout 30min, OU 60s stall (toast "sem resposta").
async function pollOutput(panel: HTMLElement, thread: ChatMsg[], runId: string) {
  const showTyping = () => { const t = panel.querySelector<HTMLElement>('#chat-typing'); if (t) t.hidden = false }
  const hideTyping = () => { const t = panel.querySelector<HTMLElement>('#chat-typing'); if (t) t.hidden = true }
  const started = Date.now()
  let lastTs = Date.now()
  let offset = 0
  let lastText = ''
  const tick = async () => {
    if (Date.now() - started > MAX_POLL_MS) { hideTyping(); toast('Poll cap atingido (30min)'); return }
    if (Date.now() - lastTs > STALL_MS) { hideTyping(); toast('Sem resposta — a parar'); return }
    try {
      const d = await api.chat.output(runId, offset)
      if (d.started) hideTyping()
      else showTyping()
      if (d.chunk) {
        // append chunk to the agent placeholder
        const last = thread[thread.length - 1]
        if (last && last.role === 'agent' && last.runId === runId) {
          last.text = (last.text || '') + d.chunk
          lastText = last.text
          // extract actions JSON fenced from agent text (ponytail: simple — last ```json block)
          const m = lastText.match(/```json\s*([\s\S]*?)```/g)
          if (m) {
            try {
              const last2 = m[m.length - 1].replace(/```json|```/g, '').trim()
              const parsed = JSON.parse(last2)
              if (Array.isArray(parsed.actions)) last.actions = parsed.actions
            } catch { /* malformed — ignore */ }
          }
          paint(panel, thread)
          scrollToBottom(panel)
        }
        offset = d.offset
        lastTs = Date.now()
      }
      if (d.done) { hideTyping(); return }
    } catch { /* aguenta — server pode reiniciar */ }
    setTimeout(tick, POLL_MS)
  }
  showTyping()
  tick()
}

function paint(panel: HTMLElement, thread: ChatMsg[]) {
  const ol = panel.querySelector<HTMLElement>('#chat-thread')!
  if (!thread.length) {
    ol.innerHTML = `<li class="chat-empty">Começa com uma pergunta, ex.:<br><code>em atlas, lista as 3 últimas notas</code><br><code>em foodlister, cria uma nota "reunião amanhã 10h"</code><br><code>em mimir, mostra os cards em doing</code></li>`
    return
  }
  ol.innerHTML = thread.map(m => {
    const cls = m.role === 'user' ? 'chat-msg chat-msg--user' : 'chat-msg chat-msg--agent'
    const body = m.text ? esc(m.text).replace(/```json\s*([\s\S]*?)```/g, '<pre class="chat-actions">$1</pre>') : (m.role === 'agent' ? '<em class="chat-pending">…</em>' : '')
    const actions = m.actions && m.actions.length ? `<div class="chat-actions-pending">${m.actions.length} ação(ões) proposta(s) — em breve UI executa-as</div>` : ''
    return `<li class="${cls}"><div class="chat-bubble">${body}</div>${actions}</li>`
  }).join('')
}

function scrollToBottom(panel: HTMLElement) {
  const ol = panel.querySelector<HTMLElement>('#chat-thread')!
  ol.parentElement?.scrollTo({ top: ol.parentElement.scrollHeight, behavior: 'smooth' })
}

function esc(s: unknown) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
