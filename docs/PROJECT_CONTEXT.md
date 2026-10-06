# PROJECT_CONTEXT

Updated: 2026-10-07.
Primary objective: software / local-first Windows personal-work hub.
This records current facts and stage policy; recheck them when the implementation or objective changes.

## Repository context
- package.json declares 0.3.0; README still describes 0.2.17. README delivery/installation claims are historical, not current acceptance evidence. Release readiness must be verified independently.
- Verified canonical GitHub remote (origin): https://github.com/hdy7031/YD.git.

## Tooling and repository map
- npm with package-lock.json; Electron, strict TypeScript, React, esbuild, electron-builder and sql.js. Honor package.json engines.node (currently >=24.0). Use npm ci for locked dependencies.

- src/: domain, persistence, Electron main/preload and UI; src/state/: state derivation. tests/: Node tests and committed migration fixtures. scripts/: build, import, fixture, audit and verification utilities. brand/, src/ui/assets/ and native/: shipped assets. docs/: durable design/acceptance records. dist/: bundles; release/: installers.

## Commands and verification entry points
- npm ci: locked install. npm run build: main/UI bundles in dist/. npm start: build and launch Electron.
- npm test: node --test tests/*.test.ts. npm run typecheck: tsc --noEmit.
- npm run fixtures:build regenerates committed fixtures intentionally. npm run assets:companion generates companion assets.
- npm run dist -- --config.electronDist=node_modules/electron/dist builds an x64 NSIS installer using local Electron. Packaging is a release step, not an ordinary-change default.
- Relevant verifiers: root verify-*.cjs; scripts/verify-*.{cjs,mjs}, scripts/verify-upgrade.mjs, scripts/ui-audit.cjs and scripts/visual-*.cjs. Electron/UI scripts may need npx electron <script>. There is no lint script.

## Current visual baseline and change restrictions
This is the current stage policy, not an immutable design law.
- The accepted main window, navigation, card system, typography, palette, spacing, radii, shadows, icons and Mist & Sage direction are frozen.
- Unless the user explicitly requests visual work or the bug is itself visual, do not redesign/polish, change colors/fonts/spacing/radii/shadows/icons/card proportions/layout, replace production assets, or change window size, information architecture or operation paths.
- Reuse current components/tokens. Functional changes may produce only the minimum necessary visual difference. Do not broaden non-visual work into overall visual improvement.
- Record possible improvements without implementing them unless they block the requested feature. Explicit visual-upgrade requests lift the freeze only within their requested scope. This policy applies until the user changes the stage baseline.

## Current implementation observations (not additional project laws)
- src/state/engine.ts implements the authoritative state projection and source ranks 100/80/40/10. Exact ranks and file location are implementation details; source ordering is the invariant.
- src/types.ts embeds optional RoutineProfile in Profile. src/routine.ts currently uses source/updatedAt/rules, legacy-default/user provenance, numeric kind ranks and later-start then smaller-id tie breaking. Field names, object nesting, ranks and tie-break mechanism may evolve while preserving per-person ownership and deterministic semantics.
- Routine code contains old Phase 2A/2B comments about a legacy companion consumer. Treat these as historical commentary, not proof of current architecture or a reason to restore retired behavior.
- CurrentState path, technology stack and repository map describe this snapshot, not mandatory permanent module placement.
