---
title: Atlas — recover kanban + fix null-write PUT (1 sprint)
date: 2026-09-01
type: DP
project: atlas
branch: dev
depends_on: 2026-09-01-kanban-wipe-atlas-DR.md
status: draft
---

# DP — Recover kanban + fix null-write root cause

## Goal

1. Recuperar `kanban.json` para o estado do ultimo backup valido (117 cards).
2. Fechar o caminho que permite um PUT vazio/invalido overwritear o ficheiro.
3. Limpar 4 orphans em `running` ha 8h+.

Zero arquitectura nova. Ponytail ladder:
- Stdlib `fs.copyFileSync` em vez de sh-tool custom.
- Type guard inline (3 LOC) em vez de middleware de validation.
- Backup do estado pré-fix para rollback manual.

## Estado actual

- `data/atlas/kanban.json`: 0 cards (corrompido).
- Backup valido: `.backup/kanban-2026-09-01T03-42-49-183Z.json` (117 cards).
- 4 .status orphans (8h+ em running).
- `kanban-saved.json`: 59 cards (28-ago, divergente — ignorar).
- `server/api.ts`:1305 LOC, L1286 writeJ sem guard.
- Branch: dev. Ultimo merge: `b321d9d`.

## Plano de execucao

### Fase 0 — snapshot pre-recovery (30s)

Copia do estado corrupido para auditoria (não commitavel):

```bash
cp data/atlas/kanban.json data/atlas/.archive/kanban-corrupted-2026-09-01.json
cp data/atlas/.backup/kanban-2026-09-01T03-43-24-347Z.json data/atlas/.archive/kanban-backup-null-2026-09-01.json
```

(`.archive/` é dir existente para artifact dumps.)

### Fase 1 — recover kanban (1 min)

```bash
cp data/atlas/.backup/kanban-2026-09-01T03-42-49-183Z.json data/atlas/kanban.json
# bump ver p/ evitar OT conflict no proximo PUT do front
# ver no backup = 678. Adicionar +1 no ficheiro restaurado.
# Use Python p/ nao corromper (Node JSON.stringify e' OK tambem).
node -e "const fs=require('fs');const p='data/atlas/kanban.json';const d=JSON.parse(fs.readFileSync(p));d.ver=(d.ver||0)+1;fs.writeFileSync(p,JSON.stringify(d,null,2))"
```

Idem em `live-data/atlas/kanban.json` (mirror). Verificar via GET que tem 117 cards.

### Fase 2 — fix null-write (5 min)

Patch em `server/api.ts`, +3 LOC na L1286. Antes:

```ts
// L1276-1286 (current)
if (kind === 'notes' && b && Array.isArray(b.items)) { ... }
await writeJ(file, b); send(200,{ok:true, ver: ...}); return
```

Depois:

```ts
// ponytail: guarda contra PUT vazio/invalido (card null-write-fix) — body() devolve null quando
// Content-Length=0 ou JSON invalido; sem guard, writeJ grava 'null' no ficheiro e wipeia tudo.
if (!b || typeof b !== 'object') { send(400, { error: 'invalid body' }); return }
const arrKey2 = kind === 'notes' ? 'items' : (kind === 'kanban' ? 'cards' : null)
if (arrKey2 && !Array.isArray(b[arrKey2])) { send(400, { error: 'invalid body: missing ' + arrKey2 + ' array' }); return }
if (kind === 'notes' && Array.isArray(b.items)) { ... sanitize existing ... }
await writeJ(file, b); send(200,{ok:true, ver: ...}); return
```

Diff real: **+5 LOC** (o `arrKey2` ja estava la em `arrKey` L1240, vou reusar).

### Fase 3 — orphans done (1 min)

```bash
for id in 3vqiv9r9 4xkd8ch3 bf40nwcx yaegl05k; do
  echo '{"state":"done","ts":1788264953.999459,"orphanRecovered":true}' > data/.wt/runs/atlas/$id.status
done
```

### Fase 4 — test seam para nao regressar (10 min)

Adicionar 1 teste em `test/side-effect-routes.test.mjs` (Tier B DP) — reusa o pattern
NO_SPAWN. Cobertura:

- PUT kanban com body vazio → 400, ficheiro intacto
- PUT kanban com `null` JSON → 400, ficheiro intacto
- PUT kanban com `{}` sem `cards` → 400, ficheiro intacto
- PUT kanban com `{ver:N, cards:[...]}` → 200, ficheiro escrito

Source anchor: `L1286 writeJ` + o novo guard.

### Fase 5 — commit + atlas-testing skill bump (5 min)

Commit message (BMS confirma, nao auto):

```
fix(atlas): PUT body guard prevents kanban wipe (card null-write-fix)

Body() devolve null em Content-Length=0 ou JSON invalido. writeJ gravava 'null' (4 bytes)
e wipeava kanban.json. Backup pre-PUT capturava o estado JA corrompido (vitima, nao causa).

- 5 LOC guard em api.ts L1286 (notes + kanban, reusa arrKey existente)
- 1 teste em side-effect-routes.test.mjs (4 cases)
- Recovery: kanban.json restaurado do backup 03:42:49 (117 cards)
- 4 orphans .status marcados done (3vqiv9r9,4xkd8ch3,bf40nwcx,yaegl05k)
```

Bump `atlas-testing` skill: nota no `## Pitfalls` sobre "body() returns null on empty".

## Diff budget

- 1 ficheiro: `server/api.ts` (+5 LOC)
- 1 ficheiro: `data/atlas/kanban.json` (restored)
- 4 ficheiros: `data/.wt/runs/atlas/*.status` (done)
- 1 ficheiro: `test/side-effect-routes.test.mjs` (+30 LOC, 4 cases)
- 1 ficheiro: skills bump

## Pitfalls

- **NAO restaurar `kanban-saved.json`**: tem 59 cards de 28-ago, divergente.
  Decisao: backup 03:42:49 é fonte da verdade.
- **Bump `ver`**: front tem cached ver; sem bump, primeiro PUT do front leva 409.
- **Orphans recovery**: marcar como `done` impede promote fantasma; o card em si
  fica `doing` no kanban restaurado (z0ibeh7f e 4xkd8ch3) — utilizador decide refazer.
- **B1 close-event**: este fix nao fecha B1. Bug separado (memory). Continua em
  `2026-09-01-integration-harness-close-blocked-DP`.

## Verification

```bash
# recovery
curl -s http://localhost:5176/api/w/atlas/kanban | jq '.cards | length'  # expected: 117

# guard
curl -s -X PUT http://localhost:5176/api/w/atlas/kanban -H 'X-Atlas-Token: $WTOKEN' -d 'null' | jq .  # expected: 400
curl -s -X PUT http://localhost:5176/api/w/atlas/kanban -H 'X-Atlas-Token: $WTOKEN' -d '' | jq .  # expected: 400

# tests
scripts/run_tests.sh test/side-effect-routes.test.mjs -q
```
