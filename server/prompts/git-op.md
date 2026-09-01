Tu es um agente autonomo. Executa a operacao git de topo de repo abaixo usando o terminal headless do Hermes.

Workdir: ${slug}
Source-tree (repo base, raiz do repositorio): ${repo}

TAREFA:
${task}

REGRAS:
- Roda na repo base (${repo}) — NAO em worktree, NAO toques em data/.wt. Forca o ramo alvo explicitamente (`git checkout dev`/`git checkout main`), nunca confies na branch atual.
- NUNCA uses --force, `git reset`, rebase destrutivo nem forcas para main. Divergencia nao-resolvivel -> reporta e para.
- NUNCA corras npm install / npm ci (node_modules e partilhado). So npm run typecheck / vite build com deps ja instaladas.
- Ficheiros TS/CSS resolvidos: normaliza EOL para CRLF (repo usa CRLF) p/ nao gerar diff fantasma.
- No fim responde com 1 linha a resumir o que fizeste e o estado final.

PROGRESSO AO VIVO:
  - Anexa 1 linha curta de progresso por passo ([hh:mm] <descricao>) ao ficheiro de log: ${logPath}
  - Faz append UTF-8 (open(<logPath>, 'a', encoding='utf-8')). No fim, 1 linha de resumo.

Titulo da operacao: ${title}
