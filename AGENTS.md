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

Select the verifier that covers the change: root `verify-*.cjs` scripts; `scripts/verify-*.{cjs,mjs}`; `scripts/verify-upgrade.mjs`; `scripts/ui-audit.cjs`; and `scripts/visual-*.cjs`. Electron/UI verifiers may need `npx electron <script>`. This repository has no lint script. For code changes, run `npm test`, `npm run typecheck`, and the relevant targeted verifier; do not weaken tests or assertions to manufacture a pass. For documentation-only work, inspect the diff instead of creating unrelated build output.

## Architecture and Domain Rules

Keep business rules deterministic, pure, and testable; do not mix UI rendering, IPC, storage, time calculation, and state selection in one module. Extend the existing domain model rather than creating a parallel state system.

`CurrentState` in `src/state/engine.ts` is the authoritative answer to what a person is doing. Its fixed source order is **manual > schedule > routine > idle**. `DailyException` modifies a schedule candidate; it is not a competing source. UI and companion rendering may project or decorate `CurrentState`, but must not override it. The workspace supports either a solo profile or self plus companion profiles—never assume a fixed pair or infer identity from array position.

Time semantics use Beijing time (`Asia/Shanghai`, UTC+8). Handle cross-midnight intervals, date boundaries, exceptions, and left-closed/right-open occurrence ranges; add boundary tests for time changes. Keep avatar definition, registered assets, runtime loading, state mapping, and rendering separate. Use only registered production packs and explicit fallbacks; never silently substitute an emoji, old avatar, random asset, or a demo placeholder.

## Data, Security, and Dependencies

Real user data takes priority over demo data. Never seed a real empty database, erase data during migration, or change persistent formats without reading the schema, preserving compatibility, using an explicit migration, and adding verification. AI or message-derived data is advisory: retain source and errors, require confirmation for consequential records, and never let an inferred result override a manual status.

Do not alter global proxy, DNS, routing, certificates, firewall, registry, persistent environment variables, or other system settings without explicit permission. Prefer scoped, reversible process settings. Do not add a dependency when existing platform or project capabilities suffice; explain dependency, bundle, license, and security impact in the diff. Never commit secrets, tokens, credentials, private message data, caches, or logs.

Treat model output and external messages as untrusted input. Preserve source, timestamp, original content, parsed result, and error state where the feature stores data. A model guess must be reviewable and correctable before it becomes a consequential schedule or record; it must never pretend success when an API fails. Treat personal QQ or other non-official message integrations as experimental until their authentication, permissions, retention, and reliability have been demonstrated. Do not promise complete access, durable login, or historical-message availability without evidence.

## UI and Visual Changes

Preserve information architecture and user flows unless the user explicitly requests a redesign. YD should feel quiet, restrained, modern, readable, and locally trustworthy: low-saturation surfaces, light hierarchy, whitespace, gentle corners and shadows, and purposeful motion. Avoid dashboard/SaaS styling, heavy glass effects, excessive gradients, gamification, and decorative animation that harms clarity. Reuse existing spacing, typography, radius, shadow, icon, and component conventions.

The companion/orb should remain low-interruption, geometrically stable, draggable, and predictable on hover. Drag cleanup must remove transient tooltip, overlay, and hover state. Treat production art as a first-class asset: use approved assets or an explicitly labeled development placeholder, never a disguised substitute.

## Change, Commit, and Report Discipline

Make the smallest complete change. Diagnose bugs through reproduction, real state, trigger chain, root cause, regression test, and neighboring behavior—not timeouts or cosmetic concealment. Refactors need a stated benefit and preserve observable behavior unless the user requests otherwise. Before deleting assets, migrations, preload code, or Electron resources, check imports, dynamic loading, and packaging references.

Do not change the application version for every commit. Change it only for an explicit user-requested version, a defined release, or a requested installer; then verify every real version source (package metadata, application/about presentation, and packaging metadata) remains consistent. Do not silently migrate large datasets, alter user preferences, restore retired behavior, or change network configuration. Design an explicit fallback policy instead.

Before committing, run proportionate checks, review `git diff`, and confirm the staged set contains only task files. Use narrow Conventional Commit-style messages such as `feat: ...`, `fix: ...`, `refactor: ...`, `ui: ...`, `test: ...`, `docs: ...`, or `chore: ...`. Commit a completed, independently verifiable task unless the user says not to. Never amend or force-push without explicit approval.

In the final report, state completed work, checks run and their result, branch, commit, and working-tree status. If existing user changes remain, name them rather than altering them. For release work, also report application version, installer path and type, build result, checksum, and packaged smoke evidence.
