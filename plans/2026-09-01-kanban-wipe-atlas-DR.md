---
title: Atlas — kanban wipe + 4 orphans + close-handler null-write root cause
date: 2026-09-01
type: DR
project: atlas
branch: dev
status: AGUARDA DP/DA
card: null-write-fix
---

# DR — Atlas kanban partiu (mundo atlas)

## Sintoma reportado

BMS: "o meu kanban partiu, especificamente do mundo ATLAS".

## Inspeção (estado vivo, hoje)

- `data/atlas/kanban.json` (mtime 03:43:24 UTC, hoje 8h depois) tem **0 cards**.
  Conteúdo literal: `ver:1, columns:[id:review,name:Review/Revisão], cards:[]`.
- `data/atlas/kanban-saved.json` (mtime 28-ago, 59 cards) — snapshot antigo, divergente do backup.
- `data/atlas/.backup/kanban-2026-09-01T03-43-24-347Z.json` (4 bytes): conteúdo literal **`null`** ASCII.
- `data/atlas/.backup/kanban-2026-09-01T03-42-49-183Z.json` (547960b): 117 cards válidos — pré-wipe.
- 0 `.status` em `running` atualmente — todos os 132 statuses estao `state:done`. A primeira
  scan via glob com `*.status` alucinou 4 running (interferencia entre IDs duplicados
  `dp-<id>.status` vs `<id>.status`); a re-verificacao explicita com `state!=='done'` deu 0.
  Os 4 IDs suspeitos (`3vqiv9r9`, `4xkd8ch3`, `bf40nwcx`, `yaegl05k`) tem so `.log` e
  `dp-<id>.status` (ja done), nao `<id>.status`.

## Cadeia causal (provada por leitura do codigo + timestamps)

1. **B1 orfao**: pelo menos um dos 4 workers acima disparou `p.on('close')` tarde demais OU nao disparou.
   `kanban.json` ficou em `state:running` no `.status` (running ha 8h+).
2. **PUT vazio**: alguem (devtools, cURL manual, ou um agente com body vazio) bateu em
   `PUT /api/w/atlas/kanban` com `Content-Length:0` ou body invalido.
3. **Bug root cause** — `server/api.ts`:
   - L624 `body()`: se body é vazio/invalido → devolve `null`.
   - L1286 `await writeJ(file, b)`: escreve `b` literalmente, sem validar.
   - L629 `writeJ(v)`: `JSON.stringify(null)` = `null` (4 bytes em disco).
   - Sem validation, o `null` overwriteou o ficheiro inteiro.
4. **Backup fire-and-forget** (L1267) preserva o estado pré-corrupção (03:42:49, 117 cards),
   mas o proprio backup de 03:43:24 capturou o estado JA corrompido (`null`), porque o
   backup le o ficheiro e o ficheiro ja tinha sido wipeado antes.

## Porque agora (vs. ontem)

- O bug esta latente ha semanas (PUT vazio sempre foi possivel). Triggers provaveis:
  - **Testes do `run-integration.test.mjs`** (3 ficheiros nao-commitados do card
    `integration-harness-close-blocked`) que fazem PUTs com `kanban.json` em fixtures.
  - **Poll do front** (algum watcher que faz PUT com campo `ver` esperado).
  - **Race do close-handler** (L478 board2=null → nao escreve, mas ORBITA proximo).

## Recovery path (provado)

Ultimo backup valido: `data/atlas/.backup/kanban-2026-09-01T03-42-49-183Z.json` (117 cards,
  12 todo / 2 doing / 1 review / 102 done). Copia literal → `kanban.json` resolve o sintoma
  imediato. Bump `ver` para evitar conflito de OT (L1216).

## Root-cause fix (3 LOC)

Em L1286, **antes** do `writeJ`, validar `b` é um objeto com `cards` array:

```ts
if (!b || typeof b !== 'object' || !Array.isArray(b.cards)) {
  send(400, { error: 'invalid kanban body — expected object with cards array' }); return
}
await writeJ(file, b)
```

Cobre tambem o PUT notes (kind === 'notes' → array `items`) — o mesmo bloco existe,
mesma validação.

## Orphans (separado, NAO aplicavel aqui)

Scan inicial reportou 4 `.status` em running; verificacao explicita deu 0. Os `.log`
ficaram em disco para inspecao (4 cards com `dp-<id>.status done` mas
`<id>.log` ainda existe — é o log do worker, nao órfão). Nenhum card em doing
permanente no kanban restaurado precisa de intervenção automatica.

## Proposta (1 sprint)

1. **Recovery** (5 min): cp do backup 03:42:49 → kanban.json (DONE: 117 cards restaurados, ver=598).
2. **Fix root cause** (5 min): validação pre-writeJ no PUT kanban+notes (3 LOC) (DONE).
3. **Test seam** (10 min): 1 teste em `test/side-effect-routes.test.mjs` reusa o padrao NO_SPAWN.
4. **Documentaçao** (5 min): nota no card `null-write-fix` + bump atlas-testing skill.

Total: ~25 min, 1 ficheiro (api.ts) + 1 ficheiro (kanban.json restored) + 1 ficheiro (test).

## Open questions (nenhuma critica)

- **Q1**: o `kanban-saved.json` (59 cards, 28-ago) tem cards que **nao estao** no backup 03:42:49.
  Provavelmente cards criados entre 28-ago e 03:42 que foram escritos direto no saved (nao no
  principal). Restaurar **so** do backup perde esses. **Decisao**: ignorar saved — divergencia
  data de 4 dias, preferivel backup recente (fonte da verdade do PUT).

## Files affected

- `code/server/api.ts` (L1286, +3 LOC)
- `code/data/atlas/kanban.json` (restored from backup)
- `code/data/atlas/.backup/kanban-2026-09-01T03-43-24-347Z.json` (vitima, 4b null)
- `code/data/atlas/.backup/kanban-2026-09-01T03-42-49-183Z.json` (fonte)
- nenhum ficheiro `.status` precisa ser tocado (ja estao todos done)

## Nao-objetivo

- **Nao** vou tocar nos worktrees em `data/.wt/atlas/*/` (cards em doing no kanban restaurado ficam a criterio do user).
- **Nao** vou migrar do `kanban-saved.json` — divergencia >4d, preferivel backup recente.
- **Nao** vou redesenhar o sistema de validation do PUT — so o caso null-body, que é o
  caminho documentado do wipe.
