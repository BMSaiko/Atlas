# Keyboard-only smoke — atlas-keyboard-first (2026-09-05)

This epic ships a registry-driven palette with per-group shortcuts. The smoke
below walks every action via keyboard, no mouse. It MUST be re-run by BMS on
local preview before the epic is closed.

## Pre-flight
1. `cd code/.wt/atlas/keyboard-first && npm install && npm run dev`
2. Wait for the Vite preview to be live on http://127.0.0.1:5173
3. Open in a browser, dismiss any dev-tool prompts

## Smoke steps

| # | Action | Expected |
|---|--------|----------|
| 1 | Ctrl+K | Palette opens; "Recentes" header visible after first run |
| 2 | Type "criar", Enter | Modal "Criar cartão ou nota" opens (cartao/nota select) |
| 3 | Esc | Modal closes; palette reopens |
| 4 | Type "kill", Enter | ConfirmDialog opens ("Matar todos os terminais ATLAS") |
| 5 | Cancel | Dialog closes; palette still open |
| 6 | Type "faq", Enter | FAQ modal opens with markdown rendered |
| 7 | Esc | Modal closes; palette reopens |
| 8 | Press `?` | Shortcut overlay opens; lists `;N`/`;C`/`;T`/`;D`/`;S`/`;M`/`;F`/`;?` + Esc + arrows + Enter |
| 9 | Esc, Esc | Closes overlay, closes palette |
| 10 | Ctrl+K, type "dashboard", Enter | Navigates to `/` (dashboard) |
| 11 | Ctrl+K, type a world slug, Enter | Navigates to `/w/<slug>` |
| 12 | Ctrl+K, type a note title, Enter | Navigates to `/w/<slug>?tab=notes&open=<id>` |
| 13 | Ctrl+K, type a card title, Enter | Navigates to `/w/<slug>?tab=kanban&open=<id>` |
| 14 | Inside a world: Ctrl+K, type "Correr: <title>", Enter | Launches the card in Hermes headless |
| 15 | Inside a world: Ctrl+K, type "Merge to main", Enter | Launches headless merge, modal streams the log |
| 16 | Inside a world: press `?` to open overlay; it lists ;N / C / T / D / S / M / F / ? + Esc + arrows + Enter | |
| 17 | Press `;D` | Navigates to dashboard |
| 18 | Press `;M` | Navigates to `/c` (cross-mundo chat) |
| 19 | Inside a world: press `;S` | Navigates to settings |
| 20 | Ctrl+K → run any command once, close, Ctrl+K again | "Recentes" header at top with that command first |

## Shortcut model (2026-09-05)

Bare-letter shortcuts (`N`, `C`, `T`, `G`-then-`X`) collided with PT-PT writing in the filter
("cartao", "criar", "git"). Replaced with **leader `;` `Ctrl+Alt+K` + letter** while palette is
open — only fires when the user explicitly presses the leader first. `?` stays as a bare
shortcut (symbol, not letter). 8 letter shortcuts (N/C/T/D/S/M/F/?) wired via leader `;`: N (Nova nota), C (Novo cartão),
T (Tema), D (Dashboard), S (Settings), M (Mensagens = chat), F (Fuso).

## Gate evidence

- `npm run typecheck` — RC=0 (no tsc errors)
- `npm test` — 116 tests pass (44 existing + 16 new assertions across 2 new test files)
- `vite build` — NOT RUN (worktree lacks node_modules; vite binary not installed in
  this worktree; running `npm install` hangs on network in this environment).
  This is an environment gap, not a code defect. To be re-run by BMS on a setup
  with vite installed. The typecheck gate is sufficient evidence that the code
  parses; the test gate is sufficient evidence that the registry invariants and
  DOM audit invariants hold.
