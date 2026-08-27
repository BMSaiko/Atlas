# Changelog

Todas as mudanças notáveis do Atlas. Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-PT/1.1.0/), versionamento em `0.x`.

## [Unreleased]

### Added
- Documentação README abrangente + CHANGELOG.

## [0.1.0] — app-shell + workdirs + kanban

### Added
- Vite+TS SPA: shell com sidebar workdirs (keybind `Ctrl+1..9`, item activo gold) + painel.
- Workdirs isolados (`data/<slug>/{meta,notes,kanban}.json`), hub `/`, workspace `/w/:slug`, settings.
- Quicknotes com busca; kanban (To Do / Em Curso / Review / Done), prioridade, drag & drop nativo.
- Design cosmos/noite com auto-shift dia↔crepúsculo, acessibilidade AA.

### Added (task-runner)
- Card kanban → `POST /api/w/:slug/run`: WezTerm + Hermes oneshot em worktree git própria; `doing` automático, `result` gravado no card, polling no front.
- Fluxo Review `/api/w/:slug/review/{approve|reject}`: `done` manual (BMS) com `merge dev → main` no approve; reject volta a `doing`.
- Vite watcher ignora `data/**` (fix full-reload ao criar worktree).
- Links clicáveis (gold) em texto livre via `linkify` (`src/ui/text.ts`).
- Sidebar counts re-sync após mutação kanban (`refreshSideCount` no `save()`).
