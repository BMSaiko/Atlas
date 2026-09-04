---
type: plan
project: atlas
epic: A-foundations
status: awaiting user sign-off
date: 2026-09-04
super-prompt: 2026-09-04 (atlas-design-polish-2026-09-04)
supersedes: plans/2026-09-04-polish-A-foundations-DP-v1/DP.md
---

# DP — atlas polish-A-foundations (2026-09-04) — v2 (recovery)

## DR synthesis (1 screen)

WHERE THE CHANGE LANDS
- 3 CSS files (tokens.css, base.css, components.css) under code/src/styles/
- 4 contract card classes (verbatim, audited in components.css): .wd-card, .note-card, .kcard (NOT .k-card as SP typo), .card-block
- Excluded from card uniformity: .foco-card (settings layout block), .sess-card (list row)
- Worktree path: code/.wt/atlas/polish-A-foundations/, branch polish/A-foundations
- The branch + dir already exist on disk with UNCOMMITTED work from a prior interrupted session; this DP is the recovery plan, not a clean start

WHAT THE CHANGE MUST RESPECT (HARD INVARIANTS)
- tokens.css — existing --s1..7, --r1..3, cosmos palette, [data-shift], [data-season] — UNTOUCHED
- base.css — existing :focus-visible outline — KEPT
- components.css — 64 KB, 801 lines, 284 selectors — single source of visual truth
- Stack: vanilla TS, no framework, no new deps unless lighthouse-ci + @axe-core/cli absent (then devDependencies only)
- Routes frozen, server byte-identical
- Local dev is +1 ahead of origin/dev (6fb66e9) — push deferred, user decides
- Stash stash@{0} on dev: PRESERVED, NEVER TOUCHED in this epic (per prior DP)
- esbuild CSS minifier trips on custom-property names with inner dashes (michi pitfall 2026-09-04). --space-1 / --radius-1 would fail the build. The prior session correctly skipped them as aliases of existing --s1..7 / --r1..3. Honor that call — add only the scales the minifier accepts.

CURRENT REPO STATE (3 SP-forks, defaults applied since user did not answer within window)
1. Worktree: dir + branch already exist. The dir is prunable (.git pointer missing). git worktree prune then git worktree add .wt/atlas/polish-A-foundations polish/A-foundations (no -b) re-registers the existing dir+branch without losing on-disk changes.
2. Stash stash@{0}: 10 files / 709 insertions of main-chat polish touching server/** — SP forbids. LEAVE STASHED. (default 2=a)
3. Lighthouse perf 91 on /: SP gate is >=95. RE-RUN ONCE on the recovered state and trust the new number. If still <95, file a single perf-focused sub-phase (lazy-load chat history, code-split modals) — but only after the first re-run. (default 3=a)
4. Recovery intent (default 1=a): keep on-disk work, finish axe/screens/smoke, fix perf, commit. Wipe-and-restart is a $30min mistake since the prior session work is the answer to A1+A3+A4 already.

PRIOR SESSION DELIVERED (REUSED, NOT REDONE)
- A1 token scales (shadow / z / motion / ease) in tokens.css — verified
- A3 card uniformity base selector in components.css — verified
- A4 :focus:not(:focus-visible) mouse-only reset in base.css — verified
- A2 components.css SECTIONED (banner approach, not 8-file split) — verified, same byte-count, navigation improved

PRIOR SESSION DELIVERED (PARTIAL, NEEDS RE-RUN)
- Lighthouse index.json exists, perf=91 (fails SP >=95), a11y=100, bp=96
- .axe/ empty — never finished
- .screens/ empty — never finished
- Smoke flow not scripted on disk
- No commit ever landed on polish/A-foundations

## Goal

Ship Epic A as a single commit on polish/A-foundations, then merge to dev (BMS reviews).
Foundations = tokens + components.css navigability + uniform cards + focus AA.

## Phases (TDD-shaped)

| #  | Phase                       | What exists today                                                                                                | What changes after                                                                                                                                                                  | Redundant?       |
|----|-----------------------------|------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------|
| A0 | Worktree recovery           | dir exists, prunable registration, branch same as dev                                                            | git worktree prune + git worktree add (no -b) re-registers the dir; on-disk uncommitted changes preserved; .git pointer restored                                                   | no (one-time)    |
| A1 | Token scales (additive)     | tokens.css already has --shadow-1..3, --z-*, --motion-*, --ease-* from prior session with ponytail: comment      | Verify, re-read, add nothing. (Skip --space-*/--radius-* per esbuild minifier pitfall — kept as --s*/--r*.)                                                                       | no (verify-only) |
| A2 | components.css split        | 64 KB, 801 lines, 284 selectors, single file, with sectioned banners (03-09)                                     | Already sectioned by prior session. Verify banner order matches file content; fix any drift. No 8-file @import split — banner approach is correct (michi pitfall 2026-09-04)         | no (verify-only) |
| A3 | Card uniformity             | Already has base selector .wd-card, .note-card, .kcard, .card-block { background/border/border-radius }          | Verify the selector sits ABOVE the per-class overrides. Visual diff: same colors, same spacing. NO new class names on TS side.                                                       | no (verify-only) |
| A4 | Focus AA hardening          | Already has :focus:not(:focus-visible) { outline: none }                                                         | Verify; keyboard nav regression test: tab from / to a kanban card.                                                                                                                  | no (verify-only) |
| A5 | Gate re-run                 | .lighthouse/A/index.json exists, perf=91; .axe/, .screens/ empty                                                | Re-run all 4 gates. Capture .lighthouse/A/{index,perf}.json, .axe/A/{a,b,c,d}.json (one per route), .screens/A/{before,after}-<route>.png. vite build MUST use --outDir .ci-gate/<ts>/ sibling dir (michi pitfall 2026-09-04). | no |
| A6 | Perf recovery (conditional) | Lighthouse perf=91 (fails SP >=95)                                                                              | If A5 perf >=95: skip. If 91-94: targeted sub-phase (lazy-load chat history module, defer non-critical CSS via <link media=print onload=…>, code-split kanban.ts modals). If <90: stop, surface to BMS, ask. | yes-if-A5-passes |
| A7 | Commit + report             | polish/A-foundations HEAD == dev HEAD (no commits)                                                              | Single commit polish(epic-A): … on the branch. Per-epic report shape (terse, ponytail).                                                                                              | no               |

## Seam test plan

- A0 — git -C .wt/atlas/polish-A-foundations rev-parse --abbrev-ref HEAD returns polish/A-foundations; git status --short lists ONLY the uncommitted A1-A4 work (no server/, no stash contents).
- A1-A4 — diff against the v1 DP to prove the on-disk state is what the v1 DP designed. Anything missing = go fix.
- A5 — 4 routes x 2 tools = 8 artifact sets. Each lighthouse run produces a JSON; each axe run produces a JSON with violations: [] for the 4 routes.
- A6 — only runs if A5 perf < 95. Sub-test: re-run vite build and confirm bundle is smaller; lighthouse perf target >= 95.
- A7 — git log polish/A-foundations ^dev --oneline returns exactly 1 commit. Files in commit: src/styles/{tokens,base,components}.css, .gitignore if data/ was added, the DP.md plan file.

## Gates (per SP section 4)

- tsc --noEmit RC=0
- npm test RC=0
- vite build RC=0, no new warnings, outDir = .ci-gate/<ts>/, never dist/
- npm run build && npm run preview -> Lighthouse on /, /w/<any>, /w/<any>/settings, /c >= 95/95/95
- @axe-core/cli per route, 0 violations
- Smoke flow (scripted, manual, 0 console errors / 0 4xx-5xx): create note -> tag -> archive -> restore -> card todo->doing->review->done -> archive -> Ctrl+K palette opens -> navigate worlds -> open settings -> toggle theme -> toggle season
- Screenshots before/after in .screens/A/ (8 PNGs: 2 per route)
- Reports in .lighthouse/A/ and .axe/A/

## Risks

- Worktree trap (michi pitfall 2026-09-03) — main checkout is code/, worktree is code/.wt/atlas/polish-A-foundations/. All edits inside the worktree MUST use execute_code with the absolute path to the worktree. read_file / search_files may resolve to a sibling path. Cheapest integrity check: wc -l before and after every patch.
- CSS cascade order — sectioned banners in components.css must remain in cascade order. After re-arrangement, run npm test and the visual smoke.
- esbuild minifier + custom-property names with inner dashes — --space-1 style tokens would fail the build. Already mitigated by skipping those scales.
- Lighthouse perf variance — 91 vs 95 on the same code is plausible across runs. Re-run, average, then decide.
- Stash explosion — if anything in this session needs to touch server/** or the stashed files, the contract is broken. STOP and surface to BMS.
- PWA SW regen on build — vite-plugin-pwa regenerates the service worker. Do not accidentally break offline install.

## Out-of-scope (per SP section 5)

- Epic B (empty states, onboarding, sidebar collapse, mobile<768, hub repolish) — separate session.
- Epic C (skeleton, drag feedback, theme transitions, micro-states, pomodoro, toasts) — separate session.
- server/** — byte-identical.
- code/src/router.ts — routes frozen.
- Stash stash@{0} (previous session polish) — preserved untouched.

## Pattern-fit

Transaction Script (michi catalogue). Epic A is a one-pass structural refactor: tokens + split + uniform cards + focus hardening. No new domain logic, no external integration, no state machine. Anything heavier (DDD aggregate, CQRS, etc.) = ceremony without payoff.

## Stack-fit

- ui-styling — SKIPPED (shadcn/Tailwind/React, wrong stack — vanilla TS).
- ui-ux-pro-max — applied via axe + Lighthouse gates (stack-agnostic rules).
- design-system — token architecture already in SP section 6 + existing tokens.css; re-using existing scales, additive only.
- Ponytail full mode active: smallest working diff, stdlib/native first, no new deps.

## Commit cadence

One commit per phase boundary (per michi pitfall 2026-09-02). A0-A4 = recovery+verify = 1 commit (the polish). A5-A6 = gate runs = 0 commits (artifacts go to .lighthouse/, .axe/, .screens/, .ci-gate/, all gitignored). A7 = the merge commit, with report in the message body.

## Commit message (NOT auto-committed)

    polish(epic-A): token scales + components.css sectioned + uniform cards + focus AA

    - tokens.css: additive --shadow-1..3, --z-side/panel/modal/toast/palette, --motion-fast/base/slow, --ease-standard/emphasized
    - base.css: :focus:not(:focus-visible) mouse-only reset
    - components.css: sectioned with banners (03 LAYOUT .. 09 MISC), single file preserved
    - card uniformity: .wd-card .note-card .kcard .card-block share background/border/radius via single base selector
    - gates: tsc/test/build RC=0, lighthouse perf/a11y/bp >= 95, axe 0 violations
    - esbuild minifier note: --space-*/--radius-* skipped (inner-dash custom-property names)

## What you should know before signing off

- This is a recovery plan, not a clean start. v1 DP (now at -v1 suffix) was already signed off; v2 supersedes it because the on-disk state is real and re-doing it is wasted work.
- Per-phase commit cadence proposed because Epic A has 7 phases. Confirm or say one big commit only.
- The previous session stash@{0} is the elephant in the room. If you want it surfaced in a separate decision (when? what to do?), say so. Default: leave it alone for this epic, flag it in the report as a known unaddressed item, deal with it post-merge.
- Lighthouse perf 91 may go away on re-run. If it does not, the A6 sub-phase is a real risk to the schedule. Be ready to make the call at A5.
