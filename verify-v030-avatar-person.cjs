// YD v0.3 Phase 4B · Person Avatar selection and PetInstance runtime acceptance.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');

const output = path.join(__dirname, 'test-data', `v030-avatar-person-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
process.env.DAYHUB_TEST_DATA = output;
// Phase 5A：双人语义由合成 fixture 显式种下，不再依赖生产 fresh default。
require('./scripts/electron-test-profile.cjs').seedWorkspace(output, 'together');
const bridge = path.join(output, 'avatar-person.cjs');
buildSync({
  absWorkingDir: __dirname, bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: bridge,
  stdin: { resolveDir: __dirname, sourcefile: 'avatar-person.ts', loader: 'ts', contents: `
    export { DEFAULT_AVATAR_PACK_ID, resolveAvatarFrame } from './src/avatar.ts';
    export { resolvePetInstance } from './src/pet-instance.ts';
    export { avatarSelectionMigrationV6 } from './src/migration.ts';
  ` },
});
const domain = require(bridge);
const passed = [], errors = [];
const check = (name, value, detail = '') => { assert.ok(value, `${name}${detail ? ': ' + detail : ''}`); passed.push(name); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { fs.writeFileSync(path.join(output, 'failure.txt'), 'avatar person acceptance timeout'); app.exit(1); }, 120000);

require('./dist/main.cjs');
app.on('web-contents-created', (_event, contents) => contents.on('console-message', (...args) => {
  const details = args[1];
  if (details && typeof details === 'object') { if (details.level === 'error' || details.level === 3) errors.push(String(details.message)); }
  else if (Number(details) >= 2) errors.push(String(args[2]));
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
    const run = code => panel.webContents.executeJavaScript(code);
    const pet = code => orb.webContents.executeJavaScript(code);
    await wait(400);

    const state = await run('window.dayhub.get()');
    check('领域版本是 v7', state.settings.domainVersion === 7);
    check('v1 链式迁移为每个 Profile 补 Avatar', state.profiles.every(p => p.avatar?.packId === 'yd-default' && p.avatar?.source === 'default'));
    const self = state.profiles.find(p => p.role === 'self'), companion = state.profiles.find(p => p.role === 'companion');
    check('Together PetInstance 主体是 companion', domain.resolvePetInstance(state).subjectId === companion.id);
    check('Together PetInstance 读取 companion Avatar', domain.resolvePetInstance(state).avatarPackId === companion.avatar.packId);
    const reordered = { ...state, profiles: [...state.profiles].reverse() };
    check('Profile reorder 不改变 PetInstance', domain.resolvePetInstance(reordered).subjectId === companion.id);
    const solo = { ...state, profiles: [self] };
    check('Solo PetInstance 主体是 self', domain.resolvePetInstance(solo).subjectId === self.id && domain.resolvePetInstance(solo).avatarPackId === self.avatar.packId);

    const v5 = structuredClone(state); v5.settings.domainVersion = 5; delete v5.profiles[0].avatar;
    const selected = v5.profiles[1].avatar = { packId: 'removed-pack', source: 'user' };
    const v6 = domain.avatarSelectionMigrationV6(v5);
    check('v5→v6 只补缺失的默认选择', v6.profiles[0].avatar.packId === 'yd-default' && v6.profiles[0].avatar.source === 'default');
    check('v5→v6 保留已有选择', JSON.stringify(v6.profiles[1].avatar) === JSON.stringify(selected));

    await run(`window.dayhub.change({type:'avatarSet',personId:${JSON.stringify(self.id)},packId:'yd-default'})`);
    let updated = await run('window.dayhub.get()');
    check('set self Avatar 成功且 source=user', updated.profiles.find(p => p.id === self.id).avatar.source === 'user');
    await run(`window.dayhub.change({type:'avatarSet',personId:${JSON.stringify(companion.id)},packId:'yd-default'})`);
    updated = await run('window.dayhub.get()');
    check('set companion Avatar 合法且独立', updated.profiles.find(p => p.id === companion.id).avatar.source === 'user');
    let rejected = false; try { await run(`window.dayhub.change({type:'avatarSet',personId:${JSON.stringify(companion.id)},packId:'missing-pack'})`); } catch { rejected = true; }
    check('unknown Pack command 被拒绝', rejected);
    await run(`window.dayhub.change({type:'avatarReset',personId:${JSON.stringify(companion.id)}})`);
    updated = await run('window.dayhub.get()');
    check('reset companion 恢复 source=default', updated.profiles.find(p => p.id === companion.id).avatar.source === 'default');

    const unknownState = structuredClone(updated); unknownState.profiles.find(p => p.id === companion.id).avatar = { packId: 'removed-pack', source: 'user' };
    const unknownInstance = domain.resolvePetInstance(unknownState), unknownFrame = domain.resolveAvatarFrame(unknownInstance.avatarPackId, 'busy_class');
    check('removed Pack 保留在 PetInstance', unknownInstance.avatarPackId === 'removed-pack');
    check('removed Pack 由 Avatar Resolver 回退 default', unknownFrame.resolvedPackId === 'yd-default' && unknownFrame.fallback === 'default-pack');
    check('runtime fallback 不改写选择', unknownState.profiles.find(p => p.id === companion.id).avatar.packId === 'removed-pack');

    const live = await run('window.dayhub.live()');
    check('live projection 暴露唯一 PetInstance', live.petInstance.subjectId === companion.id && live.petInstance.avatarPackId === 'yd-default');
    orb.webContents.send('dayhub:live', { ...live, preferences: { ...live.preferences, mode: 'custom' } });
    await wait(250);
    check('renderer 使用 PetInstance 的 Pack', await pet("document.querySelector('.companion-figure')?.dataset.avatarPack==='yd-default'"));
    check('渲染进程没有 console 错误', errors.length === 0, errors.join(' | '));

    console.log(JSON.stringify({ output, passed, consoleErrors: errors }, null, 2));
    clearTimeout(deadline); app.exit(0);
  } catch (error) {
    console.error(error); fs.writeFileSync(path.join(output, 'failure.txt'), String(error && error.stack || error));
    clearTimeout(deadline); app.exit(1);
  }
});
