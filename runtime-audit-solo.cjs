// YD v0.3 Phase 1C · Solo 运行时验收（隔离数据目录，绝不触碰真实用户数据）。
//
// 预置 tests/fixtures/v3-solo-synthetic.sqlite：1 个本人档案（自定义 id `alex`）+ 3 门课程
// + 1 场会议 + 1 条待办。用真实 Electron 启动，检查单人工作区下所有窗口：
//   panel / orb（悬浮球）/ bubble / mini / tip / menu(sheet) / tray。
//
// 运行：npx electron runtime-audit-solo.cjs
const { app, BrowserWindow, Tray } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');

const output = path.join(__dirname, 'test-data', `v030-solo-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
process.env.DAYHUB_TEST_DATA = output;
fs.copyFileSync(path.join(__dirname, 'tests', 'fixtures', 'v3-solo-synthetic.sqlite'), path.join(output, 'dayhub.sqlite'));

// 受控虚拟时钟：把"现在"平移到 fixture 的学期内（2027-03-01 周一 10:10，本人正在上
// Machine Learning），并继续正常走动。日期必须与 tests/fixtures/v3-solo-synthetic.ts 一致。
const realNow = Date.now.bind(Date);
let simAnchor = realNow(), realAnchor = realNow();
{ const target = new Date(2027, 2, 1, 10, 10, 0, 0); simAnchor = target.getTime(); realAnchor = realNow(); }
Date.now = () => simAnchor + (realNow() - realAnchor);

// 托盘 tooltip 无法从渲染层读取：挂钩 Tray.prototype.setToolTip 抓取最后一条。
const tooltips = [];
const originalSetToolTip = Tray.prototype.setToolTip;
Tray.prototype.setToolTip = function (value) { tooltips.push(String(value)); return originalSetToolTip.call(this, value); };

const passed = [], errors = [];
const check = (name, value, detail = '') => { assert.ok(value, `${name}${detail ? ': ' + detail : ''}`); passed.push(name); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { fs.writeFileSync(path.join(output, 'failure.txt'), 'solo runtime audit timeout'); app.exit(1); }, 180000);
require('./dist/main.cjs');

app.on('web-contents-created', (_event, contents) => contents.on('console-message', (...args) => {
  const details = args[1];
  if (details && typeof details === 'object') { if (details.level === 'error' || details.level === 3) errors.push(String(details.message)); }
  else if (Number(details) >= 2) errors.push(String(args[2]));
}));

app.whenReady().then(async () => {
  try {
    let panel, orb, bubble, mini, tip, sheet;
    for (let i = 0; i < 120; i++) {
      const windows = BrowserWindow.getAllWindows();
      panel = windows.find(w => !w.webContents.getURL().includes('#') && w.webContents.getURL().includes('index.html'));
      orb = windows.find(w => w.webContents.getURL().endsWith('#orb'));
      bubble = windows.find(w => w.webContents.getURL().endsWith('#bubble'));
      mini = windows.find(w => w.webContents.getURL().endsWith('#mini'));
      tip = windows.find(w => w.webContents.getURL().endsWith('#tip'));
      sheet = windows.find(w => w.webContents.getURL().endsWith('#menu'));
      if (panel && orb && bubble && mini && tip && sheet && !panel.webContents.isLoading() && !orb.webContents.isLoading()) break;
      await wait(100);
    }
    const run = code => panel.webContents.executeJavaScript(code);
    check('六个窗口完成加载（panel / orb / bubble / mini / tip / menu）', !!(panel && orb && bubble && mini && tip && sheet));
    await wait(400);

    /* ---------- Panel ---------- */
    check('主界面正常渲染，没有白屏', await run("!!document.querySelector('.shell')&&document.querySelector('.page-frame').textContent.trim().length>20"));
    check('导航只有 6 项且没有同行者课表入口', await run("(()=>{const labels=[...document.querySelectorAll('.nav-item')].map(b=>b.textContent.trim());return labels.length===6&&!labels.some(t=>/Ta|对方|伙伴/.test(t))})()"));
    check('首页只显示一个状态行', await run("document.querySelectorAll('.dual-status .person-status').length===1"));
    check('首页显示本人课程', await run("document.body.textContent.includes('Machine Learning')||document.body.textContent.includes('Computer Vision')"));
    check('安排归属下拉只有本人一个选项', await run("(async()=>{[...document.querySelectorAll('.nav-item')].find(b=>b.textContent.trim()==='课表管理').click();await new Promise(r=>setTimeout(r,150));const s=document.querySelector('[aria-label=\"课表所属人\"]');return !!s&&s.options.length===1&&s.options[0].textContent==='我的安排'})()"));
    check('设置页只列出本人作息', await run("(async()=>{[...document.querySelectorAll('.nav-item')].find(b=>b.textContent.trim()==='设置与备份').click();await new Promise(r=>setTimeout(r,100));[...document.querySelectorAll('.settings-nav button')].find(b=>b.textContent.trim()==='课表与学校').click();await new Promise(r=>setTimeout(r,100));const t=document.body.textContent;return t.includes('Alex的学期与节次')&&!t.includes('Ta的学期')})()"));
    // 逐页点击：每一页都要有内容，且不出现 undefined / 幻影同行者。
    const pages = await run("document.querySelectorAll('.nav-item').length");
    for (let index = 0; index < pages; index++) {
      await run(`document.querySelectorAll('.nav-item')[${index}].click()`);
      await wait(140);
      const probe = await run("(()=>{const t=document.querySelector('.page-frame').textContent;return {length:t.trim().length,undef:t.includes('undefined')}})()");
      check(`第 ${index + 1} 个页面有内容且无 undefined`, probe.length > 20 && !probe.undef, JSON.stringify(probe));
    }
    check('主界面没有任何 TA / 幽灵同行者文案', await run("(()=>{const t=document.querySelector('.page-frame').textContent;return !/Ta的课表|Ta 的日程|TA的安排/.test(t)})()"));

    /* ---------- Desktop Pet（桌宠主体 = 本人） ---------- */
    // 把时钟跳到学期内会产生一批"已到时间"的历史提醒（符合产品语义：恢复后汇总）。
    // 先全部确认，再验证桌宠回到本人的业务状态，而不是停留在提醒姿态。
    const dueCount = await run("window.dayhub.get().then(s=>s.reminders.filter(r=>r.status==='due').length)");
    check('历史到点提醒进入待处理集合（不是静默丢弃）', dueCount >= 1, String(dueCount));
    await run("window.dayhub.get().then(async s=>{for(const r of s.reminders.filter(x=>x.status==='due'))await window.dayhub.change({type:'ack',id:r.id});return true})");
    await wait(1600);
    check('确认后待处理提醒归零且待办未被自动完成', await run("Promise.all([window.dayhub.live(),window.dayhub.get()]).then(([l,s])=>l.pending===0&&s.tasks.every(t=>!t.done))"));
    const pet = await orb.webContents.executeJavaScript("(()=>{const f=document.querySelector('.companion-figure');const chips=[...document.querySelectorAll('.companion-rail .rail-chip')].map(c=>c.textContent.trim());return {slot:f?.dataset.assetSlot??'',chips}})()");
    check('桌宠按本人上课状态显示', pet.slot === 'busy_class', JSON.stringify(pet));
    check('桌宠状态条只有本人一枚标记', pet.chips.length === 1 && !/Ta/.test(pet.chips.join('')), JSON.stringify(pet));

    /* ---------- Dual Status Dock ---------- */
    await run("window.dayhub.change({type:'settings',pet:{mode:'orb',size:'medium'}})");
    await wait(500);
    check('状态浮标单人模式只有一行', await orb.webContents.executeJavaScript("document.querySelectorAll('.dock-row').length===1"));
    check('状态浮标没有第二个（幽灵）同行者行', await orb.webContents.executeJavaScript("!document.querySelector('.dock-row[data-person=\"partner\"]')"));
    check('状态浮标单人行的短标签来自本人档案', await orb.webContents.executeJavaScript("document.querySelector('.dock-row .dock-alias')?.textContent.trim()==='A'"), await orb.webContents.executeJavaScript("document.querySelector('.dock-row .dock-alias')?.textContent.trim()"));
    check('Solo 没有 divider 或空白第二槽位',await orb.webContents.executeJavaScript("getComputedStyle(document.querySelector('.dock-row'),'::before').display==='none'&&!document.querySelector('.dock-row+.dock-row')"));
    // Solo 是重新配比的完整一等形态，不沿用 Together 的宽度。
    check('Solo 默认几何独立、短而利落（中档 136×48）', (() => { const [width, height] = orb.getSize(); return Math.abs(width-136)<=2&&Math.abs(height-48)<=2; })(), JSON.stringify(orb.getSize()));
    fs.writeFileSync(path.join(output,'dock-solo-default.png'),(await orb.capturePage()).toPNG());
    await orb.webContents.executeJavaScript("window.dayhub.presence('enter','alex')");
    await wait(250);
    check('Solo hover 在组件内部展开为 188×60，外置 tooltip 保持隐藏', !tip.isVisible()&&Math.abs(orb.getSize()[0]-188)<=2&&Math.abs(orb.getSize()[1]-60)<=2,JSON.stringify(orb.getSize()));
    check('Solo hover 补充信息短而完整',await orb.webContents.executeJavaScript("document.querySelectorAll('.dock-row.is-hovered').length===1&&!!document.querySelector('.dock-extra')&&!document.body.textContent.includes('undefined')"));
    fs.writeFileSync(path.join(output,'dock-solo-hover.png'),(await orb.capturePage()).toPNG());
    check('不存在的状态区域被拒绝而不是崩溃', await orb.webContents.executeJavaScript("window.dayhub.presence('enter','partner').then(()=>false).catch(()=>true)"));
    await orb.webContents.executeJavaScript("window.dayhub.presence('leave')");
    await wait(180);
    check('Solo hover 离开后稳定收回且无残留',!tip.isVisible()&&Math.abs(orb.getSize()[0]-136)<=2&&Math.abs(orb.getSize()[1]-48)<=2&&await orb.webContents.executeJavaScript("!document.querySelector('.dock-row.is-hovered')"));

    /* ---------- Mini / Menu ---------- */
    await orb.webContents.executeJavaScript("window.dayhub.window('mini')");
    await wait(300);
    check('mini 面板打开且只有一条状态', mini.isVisible() && await mini.webContents.executeJavaScript("document.querySelectorAll('.mini-status-card').length===1"));
    check('mini 标题与结构是专门的 Solo 详情态', await mini.webContents.executeJavaScript("document.querySelector('h2')?.textContent==='我的 · 此刻'&&document.querySelectorAll('.mini-status-card').length===1&&document.querySelectorAll('.mini-next').length===1"));
    check('mini 尺寸更精练且没有空白第二列',Math.abs(mini.getSize()[0]-288)<=2&&Math.abs(mini.getSize()[1]-216)<=2&&await mini.webContents.executeJavaScript("getComputedStyle(document.querySelector('.mini-status-grid')).gridTemplateColumns.split(' ').length===1"),JSON.stringify(mini.getSize()));
    check('mini 没有 undefined', await mini.webContents.executeJavaScript("!document.body.textContent.includes('undefined')"));
    fs.writeFileSync(path.join(output,'dock-solo-mini.png'),(await mini.capturePage()).toPNG());
    await orb.webContents.executeJavaScript("window.dayhub.window('menu')");
    await wait(300);
    check('桌宠菜单正常且不含固定 Ta', sheet.isVisible() && await sheet.webContents.executeJavaScript("(()=>{const t=document.body.textContent;return t.includes('打开 YD')&&t.includes('退出 YD')&&!t.includes('Ta')&&!t.includes('undefined')})()"));
    await sheet.webContents.executeJavaScript("window.dayhub.menuAction('dismiss')");

    /* ---------- Bubble（真实到时提醒） ---------- */
    // 先清空开机时那批历史提醒气泡（它们已经在待处理集合里被确认过），
    // 这样下面验证的是"新建到点提醒"本身，而不是排队中的旧气泡。
    for (let i = 0; i < 6; i++) { await run("window.dayhub.bubble('close')"); await wait(120); }
    // 待办截止时间是分钟粒度：向上取整到下一分钟（与既有 runtime audit 一致）。
    const due = Math.ceil((Date.now() + 3000) / 60000) * 60000;
    const localDue = new Date(due + 8 * 3600000).toISOString().slice(0, 16);
    await run(`window.dayhub.change({type:'save',entity:'tasks',value:{id:'solo-due',title:'Solo 隔离验收到时提醒',due:'${localDue}',notes:'',done:false,checklist:[],reminders:[0]}})`);
    console.log('等待单人工作区到点气泡', Math.ceil((due - Date.now()) / 1000) + '秒');
    let bubbleText = '';
    while (Date.now() < due + 7000) {
      const live = await run('window.dayhub.live()');
      if (live.bubble?.text?.includes('Solo 隔离验收到时提醒')) { bubbleText = live.bubble.text; break; }
      await wait(200);
    }
    check('到时提醒在单人工作区正常弹出气泡', !!bubbleText, bubbleText);
    check('气泡文案只描述本人、无 undefined', !bubbleText.includes('undefined') && !bubbleText.includes('Ta'));
    await run("window.dayhub.get().then(s=>{const due=s.reminders.find(r=>r.target==='tasks:solo-due'&&r.status==='due');return due?window.dayhub.change({type:'ack',id:due.id}):null})").catch(() => {});

    /* ---------- Tray ---------- */
    await wait(1500);
    const tooltip = tooltips.at(-1) ?? '';
    check('托盘 tooltip 只有本人一行且无幽灵/undefined', tooltip.split('\n').length === 1 && tooltip.includes('·') && !/Ta|undefined/.test(tooltip), tooltip);
    check('渲染层没有报错', errors.length === 0, errors.join(' | '));
    check('没有产生损坏数据库副本', !fs.readdirSync(output).some(name => name.includes('.damaged-')));

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
