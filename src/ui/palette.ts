import { api, Card } from '../api'
import { icon } from './icons'
import { navigate } from '../router'
import { launchRun } from '../views/kanban-vanilla'
import { quickAdd, newWorkdir } from '../views/shell-vanilla'
import { confirmDialog } from './confirm'
import { toast } from './toast'
import { openModal, readForm } from './modal'
import { renderMd } from './text'

// ponytail: palette keyboard-first (Ctrl+K). Overlay proprio (nao reusa openModal — obriga <form>
// + submit). Reutiliza: navigate (deep-link de workspace.ts p/ reabrir nota/cartao), quickAdd,
// newWorkdir e launchRun (o MESMO lançador dos botoes -> resultado identico ao clique).
type Item = { group: string; icon: string; title: string; sub?: string; search: string; run: () => void }

export function openPalette(slug: string | null) {
  if (document.querySelector('.palette-backdrop')) return
  const backdrop = document.createElement('div')
  backdrop.className = 'palette-backdrop'
  backdrop.setAttribute('role', 'dialog')
  backdrop.setAttribute('aria-modal', 'true')
  backdrop.setAttribute('aria-label', 'Palette de comandos')
  backdrop.innerHTML = `
    <div class="palette">
      <input class="palette-input" type="text" placeholder="Procurar workdir, nota, cartão ou ação…   (↑↓ navegar · Enter abrir · Esc fechar)" aria-label="Filtro da palette" autocomplete="off">
      <div class="palette-list"><div class="palette-empty">A carregar…</div></div>
    </div>`
  document.body.appendChild(backdrop)
  const input = backdrop.querySelector('.palette-input') as HTMLInputElement
  const list = backdrop.querySelector('.palette-list') as HTMLElement
  input.focus()

  let items: Item[] = []
  let active = 0
  let closed = false
  const close = () => { if (closed) return; closed = true; backdrop.remove() }

  const push = (g: string, iconName: string, title: string, search: string, run: () => void, sub?: string) =>
    items.push({ group: g, icon: iconName, title, sub, search, run })

  // Ações base — disponíveis mesmo sem workdir ativo (dashboard)
  push('Ações', 'sphere', 'Dashboard', 'dashboard inicio', () => { close(); navigate('/') })
  push('Ações', 'chat', 'Chat (cross-mundo)', 'chat agente mundo cross', () => { close(); navigate('/c') })
  push('Ações', 'plus', 'Novo mundo', 'novo mundo criar', () => { close(); newWorkdir() })
  // ponytail: card FAQ-and-how-to — atalhos de ajuda no common palette. Sem slug (visiveis no
  // dashboard). Reusa openModal (rung 2) + renderMd (rung 2 — markdown sem dep nova). Conteudo
  // curto e honesto, alinhado com o que o software realmente faz (palette Ctrl+K, modal kanban,
  // notes, settings, terminais, git). Atualizar quando fluxos novos entrarem.
  push('Ajuda', 'note', 'FAQ', 'faq perguntas duvidas ajuda help', () => { close(); showHelpModal('FAQ — perguntas frequentes', FAQ_MD) })
  push('Ajuda', 'doc', 'How to use', 'how to use como usar tutorial ajuda manual', () => { close(); showHelpModal('How to use — guia rápido', HOWTO_MD) })
  if (slug) {
    push('Ações', 'note', 'Novo nota ou cartão', 'novo nota cartao criar', () => { close(); quickAdd(slug) })
    push('Ações', 'gear', 'Definições', 'definicoes settings config', () => { close(); navigate('/w/' + slug + '/settings') })
    // ponytail: actions movidas do header do workspace (canto-sup-dir) -> Ctrl+K. Sensíveis ao slug.
    // Merge to main + Resolve conflito: POST /api/w/:slug/git/<op> + abre viewGitTerm (stream log headless).
    // Matar terminais deste mundo: POST /api/terms/kill-all (per-workdir). Diferente do kill-all-atlas
    // (cross-workdir) que ja existe mais abaixo.
    push('Git', 'forward', 'Merge to main', 'merge dev main headless', () => { close(); paletteGitOp(slug, 'merge-main') })
    push('Git', 'reset', 'Resolve conflito', 'resolve conflito merge dev', () => { close(); paletteGitOp(slug, 'resolve') })
    push('Terminais', 'kill', 'Matar terminais deste mundo', 'matar terminais mundo kill per-workdir',
      async () => { close()
        const ok = await confirmDialog({ title: 'Matar terminais de ' + slug, message: 'Fecha as janelas WezTerm abertas por cards em doing deste mundo. Continuar?' })
        if (!ok) return
        try {
          const r = await fetch('/api/terms/kill-all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug }) }).then(r => r.json())
          const k = (r && typeof r.killed === 'number') ? r.killed : 0
          toast(k > 0 ? (k + ' terminais fechados') : 'Nenhum terminal aberto')
        } catch (e: any) { toast('Erro: ' + (e?.message || e)) } })
    // ponytail: card terminal-control-v2 — abre wezterm no workdir ativo (palette Ctrl+K).
    push('Terminais', 'term', 'Abrir terminal WezTerm', 'abrir terminal wezterm cmd shell',
      () => { close()
        fetch('/api/terms/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug }) })
          .then(r => r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'servidor stale — faz restart do vite' : ('HTTP ' + r.status))))
          .then((d: any) => toast(d.ok ? 'Terminal aberto' : ('Erro: ' + (d.error || 'desconhecido'))))
          .catch(e => toast('Erro: ' + e.message)) })
    // ponytail: card terminal-control-v2 — master kill cross-workdir. Confirm-dialog antes.
    push('Terminais', 'kill', 'Matar todos os terminais do ATLAS', 'matar terminais atlas kill all cross',
      async () => { close()
        const ok = await confirmDialog({ title: 'Matar todos os terminais ATLAS', message: 'Fecha todos os WezTerm abertos por qualquer workdir. Cards em doing passam a todo. Continuar?' })
        if (!ok) return
        try {
          const r = await fetch('/api/terms/kill-all-atlas', { method: 'POST' }).then(r => r.json())
          const k = (r && typeof r.killed === 'number') ? r.killed : 0
          const w = (r && typeof r.worlds === 'number') ? r.worlds : 0
          toast(k > 0 ? `${k} terminais fechados em ${w} mundo${w !== 1 ? 's' : ''}` : 'Nenhum terminal aberto')
        } catch (e: any) { toast('Erro: ' + (e?.message || e)) } })
    // ponytail: card grill-me-palette — items Skills criam cards pré-preenchidos
    // carregando a skill no hermes (card.skills -> spawn env ATLAS_CARD_SKILLS).
    // Sem pré-filtro: se skill não está instalada, launchRun falha com toast claro.
    push('Skills', 'aura', 'Grill-me — entrevista a plano/decisão', 'grill me stress test plano decisao entrevista',
      () => { close(); runSkillCard(slug, 'grill-me', SKILL_PROMPT_GRILL_ME) })
    push('Skills', 'aura', 'Grilling — stress-test contínuo', 'grilling stress test decision',
      () => { close(); runSkillCard(slug, 'grilling', SKILL_PROMPT_GRILLING) })

  }

  const visible = () => {
    const q = input.value.trim().toLowerCase()
    return q ? items.filter(it => it.search.toLowerCase().includes(q)) : items
  }
  const render = () => {
    const vis = visible()
    if (!vis.length) { list.innerHTML = '<div class="palette-empty">Sem resultados</div>'; return }
    active = Math.min(active, vis.length - 1)
    let html = ''
    let last = ''
    vis.forEach((it, i) => {
      if (it.group !== last) { html += `<div class="palette-group">${esc(it.group)}</div>`; last = it.group }
      html += `<div class="palette-item${i === active ? ' active' : ''}" data-i="${i}" role="option" aria-selected="${i === active}">
        <span class="picon">${icon(it.icon as any, 16)}</span><span class="ptitle">${esc(it.title)}</span>${it.sub ? `<span class="psub">${esc(it.sub)}</span>` : ''}</div>`
    })
    list.innerHTML = html
    list.querySelector('[data-i="' + active + '"]')?.scrollIntoView({ block: 'nearest' })
    list.querySelectorAll<HTMLElement>('.palette-item').forEach(el =>
      el.addEventListener('click', () => visible()[parseInt(el.getAttribute('data-i')!, 10)]?.run()))
  }

  input.addEventListener('input', () => { active = 0; render() })
  input.addEventListener('keydown', e => {
    const vis = visible()
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, vis.length - 1); render() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render() }
    else if (e.key === 'Enter') { e.preventDefault(); vis[active]?.run() }
    else if (e.key === 'Escape') { e.preventDefault(); close() }
  })
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close() })

  // carga assincrona dos dados: workdirs todos (navegação) + notas/cards do workdir ativo
  ;(async () => {
    const workdirs: Array<{ slug: string; name: string }> = await api.workdirs().catch(() => [])
    workdirs.forEach(w => push('Workdirs', 'sphere', w.name, 'workdir ' + w.name + ' ' + w.slug,
      () => { close(); navigate('/w/' + w.slug) }, w.slug))
    if (slug) {
      const [notes, board] = await Promise.all([
        api.notes.get(slug).catch(() => null), api.kanban.get(slug).catch(() => null),
      ])
      notes?.items.forEach(n => { if (!n.archived) push('Notas', 'note', n.title, 'nota ' + n.title,
        () => { close(); navigate('/w/' + slug + '?tab=notes&open=' + n.id) }, 'Nota') })
      board?.cards.forEach(c => { if (c.archived) return
        push('Cartões', 'board', c.title, 'cartao ' + c.title,
          () => { close(); navigate('/w/' + slug + '?tab=kanban&open=' + c.id) }, 'Cartão')
        if (c.colId === 'todo' || c.colId === 'doing')
          push('Ações', 'play', 'Correr: ' + c.title, 'correr executar ' + c.title,
            () => { close(); runPaletteCard(slug, board, c) },
            c.colId === 'doing' ? 'reiniciar' : 'executar')
      })
    }
    render()
  })()
}

// ponytail: espelha o runCard da vista kanban p/ o resultado ser identico ao clique nos botoes
// (lança o run + move o card para 'doing' + PUT). Usa o board ja carregado (tem a etag `ver`).
async function runPaletteCard(slug: string, board: { ver: number; cards: Card[] }, c: Card) {
  if (!(await launchRun(slug, c))) return
  c.colId = 'doing'; c.startedAt = Date.now()
  await api.kanban.put(slug, board as any).catch(() => {})
  navigate('/w/' + slug + '?tab=kanban')
}

function esc(s: unknown) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }

// paletteGitOp: handler partilhado para items "Merge to main" / "Resolve conflito" da palette.
// POST arranca headless; abre modal com stream offset-based do log (viewGitTerm). op 'resolve'
// mapeia para log id 'resolve-conflict' (route != log). Duplicado de workspace.ts (gitOp/viewGitTerm)
// porque mover para módulo neutro é mais código que esta cópia — YAGNI.
function paletteGitOp(slug: string, op: string) {
  const opId = op === 'resolve' ? 'resolve-conflict' : op
  const label = op === 'resolve' ? 'Resolve merge conflito' : 'Merge dev → main'
  fetch(`/api/w/${slug}/git/${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
    .then(r => r.json()).then((d: any) => {
      if (d && d.ok) { toast('A ' + label + ' em segundo plano (headless)'); viewGitTerm(slug, opId, label) }
      else toast((d && d.error) || 'Erro ao iniciar ' + label)
    }).catch(() => toast('Falha ao iniciar ' + label))
}

function viewGitTerm(slug: string, opId: string, label: string) {
  let offset = 0
  let pre = document.createElement('pre')
  pre.className = 'term-view'
  pre.textContent = ''
  let timer: ReturnType<typeof setInterval> | undefined
  const body = () => `<div class="term-wrap">${pre.outerHTML}<div class="term-status" id="${opId}-gstatus">ainda não lançada</div></div>`
  const m = openModal({ title: label + ' · ' + slug, submitText: 'Fechar', cancelText: 'Fechar', body, onSubmit: () => { if (timer) clearInterval(timer) } })
  pre = m.root.querySelector('.term-view') as HTMLPreElement
  const statusEl = m.root.querySelector('.term-status') as HTMLElement
  const tick = async () => {
    try {
      const d = await api.run.output(slug, opId, offset)
      if (d) {
        if (d.chunk) { pre.textContent += d.chunk; pre.scrollTop = pre.scrollHeight }
        offset = d.offset
        if (d.done) {
          if (timer) clearInterval(timer)
          statusEl.textContent = d.code === 0 ? 'concluído ✓' : ('terminou com erro (código ' + d.code + ') — vê o log acima')
          statusEl.classList.toggle('err', !!(d.code !== 0))
          return
        }
        if (d.started === false && !pre.textContent) { statusEl.textContent = 'ainda não lançada'; return }
        statusEl.textContent = '● a trabalhar (update 1s)'
      }
    } catch { /* aguenta — server pode reiniciar */ }
  }
  timer = setInterval(tick, 1000)
  tick()
  const obs = new MutationObserver(() => { if (!m.root.isConnected) { if (timer) clearInterval(timer); obs.disconnect() } })
  obs.observe(document.body, { childList: true })
}

// ponytail: card grill-me-palette — cria card com skills[] pré-preenchido, prompt template
// do mundo (nome+descrição do workdir), e corre. Idêntico ao runPaletteCard mas cria o card.
async function runSkillCard(slug: string, skill: string, promptTemplate: string) {
  try {
    const [board, wdm] = await Promise.all([
      api.kanban.get(slug).catch(() => null),
      api.meta(slug).catch(() => null),
    ])
    if (!board) { toast('Kanban nao carregou'); return false }
    const ctx = {
      slug,
      name: (wdm && wdm.name) || slug,
      description: (wdm && wdm.description) || '',
    }
    // ponytail: input do objetivo/decisão antes de criar o card (reusa openModal — rung 2)
    const goal = await new Promise<string | null>(resolve => {
      const m = openModal({
        title: skill === 'grill-me' ? 'Grill-me: qual o plano?' : 'Grilling: qual a decisão?',
        body: () => '<div class="field"><label for="grill-q">Objetivo / decisão</label>' +
          '<textarea id="grill-q" name="goal" rows="6" autofocus placeholder="Descreve em 2-5 linhas…"></textarea></div>',
        submitText: 'Iniciar grilling',
        cancelText: 'Cancelar',
      })
      const form = m.root.querySelector('form')!
      form.addEventListener('submit', e => { e.preventDefault(); resolve(readForm(form).goal?.trim() || null); m.close() })
      m.root.querySelector('[data-act=cancel]')!.addEventListener('click', () => { resolve(null); m.close() })
    })
    if (goal === null) { return false }  // ponytail: cancel = no-op
    const desc = promptTemplate
      .replace(/\${{slug}}/g, ctx.slug)
      .replace(/\${{wdm\.name}}/g, ctx.name)
      .replace(/\${{wdm\.description}}/g, ctx.description || '(sem descricao)')
      .replace(/<descreve[\s\S]*?>/i, goal)  // ponytail: substitui placeholder pelo input
    const newCard: Card = {
      id: Math.random().toString(36).slice(2, 10),
      colId: 'todo',
      title: skill === 'grill-me' ? 'Grill-me: plano' : 'Grilling: decisao',
      description: desc,
      priority: 'medium' as const,
      ts: Date.now(),
      archived: false,
      // ponytail: headless (sem skills) — terminal do wezterm-gui é desnecessário. Reply é via modal da UI.
    }
    board.cards.push(newCard)
    const saved = await api.kanban.put(slug, board)
    if (saved && saved.ver) board.ver = saved.ver
    const ok = await launchRun(slug, newCard)
    if (!ok) return false
    newCard.colId = 'doing'; newCard.startedAt = Date.now()
    await api.kanban.put(slug, board).catch(() => {})
    navigate('/w/' + slug + '?tab=kanban')
    return true
  } catch (e) {
    toast('Erro skill: ' + ((e as any)?.message || String(e)))
    return false
  }
}

// ponytail: card FAQ-and-how-to — abre modal com markdown renderizado. openModal ja tem scroll
// interno (.modal-body overflow-y:auto) + Esc/Ctrl+Enter — nao precisamos de chrome proprio.
function showHelpModal(title: string, md: string) {
  openModal({
    title,
    body: () => `<div class="md-view help-doc">${renderMd(md)}</div>`,
    submitText: 'Fechar',
    cancelText: 'Fechar',
  })
}

// FAQ — 6 Q&A curtas, sem rodeios. Texto honesto, alinhado com o codebase (palette, kanban, notes).
const FAQ_MD = [
  '## FAQ — perguntas frequentes',
  '',
  '**1. O que é o ATLAS?**',
  'Atlas é um dashboard para gerir **mundos** (workdirs). Cada mundo tem kanban + notas + terminais + git isolados.',
  '',
  '**2. Como abro o common palette?**',
  'Ctrl+K em qualquer vista. Pesquisa workdirs, notas, cartões ou ações.',
  '',
  '**3. Como crio um cartão novo?**',
  'Ctrl+K → "Novo nota ou cartão" (ou no palette, escreve "novo"). Funciona dentro de um mundo.',
  '',
  '**4. Onde ficam guardados os dados?**',
  'Em `data/atlas/<slug>/` dentro deste repo: `kanban.json` + `notes/`. Tudo em git, versionado.',
  '',
  '**5. Como corro um agente (DR/DP/DA) num cartão?**',
  'Botão ▶ no cartão ou Ctrl+K → "Correr: <título>". Abre WezTerm headless e stream do log fica no card.',
  '',
  '**6. E se um cartão fica preso em "doing"?**',
  'Ctrl+K → "Matar terminais deste mundo". Limpa WezTerm órfão. Cartão passa a `todo` na próxima ação.',
  '',
  '**7. Como vejo o histórico de runs?**',
  'Cartão aberto → secção `kresult` (resultado). Cada run fica como bloco com output markdown.',
  '',
  '**8. Posso ter vários mundos ao mesmo tempo?**',
  'Sim. Sidebar esquerda lista todos. Cada um com o seu kanban/notas/git independentes.',
  '',
].join('\n')

// HOWTO — passos numerados, fluxo real: criar mundo -> cartão -> correr -> review -> done.
const HOWTO_MD = [
  '## How to use — guia rápido',
  '',
  '### 1. Criar um mundo novo',
  '- Sidebar esquerda → **+ Novo mundo** (ou Ctrl+K → "Novo mundo").',
  '- Dá um nome + descrição curta. Aparece na sidebar com a sua orb.',
  '',
  '### 2. Adicionar um cartão',
  '- Abre o mundo → separador **Kanban**.',
  '- Ctrl+K → "Novo nota ou cartão" (ou clica no header).',
  '- Escreve título + descrição (markdown é renderizado).',
  '',
  '### 3. Correr o cartão (DR / DP / DA)',
  '- Cartão em `todo` → botão ▶ / Ctrl+K → "Correr: …".',
  '- Cartão passa para `doing` automaticamente.',
  '- Output chega como blocos `kresult` no próprio cartão (markdown).',
  '',
  '### 4. Rever e aprovar',
  '- Quando o run termina, cartão vai para **Revisão**.',
  '- Abre o cartão → botões **Aprovar** / **Refinar**.',
  '- Aprovar → `done`. Refinar → volta a `doing` com o teu feedback.',
  '',
  '### 5. Notas',
  '- Separador **Notas** dentro do mundo.',
  '- Markdown livre, links `[[wiki]]` entre notas (ver 4.5).',
  '- Atalhos: Ctrl+K → "Notas" filtra e abre.',
  '',
  '### 6. Git',
  '- Ctrl+K → "Merge to main" (merge dev → main headless).',
  '- Ctrl+K → "Resolve conflito" se o merge falhar.',
  '- Output abre em modal com stream do log.',
  '',
  '### 7. Atalhos úteis',
  '- **Ctrl+K** — common palette',
  '- **Esc** — fechar modal/palette',
  '- **Ctrl+Enter** — submeter modal',
  '',
].join('\n')

const SKILL_PROMPT_GRILL_ME = [
  '# Atlas world: ${{wdm.name}}',
  '',
  'Skill: grill-me (entry point). Carrega a skill "grilling" e interrogar-me sobre o plano/decisao que descrevo abaixo. Trabalha em rounds (frontier), nao shotgun. Quando a frontier esvaziar, confirma a compreensao partilhada e espera. NAO atues sem confirmacao.',
  '',
  '## Contexto',
  '- Mundo: ${{wdm.name}} (slug: ${{slug}})',
  '- Descricao: ${{wdm.description}}',
  '',
  '## O que quero grillar',
  '<descreve o plano / decisao / design que queres stress-test>',
  '',
  '## Notas no fim',
  'Quando acabares, cria notas em /api/w/${{slug}}/notes com cada decisao settled (1 nota por decisao; tags: grilled, decision).',
].join('\n')

const SKILL_PROMPT_GRILLING = [
  '# Atlas world: ${{wdm.name}}',
  '',
  'Skill grilling carregada. Stress-test continuo da decisao que descrevo abaixo. Mesmas regras da skill: design tree, rounds, frontier, nao atues sem confirmacao partilhada.',
  '',
  '## Contexto',
  '- Mundo: ${{wdm.name}} (slug: ${{slug}})',
  '- Descricao: ${{wdm.description}}',
  '',
  '## A decisao a stress-test',
  '<descreve a decisao>',
  '',
  '## Notas no fim',
  'Mesma convencao: 1 nota por decisao settled, tags grilled + decision.',
].join('\n')
