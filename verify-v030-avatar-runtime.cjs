// YD v0.3 Phase 4C1 · Avatar runtime hot-switch acceptance.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');

const output = path.join(__dirname, 'test-data', `v030-avatar-runtime-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
process.env.DAYHUB_TEST_DATA = output;
// Phase 5A：双人语义由合成 fixture 显式种下，不再依赖生产 fresh default。
require('./scripts/electron-test-profile.cjs').seedWorkspace(output, 'together');
const bridge = path.join(output, 'avatar-runtime.cjs');
buildSync({
  absWorkingDir: __dirname, bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: bridge,
  stdin: { resolveDir: __dirname, sourcefile: 'avatar-runtime-acceptance.ts', loader: 'ts', contents: `
    export { AvatarRuntime } from './src/avatar-runtime.ts';
    export { companionGeometry } from './src/companion-layout.ts';
    export { createFreshState, createCompanionProfile, epoch } from './src/core.ts';
    export { snapshot } from './src/live.ts';
    export { resolvePetState } from './src/companion-display.ts';
    export { stateLabel } from './src/state/presentation.ts';
    export { DOMAIN_VERSION } from './src/domain.ts';
  ` },
});
const domain = require(bridge);
const passed = [], consoleErrors = [];
const check = (name, value, detail = '') => { assert.ok(value, `${name}${detail ? ': ' + detail : ''}`); passed.push(name); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const meta = new Map([
  ['test-pack-a', { id: 'test-pack-a', version: '1.0.0' }],
  ['test-pack-b', { id: 'test-pack-b', version: '1.0.0' }],
  ['test-pack-c', { id: 'test-pack-c', version: '1.0.0' }],
]);
const visual = (id, version = meta.get(id).version) => ({ resolvedPackId: id, version, value: { id, canvas: id === 'test-pack-b' ? { width: 800, height: 1200 } : { width: 412, height: 411 } } });
const deadline = setTimeout(() => { fs.writeFileSync(path.join(output, 'failure.txt'), 'avatar runtime acceptance timeout'); app.exit(1); }, 120000);

require('./dist/main.cjs');
app.on('web-contents-created', (_event, contents) => contents.on('console-message', (...args) => {
  const details = args[1];
  if (details && typeof details === 'object') { if (details.level === 'error' || details.level === 3) consoleErrors.push(String(details.message)); }
  else if (Number(details) >= 2) consoleErrors.push(String(args[2]));
}));

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
    await wait(700);
    const run = code => panel.webContents.executeJavaScript(code);
    const pet = code => orb.webContents.executeJavaScript(code);
    const state = await run('window.dayhub.get()');
    const live = await run('window.dayhub.live()');
    check('DOMAIN_VERSION 是 7', domain.DOMAIN_VERSION === 7 && state.settings.domainVersion === 7);
    check('LiveSnapshot 向桌宠提供 PetInstance', !!live.petInstance.subjectId && live.petInstance.avatarPackId === 'yd-default');
    check('yd-default 运行时完成解码并显示', await pet("document.querySelector('.companion-figure')?.dataset.avatarPack==='yd-default'"));
    const before = orb.getBounds();
    check('初始窗口位于 workArea', (() => { const a = require('electron').screen.getDisplayMatching(before).workArea; return before.x >= a.x && before.y >= a.y && before.x + before.width <= a.x + a.width && before.y + before.height <= a.y + a.height; })());

    let blocked = false;
    try { blocked = await run("window.dayhub.avatarVisualReady({requestedPackId:'yd-default',resolvedPackId:'yd-default',version:'1.0.0'})") === false; } catch { blocked = true; }
    check('非桌宠 renderer 不能提交 Avatar geometry', blocked);

    const calls = [];
    const versions = new Map(meta);
    const cached = new domain.AvatarRuntime({
      resolve: id => versions.get(id),
      load: async id => { calls.push(id); return visual(id); },
      decode: async value => value,
    });
    check('启动不预载全部 Pack', cached.cacheSize === 0);
    await cached.loadAvatarPack('test-pack-a'); await cached.loadAvatarPack('test-pack-a');
    check('同 Pack 同 version 复用缓存', calls.length === 1);
    versions.set('test-pack-a', { id: 'test-pack-a', version: '1.1.0' });
    await cached.loadAvatarPack('test-pack-a'); await cached.loadAvatarPack('test-pack-b');
    check('缓存 key 包含 manifest version', cached.cacheSize === 3 && calls.length === 3);

    const b = deferred(), gate = deferred();
    const atomic = new domain.AvatarRuntime({ resolve: id => meta.get(id), load: id => id === 'test-pack-b' ? b.promise : Promise.resolve(visual(id)), decode: async value => value });
    await atomic.request('test-pack-a');
    const switching = atomic.request('test-pack-b', () => gate.promise);
    check('B 加载期间继续显示 A', atomic.activeVisual.requestedPackId === 'test-pack-a');
    b.resolve(visual('test-pack-b')); await wait(0);
    check('B decode 后 geometry commit 前仍显示 A', atomic.activeVisual.requestedPackId === 'test-pack-a');
    gate.resolve(true); await switching;
    check('visual 与 geometry 确认后原子提交 B', atomic.activeVisual.requestedPackId === 'test-pack-b');
    const ga = domain.companionGeometry('custom', 'medium', 412 / 411), gb = domain.companionGeometry('custom', 'medium', 800 / 1200);
    check('不同 Pack canvas 产生独立 geometry', ga.width !== gb.width || ga.height !== gb.height);

    const slowB = deferred(), fastC = deferred();
    const raced = new domain.AvatarRuntime({ resolve: id => meta.get(id), load: id => id === 'test-pack-b' ? slowB.promise : fastC.promise, decode: async value => value });
    const rb = raced.request('test-pack-b'), rc = raced.request('test-pack-c');
    fastC.resolve(visual('test-pack-c')); await rc; slowB.resolve(visual('test-pack-b'));
    check('A→B→C 不会被迟到的 B 覆盖', (await rb).kind === 'stale' && raced.activeVisual.requestedPackId === 'test-pack-c');

    const failed = new domain.AvatarRuntime({ resolve: id => meta.get(id), load: async id => visual(id), decode: async value => { if (value.id === 'test-pack-b') throw new Error('decode failed'); return value; } });
    await failed.request('test-pack-a');
    check('decode failure 保留 last-known-good', (await failed.request('test-pack-b')).kind === 'failed' && failed.activeVisual.requestedPackId === 'test-pack-a');

    // fresh state 是 Solo；这里的双人场景由领域工厂显式加上同行者（用户主动添加的同一路径）。
    const now = domain.epoch('2027-03-01T10:00'), synthetic = domain.createFreshState(now);
    const self = synthetic.profiles.find(profile => profile.role === 'self'), companion = domain.createCompanionProfile(now, self);
    synthetic.profiles = [self, companion];
    // Phase 5B1：桌宠主体是持久化偏好。用户添加同行者后选择"桌宠代表 TA"就是这个值。
    synthetic.settings.petSubjectRole = 'companion';
    self.avatar = { packId: 'test-pack-a', source: 'user' }; companion.avatar = { packId: 'test-pack-b', source: 'user' };
    check('Together 最终 Pack 来自 companion', domain.snapshot(synthetic, now).petInstance.avatarPackId === 'test-pack-b');
    self.avatar = { packId: 'test-pack-c', source: 'user' };
    check('修改非当前 subject 不切换当前 Pet', domain.snapshot(synthetic, now).petInstance.avatarPackId === 'test-pack-b');
    synthetic.profiles = [self];
    check('Together→Solo 无需启动缓存即可切 self Pack', domain.snapshot(synthetic, now).petInstance.avatarPackId === 'test-pack-c');
    self.avatar = { packId: 'test-pack-a', source: 'user' };
    check('Solo self Avatar 可热切回 A', domain.snapshot(synthetic, now).petInstance.avatarPackId === 'test-pack-a');
    const current = { personId: self.id, kind: 'class', label: 'Algorithms', source: 'schedule', startAt: 1, endAt: 100, priority: 80 };
    const person = { person: self.id, current, today: [], code: 'BUSY_CLASS', conflict: false, research: false, routine: null };
    const reminder = domain.resolvePetState({ people: [person], subjectId: self.id, pending: 1, now: 10, reminderSince: 10 });
    check('Avatar switch 不改变 class CurrentState', current.kind === 'class' && domain.stateLabel(current) === '上课中');
    check('Reminder 仍只进入 CompanionDisplay', reminder.state === 'reminder' && current.kind === 'class');
    check('渲染进程没有 console 错误', consoleErrors.length === 0, consoleErrors.join(' | '));

    console.log(JSON.stringify({ output, passed, consoleErrors }, null, 2));
    clearTimeout(deadline); app.exit(0);
  } catch (error) {
    console.error(error); fs.writeFileSync(path.join(output, 'failure.txt'), String(error && error.stack || error));
    clearTimeout(deadline); app.exit(1);
  }
});
