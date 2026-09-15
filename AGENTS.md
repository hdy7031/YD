# Repository Guidelines

## Scope and Instruction Order

YD (Your Day / DayHub) is a local-first Windows personal-work hub: courses and schedules, tasks, reminders, person-aware status, and a low-interruption desktop companion. Optimize in this order: stability, data correctness, clear domain modeling, maintainability, and a coherent visual experience. Do not trade those properties for a quick demo.

Follow the current user request first, then a more-specific nested `AGENTS.md` or `AGENTS.override.md`, then this file. Keep a task limited to the requested outcome; identify unrelated debt without changing it. Before any non-trivial change, inspect `git status`, the current branch, relevant recent commits, affected code, and its test baseline. Preserve user changes: never reset, stash, overwrite, rebase, merge, switch branches, or rewrite history unless explicitly asked.

## Repository Map and Tooling

This is an npm project (`package-lock.json`) using Electron, TypeScript in strict mode, React, esbuild, electron-builder, and sql.js. Honor `engines.node` in `package.json`. Future AI, message-understanding, and external-integration work must preserve the same local-first, user-confirmed model; it does not make an unimplemented integration a production capability.

- `src/` contains domain modules, persistence, Electron main/preload code, and `ui/`; `src/state/` owns current-state derivation.
- `tests/` contains Node built-in test files (`*.test.ts`) and committed migration fixtures in `tests/fixtures/`.
- `scripts/` contains build, fixture, import, audit, visual, and verification utilities. `brand/`, `src/ui/assets/`, and `native/` hold shipped assets; `docs/` records durable design and acceptance material.
- Build output belongs in `dist/`; installer output belongs in `release/`. Do not commit generated output, caches, logs, private AppData, or test data.

## Standard Commands and Verification

- `npm ci` installs the locked dependency set.
- `npm run build` bundles main and UI into `dist/`; `npm start` builds then launches Electron.
- `npm test` runs `node --test tests/*.test.ts`; `npm run typecheck` runs `tsc --noEmit`.
- `npm run fixtures:build` intentionally regenerates committed test fixtures. `npm run assets:companion` runs the companion-asset generator.
- `npm run dist -- --config.electronDist=node_modules/electron/dist` builds the x64 NSIS installer using the local Electron runtime. Packaging is a release step, not a default consequence of an ordinary change.

Select the verifier that covers the change: root `verify-*.cjs` scripts; `scripts/verify-*.{cjs,mjs}`; `scripts/verify-upgrade.mjs`; `scripts/ui-audit.cjs`; and `scripts/visual-*.cjs`. Electron/UI verifiers may need `npx electron <script>`. This repository has no lint script. Do not weaken tests or assertions to manufacture a pass.

### Proportionate Verification

The goal is to prove the current change correct, not to run the maximum number of commands. Default to the smallest sufficient verification set that covers the actual risk.

Do not run unrelated full tests, UI audits, visual verifiers, installer builds, fixture rebuilds, repeated smoke checks, or repeated static audits merely to complete a process.

#### Level 0 — Docs, AGENTS, comments, non-runtime code

Examples: `AGENTS.md`, `docs/`, `README`, comments, and copy changes that do not alter runtime logic.

Default:
- Inspect `git diff`.
- Check formatting or references only if the edit requires it.

Do not run `npm test`, typecheck, build, Electron, or UI verifiers unless the change itself requires it.

#### Level 1 — Low-risk local changes

Examples: a single non-core UI event, local display logic, a small utility function with no persistence effect, or a clearly scoped small bug fix.

Default:
- Run the directly relevant targeted test or verifier.
- Run `npm run typecheck` when TypeScript types may be affected.

Full `npm test` is not required by default. If no targeted test exists, use the lightest check that still proves the change.

#### Level 2 — Core logic changes

This level remains strict for:
- StateEngine.
- Schedule/routine/manual state derivation.
- Time and cross-midnight semantics.
- Persistence.
- Database schema and migrations.
- IPC, preload, and Electron main.
- Profile, solo, and companion semantics.
- Avatar runtime and fallback.
- Important data conversion.
- Cross-module refactors.

Default:
- `npm run typecheck`.
- Relevant targeted tests or verifiers.
- `npm test` when the change may affect multiple domain modules.

Do not add unrelated visual audits or packaging.

#### Level 3 — Release, migration, and high-risk system changes

Use the full relevant gate for:
- A formal release.
- Installer or packaging work.
- Database migrations.
- Large architecture refactors.
- Multiple domain modules changing together.
- An explicit user request for full acceptance.
- Preparing a stable version to merge or tag.

The relevant gate may include:
- `npm test`.
- `npm run typecheck`.
- Relevant targeted verifiers.
- `npm run build`.
- Necessary Electron smoke checks.
- Necessary visual or UI audits.
- Necessary installer verification.

Run only the parts that are actually relevant.

### No Redundant Verification

- If a check passed in the same task and no code it covers changed afterward, do not rerun it.
- After fixing a failed check, rerun only that check and any necessary higher-level gate.
- Do not rerun passing commands solely to produce the final report.
- Do not repeat tests merely because the content is unchanged before and after a commit.
- Do not create a temporary verifier for behavior already covered by an existing test.
- Do not rescan the repository to reconfirm facts already established.

Verification should follow changes in code risk, not the number of conversation turns.

### Audit Only When Needed

Audit is required by default only when:
- The user explicitly requests an audit.
- There is a large refactor.
- There is a release.
- There is a migration.
- There is a data-safety concern.
- Unknown legacy behavior is involved.
- Cross-module side effects are suspected.

For ordinary features, scoped bug fixes, and small functional adjustments, use:

Inspect relevant code -> implement -> targeted verification -> diff review -> commit.

Do not add full-repository searches, architecture reviews, unrelated verifiers, or full history analysis for form.

### Efficient Agent Behavior

- Inspect the most relevant files first; do not start by traversing the whole repository.
- Go directly to known module paths.
- Do not reread files already read in the same turn when they have not changed.
- Do not output large intermediate reasoning, test logs, or code summaries.
- Do not write a long plan for a simple task.
- For clear small tasks, proceed directly from inspection to implementation.
- Write a detailed plan only when architecture is unclear, impact is large, or risk exists.
- Limit searches to relevant directories and keywords; avoid aimless greps and full-repository scans.
- Keep test output to conclusions and necessary errors.
- Keep the final report short and complete.

Save tokens through precise reading, less repetition, and less unrelated verification, not by skipping necessary code understanding.

### Communication and Monitorable Progress

- Communicate in Chinese by default when the user is writing in Chinese. Keep file paths, commands, identifiers, commit messages, and raw logs unchanged.
- For non-trivial work, provide a concise monitorable progress trail: current goal, key evidence or inspection result, decision rationale summary, next action, verification result, and blockers when present.
- Prefer short rationale summaries and concrete evidence over hidden reasoning or verbose narration. Do not dump raw internal chain-of-thought.
- Use commentary updates while work is in progress for long tasks; do not wait until the final answer.
- Keep the final report in Chinese unless the user requests another language, and keep it aligned with the report format above.

### Session Handoff

`HANDOFF.md` is a temporary handoff file for moving the current work state between long Codex sessions.

Keep responsibilities separate:

- `AGENTS.md`: durable project rules, architecture constraints, and working conventions.
- `HANDOFF.md`: what the current task has reached, why it stopped there, and what comes next.
- Git: code-history facts that have actually happened and been committed.

Do not mix these three.

Create or update `HANDOFF.md` only when:

- A long session is ending.
- The current context is already long and a fresh session is safer.
- Current work is unfinished and must pause.
- The user is switching model, agent, or Codex session.
- The user explicitly requests a handoff.
- Complex uncommitted changes need to continue in another session.

Do not mechanically update `HANDOFF.md` for ordinary small tasks, short sessions, or simple work that is already complete and committed.

#### Write handoff from repository truth

Do not write a handoff from chat memory alone.

Before creating or updating `HANDOFF.md`, inspect at least:

- Current branch.
- Current HEAD and recent relevant commits.
- `git status`.
- Current uncommitted diff.
- Actual state of the task-relevant code.
- Verification results already executed.

If chat memory conflicts with the repository or Git, the repository and Git win. Never describe planned, intended, or interrupted work as completed.

#### Handoff content

Write for a new Codex session with no prior chat context. Keep it concise, factual, and executable; do not turn it into a chat summary.

Use this structure:

```md
# HANDOFF

Updated:
Branch:
HEAD:
Working tree:

## Current objective
What problem is being solved, and what does completion look like.

## Completed
Real work completed in this session. Record important results only, not a file-by-file changelog.

## Current state
The exact stopping state.

Include when needed:
- Current symptom
- Current implementation state
- Relevant files
- Uncommitted changes
- Blockers
- Known root cause

## Next actions
Specific steps the next session should execute, in order.

Aim for "open a new session and continue directly", not "research the whole repository again".

## Decisions / Invariants
Task-specific decisions that should not be reopened without reason. Do not copy durable rules already in `AGENTS.md`.

## Pitfalls / Do not repeat
Known traps, failed approaches, wrong assumptions, and changes that caused regressions. Focus on what the next session is most likely to repeat.

## Verification
PASS:
- Executed checks that are still valid.

FAIL / pending:
- Current failures.
- Checks not yet run that are actually required.
```

Do not:

- Copy long chat transcripts.
- Paste large source excerpts.
- Paste long test logs.
- Repeat all of `AGENTS.md`.
- Treat `HANDOFF.md` as a changelog.
- Treat `HANDOFF.md` as long-term project documentation.
- Preserve stale plans.
- Include information unrelated to continuing the current task.
- Mark unfinished work as complete.
- Traverse the whole repository just to make the handoff feel complete.

Keep `HANDOFF.md` quickly readable, normally tens of lines and about one hundred lines at most. Complex tasks may be longer, but the goal is accurate continuation, not maximum information.

#### Resume from handoff

If the root `HANDOFF.md` exists and the user asks to continue a prior session, read in this order:

1. Root `AGENTS.md`.
2. More specific `AGENTS.md` or `AGENTS.override.md` in the current scope.
3. `HANDOFF.md`.
4. Code paths named in the handoff.
5. `git status`, branch, and HEAD to confirm the handoff is still valid.

Do not start editing code from `HANDOFF.md` alone.

If `HANDOFF.md` conflicts with Git, code, or `AGENTS.md`:

- `AGENTS.md` and current user instructions win.
- Actual repository state wins over the handoff description.
- Correct the understanding of current state before continuing.

Do not replan decisions that are explicit and still valid. Do not rerun verification already marked PASS in the handoff when the relevant code has not changed.

#### Handoff lifecycle

When the handoff task is complete:

- Overwrite or refresh `HANDOFF.md` directly the next time a handoff is needed.
- Do not append unlimited history.
- Remove stale blockers, old plans, and obsolete information.
- Keep it describing the present, not the past.

`HANDOFF.md` is not a project archive.

#### User triggers

Treat phrases such as "this session is ending, write a handoff", "prepare a new session", "update HANDOFF", or "hand this work to the next Codex session" as requests to follow this section.

If the user only says "continue" in a new session and `HANDOFF.md` exists, proactively read `AGENTS.md -> HANDOFF.md -> git status -> relevant files named by HANDOFF`, then continue from `Next actions`.

## Architecture and Domain Rules

Keep business rules deterministic, pure, and testable; do not mix UI rendering, IPC, storage, time calculation, and state selection in one module. Extend the existing domain model rather than creating a parallel state system.

These invariants are non-negotiable and are not relaxed by the faster workflow:

- `CurrentState` remains authoritative; source order is **manual > schedule > routine > idle**.
- Solo and Together profiles remain generalized; never assume one fixed profile pair.
- Time semantics remain `Asia/Shanghai`, with correct cross-midnight and boundary handling.
- Database migrations preserve compatibility and protect real user data.
- Secrets and credentials are never committed or exposed.
- Electron main, preload, and IPC security boundaries remain intact.
- Do not change system-level network configuration without explicit permission.
- Do not add dependencies without a clear need and explicit impact review.
- Avatar production and fallback contracts remain intact.
- AI or message-derived inference must never override manual facts.
- Demo data must never contaminate a real database.
- Git history protection and user-change preservation remain mandatory.

`CurrentState` in `src/state/engine.ts` is the authoritative answer to what a person is doing. Its fixed source order is **manual > schedule > routine > idle**. `DailyException` modifies a schedule candidate; it is not a competing source. UI and companion rendering may project or decorate `CurrentState`, but must not override it. The workspace supports either a solo profile or self plus companion profiles—never assume a fixed pair or infer identity from array position.

Time semantics use Beijing time (`Asia/Shanghai`, UTC+8). Handle cross-midnight intervals, date boundaries, exceptions, and left-closed/right-open occurrence ranges; add boundary tests for time changes. Keep avatar definition, registered assets, runtime loading, state mapping, and rendering separate. Use only registered production packs and explicit fallbacks; never silently substitute an emoji, old avatar, random asset, or a demo placeholder.

## Data, Security, and Dependencies

Real user data takes priority over demo data. Never seed a real empty database, erase data during migration, or change persistent formats without reading the schema, preserving compatibility, using an explicit migration, and adding verification. AI or message-derived data is advisory: retain source and errors, require confirmation for consequential records, and never let an inferred result override a manual status.

Do not alter global proxy, DNS, routing, certificates, firewall, registry, persistent environment variables, or other system settings without explicit permission. Prefer scoped, reversible process settings. Do not add a dependency when existing platform or project capabilities suffice; explain dependency, bundle, license, and security impact in the diff. Never commit secrets, tokens, credentials, private message data, caches, or logs.

Treat model output and external messages as untrusted input. Preserve source, timestamp, original content, parsed result, and error state where the feature stores data. A model guess must be reviewable and correctable before it becomes a consequential schedule or record; it must never pretend success when an API fails. Treat personal QQ or other non-official message integrations as experimental until their authentication, permissions, retention, and reliability have been demonstrated. Do not promise complete access, durable login, or historical-message availability without evidence.

## UI and Visual Changes

### Visual Baseline Freeze

The current YD main window, navigation, card system, typography hierarchy, color palette, spacing, radii, shadows, icon language, and overall Mist & Sage visual direction are treated as an accepted stage baseline.

Unless the current user explicitly requests visual design work or the current bug is itself a visual problem:

- Do not proactively redesign.
- Do not proactively polish.
- Do not change UI for subjective reasons such as "more modern", "more premium", or "more unified".
- Do not adjust colors, font sizes, fonts, spacing, radii, shadows, icons, card proportions, or layout as a side effect.
- Do not replace existing production assets.
- Do not change the main window size, information architecture, or operation paths.
- Prefer existing components and visual tokens for feature work.
- If a functional change must produce a visual difference, limit it to the minimum required by the feature.
- Do not expand a non-visual task into an "overall visual improvement".

If feature work reveals a visual improvement worth considering, record it only; do not handle it incidentally unless it blocks the current feature or the user explicitly asks for it.

The next visual upgrade must be explicitly requested by the user, which lifts the freeze only for the requested scope.

### Information Density and Presentation Discipline

These rules govern how to make a presentation change when the user explicitly requests it or the current bug is itself a presentation problem. They do not authorize proactive redesign or polish, and they remain subordinate to `Visual Baseline Freeze`.

1. **Separate summary and detail layers.** Summary surfaces include daily pages, status cards, course cards, Dock, Tip, Mini, and list rows. They show only what the user needs to make the current decision: current state, time, title, next meaningful item, and optional useful location or status. Do not put import provenance, parser or source explanations, implementation details, migration notes, storage rationale, or long confidence/source descriptions in summary layers. Put them in detail views, tooltips, secondary inspectors, or source/provenance areas. A source may appear in a summary only when it directly affects the current decision and can be expressed in a very short form.

2. **Keep one semantic role per visual line.** Do not concatenate source, expected end, next item, time, and title into one sentence. Prefer distinct layers: primary state or title, status-specific note, and next item. Each layer should answer one question. If position already conveys "next", do not repeat "next item", "next lesson", or "first lesson". If an end time is sufficient, do not add an estimated-end prefix. Do not add filler connective phrases to make a complete spoken sentence.

3. **Do not repeat semantics already conveyed by hierarchy or controls.** Avoid nested synonym headings that restate the same concept at a section, subsection, and row level. If a control, title, position, or current mode already conveys the meaning, do not add a permanent explanation layer. Keep a control with the title it controls when that makes the relationship obvious. Settings are a place to make choices, not to explain internal architecture. Explanatory copy should remain only when its absence would create a real misunderstanding. Do not render meaningless comparison options for the current mode; for example, solo mode should not show the other person's choice.

4. **Omit missing optional information.** For non-required information such as location, note, or secondary metadata, do not render the row when the value is absent. Do not repeatedly show placeholders such as `location not entered`, `no notes`, `not set`, or `no data` unless the user must know the field is missing, the absence blocks the current operation, or the screen's purpose is to complete that field. Empty state and missing field are different concepts and must not be mixed.

5. **Keep provenance and implementation metadata in detail views.** Facts such as the import source, a provisional academic-week assumption, OCR origin, notification origin, or storage rationale may be valuable data, but they are not primary daily-list content. Preserve provenance truth, but default it to details, source information, import history, or an audit trail. Do not delete domain data or rewrite real data to make the UI cleaner.

6. **Privilege scanability in compact cards.** Repeated items such as schedule rows, course cards, todo rows, and status cards should be easy to scan. Prioritize time, title, and meaningful state; then add location or short context. Do not make every repeated card carry the same source explanation, long description, or implementation explanation. If four cards repeat the same sentence, that information is usually at the wrong presentation layer.

7. **Use a consistent visual language for choice controls.** Default setting controls are: page or section navigation as tabs; boolean settings as switches; 2-4 setting values as independent lightweight choice chips; larger visual choices as cards; and many textual options as a dropdown or list when appropriate. For setting values such as `self / companion` or `small / medium / large`, do not default to a cheap segmented control in which buttons are glued to one gray track. Prefer separate chips with natural gaps, clear selected/hover/normal hierarchy, low-saturation backgrounds, and fine borders, without heavy shadows or saturated filled buttons. True page-navigation tabs are not affected by this rule. Reuse the same visual tokens or component for the same enum control pattern on a page instead of inventing a new style each time.

8. **Make visual hierarchy reflect importance, not implementation structure.** Do not display four heading levels just because the code has section, subsection, field, and helper structure. Visual hierarchy follows the user task: page or section, then the setting or primary content, then optional supporting text. Avoid deep title nesting. Supporting copy should be clearly lower than the primary choice in size, color, and space. Previews, illustrations, and avatar displays must not outrank the setting itself.

9. **Prefer omission over explanation when the interface is already self-evident.** Before adding persistent copy, ask whether the user needs this information to make a decision right now. If not, prefer deletion, moving it to details, or letting interaction express it naturally. YD should show the minimum information needed at the moment without hiding important truth.

10. **Presentation cleanup must not alter domain truth.** When reducing UI noise, do not rewrite persisted data, change `CurrentState`, change schedule or event type, discard provenance, change migration behavior, or fake a missing field. Solve presentation issues through projection, conditional rendering, hierarchy, copy, and layout. If a display problem actually comes from incorrect domain data, report it separately and handle it as a domain issue; do not hide it with copy.

11. **Scope visual cleanup proportionately.** When the user explicitly asks to address verbosity, crowding, fragmentation, excessive information, or repeated hierarchy, it is acceptable to check the same page or component family for obvious issues of the same kind and converge them together. Do not expand this into a full-site redesign, global copy rewrite, or incidental replacement of colors, fonts, or the card system. Continue to follow `Visual Baseline Freeze`.

Outside a frozen area, YD should still feel quiet, restrained, modern, readable, and locally trustworthy: low-saturation surfaces, light hierarchy, whitespace, gentle corners and shadows, and purposeful motion. Avoid dashboard/SaaS styling, heavy glass effects, excessive gradients, gamification, and decorative animation that harms clarity. Reuse existing spacing, typography, radius, shadow, icon, and component conventions.

The companion/orb should remain low-interruption, geometrically stable, draggable, and predictable on hover. Drag cleanup must remove transient tooltip, overlay, and hover state. Treat production art as a first-class asset: use approved assets or an explicitly labeled development placeholder, never a disguised substitute.

## Change, Commit, and Report Discipline

Make the smallest complete change. Diagnose bugs through reproduction, real state, trigger chain, root cause, regression test, and neighboring behavior—not timeouts or cosmetic concealment. Refactors need a stated benefit and preserve observable behavior unless the user requests otherwise. Before deleting assets, migrations, preload code, or Electron resources, check imports, dynamic loading, and packaging references.

Do not change the application version for every commit. Change it only for an explicit user-requested version, a defined release, or a requested installer; then verify every real version source (package metadata, application/about presentation, and packaging metadata) remains consistent. Do not silently migrate large datasets, alter user preferences, restore retired behavior, or change network configuration. Design an explicit fallback policy instead.

Before committing, use this flow:

requested change -> proportionate verification -> `git diff` review -> commit.

Do not mechanically run the full test suite before an ordinary commit. Run full testing only when the risk level requires it. Confirm the staged set contains only task files. `AGENTS.md` is also under Git management.

Use narrow Conventional Commit-style messages such as `feat: ...`, `fix: ...`, `refactor: ...`, `ui: ...`, `test: ...`, `docs: ...`, or `chore: ...`. Commit a completed, independently verifiable task unless the user says not to. Never amend or force-push without explicit approval.

For ordinary tasks, the final report should contain only:

完成
- One or two lines describing the actual change.

验证
- Only checks actually executed, with PASS / FAIL.

Git
- Branch.
- Commit.
- Working tree.

Do not repeat every modified file, write a long design explanation, paste full test logs, or restate what the commit message already makes clear.

Use a detailed report only for release work or when a blocker exists. Release reports must include application version, installer path and type, build result, checksum, and packaged smoke evidence. If existing user changes remain, name them rather than altering them.
