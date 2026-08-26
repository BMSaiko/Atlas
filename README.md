# ATLAS

> O titã que sustenta os céus — hub pessoal de produtividade com workdirs isolados (quicknotes + kanban por projecto).

Cada projecto é um **workdir** independente: ao entrar vês apenas as quicknotes e o kanban desse workdir. Trocar de workdir = trocar de contexto, nunca misturar.

## Stack
- Vite + TypeScript (vanilla, zero framework de UI pesado)
- Persistência local em ficheiros JSON por workdir (`data/<slug>/{meta,notes,kanban}.json`), servida por uma mini-API embutida no Vite dev/preview
- Drag & Drop nativo (HTML5), zero libs de runtime

## Correr
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # build de produção -> dist/
npm run preview  # serve o build + API (persistência funciona igual)
```

## Dados
- `data/index.json` — lista de workdirs
- `data/<slug>/meta.json` — nome, descrição
- `data/<slug>/notes.json` — notas
- `data/<slug>/kanban.json` — colunas + cartões

`data/` é versionado no git — backup = clone do repo.

## Rotas
- `/` — hub: cards dos workdirs + contagens + criar
- `/w/:slug` — workspace (tabs Notas | Kanban)
- `/w/:slug/settings` — editar workdir, colunas, eliminar

## Design
- Cosmos azul-noite → quase-preto; accents gold/mármore
- Auto-shift dia (blue/sky) ↔ entardecer/noite (gold/crepúsculo) por hora
- Workdir activo em cor-cheia; restantes desaturados
- Prioridade kanban = só cor semântica (gold/âmbar/vermelho-aurora), com texto
- acessível: contrastes AA, prefers-reduced-motion, focos visíveis
