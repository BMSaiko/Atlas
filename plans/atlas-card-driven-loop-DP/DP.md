# DP — atlas-card-driven-loop (2026-09-05)

> Super Prompt: `knowledge/infra/super-prompts/atlas-kanban-card-driven-loop-2026-09-05.md`
> Branch: `atlas/card-driven-loop` (from `dev` @ `ef2e022`)
> Pattern-fit: **Hexagonal** (Card/Board/Worker = domain; HTTP routes + PID file + git worktree = adapters)
> Cadence: per-phase commit after gates RC=0

## What you should know before signing off

1. **PID-tracking fork (resolved via ponytail default).** SP §6 asks for `runs/<slug>/<cardId>.pid`. `runCard` (`server/lib/run-card.mjs`) does NOT surface `child.pid`. SP §5 says: "Must keep `server/lib/run-card.mjs` argv shape (BUG 3b family). Touch only the args array passed by `launchHermes`, NOT the helper's signature or argv layout."
   **Ponytail default (applied):** add ONE optional field to `runCard`'s opts (`pidPath?: string`). The helper writes `String(child.pid)` to that file right after spawn. The 2 existing callers (`w:approve-agent` via `runHermesHeadless`, `launchHermes` via `runCard`) do NOT pass `pidPath` → zero BC break. This is **NOT a signature change** — it's an additive optional parameter that defaults to no-op. If you reject this default, the alternative is `wmic process where CommandLine contains <wt>` lookup (race-prone) — say so.
2. **Refuses on body > 200KB** (SP §5) → 400 `{ error: 'SP too large' }`. Soft-cap 100KB is a soft warning (toast in UI, not server rejection).
3. **`runs/<slug>/<cardId>.pid` lifetime:** created in `launchHermes` after spawn, deleted by `cleanupRuns` (existing 7d rule already handles it). The new `killWorkerForCard` is a narrow targeted kill — does NOT touch the existing `cleanupRuns` logic.
4. **`openSPModal` reuses `openModal`** (no new modal framework). Adds 1 hidden input + 1 textarea. Esc cancels, Ctrl+Enter submits — same keybinds as `openModal`.
5. **Status chip polls `runs/<slug>/<cardId>.pid` every 5s** while `colId === 'doing'`. Polling stops on column change (MutationObserver on the card root). NOT SSE (per SP §4).
6. **No drive-by refactor** of `run-card.mjs` core logic (heartbeat, C1 sanitise, auto-merge spawn). Only the optional `pidPath` add-on is touched.
7. **`npm test` runs 46 of the 48 tests by default** (per `package.json` line 9; `run-integration.test.mjs` + `syncvault-debounce.test.mjs` are in `test:integration`). 46 + new = target. SP says "48 existing tests pass" — counted all 48; integration runs separately.

## Audit table (per phase)

| phase | what exists today | what changes after | redundant? |
|---|---|---|---|
| 1. Schema | `Card` interface has 23 fields incl. `dp`, `crashRetry`, `skills` | `Card` adds 2 OPTIONAL fields: `superPromptBody?: string`, `superPromptRef?: string` | no — 0 existing field records the SP text/ref |
| 2. SP persistence | `POST /api/w/:slug/run` exists; `notes.put` writes a `ver`-fenced doc | new `POST /api/w/:slug/kanban/sp` validates + persists `{cardId, body, ref}`, bumps `ver`, 400/409 errors | no — no existing endpoint writes SP fields |
| 3. Refine endpoint | `w:run` re-spawns by deleting worktree + `worktree add` (existing `launchHermes` always rebuilds wt) | new `POST /api/w/:slug/kanban/refine` reuses same wt, kills old PID via `killWorkerForCard`, calls `launchHermes` (rebuilds wt — same as today) | no — no existing endpoint kills the worker's Python PID |
| 4. Kill-on-transition | `PUT /api/w/:slug/kanban` calls `killPaneForCard` on column exit (L645-657) | same handler ALSO calls `killWorkerForCard` (narrow `taskkill /F /PID`) | no — current helper kills pane only, NOT python worker |
| 5. launchHermes SP injection | `interpolate(run-card, { ..., cardDp, ... })` at L417-427 | inject `cardSP` block BEFORE `cardDp` in the `interpolate` call; add `${cardSP}` placeholder to `prompts/run-card.md` | no — current prompt has no SP slot |
| 6. UI buttons + modal + chip | `kops(c)` returns run/dp/term/reply per colId | `todo` adds `generate-sp` (when no SP) or keeps `run` (when SP); `review` adds `refine`; chip shows `agent: running (pid NNNN)` in `.kstates` | no — current buttons do not gate on SP presence |

## Phases (TDD cycles)

### Phase 1 — Schema (Card interface + typecheck)
- **Seams:** `interface Card` in `src/api.ts:10`. Add 2 optional fields. Existing fields unchanged. (Confirmed: read L10 — single-line interface.)
- **Red:** `tsc --noEmit` rc=1 if any consumer reads `card.foo` without `?`.
- **Green:** add `superPromptBody?: string` + `superPromptRef?: string`. No consumer code reads them yet → typecheck stays green.
- **Tautology:** the test "the new fields exist" is tautology (it tests the type system). Skip — `tsc --noEmit` is the gate. Document in report.

### Phase 2 — SP persistence (POST `/api/w/:slug/kanban/sp`)
- **Seams:** new route in `server/routes/w.ts`. Match: `["w", null, "kanban", "sp"]`. Method POST. Length 4. Deps: same `readJsonBody, readJ, writeJ, SLUG, inside`.
- **Red:** write `test/sp-persistence.test.mjs`:
  1. happy: POST with `body ≥50` + `ref` valid → 200, board re-read shows field persisted + `ver` bumped.
  2. body < 50 → 400 `{ error: 'SP too short (min 50 chars)' }`.
  3. body > 200000 → 400 `{ error: 'SP too large' }`.
  4. ver mismatch → 409.
- **Green:** handler reads board, finds card, validates `body.length` (50 ≤ n ≤ 200000), validates `ref` is a relative path under `knowledge/infra/super-prompts/` (regex `^knowledge/infra/super-prompts/[A-Za-z0-9_\-. /]+\.md$`), persists both fields, increments `ver`, writeJ. Returns `200 { ok: true, ver }`.
- **Tautology:** the "ref is a relative path under super-prompts/" test would be tautology if we tested only `typeof ref === 'string'` — must check it does NOT accept `/etc/passwd` or `C:\Windows\...`.
- **UI side:** update `kops(c)` `todo` branch: if `!c.superPromptBody`, push `generate-sp` button; else keep `run` button. Add `data-act="generate-sp"` handler in `bind()` that opens `openSPModal`.

### Phase 3 — Refine endpoint (POST `/api/w/:slug/kanban/refine`)
- **Seams:** new route + new helper `killWorkerForCard(slug, cardId)` in `server/api.ts` (sibling of `killPaneForCard`).
- **Red:** write `test/sp-refine.test.mjs`:
  1. happy: POST with new body+ref → 200, board re-read shows updated fields, status of card remains `review` (NOT bumped to `done`), old PID file gone, new spawn attempted (`ATLAS_TEST_NO_SPAWN=1` → spawn is no-op).
  2. PID file missing → idempotent skip, returns 200 (refine still works).
  3. PID file present but stale (already-dead process) → narrow `taskkill` returns ENOENT/ESRCH-equivalent, we ignore, return 200.
- **Green:** `killWorkerForCard` reads `<wtRoot>/runs/<slug>/<cardId>.pid`, narrows via `taskkill /F /PID <pid>` (PowerShell call mirroring `killWtLockers` pattern at L223-230). If file missing → noop. If `taskkill` returns non-zero → log warn + proceed. Then `launchHermes(slug, card)` is called (existing function rebuilds wt + spawns new worker). Card colId is NOT changed.
- **Tautology:** the "happy" test must assert that the OLD PID file is gone AND that the route persists the new body — otherwise it's testing the wrong layer.
- **UI side:** add `data-act="refine"` button in `kops(c)` `review` branch. Handler opens `openSPModal` pre-filled with current `c.superPromptBody`.

### Phase 4 — Kill-on-transition (extend PUT `/api/w/:slug/kanban`)
- **Seams:** `PUT /api/w/:slug/kanban` kill block at `server/routes/w.ts:649-658`. Add `killWorkerForCard` call after `killPaneForCard`.
- **Red:** write `test/sp-kill-transition.test.mjs`:
  1. card transitions `doing → todo` with PID file alive → after PUT, `killWorkerForCard` was called (spy via mock OR assert PID file is `taskkill`-ed in test env). Use `ATLAS_TEST_NO_SPAWN=1` and verify `runs/<slug>/<cardId>.pid` is absent after PUT.
  2. PID file absent → handler returns 200, no error.
- **Green:** in the existing L649-658 loop, add a second `void killWorkerForCard(slug, a.id)` after the existing `void killPaneForCard(slug, a.id)`. Reuse `killWorkerForCard` from Phase 3 (defined in `server/api.ts`).
- **Tautology:** testing "killWorkerForCard exists" is tautology. Test must assert the PUT handler invokes it — easiest via spy on the deps object.

### Phase 5 — launchHermes SP injection
- **Seams:** `interpolate(await loadPrompt('run-card'), { ... })` at `server/api.ts:417-427`. Inject `cardSP` before `cardDp`. Add `${cardSP}` placeholder to `server/prompts/run-card.md` between `${cardDescription}` and `${cardDp}`.
- **Red:** extract `buildRunPrompt(card, ctx, prompt)` as a pure function (no FS, no spawn). Unit-test it:
  1. card without `superPromptBody` → prompt contains `"SEM SUPER PROMPT"` sentinel + NO SP body.
  2. card WITH `superPromptBody` of 1000 chars → prompt contains the first 200 chars + `"PRIORITY-READ"` header + the sentinel is ABSENT.
  3. SP body is interpolated BEFORE `cardDp` (string position check).
- **Green:** add `cardSP` derivation at L414: `const cardSP = card.superPromptBody ? 'SUPER PROMPT (priority-read, source of truth):\n\n' + card.superPromptBody + '\n' : 'SEM SUPER PROMPT — derive intent from card title + description + dp.'`. Pass into `interpolate`. Add `${cardSP}` to template after `${cardDescription}` line.
- **Tautology:** testing "prompt length grew" is tautology. Test must check SPECIFIC strings (the sentinel + the priority-read header) at SPECIFIC positions.
- **CRLF caveat:** `server/prompts/run-card.md` is CRLF-tracked (`text=auto eol=crlf`). When patching, read bytes → patch bytes → write bytes (per michi pitfall).

### Phase 6 — UI: modal + buttons + status chip
- **Seams:** `openModal` from `src/ui/modal.ts` (re-exported). `kops(c)` at `kanban-vanilla.ts:403`. `kcard` template at L378-387 (`.kstates` div at L381 is the chip insertion point).
- **Red:** write `test/sp-ui-buttons.test.mjs` (DOM-level — load the view module via the test harness or use a minimal jsdom). If jsdom is unavailable, this test becomes a SOURCE EQUALITY test (verify `kops` string contains the right `data-act` for the right colId + SP-presence combos).
- **Green:**
  - Add `openSPModal(c, ctx)` sibling to `openReplyModal` (L131). Uses `openModal({ title: 'Generate SP · ' + c.title, body: () => '<textarea name="body" rows="14">' + esc(c.superPromptBody || '') + '</textarea><input type="hidden" name="ref" value="' + esc(c.superPromptRef || defaultRefPath(slug)) + '">', submitText: 'Guardar', onSubmit: ... })`. POSTs to `/api/w/<slug>/kanban/sp`.
  - Patch `kops(c)`: `todo` branch — `if (!c.superPromptBody) b.push('<button data-act="generate-sp">${icon(\"pencil\",15)}</button>'); else b.push('<button data-act="run">${icon(\"play\",15)}</button>')` (current `run` button becomes the "start-run" gate). `review` branch — push `<button data-act="refine">${icon(\"pencil\",15)}</button>`.
  - Add `data-act="generate-sp"` and `data-act="refine"` to the click router at L495-500.
  - Add `agentRunningChip(c)` helper that returns `<span class="kbadge kbadge-run">agent: running (pid NNNN)</span>` when `colId === 'doing'`. Insert in `.kstates` div at L381 before `stateChip(c)`. Polling: fetch `runs/<slug>/<id>.pid` via new `api.runs.pid(slug, id)` (server endpoint returns 200 `{ pid: number|null, mtime: number }` or 404). 5s `setInterval` while colId === 'doing'. `MutationObserver` on the card root stops the poll when disconnected.
- **Tautology:** testing "the modal opens" is tautology. Test must assert the SP body is sent in the POST (mock `fetch` and inspect).

## Risks

- **PID race.** Between `spawn()` returning and the PID file write, a kill-on-transition could fire and miss the PID. Mitigation: write PID file BEFORE calling `runCard` (write `placeholder = 0`, overwrite with real PID inside `runCard`). Ponytail: write `<runs>/<cardId>.pid` with `String(child.pid)` AFTER `runHermes`'s `spawn()` returns — adds ~5ms race window. **Acceptable** because kill-on-transition only fires on user PUT (column drag) — rare vs 5ms.
- **Status chip stale PID.** PID file persists after worker exits (until `cleanupRuns` runs). Chip would show ghost PIDs. Mitigation: chip also reads `<runs>/<cardId>.status` (existing). If `status.state !== 'running'`, hide chip. OR: chip polls `process` via `tasklist /FI "PID eq <pid>"` — adds latency. **Ponytail:** chip polls BOTH `runs/<slug>/<cardId>.pid` AND `runs/<slug>/<cardId>.status`. Hides chip when status says `done`.
- **`openSPModal` doesn't auto-load existing SP into textarea** if user already submitted once. Fix: `textarea value = esc(c.superPromptBody || '')` — confirmed in seam.
- **CRLF re-normalisation on `run-card.md`.** `text=auto eol=crlf` means git WILL normalise on commit. Read bytes → patch → write bytes preserves CRLF. Verify `git ls-files --eol` after each patch.

## Out of scope (YAGNI, from SP)

- Visual redesign of kanban (colors, drag, layout).
- PR-via-gh workflow for approve.
- New schema field for `phase` (derive from colId+skills+dp+crashRetry — existing).
- Migrating `kanban.tsx` to vanilla.
- Lighthouse/axe gates (no perf clause in SP).
- Hermes skill auto-loading from card.skills (untouched).

## Done-when (mirrors SP §8)

A new card in `/w/atlas`:
1. Generate SP modal opens with empty textarea.
2. Submit body ≥50 chars → persists `superPromptBody` + `superPromptRef`.
3. Play moves to `doing` → status chip shows live PID.
4. Worker commits in worktree → auto-merge into `dev` → moves to `review` via existing `w:approve-agent` gate.
5. Refine → SP body+ref update → old PID gone → new worker spawns in same wt.
6. Approve → ff-merge `dev` → `main` → card `done`.
7. Drag from `doing` to `todo` mid-run → PID killed within 1s.

All 48 existing tests pass + 4 new test files. Typecheck rc=0. Build rc=0 (sibling `.ci-gate/<ts>/`). Zero drive-by refactors. Zero schema bumps beyond 2 optional fields.
