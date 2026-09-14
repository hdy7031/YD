// YD v0.3 Phase 3B 隔离运行时验收：统一 CurrentState 之后，所有表面只说一件事。
//
// 覆盖：
//   * 同一时刻 Home / Orb / Mini / Tip / Tray / 桌宠都只从 StateEngine 的 CurrentState 得出结论；
//   * Schedule > Routine > Idle 的优先级在真实 Electron 运行时里成立（课程压过午饭，下课立即回到午饭）；
//   * 待处理提醒只改变桌宠姿态，不改变人物状态文案。
//
// 运行：npx electron verify-v030-current-state.cjs
const { app, BrowserWindow, Tray } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');

const output = path.join(__dirname, 'test-data', `v030-current-state-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
process.env.DAYHUB_TEST_DATA = output;

// 受控虚拟时钟：2027-03-01（周一）11:00，继续正常走动（与其它隔离验收同一套做法）。
const realNow = Date.now.bind(Date);
let simAnchor = realNow(), realAnchor = realNow();
{ const target = new Date(2027, 2, 1, 11, 0, 0, 0); simAnchor = target.getTime(); realAnchor = realNow(); }
Date.now = () => simAnchor + (realNow() - realAnchor);

// 托盘 tooltip 无法从渲染层读取：挂钩 Tray.prototype.setToolTip 抓取最后一条。
const tooltips = [];
const originalSetToolTip = Tray.prototype.setToolTip;
Tray.prototype.setToolTip = function (value) { tooltips.push(String(value)); return originalSetToolTip.call(this, value); };

const passed = [], errors = [];
const check = (name, value, detail = '') => { assert.ok(value, `${name}${detail ? ': ' + detail : ''}`); passed.push(name); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { fs.writeFileSync(path.join(output, 'failure.txt'), 'current-state acceptance timeout'); app.exit(1); }, 240000);
require('./dist/main.cjs');

app.on('web-contents-created', (_event, contents) => contents.on('console-message', (...args) => {
  const details = args[1];
  if (details && typeof details === 'object') { if (details.level === 'error' || details.level === 3) errors.push(String(details.message)); }
  else if (Number(details) >= 2) errors.push(String(args[2]));
}));

// 只改时间，保持日期不变（周一，学期内）。
const setClock = (hour, minute) => { const target = new Date(simAnchor); target.setHours(hour, minute, 0, 0); simAnchor = target.getTime(); realAnchor = realNow(); };

app.whenReady().then(async () => {
  try {
    let panel, orb, mini, tip;
    for (let i = 0; i < 120; i++) {
      const windows = BrowserWindow.getAllWindows();
      panel = windows.find(w => !w.webContents.getURL().includes('#') && w.webContents.getURL().includes('index.html'));
      orb = windows.find(w => w.webContents.getURL().endsWith('#orb'));
      mini = windows.find(w => w.webContents.getURL().endsWith('#mini'));
      tip = windows.find(w => w.webContents.getURL().endsWith('#tip'));
      if (panel && orb && mini && tip && !panel.webContents.isLoading() && !orb.webContents.isLoading()) break;
      await wait(100);
    }
    check('主窗口与桌宠窗口加载完成', !!panel && !!orb && !!mini && !!tip);
    const run = code => panel.webContents.executeJavaScript(code);
    const pet = code => orb.webContents.executeJavaScript(code);
    await wait(600);

    /* ---------- 0. 只保留一条同行者课程（10:55–11:40）与自定义作息（11:30–13:00 午饭） ---------- */
    const now = Date.now();
    await run(`window.dayhub.get().then(async s=>{
      for(const c of s.courses) await window.dayhub.change({type:'delete',entity:'courses',id:c.id});
      const profile=s.profiles.find(p=>p.role==='companion');
      await window.dayhub.change({type:'save',entity:'profiles',value:{...profile,routine:{source:'user',updatedAt:${now},rules:[
        {id:'x-lunch',kind:'meal',label:'午饭',start:'11:30',end:'13:00',days:[1,2,3,4,5,6,7],enabled:true,priority:30}
      ]}}});
      await window.dayhub.change({type:'save',entity:'courses',value:{id:'x-course',person:profile.id,title:'Computer Vision',place:'Building A 301',notes:'',activity:'teaching',weekday:1,first:4,last:4,weeks:[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20],reminders:[],checklist:[],updatedAt:${now}}});
    })`);
    const prepared = await run("window.dayhub.get().then(s=>({courses:s.courses.map(c=>[c.id,c.first,c.last]),routine:s.profiles.find(p=>p.role==='companion').routine}))");
    check('只保留一条 10:55–11:40 的同行者课程', prepared.courses.length === 1 && prepared.courses[0][0] === 'x-course', JSON.stringify(prepared.courses));
    check('同行者作息替换为 11:30–13:00 午饭', prepared.routine.rules.length === 1 && prepared.routine.rules[0].kind === 'meal');

    /* ---------- 1. 时间线：Schedule > Routine > Idle（人物状态 / 状态条 / 桌宠姿态一致） ---------- */
    // [时刻, CurrentState.kind, 完整文案, 状态条短标签, 桌宠姿态]
    const moments = [
      ['09:30', 'idle', '空闲', '空闲', 'idle'],
      ['11:00', 'class', '上课中', '上课', 'busy_class'],
      ['11:35', 'class', '上课中', '上课', 'busy_class'],
      ['11:45', 'meal', '吃饭中', '吃饭', 'eating'],
      ['12:30', 'meal', '吃饭中', '吃饭', 'eating'],
      ['13:00', 'idle', '今日课程已结束', '已下课', 'idle'],
    ];
    for (const [time, kind, label, short, pose] of moments) {
      const [hour, minute] = time.split(':').map(Number);
      setClock(hour, minute);
      await wait(1300);
      const live = await run('window.dayhub.live()');
      const status = live.people.find(p => p.person === 'partner');
      check(`${time} 人物状态 ${kind}`, status.current.kind === kind, JSON.stringify(status.current));
      // 首页状态行（Home 的真实 DOM）与 Mini / Tip / Tray 共用同一句文案。
      const rows = await run("[...document.querySelectorAll('.dual-status .person-status')].map(e=>[e.querySelector('.person-status-label')?.textContent,e.querySelector('strong')?.textContent])");
      check(`${time} 首页状态行 ${label}`, rows.some(([, text]) => text === label), JSON.stringify(rows));
      // VS2 默认形态是 Dual Status Dock（.dock-row），旧的角色陪伴模式才有 .rail-chip；
      // 两种形态拼出同一句「短代号 · 状态」，检查不再依赖某一种 DOM。
      const rail = await pet(`(()=>{
        const chips=[...document.querySelectorAll('.rail-chip')].map(e=>e.title);
        const rows=[...document.querySelectorAll('.dock-row')].map(r=>{
          const alias=r.querySelector('.dock-alias')?.textContent?.trim()??'';
          const status=r.querySelector('.dock-status')?.textContent?.trim()??'';
          return alias+' · '+status;
        });
        return [...chips,...rows];
      })()`);
      check(`${time} 桌宠状态条 ${short}`, rail.some(text => text === `Y · ${short}`), JSON.stringify(rail));
      const slot = await pet("document.querySelector('.companion-figure')?.dataset.assetSlot");
      check(`${time} 桌宠姿态 ${pose}`, slot === pose, slot);
      if (time === '11:35') check('11:35 作息层仍记录午饭（被课程压过）', live.display.scheduled === 'eating', JSON.stringify(live.display));
    }

    /* ---------- 2. 全表面一致：Orb / Mini / Tip / Tray 与状态文案同源 ---------- */
    setClock(12, 30);
    await wait(1300);
    const mealLive = await run('window.dayhub.live()');
    check('全表面检查时刻是"吃饭中"', mealLive.people.find(p => p.person === 'partner').current.kind === 'meal');
    check('托盘 tooltip 与状态文案同源', (tooltips.at(-1) ?? '').includes('Y · 吃饭中'), tooltips.at(-1) ?? '');
    await orb.webContents.executeJavaScript("window.dayhub.presence('enter','partner')");
    await wait(120);
    check('悬停提示来自同一 CurrentState', (await tip.webContents.executeJavaScript("document.querySelector('.presence-tip')?.textContent??''")).trim() === 'Y · 吃饭中');
    await orb.webContents.executeJavaScript("window.dayhub.presence('leave')");
    await pet("document.querySelector('.companion-rail-button').click()");
    await wait(200);
    const miniRows = await mini.webContents.executeJavaScript("[...document.querySelectorAll('.person-status strong')].map(e=>e.textContent)");
    check('Mini 面板显示同一文案', miniRows.includes('吃饭中'), JSON.stringify(miniRows));
    // Orb 模式：无障碍文案同样来自 statusLabel，而不是另一套粗粒度状态词。
    await run("window.dayhub.change({type:'settings',pet:{mode:'orb'}})");
    await wait(300);
    const orbLabel = await pet("document.querySelector('.presence-orb')?.getAttribute('aria-label')");
    check('Orb 无障碍文案包含"吃饭中"', typeof orbLabel === 'string' && orbLabel.includes('吃饭中'), String(orbLabel));
    await run("window.dayhub.change({type:'settings',pet:{mode:'custom'}})");
    await wait(300);
    check('恢复专属角色桌宠显示', await pet("!!document.querySelector('.companion-figure')"));

    /* ---------- 3. 提醒只改变桌宠姿态，不改人物状态 ---------- */
    setClock(11, 0);
    await wait(1300);
    const classLive = await run('window.dayhub.live()');
    check('回到上课时刻', classLive.people.find(p => p.person === 'partner').current.kind === 'class', JSON.stringify(classLive.people.find(p => p.person === 'partner').current));
    // 建一条下一分钟到点的提醒，再把时钟拨过去：提醒进入"已到时间"。
    const due = new Date(Date.now()); due.setSeconds(0, 0); due.setMinutes(due.getMinutes() + 1);
    const stamp = d => { const t = new Date(d.getTime() + 8 * 3600000); return t.toISOString().slice(0, 16); };
    await run(`window.dayhub.change({type:'save',entity:'tasks',value:{id:'x-task',title:'隔离验收提醒',notes:'',due:'${stamp(due)}',done:false,checklist:[],reminders:[0]}})`);
    await wait(1300);
    setClock(11, 2);
    let pending = null;
    for (let i = 0; i < 30 && !pending; i++) { await wait(300); const value = await run('window.dayhub.live()'); if (value.pending > 0) pending = value; }
    check('提醒进入待处理', !!pending, JSON.stringify((await run('window.dayhub.live()')).display));
    check('桌宠播放提醒姿态', pending?.display.state === 'reminder', JSON.stringify(pending?.display));
    check('提醒下的真实姿态仍是上课', pending?.display.base === 'busy_class', JSON.stringify(pending?.display));
    const reminderRows = await run("[...document.querySelectorAll('.dual-status .person-status')].map(e=>[e.querySelector('.person-status-label')?.textContent,e.querySelector('strong')?.textContent])");
    check('提醒不改变首页状态文案', reminderRows.some(([who, text]) => who === 'Ta' && text === '上课中'), JSON.stringify(reminderRows));
    check('提醒不改变桌宠状态条', (await pet("[...document.querySelectorAll('.rail-chip')].map(e=>e.title)")).some(title => title === 'Y · 上课'));
    await orb.webContents.executeJavaScript("window.dayhub.presence('enter','partner')");
    await wait(120);
    check('提醒不改变悬停提示', (await tip.webContents.executeJavaScript("document.querySelector('.presence-tip')?.textContent??''")).trim() === 'Y · 上课中');
    await orb.webContents.executeJavaScript("window.dayhub.presence('leave')");
    check('提醒不改变托盘 tooltip', (tooltips.at(-1) ?? '').includes('Y · 上课中'), tooltips.at(-1) ?? '');
    const reminderId = await run("window.dayhub.get().then(s=>s.reminders.find(r=>r.target==='tasks:x-task'&&r.status==='due')?.id)");
    check('提醒可被确认', !!reminderId && await run(`window.dayhub.change({type:'ack',id:'${reminderId}'}).then(()=>true)`));
    await wait(1300);
    check('确认后桌宠回到上课姿态', (await run('window.dayhub.live()')).display.state === 'busy_class');

    /* ---------- 4. 渲染层没有报错 ---------- */
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed }, null, 2));
    check('渲染层没有 console 错误', errors.length === 0, errors.join(' | '));
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
