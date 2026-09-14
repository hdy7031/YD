// v0.3 Dock 重建 —— 最终视觉截图（Solo / Together × collapsed / hover / detail，
// 以及"正在上课 / 今日课程已结束"两个真实状态、课表管理顶部与通知页顶部）。
//
// 与 verify-v030-dock.cjs 的分工：那个脚本做运行时断言，这个脚本只负责产出
// 可以直接用眼睛确认的截图。数据全部落在 os.tmpdir() 的隔离 userData 下。
//
// 运行：
//   npx electron scripts/visual-v030-dock.cjs            # 依次跑全部步骤
//   npx electron scripts/visual-v030-dock.cjs --mode=together --at=10:10 --data=<dir> --panels
const { app, BrowserWindow, screen } = require('electron');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configureIsolatedUserData } = require('./electron-test-profile.cjs');

const root = path.join(__dirname, '..');
const output = path.join(root, 'test-data', 'v030-visual');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
/**
 * 真实鼠标定位：新的 hover 兜底守卫会用系统光标位置确认"指针是否还在窗口里"，
 * 因此脚本里的合成 pointerover 必须配合真实光标一起移动，否则守卫会正确地把它判成"已离开"。
 */
function moveCursor(x, y) {
  try {
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point(${Math.round(x)},${Math.round(y)});` +
      `$sig='[DllImport("user32.dll")] public static extern void mouse_event(uint f,int dx,int dy,uint d,System.IntPtr e);';` +
      `Add-Type -MemberDefinition $sig -Name M -Namespace YD;[YD.M]::mouse_event(1,1,1,0,[System.IntPtr]::Zero);[YD.M]::mouse_event(1,-1,-1,0,[System.IntPtr]::Zero)`], { windowsHide: true });
  } catch { /* 定位失败时断言会明确失败，不静默通过 */ }
}
// SetCursorPos 用物理像素，Electron 的 bounds 是 DIP：必须乘上显示器缩放因子。
const cursorInto = win => { const b = win.getBounds(); const scale = screen.getDisplayMatching(b).scaleFactor || 1; moveCursor(Math.round((b.x + b.width / 2) * scale), Math.round((b.y + b.height / 2) * scale)); };
const argOf = name => {
  const prefix = `--${name}=`;
  const found = process.argv.find(value => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
};
const hasFlag = name => process.argv.includes(`--${name}`);

// 受控虚拟时钟：把"现在"平移进合成课表的学期内，截图才有真实的课程状态。
// 锚点与 tests/fixtures/synthetic-schedule.json 的 startDate（2027-03-01 周一）一致。
const realNowImpl = Date.now.bind(Date);
let anchoredAt = null;
function setClock(hour, minute) {
  anchoredAt = new Date(2027, 2, 1, hour, minute, 0, 0).getTime();
  const base = realNowImpl();
  Date.now = () => anchoredAt + (realNowImpl() - base);
}

let report = [];
const check = (name, value, detail = '') => report.push({ name, ok: !!value, detail: String(detail) });

async function boot(dataDir) {
  configureIsolatedUserData('v030-visual', dataDir);
  app.setAppPath(root);
  require(path.join(root, 'dist', 'main.cjs'));
  let panel, dock;
  for (let i = 0; i < 160; i++) {
    const windows = BrowserWindow.getAllWindows();
    panel = windows.find(w => w.webContents.getURL().includes('index.html') && !w.webContents.getURL().includes('#'));
    dock = windows.find(w => w.webContents.getURL().endsWith('#orb'));
    if (panel && dock && !panel.webContents.isLoading() && !dock.webContents.isLoading()) break;
    await wait(100);
  }
  return { panel, dock, mini: () => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#mini')) };
}

const save = async (win, name) => {
  const image = await win.capturePage();
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, name), image.toPNG());
};

const pointer = (type, related) => `document.querySelector('.pet-handle').dispatchEvent(new PointerEvent('${type}',{bubbles:true,pointerType:'mouse',relatedTarget:document.${related}}))`;

async function run() {
  const mode = argOf('mode') ?? 'together';
  const [hour, minute] = (argOf('at') ?? '10:10').split(':').map(Number);
  const dataDir = argOf('data') ?? fs.mkdtempSync(path.join(os.tmpdir(), 'yd-visual-'));
  setClock(hour, minute);
  // Solo 用仓库里已提交的单人 fixture（1 个本人档案 + 3 门课），而不是"删掉同行者"：
  // 单人工作区是合法形态，必须用真实的单人数据截图。
  const solo = mode === 'solo';
  if (solo) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.copyFileSync(path.join(root, 'tests', 'fixtures', 'v3-solo-synthetic.sqlite'), path.join(dataDir, 'dayhub.sqlite'));
  }
  const { panel, dock } = await boot(dataDir);
  check('主窗口与状态 Dock 加载完成', !!panel && !!dock);
  const run = async code => {
    try { return await panel.webContents.executeJavaScript(code); }
    catch (error) { check(`主窗口脚本失败：${String(code).slice(0, 48)}…`, false, String(error && error.message ? error.message : error)); return undefined; }
  };

  const schedule = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'synthetic-schedule.json'), 'utf8'));
  if (!solo) await run(`window.dayhub.change({type:'importSchedule',value:${JSON.stringify(schedule)}})`);
  await run("window.dayhub.change({type:'settings',setup:true,pet:{mode:'orb',size:'medium'}})");
  await wait(1100);

  const tag = `${mode}-${hour}${String(minute).padStart(2, '0')}`;
  await save(dock, `${tag}-collapsed.png`);
  // 用真实光标触发 hover（而不是只合成 DOM 事件）：截图里的展开态就是用户真正会
  // 看到的那一个，同时也顺带验证了"指针还在窗口内 → 保持展开"。
  let hoverState = null;
  for (let attempt = 0; attempt < 3 && hoverState?.view !== 'hover'; attempt++) {
    cursorInto(dock);
    await wait(200);
    // 点击穿透窗口需要先由一次移动切回可交互，再有一次真实移动才会产生 pointerover：
    // 这里轻微抖动一下光标（1.5px / 3px），模拟用户把鼠标移进状态牌。
    const b = dock.getBounds(), scale = screen.getDisplayMatching(b).scaleFactor || 1;
    moveCursor(Math.round((b.x + b.width / 2 + attempt + 2) * scale), Math.round((b.y + b.height / 2) * scale));
    await wait(420);
    hoverState = await dock.webContents.executeJavaScript("({view:document.querySelector('.pet-dock').dataset.dockView,extras:[...document.querySelectorAll('.dock-extra')].map(e=>e.textContent.trim()),status:[...document.querySelectorAll('.dock-status')].map(e=>e.textContent.trim())})");
  }
  // 真实指针在部分 DPI / 合成环境下不会产生 pointerover；这时退回与验收脚本同一条
  // React 处理链的合成事件（仍然驱动同一套状态机，不是直接改 DOM）。
  if (hoverState?.view !== 'hover') {
    cursorInto(dock);
    await dock.webContents.executeJavaScript(pointer('pointerover', 'documentElement'));
    await wait(260);
    hoverState = await dock.webContents.executeJavaScript("({view:document.querySelector('.pet-dock').dataset.dockView,extras:[...document.querySelectorAll('.dock-extra')].map(e=>e.textContent.trim()),status:[...document.querySelectorAll('.dock-status')].map(e=>e.textContent.trim())})");
  }
  await save(dock, `${tag}-hover.png`);
  check(`${mode} hover 截图状态`, hoverState.view === 'hover', JSON.stringify(hoverState));
  moveCursor(4, 4);
  await dock.webContents.executeJavaScript(pointer('pointerout', 'documentElement'));
  await wait(260);
  await dock.webContents.executeJavaScript("document.querySelector('.pet-handle').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
  await wait(650);
  const mini = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#mini'));
  const detailText = await mini.webContents.executeJavaScript("document.body.innerText.replace(/\\s+/g,' ').trim()");
  check(`${mode} detail 截图状态`, mini.isVisible() && detailText.length > 10, detailText.slice(0, 120));
  await save(mini, `${tag}-detail.png`);
  await mini.hide();
  await wait(240);

  // 两个真实状态：
  //   正在上课（10:10）→ busy；今日课程已结束（20:00）→ idle + 今日课程已结束。
  const state = await dock.webContents.executeJavaScript("({status:[...document.querySelectorAll('.dock-status')].map(e=>e.textContent.trim()),kind:[...document.querySelectorAll('.dock-row')].map(e=>e.dataset.stateKind),dot:[...document.querySelectorAll('.dock-row .status-dot')].map(e=>getComputedStyle(e).backgroundColor)})");
  // 默认态不允许任何内置状态被省略号截断（"上课中"是最常见的三字状态）。
  const compact = await dock.webContents.executeJavaScript(`({overflow:[...document.querySelectorAll('.dock-status')].map(e=>Math.max(0,e.scrollWidth-e.clientWidth)),text:[...document.querySelectorAll('.dock-status')].map(e=>e.textContent.trim()),rows:[...document.querySelectorAll('.dock-row')].map(e=>({w:Math.round(e.getBoundingClientRect().width),aliasW:Math.round(e.querySelector('.dock-alias').getBoundingClientRect().width),statusW:Math.round(e.querySelector('.dock-status').getBoundingClientRect().width),font:getComputedStyle(e.querySelector('.dock-status')).font})),plate:Math.round(document.querySelector('.dock-surface').getBoundingClientRect().width)})`);
  check(`${mode} compact 内置状态完整显示`, compact.overflow.every(value => value <= 1), JSON.stringify(compact));
  // Solo 与 Together 是两个独立工作区：Solo 必须真的是"一个人 1 行"，不是删掉半边。
  check(`${mode} 工作区档案数正确`, state.kind.length === (solo ? 1 : 2), JSON.stringify(state));
  fs.writeFileSync(path.join(output, `${tag}-state.json`), JSON.stringify(state, null, 2));
  if (mode === 'together' && hour === 10) await save(dock, 'state-current-class.png');
  if (mode === 'together' && hour === 20) await save(dock, 'state-after-class.png');

  if (hasFlag('panels')) {
    // 主窗口按 1440px 宽截图：课表管理顶部控制区 + 通知页顶部与第一条列表。
    const area = screen.getPrimaryDisplay().workArea;
    panel.setBounds({ x: area.x + 20, y: area.y + 20, width: Math.min(1440, area.width - 40), height: Math.min(900, area.height - 60) });
    await wait(500);
    await panel.webContents.executeJavaScript("document.querySelector('.nav-item[data-tab=\"courses\"]')?.click()");
    await wait(700);
    const toolbar = await panel.webContents.executeJavaScript(`(()=>{const el=document.querySelector('.course-toolbar');const r=el.getBoundingClientRect();const grid=document.querySelector('.course-toolbar').getBoundingClientRect();const select=el.querySelector('select').getBoundingClientRect();const copy=el.querySelector('.course-toolbar-copy').getBoundingClientRect();const actions=el.querySelector('.course-toolbar-actions').getBoundingClientRect();const style=getComputedStyle(el);return {rect:{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)},display:style.display,columns:style.gridTemplateColumns,selectLeft:Math.round(select.x),copyLeft:Math.round(copy.x),actionsRight:Math.round(actions.right),right:Math.round(grid.right),overflow:el.scrollWidth-el.clientWidth}})()`);
    check('课表管理顶部是横向工具栏（selector | metadata | actions）', toolbar.display === 'grid' && toolbar.overflow <= 1 && toolbar.selectLeft < toolbar.copyLeft && toolbar.copyLeft < toolbar.actionsRight && Math.abs(toolbar.right - toolbar.actionsRight) <= 24, JSON.stringify(toolbar));
    await save(panel, 'page-schedule-toolbar.png');
    await panel.webContents.capturePage({ x: 0, y: 0, width: Math.min(1440, area.width - 40), height: 260 }).then(image => fs.writeFileSync(path.join(output, 'page-schedule-toolbar-crop.png'), image.toPNG()));
    // 通知页：先造两条通知，再看顶部层级。
    for (const [index, text] of ['明天下午三点和导师开会，地点 D10b', '周五的高等数学调课到周六上午 10:00'].entries()) {
      await panel.webContents.executeJavaScript(`window.dayhub.change({type:'inbound',id:'visual-notice-${index}',payload:{text:${JSON.stringify(text)},sourceType:'MANUAL'}})`);
    }
    await wait(600);
    await panel.webContents.executeJavaScript("document.querySelector('.nav-item[data-tab=\"inbox\"]')?.click()");
    await wait(700);
    const inbox = await panel.webContents.executeJavaScript(`(()=>{const head=document.querySelector('.inbox-list-head');const note=document.querySelector('.trust-note');const items=[...document.querySelectorAll('.inbox-list-item')];const first=items[0]?.getBoundingClientRect();const title=document.querySelector('.page-title, h1')?.textContent??'';return {trust:note?note.textContent.trim():null,head:head?head.textContent.trim():null,items:items.length,firstTop:first?Math.round(first.y):null,hasInstruction:/选择一条查看详情/.test(document.body.innerText),trustFont:note?getComputedStyle(note).fontSize:null}})()`);
    check('通知页只保留一行机制说明 + 一行 section header', inbox.trust === '整理结果经确认后才会加入正式事务' && /^通知\s*\d+\s*条$/.test(inbox.head) && !inbox.hasInstruction, JSON.stringify(inbox));
    await save(panel, 'page-inbox-top.png');
    // 裁到"标题 → 机制说明 → section header → 第一条通知"这一段，正好是本次要验收的层级。
    await panel.webContents.capturePage({ x: 0, y: 0, width: Math.min(1440, area.width - 40), height: 640 }).then(image => fs.writeFileSync(path.join(output, 'page-inbox-top-crop.png'), image.toPNG()));
  }

  const failed = report.filter(item => !item.ok);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, `report-${tag}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode, at: `${hour}:${String(minute).padStart(2, '0')}`, passed: report.length - failed.length, failed }, null, 2));
  return failed.length;
}

const spawnStep = args => spawnSync(process.execPath, [__filename, ...args], { cwd: root, env: process.env, stdio: 'inherit' }).status ?? 1;

if (!process.argv.some(value => value.startsWith('--mode='))) {
  // Solo 与 Together 使用互不影响的隔离数据目录：导入课表是合并语义，
  // 同一个目录里跑两种模式会让 Solo 混进上一个工作区的同行者档案。
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-visual-'));
  const togetherDir = path.join(baseDir, 'together');
  const soloDir = path.join(baseDir, 'solo');
  const steps = [
    ['--mode=together', '--at=10:10', `--data=${togetherDir}`, '--panels'],
    ['--mode=together', '--at=20:00', `--data=${togetherDir}`],
    ['--mode=solo', '--at=10:10', `--data=${soloDir}`],
    ['--mode=solo', '--at=20:00', `--data=${soloDir}`],
  ];
  let worst = 0;
  for (const step of steps) worst = spawnStep(step) !== 0 ? 1 : worst;
  process.exit(worst);
} else {
  app.whenReady().then(async () => {
    let failed = 1;
    try { failed = await run(); } catch (error) { console.error(error); }
    app.exit(failed ? 1 : 0);
  });
}
