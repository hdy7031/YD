// YD v0.3 Phase 2B 隔离运行时验收：桌宠时间状态来自 Profile.routine。
//
// 与 verify-v0220.cjs 的分工：
//   * verify-v0220.cjs 锁定"默认迁移用户"的逐分钟行为（legacy 默认作息 == 0.2.x 旧时间表）；
//   * 本脚本锁定"非默认作息"的行为：把同行者的作息改成完全不同的时间，桌宠必须跟着新规则走，
//     并且在**不重启应用**的情况下响应运行中的作息修改（Phase 2C 设置页的前置条件）。
//
// 运行：npx electron verify-v030-routine-pet.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');

const output = path.join(__dirname, 'test-data', `v030-routine-pet-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
// 空目录：应用按默认双人工作区启动（同行者 = 桌宠主体，初始为 legacy 默认作息）。
process.env.DAYHUB_TEST_DATA = output;

// 受控虚拟时钟：平移 2027-03-01（周一）02:00 并继续走动。
const realNow = Date.now.bind(Date);
let simAnchor = realNow(), realAnchor = realNow();
{ const target = new Date(2027, 2, 1, 2, 0, 0, 0); simAnchor = target.getTime(); realAnchor = realNow(); }
Date.now = () => simAnchor + (realNow() - realAnchor);

const passed = [], errors = [];
const check = (name, value, detail = '') => { assert.ok(value, `${name}${detail ? ': ' + detail : ''}`); passed.push(name); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { fs.writeFileSync(path.join(output, 'failure.txt'), 'routine pet acceptance timeout'); app.exit(1); }, 180000);
require('./dist/main.cjs');

app.on('web-contents-created', (_event, contents) => contents.on('console-message', (...args) => {
  const details = args[1];
  if (details && typeof details === 'object') { if (details.level === 'error' || details.level === 3) errors.push(String(details.message)); }
  else if (Number(details) >= 2) errors.push(String(args[2]));
}));

// 只改时间，保持日期不变（周一，学期内）。
const setClock = (hour, minute) => {
  const target = new Date(simAnchor);
  target.setHours(hour, minute, 0, 0);
  simAnchor = target.getTime(); realAnchor = realNow();
};

const routine = rules => ({ source: 'user', updatedAt: Date.now(), rules: rules.map(rule => ({ days: [1, 2, 3, 4, 5, 6, 7], enabled: true, priority: 30, ...rule })) });
const saveRoutine = (run, rules) => run(`window.dayhub.get().then(s=>{
  const profile=s.profiles.find(p=>p.role==='companion');
  return window.dayhub.change({type:'save',entity:'profiles',value:{...profile,routine:${JSON.stringify(routine(rules))}}});
})`);

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
    const run = code => panel.webContents.executeJavaScript(code);
    const pet = code => orb.webContents.executeJavaScript(code);
    const stateAt = async (hour, minute = 30) => { setClock(hour, minute); await wait(1300); return run('window.dayhub.live()'); };
    await wait(600);

    /* ---------- 0. 初始是迁移默认作息 ---------- */
    const initial = await run("window.dayhub.get().then(s=>s.profiles.find(p=>p.role==='companion').routine)");
    check('新工作区的桌宠主体带 legacy 默认作息', initial?.source === 'legacy-default' && initial.rules.length === 5, JSON.stringify(initial?.rules?.map(r => r.kind)));
    check('桌宠主体沿用身份层（Together = 同行者）', (await run('window.dayhub.live()')).subject === 'partner');

    /* ---------- 1. 换成完全不同的作息，桌宠跟着新规则走 ---------- */
    await saveRoutine(run, [
      { id: 'x-sleep', kind: 'sleep', label: '睡觉', start: '01:00', end: '09:00', priority: 40 },
      { id: 'x-meal', kind: 'meal', label: '午饭', start: '13:00', end: '13:30', priority: 30 },
    ]);
    // 08:30：旧时间表是普通状态，新作息要求在睡觉。
    const morning = await stateAt(8);
    check('自定义作息：08:30 进入夜间睡觉', morning.display.state === 'night_sleep' && morning.display.scheduled === 'night_sleep', JSON.stringify(morning.display));
    check('桌宠渲染层同步为睡觉素材', await pet("document.querySelector('.companion-figure').dataset.assetSlot==='night_sleep'"));
    // 11:45：旧时间表是吃饭（11:30–12:00），新作息里没有这一条。
    const beforeLunch = await stateAt(11, 45);
    check('旧时间表的吃饭时段不再生效', beforeLunch.display.scheduled === null && beforeLunch.display.state === 'idle', JSON.stringify(beforeLunch.display));
    // 13:30 前的 13:15：新作息要求的吃饭。
    const lunch = await stateAt(13, 15);
    check('自定义作息：13:15 开始吃饭', lunch.display.state === 'eating' && lunch.display.scheduled === 'eating', JSON.stringify(lunch.display));
    // 23:45：旧时间表是睡觉（23:30–07:30），新作息 01:00 才开始。
    const night = await stateAt(23, 45);
    check('旧时间表的夜间睡觉时段不再生效', night.display.scheduled === null && night.display.state === 'idle', JSON.stringify(night.display));

    /* ---------- 2. 设置页说明文字同样来自 Routine ---------- */
    await run("window.dayhub.window('settings')");
    await wait(400);
    const settingsText = await run("document.querySelector('.pet-settings')?.textContent??''");
    check('设置页按新作息显示睡觉时段', settingsText.includes('01:00–09:00'), settingsText.slice(0, 200));
    check('设置页不再出现旧的写死时间', !settingsText.includes('23:30–07:30') && !settingsText.includes('12:30–14:00'), settingsText.slice(0, 200));

    /* ---------- 3. 运行中改作息：不重启立即生效 ---------- */
    await saveRoutine(run, [
      { id: 'x-sleep', kind: 'sleep', label: '睡觉', start: '01:00', end: '09:00', priority: 40 },
      { id: 'x-meal', kind: 'meal', label: '午饭', start: '13:00', end: '13:30', priority: 30, enabled: false },
      { id: 'x-nap', kind: 'nap', label: '午睡', start: '15:00', end: '15:30', priority: 35 },
    ]);
    const disabledMeal = await stateAt(13, 15);
    check('停用规则立即生效：13:15 不再吃饭', disabledMeal.display.scheduled === null, JSON.stringify(disabledMeal.display));
    const nap = await stateAt(15, 10);
    check('新增规则立即生效：15:30 前午睡（无需重启应用）', nap.display.state === 'nap' && nap.display.scheduled === 'nap', JSON.stringify(nap.display));
    check('桌宠渲染层同步为午睡素材', await pet("document.querySelector('.companion-figure').dataset.assetSlot==='nap'"));
    const settled = await stateAt(16);
    check('午睡结束后回到普通状态', settled.display.scheduled === null && settled.display.state === 'idle', JSON.stringify(settled.display));

    /* ---------- 4. 运行状态与数据一致性 ---------- */
    const saved = await run("window.dayhub.get().then(s=>s.profiles.find(p=>p.role==='companion').routine)");
    check('新作息已落盘', saved?.rules.length === 3 && saved.rules.some(r => r.id === 'x-nap'));
    check('没有产生损坏数据库副本', !fs.readdirSync(output).some(name => name.includes('.damaged-')));
    check('渲染进程没有报错', errors.length === 0, errors.join(' | '));

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
