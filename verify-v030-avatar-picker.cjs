// YD v0.3 Phase 4C2 · production multi-pack picker/preview acceptance.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');

const output = path.join(__dirname, 'test-data', `v030-avatar-picker-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
process.env.DAYHUB_TEST_DATA = output;
// Phase 5A：self / companion 两个 Picker 需要双人工作区，因此显式种 fixture。
require('./scripts/electron-test-profile.cjs').seedWorkspace(output, 'together');
const bridge = path.join(output, 'avatar-picker-domain.cjs');
buildSync({
  absWorkingDir: __dirname, bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: bridge,
  stdin: { resolveDir: __dirname, sourcefile: 'avatar-picker-domain.ts', loader: 'ts', contents: `
    export { listAvatarPacks, getAvatarPack, resolveAvatarFrame } from './src/avatar.ts';
    export { DOMAIN_VERSION } from './src/domain.ts';
    export { createFreshState } from './src/core.ts';
    export { snapshot } from './src/live.ts';
  ` },
});
const domain = require(bridge);
const passed = [], errors = [];
const check = (name, value, detail = '') => { assert.ok(value, `${name}${detail ? ': ' + detail : ''}`); passed.push(name); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { fs.writeFileSync(path.join(output, 'failure.txt'), 'avatar picker timeout'); app.exit(1); }, 180000);

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
    const click = selector => run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;el.click();return true})()`);
    await run("window.dayhub.window('settings')");
    await wait(900);

    const packs = domain.listAvatarPacks();
    check('production registry 有两个真实 Pack', packs.map(pack => pack.id).join(',') === 'yd-default,yd-pixel');
    check('yd-pixel manifest 独立完整', domain.getAvatarPack('yd-pixel').assetRoot === 'companion/pixel' && Object.keys(domain.getAvatarPack('yd-pixel').frames).length === 10);
    const state = await run('window.dayhub.get()');
    check('DOMAIN_VERSION 是 7', domain.DOMAIN_VERSION === 7 && state.settings.domainVersion === 7);
    const self = state.profiles.find(profile => profile.role === 'self');
    const companion = state.profiles.find(profile => profile.role === 'companion');
    check('Together 设置页同时显示 self/companion Picker', await run("document.querySelectorAll('.avatar-person-picker').length===2"));
    check('每个 Picker 都显示两个卡片', await run("[...document.querySelectorAll('.avatar-person-picker')].every(p=>p.querySelectorAll('[data-avatar-pack-option]').length===2)"));

    const selfPicker = `.avatar-person-picker[data-avatar-person="${self.id}"]`;
    const companionPicker = `.avatar-person-picker[data-avatar-person="${companion.id}"]`;
    const beforePreview = await run('window.dayhub.get()');
    check('点击 yd-pixel 卡片进入本地预览', await click(`${selfPicker} [data-avatar-pack-option="yd-pixel"]`));
    await wait(300);
    check('大预览使用 yd-pixel 资源真相', await run(`document.querySelector(${JSON.stringify(selfPicker + ' .avatar-preview')})?.dataset.avatarPreviewPack==='yd-pixel'`));
    check('可切换 reminder 预览状态', await click(`${selfPicker} [data-avatar-preview-state-option="reminder"]`));
    await wait(200);
    check('预览状态已变为 reminder', await run(`document.querySelector(${JSON.stringify(selfPicker + ' .avatar-preview')})?.dataset.avatarPreviewState==='reminder'`));
    const afterPreview = await run('window.dayhub.get()');
    check('预览不写 persisted Profile.avatar', JSON.stringify(beforePreview.profiles) === JSON.stringify(afterPreview.profiles));
    check('预览不改 CurrentState/Manual/Routine', JSON.stringify(beforePreview.manualOverrides) === JSON.stringify(afterPreview.manualOverrides) && JSON.stringify(beforePreview.profiles.map(p => p.routine)) === JSON.stringify(afterPreview.profiles.map(p => p.routine)));

    check('self 正式选择按钮可用', await click(`${selfPicker} [data-avatar-apply="yd-pixel"]`));
    await wait(1000);
    let changed = await run('window.dayhub.get()');
    check('avatarSet 写入 self 且 source=user', changed.profiles.find(p => p.id === self.id).avatar.packId === 'yd-pixel' && changed.profiles.find(p => p.id === self.id).avatar.source === 'user');
    check('Together 修改非当前 self 不切真实桌宠', (await run('window.dayhub.live()')).petInstance.avatarPackId === 'yd-default');

    await click(`${companionPicker} [data-avatar-pack-option="yd-pixel"]`);
    await wait(200);
    await click(`${companionPicker} [data-avatar-apply="yd-pixel"]`);
    await wait(1400);
    changed = await run('window.dayhub.get()');
    check('avatarSet 写入 companion 且 source=user', changed.profiles.find(p => p.id === companion.id).avatar.packId === 'yd-pixel' && changed.profiles.find(p => p.id === companion.id).avatar.source === 'user');
    check('Together 当前 subject 无需重启热切 yd-pixel', (await run('window.dayhub.live()')).petInstance.avatarPackId === 'yd-pixel' && await pet("document.querySelector('.companion-figure')?.dataset.avatarPack==='yd-pixel'"));
    fs.writeFileSync(path.join(output, 'avatar-picker.png'), (await panel.capturePage()).toPNG());
    fs.writeFileSync(path.join(output, 'avatar-orb.png'), (await orb.capturePage()).toPNG());
    check('Picker 与真实桌宠视觉证据已保存', fs.existsSync(path.join(output, 'avatar-picker.png')) && fs.existsSync(path.join(output, 'avatar-orb.png')));

    check('恢复默认按钮走 avatarReset', await click(`${companionPicker} [data-avatar-reset="true"]`));
    await wait(1200);
    changed = await run('window.dayhub.get()');
    check('avatarReset 恢复 source=default', changed.profiles.find(p => p.id === companion.id).avatar.packId === 'yd-default' && changed.profiles.find(p => p.id === companion.id).avatar.source === 'default');
    check('真实桌宠热切回 yd-default', await pet("document.querySelector('.companion-figure')?.dataset.avatarPack==='yd-default'"));

    await Promise.all([
      run(`window.dayhub.change({type:'avatarSet',personId:${JSON.stringify(companion.id)},packId:'yd-pixel'})`),
      run(`window.dayhub.change({type:'avatarReset',personId:${JSON.stringify(companion.id)}})`),
    ]);
    await wait(1200);
    check('快速切换最终选择与视觉一致', (await run('window.dayhub.live()')).petInstance.avatarPackId === 'yd-default' && await pet("document.querySelector('.companion-figure')?.dataset.avatarPack==='yd-default'"));
    panel.webContents.reload();
    await wait(1200);
    check('renderer 重载后持久选择仍在', (await run('window.dayhub.get()')).profiles.find(profile => profile.id === self.id).avatar.packId === 'yd-pixel');
    const solo = domain.createFreshState(Date.now());
    const soloSelf = solo.profiles.find(profile => profile.role === 'self');
    solo.profiles = [soloSelf]; soloSelf.avatar = { packId: 'yd-pixel', source: 'user' };
    check('Solo runtime 主体与选择来自 self', domain.snapshot(solo, Date.now()).petInstance.subjectId === soloSelf.id && domain.snapshot(solo, Date.now()).petInstance.avatarPackId === 'yd-pixel');
    check('removed Pack resolver 安全回退且不改 Store', domain.resolveAvatarFrame('removed-pack', 'reminder').resolvedPackId === 'yd-default');
    check('渲染进程没有 console 错误', errors.length === 0, errors.join(' | '));

    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed }, null, 2));
    console.log(JSON.stringify({ output, passed, consoleErrors: errors }, null, 2));
    clearTimeout(deadline); app.exit(0);
  } catch (error) {
    fs.writeFileSync(path.join(output, 'failure.txt'), String(error && error.stack || error));
    console.error(error); clearTimeout(deadline); app.exit(1);
  }
});
