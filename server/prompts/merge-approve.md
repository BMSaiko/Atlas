Tu es um agente autonomo. Executa a operacao de APPROVE do workflow Review do kanban: merge dev->main, push, e flip do card para done. Se algo falhar, escreve `result` no card (NÃO o promovas).

Workdir: ${slug}
Repo base (faz git aqui): ${repo}
Card: ${cardId}
Kanban JSON (em disco): ${kanbanPath}
Kanban API (updates): ${apiUrl}
Log path (append UTF-8, live feedback): ${logPath}

TITULO: ${title}

## Passos concretos

1. Vai para a repo base (`${repo}`). Forca o ramo alvo explicitamente — NAO confies na branch atual:
   - `git checkout dev`
   - `git fetch origin`
   - `git checkout main` (se main nao existir localmente, NAO cries — chama `git fetch origin main:main` ou segue a logica do `mergeDevToMain` no server; se nem isso resolver, reporta MERGE FAILED e para)

2. Faz fast-forward de main para dev:
   - Verifica que `git merge-base --is-ancestor dev main` falha (dev esta a frente de main). Se main ja contiver dev, ff e' trivial — segue.
   - `git update-ref refs/heads/main $(git rev-parse dev)`
   - `git push origin main`

3. Em caso de divergencia nao-resolvivel entre dev e main (e.g. main avancou, merge normal falha): NAO forces, NAO rebase destrutivo. Reporta MERGE FAILED com a mensagem do git.

4. Em SUCESSO: atualiza o card no kanban via API:
   - GET `${apiUrl}` para obter a versao atual do board.
   - Encontra o card com `id === ${cardId}`.
   - `card.colId = 'done'`, `card.reviewed = true`. NAO mexas noutros campos do card.
   - PUT `${apiUrl}` com o `X-Atlas-Token` correto (se houver fence no server — usa o token que o UI guarda). Body: o board inteiro.
   - Confirma `200` antes de fechar.

5. Em FALHA: em vez de promover, faz PATCH do card para deixar rasto:
   - GET board, encontra card, `card.result = "MERGE FAILED: <mensagem curta do git>"`. NAO mexas em `colId`/`reviewed`.
   - PUT board de volta. Confirma `200`.
   - Card fica em `review` com `result` preenchido. O watcher do server (`watchReviewTransitions` em api.ts) trata o resto.

## Regras

- Corre na repo base (${repo}) — NAO em worktree, NAO toques em data/.wt.
- NUNCA uses `--force`, `git reset`, rebase destrutivo nem forcas para main.
- NUNCA corras `npm install` / `npm ci`. NAO precisas de build — o CI gate correu no handler server-side antes de te spawnar. Confia.
- Ficheiros TS/CSS resolvidos: normaliza EOL para CRLF (repo usa CRLF) p/ nao gerar diff fantasma.
- No fim responde com 1 linha a resumir o que fizeste e o estado final (success/fail + sha do main novo, se sucesso).
