// YD v0.3 Phase 1A 隔离运行时验收：身份迁移（v1 → v2）。
//
// 把 tests/fixtures/v020-synthetic.sqlite（v0.2.20 形态、没有 role / domainVersion）
// 放进隔离数据目录，启动真实 Electron 应用，验证：
//   1. 启动流程里的 migration gate 真的把身份语义升级到 v2；
//   2. 迁移前生成 before-v030 备份（.dayhub / .sqlite / .json）；
//   3. 档案 id、课程、待办、会议、通知、调课、提醒全部保持不变；
//   4. 双人界面行为冻结（状态行、桌宠状态条、导航项数）。
//
// 运行：npx electron verify-v030-identity-migration.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');

const output = path.join(__dirname, 'test-data', `v030-identity-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
process.env.DAYHUB_TEST_DATA = output;
// 预置迁移前的 v0.2.20 数据库（绝不触碰真实 %APPDATA%）。
fs.copyFileSync(path.join(__dirname, 'tests', 'fixtures', 'v020-synthetic.sqlite'), path.join(output, 'dayhub.sqlite'));

const passed = [], errors = [];
const check = (name, value, detail = '') => { assert.ok(value, `${name}${detail ? ': ' + detail : ''}`); passed.push(name); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { fs.writeFileSync(path.join(output, 'failure.txt'), 'identity migration acceptance timeout'); app.exit(1); }, 90000);
require('./dist/main.cjs');

app.on('web-contents-created', (_event, contents) => contents.on('console-message', (...args) => {
  const details = args[1];
  if (details && typeof details === 'object') { if (details.level === 'error' || details.level === 3) errors.push(String(details.message)); }
  else if (Number(details) >= 2) errors.push(String(args[2]));
}));

app.whenReady().then(async () => {
  try {
    let panel, orb;
    for (let i = 0; i < 120; i++) {
      const windows = BrowserWindow.getAllWindows();
      panel = windows.find(w => !w.webContents.getURL().includes('#') && w.webContents.getURL().includes('index.html'));
      orb = windows.find(w => w.webContents.getURL().endsWith('#orb'));
      if (panel && orb && !panel.webContents.isLoading() && !orb.webContents.isLoading()) break;
      await wait(100);
    }
    check('主窗口与桌宠窗口加载完成', !!panel && !!orb);
    await wait(300);

    const state = await panel.webContents.executeJavaScript('window.dayhub.get()');
    check('领域版本升级到 2', state.settings.domainVersion === 2, String(state.settings.domainVersion));
    check('本人档案 role=self', state.profiles.find(p => p.id === 'me')?.role === 'self');
    check('同行者档案 role=companion', state.profiles.find(p => p.id === 'partner')?.role === 'companion');
    check('档案 id 未被重写', state.profiles.map(p => p.id).join(',') === 'me,partner', state.profiles.map(p => p.id).join(','));
    check('课程数量与归属不变', state.courses.length === 15 && [...new Set(state.courses.map(c => c.person))].sort().join(',') === 'me,partner',
      `${state.courses.length} 门 · ${[...new Set(state.courses.map(c => c.person))].join(',')}`);
    check('业务集合数量不变',
      state.tasks.length === 1 && state.events.length === 1 && state.notices.length === 1 && state.exceptions.length === 1 && state.reminders.length === 3,
      `tasks=${state.tasks.length} events=${state.events.length} notices=${state.notices.length} exceptions=${state.exceptions.length} reminders=${state.reminders.length}`);

    const backups = fs.readdirSync(path.join(output, 'backups')).filter(name => name.startsWith('before-v030'));
    check('迁移前生成 before-v030 备份（三种产物）',
      backups.some(n => n.endsWith('.dayhub')) && backups.some(n => n.endsWith('.sqlite')) && backups.some(n => n.endsWith('.json')),
      backups.join(','));
    const receipt = JSON.parse(fs.readFileSync(path.join(output, 'backups', backups.find(n => n.endsWith('.json'))), 'utf8'));
    check('备份回执记录 v1 → v2 与迁移前数量',
      receipt.fromDomainVersion === 1 && receipt.targetDomainVersion === 2 && receipt.counts.courses === 15 && receipt.counts.reminders === 3);

    check('双人状态行仍然渲染两条', await panel.webContents.executeJavaScript("document.querySelectorAll('.dual-status .person-status').length===2"));
    check('导航仍然是七项', await panel.webContents.executeJavaScript("document.querySelectorAll('.nav-item').length===7"));
    check('桌宠状态条仍然是两枚身份标记', await orb.webContents.executeJavaScript("document.querySelectorAll('.companion-rail .rail-chip').length===2"));
    check('渲染进程没有报错', errors.length === 0, errors.join(' | '));
    check('没有写入 dayhub.sqlite.damaged 文件', !fs.readdirSync(output).some(name => name.includes('.damaged-')));

    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed }, null, 2));
    console.log(JSON.stringify({ output, passed }, null, 2));
    clearTimeout(deadline);
    app.quit();
  } catch (error) {
    clearTimeout(deadline);
    fs.writeFileSync(path.join(output, 'failure.txt'), error.stack || String(error));
    console.error(error);
    app.exit(1);
  }
});
