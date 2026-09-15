// YD Phase 5B1 P0 · 桌面交互回归（三个真实 Bug 的 targeted verifier）。
//
// 运行：
//   npx electron verify-v051-desktop-interaction.cjs          # 主窗口 + 桌宠 + Dock，一次启动
//
// 覆盖：
//   A. 主窗口 viewport 不变量（Bug 1）—— renderer CSS 视口必须等于 BrowserWindow 客户区，
//      外壳（.shell）必须填满视口，任何一条几何路径之后都不允许出现"内容宽度停留在旧值"。
//   B. 桌宠命中区（Bug 3）—— 交互区域 = 人物真实渲染矩形 + 极小 padding，而不是整块
//      透明画布：人物中心可拖动、透明留白点击穿透、状态小框独立命中但不参与拖动。
//   C. Dock hover（Bug 2）—— 真实光标进入状态牌面才微展开，落在透明区不展开，
//      离开立即恢复；hover 只改牌面不改窗口。
//   D. 拖动结束后的清理 —— 没有残留 hover / dragging / 提示，穿透状态回到 through。
//
// 需要真实光标（点击穿透窗口的 mouse 转发走低层鼠标钩子），因此用 SetCursorPos +
// 1px mouse_event 制造真实移动，坐标按显示器 DPI 换算成物理像素。
const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { configureIsolatedUserData, seedWorkspace } = require('./scripts/electron-test-profile.cjs');

const root = __dirname;
const output = path.join(root, 'test-data', 'v051-desktop-interaction');
fs.mkdirSync(output, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-v051-interaction-'));
configureIsolatedUserData('v051-interaction', dataDir);
seedWorkspace(dataDir, 'together');
app.setAppPath(root);

const report = [];
const check = (name, ok, detail = '') => report.push({ name, ok: !!ok, detail });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 真实鼠标移动（物理像素 + per-monitor DPI aware），见 verify-v030-dock.cjs 的说明。 */
function moveCursor(x, y) {
  try {
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$dpi='[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);';` +
      `Add-Type -MemberDefinition $dpi -Name D -Namespace YD;[YD.D]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null;` +
      `Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point(${Math.round(x)},${Math.round(y)});` +
      `$sig='[DllImport("user32.dll")] public static extern void mouse_event(uint f,int dx,int dy,uint d,System.IntPtr e);';` +
      `Add-Type -MemberDefinition $sig -Name M -Namespace YD;[YD.M]::mouse_event(1,1,1,0,[System.IntPtr]::Zero);[YD.M]::mouse_event(1,-1,-1,0,[System.IntPtr]::Zero)`], { windowsHide: true });
  } catch {
    /* 定位失败时后续断言会明确失败，不静默通过 */
  }
}

/** 把系统光标放到窗口内的 DIP 坐标（相对窗口左上角）。 */
async function cursorTo(win, x, y) {
  const bounds = win.getBounds();
  const scale = screen.getDisplayMatching(bounds).scaleFactor || 1;
  moveCursor(Math.round((bounds.x + x) * scale), Math.round((bounds.y + y) * scale));
  await wait(220);
}
/** 系统光标离开所有 companion 窗口（放到屏幕左上角）。 */
async function cursorAway() {
  moveCursor(4, 4);
  await wait(220);
}
/**
 * 把光标放到窗口内某点，等到渲染层的命中状态与 dock view 满足期望为止
 * （主进程每 60ms 采样一次真实光标，测试不能假设"移动完立刻生效"）。
 */
async function expectAt(dock, x, y, expected, timeoutMs = 2500) {
  const scale = screen.getDisplayMatching(dock.getBounds()).scaleFactor || 1;
  const bounds = dock.getBounds();
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    moveCursor(Math.round((bounds.x + x) * scale), Math.round((bounds.y + y) * scale));
    await wait(160);
    last = await dock.webContents.executeJavaScript(MEASURE);
    const hitOk = !expected.hit || last.hit === expected.hit;
    const viewOk = !expected.view || last.view === expected.view;
    const expandedOk = expected.expanded === undefined || last.expanded === expected.expanded;
    if (hitOk && viewOk && expandedOk) return last;
  }
  return last;
}

const MEASURE = `(()=>{
  const rect=(el)=>{if(!el)return null;const r=el.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};};
  return {
    canvas:rect(document.querySelector('.pet-handle')),
    sprite:rect(document.querySelector('[data-hitbox="sprite"]')),
    rail:rect(document.querySelector('[data-hitbox="rail"]')),
    plate:rect(document.querySelector('[data-hitbox="hover"]')),
    hit:document.body.dataset.hit||'',
    view:document.querySelector('.pet-dock')?.dataset.dockView||'',
    dragging:document.querySelector('.pet-dock')?.classList.contains('is-dragging')===true,
    expanded:document.querySelector('.dock-surface')?.classList.contains('is-expanded')===true,
    meta: [...document.querySelectorAll('.person-meta')].map(e=>Number(getComputedStyle(e).opacity)>0.9&&e.textContent.trim().length>1),
  };
})()`;

const LAYOUT = `(()=>{
  const doc=document.documentElement;
  const shell=document.querySelector('.shell');
  const main=document.querySelector('.main');
  return {
    innerWidth:window.innerWidth, innerHeight:window.innerHeight,
    docClient:doc.clientWidth, docScrollW:doc.scrollWidth,
    shellW:shell?Math.round(shell.getBoundingClientRect().width):null,
    mainW:main?Math.round(main.getBoundingClientRect().width):null,
    overflowX:doc.scrollWidth-doc.clientWidth,
  };
})()`;

async function findWindows() {
  for (let i = 0; i < 140; i++) {
    const windows = BrowserWindow.getAllWindows();
    const panel = windows.find((w) => w.webContents.getURL().includes('index.html') && !w.webContents.getURL().includes('#'));
    const dock = windows.find((w) => w.webContents.getURL().endsWith('#orb'));
    if (panel && dock && !panel.webContents.isLoading() && !dock.webContents.isLoading()) return { panel, dock };
    await wait(100);
  }
  throw new Error('主窗口 / 状态 Dock 没有在 14 秒内加载出来');
}

require('./dist/main.cjs');

app.whenReady().then(async () => {
  try {
    const { panel, dock } = await findWindows();
    const run = (code) => panel.webContents.executeJavaScript(code);
    const pet = (code) => dock.webContents.executeJavaScript(code);
    const measure = () => pet(MEASURE);
    await wait(900);
    check('主窗口与桌宠窗口加载完成', !!panel && !!dock);

    /* ---------------- A. 主窗口 viewport 不变量（Bug 1） ---------------- */
    const layoutSamples = [];
    const assertLayout = async (label) => {
      await wait(340);
      const content = panel.getContentBounds();
      const m = await run(LAYOUT);
      layoutSamples.push({ label, windowWidth: content.width, ...m });
      check(`A 布局不变量（${label}）：CSS 视口 = 窗口客户区（±1px）`,
        Math.abs(m.innerWidth - content.width) <= 1, JSON.stringify({ window: content.width, viewport: m.innerWidth }));
      check(`A 布局不变量（${label}）：app shell 填满视口（不出现"内容只占左侧"）`,
        m.shellW !== null && Math.abs(m.shellW - m.innerWidth) <= 7, JSON.stringify({ shell: m.shellW, viewport: m.innerWidth }));
      check(`A 布局不变量（${label}）：没有横向溢出`, m.overflowX <= 0, JSON.stringify({ overflowX: m.overflowX }));
    };
    await assertLayout('startup');
    for (const width of [1366, 1050, 1600]) { panel.setSize(width, 820); await assertLayout(`setSize ${width}`); }
    panel.maximize(); await assertLayout('maximized');
    panel.unmaximize(); await assertLayout('restored');
    panel.hide(); await wait(260); panel.setSize(1700, 900); await wait(260); panel.show(); await assertLayout('hide→setSize→show');
    panel.hide(); await wait(260); panel.maximize(); await wait(260); panel.show(); await assertLayout('hide→maximize→show');
    panel.unmaximize(); await wait(260);
    // 页面缩放锁：缩放是唯一能让"窗口宽度"与"内容宽度"合法分离的用户路径。
    const zoomBefore = panel.webContents.getZoomFactor();
    panel.webContents.sendInputEvent({ type: 'keyDown', keyCode: '+', modifiers: ['control'] });
    panel.webContents.sendInputEvent({ type: 'keyUp', keyCode: '+', modifiers: ['control'] });
    await wait(320);
    check('A 缩放锁：Ctrl+加号 不会改变页面缩放',
      zoomBefore === 1 && panel.webContents.getZoomFactor() === 1, String(panel.webContents.getZoomFactor()));
    await assertLayout('after zoom attempt');

    /* ---------------- B. 桌宠命中区（Bug 3） ---------------- */
    await run("window.dayhub.change({type:'settings',pet:{mode:'custom',size:'medium'}})");
    await wait(1100);
    const petView = await measure();
    check('B 桌宠：画布明显大于人物本体（命中区必须收窄，不能等于整块透明窗口）',
      !!petView.sprite && !!petView.canvas && petView.sprite.w < petView.canvas.w - 8,
      JSON.stringify({ canvas: petView.canvas, sprite: petView.sprite }));
    check('B 桌宠：人物本体与窗口相交（命中区可换算为窗口坐标）',
      !!petView.sprite && petView.canvas
      && petView.sprite.x < petView.canvas.x + petView.canvas.w && petView.sprite.x + petView.sprite.w > petView.canvas.x
      && petView.sprite.y < petView.canvas.y + petView.canvas.h && petView.sprite.y + petView.sprite.h > petView.canvas.y,
      JSON.stringify({ sprite: petView.sprite, canvas: petView.canvas }));
    // 人物中心：必须接收鼠标（可拖动）。
    const onSprite = await expectAt(dock, petView.sprite.x + petView.sprite.w / 2, petView.sprite.y + petView.sprite.h / 2, { hit: 'interactive' });
    check('B 人物中心：窗口接收鼠标（可拖动）', onSprite.hit === 'interactive', JSON.stringify({ hit: onSprite.hit, sprite: onSprite.sprite }));
    // 透明留白（画布左上角）：必须点击穿透。
    const onMargin = await expectAt(dock, 6, 6, { hit: 'through' });
    check('B 透明留白：点击穿透，不拦截桌面',
      onMargin.hit === 'through', JSON.stringify({ hit: onMargin.hit, canvas: onMargin.canvas }));
    // 状态小框：独立命中区。
    if (petView.rail) {
      const onRail = await expectAt(dock, petView.rail.x + petView.rail.w / 2, petView.rail.y + petView.rail.h / 2, { hit: 'interactive' });
      check('B 状态小框：独立命中区（不扩大人物拖动范围）', onRail.hit === 'interactive', JSON.stringify({ hit: onRail.hit, rail: onRail.rail }));
    } else {
      check('B 状态小框：独立命中区（不扩大人物拖动范围）', false, '没有找到 [data-hitbox="rail"]');
    }
    // 命中区矩阵：逐个上报矩形中心 + 一个透明点，全部走真实光标。
    const reported = await pet(`(()=>Array.from(document.querySelectorAll('[data-hitbox]')).map(el=>{const r=el.getBoundingClientRect();return {kind:el.dataset.hitbox,x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};}))()`);
    const matrix = [];
    for (const rect of reported) {
      const state = await expectAt(dock, rect.x + rect.w / 2, rect.y + rect.h / 2, { hit: 'interactive' });
      matrix.push({ ...rect, hit: state.hit });
    }
    matrix.push({ kind: 'margin', x: 6, y: 6, w: 0, h: 0, hit: (await expectAt(dock, 6, 6, { hit: 'through' })).hit });
    check('B 命中区矩阵：每个上报矩形都接收鼠标，透明留白穿透',
      matrix.filter((entry) => entry.kind !== 'margin').every((entry) => entry.hit === 'interactive')
      && (matrix.find((entry) => entry.kind === 'margin') || {}).hit === 'through',
      JSON.stringify(matrix));

    /* ---------------- D. 拖动只从人物本体开始 ---------------- */
    const push = (type, clientX, clientY, screenX, screenY) => pet(
      `document.querySelector('.pet-handle').dispatchEvent(new PointerEvent('${type}',{bubbles:true,cancelable:true,pointerId:31,pointerType:'mouse',isPrimary:true,button:0,buttons:${type === 'pointerup' ? 0 : 1},clientX:${clientX},clientY:${clientY},screenX:${Math.round(screenX)},screenY:${Math.round(screenY)}}))`);
    // 透明留白按下（此时命中状态是 through）→ 不允许拖动。
    const beforeMarginDrag = dock.getBounds();
    await cursorTo(dock, 6, 6);
    await push('pointerdown', 6, 6, beforeMarginDrag.x + 6, beforeMarginDrag.y + 6);
    await push('pointermove', 40, 40, beforeMarginDrag.x + 40, beforeMarginDrag.y + 40);
    await push('pointerup', 40, 40, beforeMarginDrag.x + 40, beforeMarginDrag.y + 40);
    await wait(320);
    const afterMarginDrag = dock.getBounds();
    check('D 透明留白按下：不触发拖动（窗口不移动、不进入 dragging）',
      afterMarginDrag.x === beforeMarginDrag.x && afterMarginDrag.y === beforeMarginDrag.y && !(await measure()).dragging,
      JSON.stringify({ before: beforeMarginDrag, after: afterMarginDrag }));
    // 人物本体按下 → 正常拖动。
    const spriteCenter = { x: petView.sprite.x + petView.sprite.w / 2, y: petView.sprite.y + petView.sprite.h / 2 };
    await cursorTo(dock, spriteCenter.x, spriteCenter.y);
    const beforeDrag = dock.getBounds();
    const sx = beforeDrag.x + spriteCenter.x, sy = beforeDrag.y + spriteCenter.y;
    await push('pointerdown', spriteCenter.x, spriteCenter.y, sx, sy);
    await push('pointermove', spriteCenter.x + 36, spriteCenter.y + 24, sx + 36, sy + 24);
    await wait(160);
    const duringDrag = await measure();
    await push('pointerup', spriteCenter.x + 36, spriteCenter.y + 24, sx + 36, sy + 24);
    await wait(420);
    const afterDrag = dock.getBounds();
    check('D 人物本体按下：进入 dragging 并移动窗口',
      duringDrag.dragging && (afterDrag.x !== beforeDrag.x || afterDrag.y !== beforeDrag.y),
      JSON.stringify({ during: duringDrag.dragging, before: beforeDrag, after: afterDrag }));
    check('D 拖动不改变窗口尺寸（只移动）',
      afterDrag.width === beforeDrag.width && afterDrag.height === beforeDrag.height,
      JSON.stringify({ before: beforeDrag, after: afterDrag }));
    await cursorAway();
    const settled = await measure();
    check('D 拖动结束后清理：没有残留 hover / dragging / 穿透状态回到 through',
      settled.view === 'collapsed' && !settled.dragging && settled.hit === 'through',
      JSON.stringify({ view: settled.view, dragging: settled.dragging, hit: settled.hit }));
    fs.writeFileSync(path.join(output, 'pet-hit-regions.png'), (await dock.capturePage()).toPNG());

    /* ---------------- C. Dock hover（Bug 2） ---------------- */
    await run("window.dayhub.change({type:'settings',pet:{mode:'orb',size:'medium'}})");
    await wait(1200);
    const orbView = await measure();
    check('C Dock：状态牌面是命中区，画布其余部分是透明留白',
      !!orbView.plate && !!orbView.canvas && orbView.plate.w <= orbView.canvas.w,
      JSON.stringify({ canvas: orbView.canvas, plate: orbView.plate }));
    const plateCenter = { x: orbView.plate.x + orbView.plate.w / 2, y: orbView.plate.y + orbView.plate.h / 2 };
    const beforeHover = dock.getBounds();
    const hovered = await expectAt(dock, plateCenter.x, plateCenter.y, { hit: 'interactive', view: 'hover', expanded: true });
    check('C Dock hover：真实光标进入牌面后微展开并显露第二行',
      hovered.view === 'hover' && hovered.expanded && hovered.meta.length > 0 && hovered.meta.every(Boolean),
      JSON.stringify({ view: hovered.view, expanded: hovered.expanded, meta: hovered.meta }));
    const duringHover = dock.getBounds();
    check('C Dock hover：窗口 bounds 完全不变（只改牌面布局）',
      duringHover.x === beforeHover.x && duringHover.y === beforeHover.y
      && duringHover.width === beforeHover.width && duringHover.height === beforeHover.height,
      JSON.stringify({ beforeHover, duringHover }));
    // Dock 画布本身只有牌面 + 4–5px 阴影留白（比命中区容错还小），因此"指针离开命中区"
    // 用窗口外的真实位置验证：离开窗口就必须回到点击穿透并收起第二行。
    const outsideY = -12;
    const outside = await expectAt(dock, plateCenter.x, outsideY, { hit: 'through', expanded: false });
    check('C Dock：指针离开命中区后收起第二行并回到点击穿透',
      outside.hit === 'through' && outside.expanded === false && outside.view === 'collapsed',
      JSON.stringify({ hit: outside.hit, expanded: outside.expanded, view: outside.view }));
    await cursorAway();
    await wait(260);
    const away = await measure();
    check('C Dock：指针离开后回到 collapsed 且穿透状态恢复',
      away.view === 'collapsed' && !away.expanded && away.hit === 'through',
      JSON.stringify({ view: away.view, hit: away.hit, cursor: screen.getCursorScreenPoint(), bounds: dock.getBounds(), hoverBounds: duringHover }));
    fs.writeFileSync(path.join(output, 'dock-hover.png'), (await dock.capturePage()).toPNG());

    fs.writeFileSync(path.join(output, 'layout-samples.json'), JSON.stringify(layoutSamples, null, 2));
    const failed = report.filter((entry) => !entry.ok);
    const result = { dataDir, passed: report.length - failed.length, failed: failed.length, report, layoutSamples };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ passed: result.passed, failed, layoutSamples }, null, 2));
    app.exit(failed.length ? 1 : 0);
  } catch (error) {
    console.error(error);
    fs.writeFileSync(path.join(output, 'failure.txt'), String(error && error.stack || error));
    app.exit(1);
  }
});
