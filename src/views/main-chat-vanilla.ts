// src/views/main-chat.ts
// ponytail: main chat cross-mundo. conversas (sidebar) + composer (com arrow-up history) + thread
// com avatar Heimdall + typing dots sempre + render markdown mini. NAO SSE — poll 1s.

import { api, ChatMsg } from '../api'
import { icon } from '../ui/icons'
import { toast } from '../ui/toast'

const POLL_MS = 1000
const MAX_POLL_MS = 30 * 60 * 1000  // 30 min cap
const STALL_MS = 60 * 1000          // 60s sem bytes = "sem resposta"
const DRAFT_KEY = 'atlas.chat.draft'
const HISTORY_KEY = 'atlas.chat.inputHistory'  // ultimo N textos que o user mandou (setas navegam)

interface Conv { id: string; title: string; createdAt: number; updatedAt: number; msgCount: number }

export async function renderMainChat(panel: HTMLElement) {
  const state = await api.chat.history().catch(() => ({ conversation: null, messages: [], conversations: [], current: '' }))
  let thread: ChatMsg[] = state.messages
  let conversations: Conv[] = state.conversations as any
  let currentId: string = state.current

  panel.innerHTML = `
    <div class="chat-shell">
      <aside class="chat-sidebar" aria-label="Conversas">
        <div class="chat-side-head">
          <span>${icon('chat', 14)} Conversas</span>
          <button class="btn btn-ghost btn-sm" id="chat-new" title="Nova conversa" data-cmd="chat.nova-conversa">${icon('plus', 14)}</button>
        </div>
        <ol class="chat-conv-list" id="chat-conv-list" aria-label="Lista de conversas"></ol>
      </aside>
      <section class="chat-main">
        <header class="chat-head">
          <img class="chat-avatar" src="/heimdall.jfif" alt="" aria-hidden="true">
          <div class="chat-head-text">
            <h1>Heimdall</h1>
            <p class="chat-sub">Refere o mundo: <code>em atlas, …</code></p>
          </div>
          <div class="chat-actions">
            <button class="btn btn-ghost btn-sm" id="chat-clear" title="Limpar mensagens desta conversa" data-cmd="chat.limpar">${icon('trash', 14)} Limpar</button>
          </div>
        </header>
        <ol class="chat-thread" id="chat-thread" aria-live="polite"></ol>
        <div class="chat-typing" id="chat-typing" aria-live="polite" hidden><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="chat-typing-label">a responder…</span></div>
        <form class="chat-composer" id="chat-composer" autocomplete="off">
          <textarea id="chat-input" rows="2" placeholder='Ex: "em atlas, lista as 3 últimas notas"' aria-label="Mensagem para o agente"></textarea>
          <button class="btn btn-primary" id="chat-send" type="submit" data-cmd="chat.enviar">${icon('play', 14)} Enviar</button>
        </form>
      </section>
    </div>`
  paint(panel, thread)
  paintSidebar(panel, conversations, currentId)

  const input = panel.querySelector<HTMLTextAreaElement>('#chat-input')!
  const form = panel.querySelector<HTMLFormElement>('#chat-composer')!
  const clearBtn = panel.querySelector<HTMLButtonElement>('#chat-clear')!
  const newBtn = panel.querySelector<HTMLButtonElement>('#chat-new')!
  const convList = panel.querySelector<HTMLElement>('#chat-conv-list')!

  // ponytail: state-preservation (ui-ux-pro-max §8) — auto-save composer 300ms debounced.
  try { input.value = localStorage.getItem(DRAFT_KEY) || '' } catch {}
  let saveT = 0
  input.addEventListener('input', () => { clearTimeout(saveT); saveT = window.setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, input.value) } catch {} }, 300) })

  // ponytail: ↑/↓ navegam historico de inputs do user (request 6). Cmd/Ctrl+Enter submete. Esc focus.
  const hist = readInputHistory()
  let histIdx = hist.length  // past-the-end = "draft atual"
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); (form.querySelector('#chat-send') as HTMLButtonElement).click(); return }
    if (e.key === 'Escape') { input.focus(); return }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (histIdx > 0) {
        histIdx--
        input.value = hist[histIdx] || ''
        try { localStorage.setItem(DRAFT_KEY, input.value) } catch {}
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (histIdx < hist.length) {
        histIdx++
        input.value = hist[histIdx] !== undefined ? hist[histIdx] : ''
        try { localStorage.setItem(DRAFT_KEY, input.value) } catch {}
      }
    }
  })

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const text = input.value.trim()
    if (!text) return
    pushInputHistory(text)
    histIdx = readInputHistory().length
    input.value = ''
    try { localStorage.removeItem(DRAFT_KEY) } catch {}
    input.disabled = true; (form.querySelector('#chat-send') as HTMLButtonElement).disabled = true
    try {
      const { runId, conversationId } = await api.chat.send(text)
      if (conversationId !== currentId) {
        currentId = conversationId
        // refresh sidebar
        const s = await api.chat.conversations().catch(() => null)
        if (s) { conversations = s.conversations; paintSidebar(panel, conversations, currentId) }
      }
      thread.push({ role: 'user', text, ts: Date.now() })
      thread.push({ role: 'agent', text: '', ts: Date.now(), runId })
      paint(panel, thread)
      pollOutput(panel, thread, runId, () => api.chat.history().then((s) => { thread = s.messages; paint(panel, thread) }))
    } catch (err: any) {
      // request 7: erro inline no thread, NAO toast
      thread.push({ role: 'agent', text: '', ts: Date.now(), err: err?.message || 'erro' })
      paint(panel, thread, err?.message)
    } finally {
      input.disabled = false; (form.querySelector('#chat-send') as HTMLButtonElement).disabled = false
      input.focus()
    }
  })
  clearBtn.addEventListener('click', async () => {
    if (!confirm('Limpar mensagens desta conversa?')) return
    try { await api.chat.clear(); thread = []; paint(panel, thread) } catch { toast('Erro a limpar') }
  })
  newBtn.addEventListener('click', async () => {
    try {
      const s = await api.chat.newConversation()
      thread = s.messages; conversations = s.conversations as any; currentId = s.current
      paint(panel, thread); paintSidebar(panel, conversations, currentId)
      input.focus()
    } catch { toast('Erro a criar conversa') }
  })
  convList.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement
    const item = target.closest<HTMLElement>('[data-cid]')
    if (!item) return
    const id = item.dataset.cid!
    if (item.classList.contains('active')) return
    // click no X = delete
    if (target.closest('.conv-del')) {
      e.stopPropagation()
      if (!confirm('Apagar esta conversa?')) return
      try {
        const r = await api.chat.deleteConversation(id)
        if (r && r.current === currentId) {
          // ja nao e' a current; refresh
          const s = await api.chat.history()
          thread = s.messages; currentId = s.current; conversations = s.conversations as any
          paint(panel, thread); paintSidebar(panel, conversations, currentId)
        } else if (r) {
          const s = await api.chat.conversations()
          conversations = s.conversations; paintSidebar(panel, conversations, currentId)
        }
      } catch { toast('Erro a apagar') }
      return
    }
    try {
      const s = await api.chat.switchConversation(id)
      if (!s) return
      thread = s.messages; conversations = s.conversations as any; currentId = s.current
      paint(panel, thread); paintSidebar(panel, conversations, currentId)
    } catch { toast('Erro a trocar') }
  })
  // focus-on-route-change
  setTimeout(() => input.focus(), 0)
}

async function pollOutput(panel: HTMLElement, thread: ChatMsg[], runId: string, onSettle: () => void) {
  const showTyping = () => { const t = panel.querySelector<HTMLElement>('#chat-typing'); if (t) t.hidden = false }
  const hideTyping = () => { const t = panel.querySelector<HTMLElement>('#chat-typing'); if (t) t.hidden = true }
  const started = Date.now()
  let lastTs = Date.now()
  let offset = 0
  let lastText = ''
  const tick = async () => {
    if (Date.now() - started > MAX_POLL_MS) { hideTyping(); onSettle(); return }
    if (Date.now() - lastTs > STALL_MS) { hideTyping(); onSettle(); return }
    try {
      const d = await api.chat.output(runId, offset)
      showTyping()  // request 4: typing dots SEMPRE enquanto nao done
      if (d.chunk) {
        const last = thread[thread.length - 1]
        if (last && last.role === 'agent' && last.runId === runId) {
          last.text = (last.text || '') + d.chunk
          lastText = last.text
          paint(panel, thread); scrollToBottom(panel)
        }
        offset = d.offset
        lastTs = Date.now()
      }
      if (d.done) { hideTyping(); onSettle(); return }
    } catch { /* aguenta */ }
    setTimeout(tick, POLL_MS)
  }
  showTyping()
  tick()
}

function paint(panel: HTMLElement, thread: ChatMsg[], _errMsg?: string) {
  const ol = panel.querySelector<HTMLElement>('#chat-thread')!
  if (!thread.length) {
    ol.innerHTML = `<li class="chat-empty"><img class="chat-avatar chat-avatar--big" src="/heimdall.jfif" alt="" aria-hidden="true"><p>Olá — sou o <b>Heimdall</b>, o agente do Atlas. Refere o mundo: <code>em atlas, …</code></p><p>Exemplos:<br><code>em atlas, lista as 3 últimas notas</code><br><code>em foodlister, cria uma nota "reunião amanhã 10h"</code><br><code>em mimir, mostra os cards em doing</code></p></li>`
    return
  }
  ol.innerHTML = thread.map((m) => {
    if (m.role === 'user') {
      return `<li class="chat-msg chat-msg--user"><div class="chat-bubble chat-bubble--user">${miniMd(m.text)}</div></li>`
    }
    // agent
    const body = m.text ? miniMd(m.text) : (m.err ? `<span class="chat-err">${esc(m.err)}</span>` : '<em class="chat-pending">…</em>')
    return `<li class="chat-msg chat-msg--agent"><img class="chat-avatar" src="/heimdall.jfif" alt="" aria-hidden="true"><div class="chat-bubble chat-bubble--agent">${body}</div></li>`
  }).join('')
}

function paintSidebar(panel: HTMLElement, conversations: Conv[], currentId: string) {
  const ol = panel.querySelector<HTMLElement>('#chat-conv-list')!
  if (!conversations.length) {
    ol.innerHTML = `<li class="chat-conv-empty">Sem conversas.<br>Carrega + para criar.</li>`
    return
  }
  ol.innerHTML = conversations.map((c) => {
    const date = new Date(c.updatedAt).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    return `<li class="chat-conv ${c.id === currentId ? 'active' : ''}" data-cid="${c.id}">
      <div class="conv-title">${esc(c.title || 'conversa')}</div>
      <div class="conv-meta">${c.msgCount} msg · ${date}</div>
      <button class="conv-del" title="Apagar" aria-label="Apagar conversa" data-cmd="chat.apagar-conversa">${icon('trash', 12)}</button>
    </li>`
  }).join('')
}

function scrollToBottom(panel: HTMLElement) {
  const ol = panel.querySelector<HTMLElement>('#chat-thread')!
  ol.parentElement?.scrollTo({ top: ol.parentElement.scrollHeight, behavior: 'smooth' })
}

function esc(s: unknown) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }

// ponytail: render markdown mini (request 5). Bold, italic, code inline, code block, listas, links.
// NAO usa lib externa — DOMPurify-like basico escapa primeiro, depois aplica patterns.
function miniMd(src: string): string {
  let s = esc(src)
  // code blocks (fenced) primeiro — maior prioridade
  s = s.replace(/```([\s\S]*?)```/g, (_, code) => `<pre class="chat-code"><code>${code.trim()}</code></pre>`)
  // inline code
  s = s.replace(/`([^`\n]+)`/g, '<code class="chat-code-inline">$1</code>')
  // bold
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  // italic
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  // links: [text](url) — so http(s) para seguranca
  s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/)[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  // unordered lists (linhas que comecam com "- ")
  s = s.replace(/(^|\n)((?:- [^\n]+\n?)+)/g, (_, p, block) => `${p}<ul class="chat-list">${block.trim().split('\n').map((l: string) => `<li>${l.replace(/^- /, '')}</li>`).join('')}</ul>`)
  // newlines
  s = s.replace(/\n/g, '<br>')
  return s
}

// ponytail: input history (request 6) — guarda ate 50 inputs do user em localStorage. seta ↑/↓ navegam.
function readInputHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') || [] } catch { return [] }
}
function pushInputHistory(text: string) {
  const h = readInputHistory()
  if (h[h.length - 1] === text) return
  h.push(text)
  while (h.length > 50) h.shift()
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)) } catch {}
}
