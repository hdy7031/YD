// YD v0.3 Phase 3C 隔离运行时验收：临时手动状态（Manual Override）。
//
// 覆盖：
//   * 从首页状态行与桌宠右键菜单两个入口打开「设置当前状态」；
//   * 手动状态压过课表，并且所有表面（Home / Mini / Tip / Tray / 状态条 / 桌宠）同源；
//   * 到期自动回落到课表推导，取消立即回落；
//   * 手动状态是真实人物状态：它参与桌宠显示层的"另一位在忙"判断。
//
// 运行：npx electron verify-v030-manual-status.cjs
const { app, BrowserWindow, Tray } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');

const output = path.join(__dirname, 'test-data', `v030-manual-status-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
process.env.DAYHUB_TEST_DATA = output;

// 受控虚拟时钟：2027-03-01（周一）11:20，学期内（默认双人工作区）。
const realNow = Date.now.bind(Date);
let simAnchor = realNow(), realAnchor = realNow();
{ const target = new Date(2027, 2, 1, 11, 20, 0, 0); simAnchor = target.getTime(); realAnchor = realNow(); }
Date.now = () => simAnchor + (realNow() - realAnchor);

const tooltips = [];
const originalSetToolTip = Tray.prototype.setToolTip;
Tray.prototype.setToolTip = function (value) { tooltips.push(String(value)); return originalSetToolTip.call(this, value); };

const passed = [], errors = [];
const check = (name, value, detail = '') => { assert.ok(value, `${name}${detail ? ': ' + detail : ''}`); passed.push(name); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { fs.writeFileSync(path.join(output, 'failure.txt'), 'manual status acceptance timeout'); app.exit(1); }, 240000);
require('./dist/main.cjs');

app.on('web-contents-created', (_event, contents) => contents.on('console-message', (...args) => {
  const details = args[1];
  if (details && typeof details === 'object') { if (details.level === 'error' || details.level === 3) errors.push(String(details.message)); }
  else if (Number(details) >= 2) errors.push(String(args[2]));
}));

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
    const click = selector => run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;el.click();return true})()`);
    const input = (selector, value) => run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});
      el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return el.value})()`);
    const live = () => run('window.dayhub.live()');
    // VS2 首页状态行的标签来自档案（短代号 / 展示名），不再是写死的「我的」；
    // 因此先取本人档案再按标签定位他那一行。本人恒为第一条 person-status。
    const selfRow = () => run(`window.dayhub.get().then(state=>{
      const self=state.profiles.find(p=>p.role==='self');
      const labels=[self?.shortAlias,self?.name].filter(Boolean);
      const rows=[...document.querySelectorAll('.dual-status .person-status')];
      const row=rows.find(el=>labels.includes(el.querySelector('.person-status-label')?.textContent?.trim()))??rows[0];
      return row?{label:row.querySelector('strong')?.textContent,detail:row.querySelector('small')?.textContent}:null;
    })`);
    await wait(600);

    /* ---------- 0. 准备：本人周一一节 10:00–11:40 的课 ---------- */
    const now = Date.now();
    await run(`window.dayhub.get().then(async s=>{
      const self=s.profiles.find(p=>p.role==='self');
      await window.dayhub.change({type:'save',entity:'courses',value:{id:'x-self-class',person:self.id,title:'Computer Vision',place:'Building A 301',notes:'',activity:'teaching',weekday:1,first:3,last:4,weeks:[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20],reminders:[],checklist:[],updatedAt:${now}}});
    })`);
    await wait(1300);
    const before = await selfRow();
    check('上课时间首页显示「上课中」（按课表推测）', before?.label === '上课中' && /按课表推测/.test(before.detail ?? ''), JSON.stringify(before));
    check('本人上课时桌宠显示忙碌（另一位在忙）', (await pet("document.querySelector('.companion-figure')?.dataset.assetSlot")) === 'busy_work');

    /* ---------- 1. 首页入口：设置「专注」到 11:30 ---------- */
    check('首页状态行提供「设置当前状态」入口', await click('[data-set-status="me"]'));
    await wait(200);
    check('对话框打开且只有本人可设置', await run("!!document.querySelector('.manual-status')&&document.querySelectorAll('[data-set-status]').length===1"));
    check('可以选择「专注」', await click('[data-manual-kind="focus"]'));
    check('可以选择自定义结束时间', await click('[data-manual-duration="custom"]'));
    check('填写 11:30 结束', (await input('[aria-label="结束时间"]', '2027-03-01T11:30')) === '2027-03-01T11:30');
    check('保存临时状态', await click('[data-manual-action="save"]'));
    await wait(1300);
    const manualRow = await selfRow();
    check('首页显示「专注中 · 本人设置」', manualRow?.label === '专注中' && /本人设置/.test(manualRow.detail ?? ''), JSON.stringify(manualRow));
    const manualLive = await live();
    const selfStatus = manualLive.people.find(p => p.person === 'me');
    check('引擎来源是 manual 且 confidence = 1', selfStatus.current.source === 'manual' && selfStatus.current.confidence === 1, JSON.stringify(selfStatus.current));
    check('手动状态压过课程', selfStatus.current.kind === 'focus' && selfStatus.current.endAt === Date.UTC(2027, 2, 1, 3, 30), JSON.stringify(selfStatus.current));
    // 同上：Dock 形态读 .person（主文案 = 完整标签「专注中」），角色陪伴形态读 .rail-chip
    // （短标签「专注」）。短代号来自档案本身，不再写死成 D / Y。
    const petRail = await pet(`(()=>{
      const chips=[...document.querySelectorAll('.rail-chip')].map(e=>e.title);
      const rows=[...document.querySelectorAll('.person')].map(r=>{
        const alias=r.querySelector('.person-letter')?.textContent?.trim()??'';
        return alias+' · '+(r.querySelector('.status-text')?.textContent?.trim()??'');
      });
      return {chips,rows};
    })()`);
    const petSurfaces=[];
    if(petRail.chips.length)petSurfaces.push({name:'rail-chip',ok:petRail.chips.some(text=>text===`${selfStatus.alias} · 专注`)});
    if(petRail.rows.length)petSurfaces.push({name:'dock',ok:petRail.rows.some(text=>text===`${selfStatus.alias} · 专注中`)});
    check('桌宠状态条显示「专注」', petSurfaces.length>0&&petSurfaces.every(surface=>surface.ok), JSON.stringify({alias:selfStatus.alias,petRail,petSurfaces}));
    check('托盘 tooltip 同源', (tooltips.at(-1) ?? '').includes(`${selfStatus.alias} · 专注中`), tooltips.at(-1) ?? '');
    await orb.webContents.executeJavaScript("window.dayhub.presence('enter','me')");
    await wait(150);
    check('悬停提示同源', (await tip.webContents.executeJavaScript("document.querySelector('.presence-tip')?.textContent??''")).trim() === `${selfStatus.alias} · 专注中`);
    await orb.webContents.executeJavaScript("window.dayhub.presence('leave')");
    // 手动"专注"没有专属素材，桌宠不会被伪装成别的姿态；本人不再算"忙碌中的另一位"。
    check('桌宠不被手动状态伪造姿态', (await pet("document.querySelector('.companion-figure')?.dataset.assetSlot")) === 'idle');

    /* ---------- 2. 到期自动回落 ---------- */
    setClock(11, 31);
    await wait(1300);
    const expiredRow = await selfRow();
    check('到期后回落为「上课中」', expiredRow?.label === '上课中' && /按课表推测/.test(expiredRow.detail ?? ''), JSON.stringify(expiredRow));
    check('引擎来源回到 schedule', (await live()).people.find(p => p.person === 'me').current.source === 'schedule');

    /* ---------- 3. 取消立即回落 ---------- */
    check('再次打开对话框', await click('[data-set-status="me"]'));
    await wait(200);
    check('选择「忙碌」并保留 1 小时预设', await click('[data-manual-kind="busy"]') && await click('[data-manual-duration="60"]'));
    check('保存', await click('[data-manual-action="save"]'));
    await wait(1300);
    check('本人显示「忙碌中」', (await selfRow())?.label === '忙碌中', JSON.stringify(await selfRow()));
    check('手动「忙碌」映射到桌宠忙碌姿态（另一位在忙）', (await pet("document.querySelector('.companion-figure')?.dataset.assetSlot")) === 'busy_work');
    check('重新打开对话框显示当前临时状态', await click('[data-set-status="me"]'));
    await wait(200);
    check('对话框提示当前状态', await run("!!document.querySelector('.manual-status [data-manual-active]')"));
    check('取消当前状态', await click('[data-manual-action="cancel"]'));
    await wait(1300);
    check('取消后立即回到「上课中」', (await selfRow())?.label === '上课中', JSON.stringify(await selfRow()));
    check('记录被清空', (await run("window.dayhub.get().then(s=>s.manualOverrides.length)")) === 0);

    /* ---------- 4. 桌宠右键菜单入口 ---------- */
    await pet("window.dayhub.window('menu')");
    await wait(400);
    const menuWindow = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#menu'));
    check('右键菜单存在', !!menuWindow);
    const menu = code => menuWindow.webContents.executeJavaScript(code);
    check('菜单里有「设置当前状态」', await menu("[...document.querySelectorAll('.pet-menu-item')].some(b=>b.querySelector('.pet-menu-label').textContent.trim()==='设置当前状态')"));
    await menu("[...document.querySelectorAll('.pet-menu-item')].find(b=>b.querySelector('.pet-menu-label').textContent.trim()==='设置当前状态').click()");
    await wait(500);
    check('菜单入口打开主窗口与对话框', panel.isVisible() && await run("!!document.querySelector('.manual-status')"));

    /* ---------- 5. 校验：自定义状态必须填名称 ---------- */
    check('选择「自定义」', await click('[data-manual-kind="custom"]'));
    check('空名称保存被拒绝', await click('[data-manual-action="save"]') && await run("!!document.querySelector('.manual-status .error')"));
    check('被拒绝时没有写入', (await run("window.dayhub.get().then(s=>s.manualOverrides.length)")) === 0);
    check('关闭对话框', await click('.manual-status .modal-foot button.ghost'));
    await wait(200);
    check('关闭后对话框消失', await run("!document.querySelector('.manual-status')"));

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
