// YD v0.3 Phase 4A · Avatar Pack runtime acceptance.
// Uses an isolated app data directory and the real Electron renderer. Pure
// registry/resolver checks are bundled from the production TypeScript module,
// so this script does not maintain a second implementation.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');

const output = path.join(__dirname, 'test-data', `v030-avatar-pack-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
process.env.DAYHUB_TEST_DATA = output;

const bridge = path.join(output, 'avatar-contract.cjs');
buildSync({
  absWorkingDir: __dirname,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: bridge,
  stdin: {
    resolveDir: __dirname,
    sourcefile: 'avatar-contract.ts',
    loader: 'ts',
    contents: `
      export * from './src/avatar.ts';
      export { resolvePetState } from './src/companion-display.ts';
      export { stateLabel } from './src/state/presentation.ts';
    `,
  },
});
const avatar = require(bridge);

const passed = [];
const errors = [];
const check = (name, value, detail = '') => { assert.ok(value, `${name}${detail ? ': ' + detail : ''}`); passed.push(name); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { fs.writeFileSync(path.join(output, 'failure.txt'), 'avatar pack acceptance timeout'); app.exit(1); }, 120000);

require('./dist/main.cjs');
app.on('web-contents-created', (_event, contents) => contents.on('console-message', (...args) => {
  const details = args[1];
  if (details && typeof details === 'object') { if (details.level === 'error' || details.level === 3) errors.push(String(details.message)); }
  else if (Number(details) >= 2) errors.push(String(args[2]));
}));

const testPack = {
  id: 'test-tall', version: '1.0.0', name: 'Test Tall', source: 'builtin', assetRoot: 'companion/test-tall',
  canvas: { width: 800, height: 1200 }, previewState: 'busy_class', fallbackState: 'idle',
  frames: {
    idle: { asset: 'still', geometry: { scale: 0.7, offsetX: 12, offsetY: -8 } },
    busy_class: { asset: 'lesson', geometry: { scale: 1.2, offsetX: -6, offsetY: 14 } },
  },
};

app.whenReady().then(async () => {
  try {
    let panel, orb;
    for (let i = 0; i < 120; i += 1) {
      const windows = BrowserWindow.getAllWindows();
      panel = windows.find(window => !window.webContents.getURL().includes('#') && window.webContents.getURL().includes('index.html'));
      orb = windows.find(window => window.webContents.getURL().endsWith('#orb'));
      if (panel && orb && !panel.webContents.isLoading() && !orb.webContents.isLoading()) break;
      await wait(100);
    }
    check('主窗口与桌宠窗口加载完成', !!panel && !!orb);
    const run = code => panel.webContents.executeJavaScript(code);
    const pet = code => orb.webContents.executeJavaScript(code);
    await wait(500);

    const builtin = avatar.listAvatarPacks();
    check('builtin registry 唯一且默认 Pack 存在', builtin.length === 1 && builtin[0].id === 'yd-default');
    check('yd-default manifest version 稳定', builtin[0].version === '1.0.0');
    check('builtin manifest validation 通过', (() => { avatar.assertAvatarPackManifest(builtin[0]); return true; })());

    const bundle = await run('window.dayhub.companionAssets()');
    check('运行时使用 yd-default', bundle.requestedPackId === 'yd-default' && bundle.resolvedPackId === 'yd-default');
    check('Pack canvas 进入运行时 contract', bundle.pack.canvas.width === 412 && bundle.pack.canvas.height === 411);
    check('十态资源全部从 Pack 装载', bundle.available === true && bundle.missing.length === 0 && Object.keys(bundle.images).length === 10);

    const live = await run('window.dayhub.live()');
    orb.webContents.send('dayhub:live', { ...live, preferences: { ...live.preferences, mode: 'custom' }, display: { ...live.display, state: 'reminder', label: '1 条待处理' } });
    await wait(250);
    check('renderer 经统一 resolver 使用 reminder frame', await pet("(()=>{const f=document.querySelector('.companion-figure'),i=document.querySelector('.companion-frame.is-current');return f?.dataset.avatarPack==='yd-default'&&f?.dataset.avatarState==='reminder'&&f?.dataset.avatarFallback==='none'&&f?.dataset.assetKey==='reminder'&&i?.style.getPropertyValue('--pet-scale')==='1'})()"));

    const registry = avatar.createAvatarPackRegistry([avatar.ydDefaultAvatarPack, testPack]);
    const exact = avatar.resolveAvatarFrame('test-tall', 'busy_class', { registry });
    check('test Pack exact frame 与 geometry 独立', exact.asset === 'lesson' && exact.geometry.scale === 1.2 && exact.geometry.offsetX === -6 && exact.geometry.offsetY === 14);
    const missing = avatar.resolveAvatarFrame('test-tall', 'reminder', { registry });
    check('missing frame 优先 same-pack idle', missing.resolvedPackId === 'test-tall' && missing.resolvedState === 'idle' && missing.fallback === 'pack-state' && missing.geometry.offsetX === 12);
    const unknown = avatar.resolveAvatarFrame('unknown-pack', 'busy_class', { registry });
    check('unknown Pack 回退 yd-default', unknown.resolvedPackId === 'yd-default' && unknown.resolvedState === 'busy_class' && unknown.fallback === 'default-pack');
    const broken = avatar.resolveAvatarFrame('test-tall', 'busy_class', { registry, hasAsset: (packId, asset) => packId === 'yd-default' && asset === 'busy_class' });
    check('损坏 Pack 跨 Pack 回退 default', broken.resolvedPackId === 'yd-default' && broken.fallback === 'default-pack');
    const catastrophic = avatar.resolveAvatarFrame('test-tall', 'reminder', { registry, hasAsset: () => false });
    check('全部资源损坏回退 embedded idle', catastrophic.asset === 'companion-fallback-idle' && catastrophic.fallback === 'embedded');

    const current = { personId: 'partner', kind: 'class', label: 'Algorithms', source: 'schedule', startAt: 1, endAt: 100, priority: 80 };
    const person = { person: 'partner', current, today: [], code: 'BUSY_CLASS', conflict: false, research: false, routine: null };
    const reminderDisplay = avatar.resolvePetState({ people: [person], subjectId: 'partner', pending: 1, now: 10, reminderSince: 10 });
    check('CurrentState=class + reminder 只改变 Avatar visual', current.kind === 'class' && avatar.stateLabel(current) === '上课中' && reminderDisplay.state === 'reminder');
    check('Solo display 同样只消费 CurrentState', avatar.resolvePetState({ people: [person], subjectId: 'partner', pending: 0, now: 10 }).state === 'busy_class');
    const self = { ...person, person: 'me', current: { ...current, personId: 'me', kind: 'idle', label: '空闲', source: 'idle', priority: 10 } };
    check('Together display 保持既有双方语义', avatar.resolvePetState({ people: [self, person], subjectId: 'partner', pending: 0, now: 10 }).state === 'busy_class');
    check('渲染进程没有 console 错误', errors.length === 0, errors.join(' | '));

    console.log(JSON.stringify({ output, passed, consoleErrors: errors }, null, 2));
    clearTimeout(deadline);
    app.exit(0);
  } catch (error) {
    console.error(error);
    fs.writeFileSync(path.join(output, 'failure.txt'), String(error && error.stack || error));
    clearTimeout(deadline);
    app.exit(1);
  }
});
