// v0.3 Phase 2：YD Dual Status Dock 运行时验收。
//
// 覆盖：Dock 结构 / 人物 label / 状态来源 / hover / click / drag / rapid drag /
// drag→mouse leave / drag→click / 位置落盘与重启恢复；以及 Solo 工作区退化成单行。
//
// Solo 工作区由 runtime-audit-solo.cjs 覆盖（它自带 Solo fixture）；
// 本脚本负责 Together 工作区的 Dock 行为，因为应用自身持有单实例锁、同一进程无法重启：
//   npx electron verify-v030-dock.cjs            # 依次 spawn together → restart
//   npx electron verify-v030-dock.cjs together
//   npx electron verify-v030-dock.cjs restart <dataDir>
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = __dirname;
const output = path.join(root, 'test-data', 'v030-dock');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = [];
const check = (name, value, detail = '') => report.push({ name, ok: !!value, detail });

async function boot(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.DAYHUB_TEST_DATA = dataDir;
  app.setAppPath(root);
  require('./dist/main.cjs');
  let panel, dock;
  for (let i = 0; i < 140; i++) {
    const windows = BrowserWindow.getAllWindows();
    panel = windows.find(w => w.webContents.getURL().includes('index.html') && !w.webContents.getURL().includes('#'));
    dock = windows.find(w => w.webContents.getURL().endsWith('#orb'));
    if (panel && dock && !panel.webContents.isLoading() && !dock.webContents.isLoading()) break;
    await wait(100);
  }
  return { panel, dock };
}

const windowOf = hash => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#' + hash));

async function runTogether() {
  const dataDir = path.join(output, 'together');
  const { panel, dock } = await boot(dataDir);
  const run = code => panel.webContents.executeJavaScript(code);
  const pet = code => dock.webContents.executeJavaScript(code);
  check('主窗口与状态浮标窗口加载完成', !!panel && !!dock);

  const schedule = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'synthetic-schedule.json'), 'utf8'));
  await run(`window.dayhub.change({type:'importSchedule',value:${JSON.stringify(schedule)}})`);
  await run("window.dayhub.change({type:'settings',setup:true,pet:{mode:'orb',size:'medium'}})");
  await wait(800);

  /* ---------- A. 结构与语义 ---------- */
  const structure = await pet(`(()=>{
    const rows=[...document.querySelectorAll('.dock-row')];
    const surface=document.querySelector('.dock-surface');
    const rect=surface?.getBoundingClientRect();
    const style=surface?getComputedStyle(surface):null;
    return {
      rows:rows.map(r=>({person:r.dataset.person,label:r.querySelector('.dock-alias')?.textContent.trim(),status:r.querySelector('.dock-status')?.textContent.trim(),kind:r.dataset.stateKind,dot:!!r.querySelector('.status-dot')})),
      radius:style?.borderRadius,background:style?.backgroundColor,backdrop:style?.backdropFilter,
      rect:rect?{width:rect.width,height:rect.height}:null,
      legacy:!!document.querySelector('.presence-orb,.presence-surface,.identity-mark,.orb-shell,.split-orb')
    };
  })()`);
  check('两行状态：人物 label 与状态都来自档案 / CurrentState', structure.rows.length === 2 && structure.rows.every(r => r.label && r.status && r.dot), JSON.stringify(structure.rows));
  check('Dock 是固定圆角状态牌（非单球体）', structure.rect && structure.rect.width > structure.rect.height && parseFloat(structure.radius) >= 14 && parseFloat(structure.radius) <= 16, JSON.stringify({ rect: structure.rect, radius: structure.radius }));
  check('Dock 表面为 mist 白底与轻玻璃层', /rgba?\(\s*250\s*,\s*252\s*,\s*251/.test(String(structure.background)) && /blur\(18px\)/.test(String(structure.backdrop)), JSON.stringify({ background: structure.background, backdrop: structure.backdrop }));
  check('legacy orb 结构已不在 DOM 中', structure.legacy === false);
  const dockSize = dock.getSize();
  check('Together 默认窗口尺寸与布局常量一致（中档 276×58）', Math.abs(dockSize[0] - 276) <= 2 && Math.abs(dockSize[1] - 58) <= 2, dockSize.join('x'));
  const dotColor = await pet("getComputedStyle(document.querySelector('.dock-row .status-dot')).backgroundColor");
  check('状态点颜色来自统一语义色板', /rgba?\(\d+, \d+, \d+/.test(dotColor), dotColor);

  /* ---------- B. hover / click ---------- */
  await pet("window.dayhub.presence('enter','partner')");
  await wait(340);
  const tip = windowOf('tip');
  const expanded=dock.getSize();
  check('hover 只在固定 Dock 内显露第二行，不显示外置 tooltip', !!tip&&!tip.isVisible()&&Math.abs(expanded[0]-dockSize[0])<=1&&Math.abs(expanded[1]-dockSize[1])<=1,expanded.join('x'));
  check('hover 侧显示一条 CurrentState 派生的补充信息',await pet("document.querySelectorAll('.dock-row.is-hovered').length===1&&!!document.querySelector('.dock-row.is-hovered .dock-extra')&&!document.body.textContent.includes('undefined')"));
  fs.writeFileSync(path.join(output,'dock-together-hover.png'),(await dock.capturePage()).toPNG());
  await pet("window.dayhub.presence('leave')");
  await wait(240);
  check('离开后固定几何不变且无幽灵 tooltip',Math.abs(dock.getSize()[0]-276)<=2&&Math.abs(dock.getSize()[1]-58)<=2&&!tip.isVisible(),dock.getSize().join('x'));
  const mini = windowOf('mini');
  await pet("document.querySelector('.pet-handle').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
  await wait(360);
  check('click 展开轻量详情面板（当前状态 / 下一项）', mini.isVisible() && await mini.webContents.executeJavaScript("document.body.textContent.includes('当前')||document.body.textContent.includes('下一项')"));
  check('Together Mini 使用两个平级状态卡且无冗余操作',await mini.webContents.executeJavaScript("document.querySelectorAll('.mini-status-card').length===2&&document.querySelectorAll('.mini-next').length===2&&document.querySelectorAll('.mini-actions button').length===2"));
  fs.writeFileSync(path.join(output,'dock-together-mini.png'),(await mini.capturePage()).toPNG());
  if (mini.isVisible()) await mini.hide();
  await wait(220);

  /* ---------- C. drag / rapid drag / drag→leave / drag→click ---------- */
  const start = dock.getBounds();
  // Windows 在 100%–150% DPI 下会把透明窗口的客户区重新对齐到物理像素（±1–7px），
  // 因此这里锁定的是"固定画布"契约：高度恒为布局常量，宽度只在常量附近小幅取整。
  check('Dock 窗口尺寸稳定（高度等于布局常量，宽度仅物理像素取整）', start.height === 58 && Math.abs(start.width - 276) <= 7, JSON.stringify(start));
  const drag = async (fromX, fromY, points) => {
    await pet(`window.dayhub.beginDrag(${fromX},${fromY})`);
    for (const [x, y] of points) await pet(`window.dayhub.drag(${x},${y})`);
    await pet("window.dayhub.endDrag()");
  };
  await drag(start.x + 40, start.y + 30, [[start.x + 60, start.y + 50], [start.x + 120, start.y + 90], [start.x + 150, start.y + 120]]);
  await wait(600);
  const afterDrag = dock.getBounds();
  check('拖动改变窗口位置且尺寸完全保持', (afterDrag.x !== start.x || afterDrag.y !== start.y) && afterDrag.width===start.width&&afterDrag.height===start.height, JSON.stringify({ start, afterDrag }));
  check('拖动结束后没有遗留悬停提示', !windowOf('tip').isVisible());
  check('拖动结束后 DOM 不残留 is-dragging', await pet("!document.querySelector('.pet-dock').classList.contains('is-dragging')"));
  // 快速拖动：两次坐标内完成，不残留状态。
  await drag(afterDrag.x + 30, afterDrag.y + 20, [[afterDrag.x + 150, afterDrag.y + 100], [afterDrag.x + 230, afterDrag.y + 60]]);
  await wait(520);
  const rapid = dock.getBounds();
  check('快速拖动只移动窗口、不残留提示与形变', rapid.width===start.width&&rapid.height===start.height&&!windowOf('tip').isVisible() && await pet("!document.querySelector('.pet-dock').classList.contains('is-dragging')&&!document.querySelector('.dock-row.is-hovered')"), JSON.stringify(rapid));
  // 连续往返 20 次：每次都从新的 bounds 建锚，尺寸必须逐像素不变。
  for(let i=0;i<20;i++){
    const b=dock.getBounds(),sign=i%2===0?1:-1;
    await drag(b.x+Math.round(b.width/2),b.y+Math.round(b.height/2),[[b.x+Math.round(b.width/2)+sign*18,b.y+Math.round(b.height/2)+sign*8]]);
  }
  await wait(320);
  const repeated=dock.getBounds();
  check('连续拖动 20 次后 Δwidth=0 且 Δheight=0',repeated.width===start.width&&repeated.height===start.height,JSON.stringify({start,repeated}));
  // 未越过阈值的 potential click 与 double click 都不能触碰窗口 bounds。
  const beforeGestures=dock.getBounds();
  await pet(`window.dayhub.beginDrag(${beforeGestures.x+20},${beforeGestures.y+20})`);await pet('window.dayhub.endDrag()');
  await pet("document.querySelector('.pet-handle').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
  await wait(280);
  const afterGestures=dock.getBounds();
  check('click / double click 不改变 Dock 几何',afterGestures.width===beforeGestures.width&&afterGestures.height===beforeGestures.height&&afterGestures.x===beforeGestures.x&&afterGestures.y===beforeGestures.y,JSON.stringify({beforeGestures,afterGestures}));
  // drag → mouse leave：拖动中离开不产生提示。
  await pet(`window.dayhub.beginDrag(${rapid.x + 40},${rapid.y + 30})`);
  await pet("document.querySelector('.pet-handle').dispatchEvent(new PointerEvent('pointerleave',{bubbles:true}))");
  await wait(200);
  check('拖动中出现 pointerleave 也不显示提示', !windowOf('tip').isVisible());
  await pet("window.dayhub.endDrag()");
  await wait(380);
  check('拖动结束且鼠标已离开时保持无提示', !windowOf('tip').isVisible());
  // drag → click：拖动后不应误开详情面板。
  const beforeMini = windowOf('mini').isVisible();
  const beforeClick = dock.getBounds();
  await drag(beforeClick.x + 40, beforeClick.y + 30, [[beforeClick.x + 90, beforeClick.y + 50], [beforeClick.x + 120, beforeClick.y + 70]]);
  await wait(400);
  check('drag→click 不误触详情面板', windowOf('mini').isVisible() === beforeMini);

  /* ---------- D. 位置落盘（供 restart 步骤核对） ---------- */
  const saved = await run("window.dayhub.get().then(s=>s.settings.orb)");
  const finalBounds = dock.getBounds();
  check('拖动结束后位置写入本地设置', !!saved && Math.abs(saved.x - finalBounds.x) <= 4 && Math.abs(saved.y - finalBounds.y) <= 4, JSON.stringify({ saved, finalBounds }));
  fs.writeFileSync(path.join(output, 'dock-together.png'), (await dock.capturePage()).toPNG());
  fs.writeFileSync(path.join(output, 'together-saved.json'), JSON.stringify(saved));
}

async function runRestart(dataDir) {
  const expected = JSON.parse(fs.readFileSync(path.join(output, 'together-saved.json'), 'utf8'));
  const { dock } = await boot(dataDir);
  await wait(800);
  const bounds = dock.getBounds();
  // 恢复的位置可能被工作区回收（clamp），因此比较的是"同样的回收规则"下的结果。
  const { screen } = require('electron');
  const area = screen.getDisplayMatching(bounds).workArea;
  const wantX = Math.max(area.x, Math.min(expected.x, area.x + area.width - bounds.width));
  const wantY = Math.max(area.y, Math.min(expected.y, area.y + area.height - bounds.height));
  check('重启后恢复状态浮标位置', Math.abs(bounds.x - wantX) <= 6 && Math.abs(bounds.y - wantY) <= 6, JSON.stringify({ bounds, expected, want:{x:wantX,y:wantY}, area }));
  check('重启后仍是 Dual Status Dock（两行状态牌）', await dock.webContents.executeJavaScript("!!document.querySelector('.dock-surface')&&document.querySelectorAll('.dock-row').length===2"));
  fs.writeFileSync(path.join(output, 'dock-restarted.png'), (await dock.capturePage()).toPNG());
}

function summarize() {
  const failed = report.filter(item => !item.ok);
  fs.writeFileSync(path.join(output, `report-${process.argv[2] ?? 'all'}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode: process.argv[2] ?? 'all', passed: report.length - failed.length, failed, report }, null, 2));
  return failed.length;
}

function spawnStep(args) {
  // process.execPath 在 Electron 里就是 electron 可执行文件：直接带上脚本与参数再启动一个实例。
  const result = spawnSync(process.execPath, [__filename, ...args], { cwd: root, env: process.env, stdio: 'inherit' });
  return result.status ?? 1;
}

if (!process.argv[2]) {
  fs.mkdirSync(output, { recursive: true });
  const code = [
    spawnStep(['together']),
    spawnStep(['restart', path.join(output, 'together')]),
  ].reduce((worst, current) => current !== 0 ? current : worst, 0);
  process.exit(code);
} else {
  app.whenReady().then(async () => {
    try {
      if (process.argv[2] === 'together') await runTogether();
      else if (process.argv[2] === 'restart') await runRestart(process.argv[3]);
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      const failed = summarize();
      app.exit(failed ? 1 : 0);
    }
  });
}
