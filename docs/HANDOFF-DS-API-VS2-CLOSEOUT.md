# DS API Handoff: YD Visual System 2.0 Acceptance Closeout

## Objective

Continue in `C:\Users\hdy\Desktop\事物agent` on branch `v0.3-productization`.
Visual System 2.0 itself is accepted. Do not redesign product UI or add features.

Finish these engineering acceptance items:

1. Replace the obsolete `scripts/visual-v022.cjs` and `scripts/ui-audit.cjs` with one maintained VS2 visual/runtime gate covering Schedule, Settings, responsive layouts, and Solo/Duo Dock.
2. Make every Electron runtime/visual verifier set a unique temporary `userData` before loading `dist/main.cjs`. Never read, migrate, restore, delete, or modify `%APPDATA%\事务助手`.
3. Fix Windows application/setup icon white halo and the NSIS wizard's old yellow branding. Add restrained mist/sage installer header/sidebar assets.
4. Rebuild version `0.2.21` without installing it. Perform real Windows Shell observation for Explorer, taskbar, Alt+Tab, and 100%/125% DPI without changing system settings or clearing icon cache.
5. Run required checks, review the diff, commit independently, and report exact `git log --oneline -5` and `git status`.

Do not change database schema, migrations, StateEngine, priority rules, application version, system DPI, registry, network settings, or global configuration.

## Current Git baseline

```text
ec26737 fix: restore transparent Windows application icon
718cea1 ui: stabilize visual system and floating dock
5645db5 chore: release 0.2.21
bd2d5bf assets: ship visual system artwork
443f900 ui: refine solo and together status dock
```

The earlier report strings `-feed ibele?` and `ec267 バッグupal?` were response-rendering corruption only. Real commit messages are normal.

## User evidence

Latest screenshots:

```text
C:\Users\hdy\AppData\Local\Temp\codex-clipboard-5b31d036-7d36-4753-a3d5-fc9f6ebec051.png
C:\Users\hdy\AppData\Local\Temp\codex-clipboard-f9aa7104-8f01-4d76-bf41-13710394931e.png
```

They show:

- `YD-Setup-0.2.21.exe` has a pale/white square or halo around the small icon.
- The assisted NSIS wizard still shows the old yellow YD icon in its header.
- The user opened the installer but did not ask to install it. Future checks may open the wizard for observation, but must not click through or install.

## Uncommitted work already present

Preserve and review these changes; do not reset or stash them:

```text
M runtime-audit.cjs
M runtime-audit-solo.cjs
M scripts/visual-mist.cjs
M verify-v030-dock.cjs
M scripts/brand-render.cjs
M brand/exports/*
?? scripts/electron-test-profile.cjs
```

### Temporary Electron profile helper

`scripts/electron-test-profile.cjs` now creates a profile with `fs.mkdtempSync(os.tmpdir())`, rejects the normalized production path, and sets both:

```js
process.env.DAYHUB_TEST_DATA = userData;
app.setPath('userData', userData);
app.setPath('sessionData', path.join(userData, 'session'));
```

It has been wired into `runtime-audit.cjs`, `runtime-audit-solo.cjs`, `scripts/visual-mist.cjs`, and `verify-v030-dock.cjs`, but none of these changes has been verified yet.

The Dock verifier's Together and Restart child processes now share one OS-temp profile so restart-position persistence can still be tested.

### Icon generator work

`scripts/brand-render.cjs` is the correct VS2 vector generator. It has been modified so:

- 16/20/24/32/40/48px frames have no pale decorative hairline.
- ICO includes native 20px and 40px frames for 125% Shell rendering.
- 64px and larger retain the subtle hairline.

The current `brand/exports/*` are unverified generated output. Re-run the generator after reviewing the patch:

```powershell
npx electron scripts/brand-render.cjs
```

Do not run `scripts/brand-raster-exports.py`; it uses the old yellow `brand/source/yd-app-icon-master.png` and previously overwrote the VS2 green exports. This explains why commit `ec26737` had transparent alpha but still produced old yellow installer branding.

## Confirmed icon/installer root causes

1. Two competing export chains exist: the current green vector chain (`brand-render.cjs`) and an old yellow raster chain (`brand-raster-exports.py`).
2. The previous closeout checked alpha but accidentally committed the yellow raster exports.
3. The green vector generator applied a pale hairline to every small frame; fractional-DPI resampling can turn that into a visible white halo.
4. `package.json` configures only `build.win.icon`. The NSIS assisted installer has no explicit branded header/sidebar assets and therefore reused the icon/default header available at package time.

## Installer branding implementation

Keep the native assisted installer; do not build a custom full-page NSIS UI.

Add `scripts/installer-brand-assets.py` using Pillow and the final green `brand/exports/icon-256.png`. Generate deterministic 24-bit RGB BMP files:

```text
brand/installer/header.bmp   150 x 57
brand/installer/sidebar.bmp 164 x 314
```

Design direction: warm mist background, deep sage YD mark, light order line, small `Your Day` / `quietly organized.` copy. No glass, heavy gradient, or decorative dashboard styling.

Add explicit NSIS paths in `package.json`:

```json
"installerIcon": "brand/exports/yd.ico",
"uninstallerIcon": "brand/exports/yd.ico",
"installerHeader": "brand/installer/header.bmp",
"installerSidebar": "brand/installer/sidebar.bmp",
"uninstallerSidebar": "brand/installer/sidebar.bmp"
```

`installerHeaderIcon` may also point to the ICO, but electron-builder documents it mainly for one-click installers. The assisted installer requires `installerHeader` and `installerSidebar`.

Do not bump version. Treat the existing `release/YD-Setup-0.2.21.exe` as stale.

## New maintained VS2 verifier

An attempted patch for `scripts/visual-vs2.cjs` failed to parse and created no file.

Recommended files:

```text
scripts/visual-vs2.cjs
scripts/verify-vs2.cjs
```

Add:

```json
"verify:vs2": "node scripts/verify-vs2.cjs"
```

The orchestrator should run sequentially:

```text
npx electron scripts/visual-vs2.cjs
npx electron runtime-audit.cjs
npx electron runtime-audit-solo.cjs
npx electron verify-v030-dock.cjs
```

The visual script must use `configureIsolatedUserData()` and verify/capture:

- compact 780x600, normal 1050x780, wide 1600x960;
- Today, Schedule, Tasks/Meetings, Inbox, Reminders, Settings;
- visible titles, no root/page-frame horizontal overflow, no `undefined`;
- Schedule has no `一览模式`, has `编辑课表`, has eight complete `HH:mm–HH:mm` gutter values and a week switch;
- Settings has six top section tabs, one-column/top-nav computed layout, shared setting rows, and About shows Electron version `0.2.21`;
- Duo Dock has two equal profile areas, no legacy Orb DOM, fixed outer geometry on hover, and two Mini cards;
- Solo gate confirms one row, no divider/empty slot, fixed hover geometry, and one full-width Mini card;
- report includes `screen.getAllDisplays()` scale factors and the actual temporary userData path.

Delete obsolete executable verifiers:

```text
scripts/visual-v022.cjs
scripts/ui-audit.cjs
```

Update `docs/verification-v030.md`, `scripts/verify-current-release.cjs`, and `package.json`. Historical phase documents may retain statements that those scripts existed at the time, but the current gate must state they were replaced by `verify:vs2`.

## Windows Shell acceptance

Resource checks are necessary but not sufficient:

1. Confirm ICO frames 16/20/24/32/40/48/64/128/256.
2. Confirm corner alpha is zero in every frame.
3. Confirm visible edge pixels in 16-48px frames do not contain a near-white outline.
4. Inspect embedded icons in both `release/win-unpacked/YD.exe` and the newly built setup EXE.
5. Use Computer Use to observe Explorer small/large icons, running packaged taskbar icon, and Alt+Tab overlay.
6. Observe native 125% on the current display and record the actual `screen.getAllDisplays()` scale factor.
7. For 100%, use only process-scoped `--force-device-scale-factor=1` with a separate isolated packaged process. Do not change Windows display settings. Report clearly that this is process-scoped 100%.
8. Do not clear icon cache. If a uniquely named copy/new path is correct while an old same-path entry is stale, classify that as cache; otherwise classify it as an asset/build problem.

If Computer Use cannot actually capture a surface, report `BLOCKED/NOT OBSERVED`; do not infer Shell PASS from alpha alone.

## Production-data safety

A previous naked `npm start` touched real AppData and ran the repository's existing v1-to-v6 migration. It created this backup:

```text
C:\Users\hdy\AppData\Roaming\事务助手\backups\before-v030-2026-09-14T02-28-06-211Z.dayhub
```

The user explicitly requires that backup and all real data to remain untouched. Do not delete, restore, copy over, or modify it. Do not run naked `npm start` for acceptance.

## Required final sequence

```powershell
npm test
npm run typecheck
npm run build
npm run verify:vs2
git diff --check
git diff
```

Then create an independent commit (or tightly scoped commits) without amending existing history. Suggested messages:

```text
test: replace legacy visual audits with VS2 gate
build: isolate Electron verifier user data
build: brand the Windows installer and icons
```

Build with local Electron:

```powershell
npm run dist -- --config.electronDist=node_modules/electron/dist
```

Perform packaged smoke with a temporary userData, then Shell observation. Report version, installer path, size, SHA-256, unsigned-publisher caveat, actual PASS/FAIL evidence, exact `git log --oneline -5`, and exact `git status`.
