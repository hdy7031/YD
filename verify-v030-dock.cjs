// v0.3 Dock 重建：YD Dual Status Dock 运行时验收。
//
// 覆盖（对应任务的验收清单）：
//   A. 状态语义      —— compact 只显示此刻状态；"今日课程已结束"只在第二行；状态点颜色正确
//   B. 尺寸契约      —— 窗口 = 展开态画布；默认牌面在画布内收拢，hover 只改牌面不改窗口
//   C. hover         —— 真正增加第二行信息（不是 scale），窗口 bounds 完全不变
//   D. 指针离开      —— 连续多次都回到 collapsed（不依赖 timer 的正确性）
//   E. resize 竞态   —— hover 中改变 Dock 尺寸：不卡在展开态，右 / 下锚点不跳
//   F. 详情          —— 与状态牌**同一个** floating 窗口（详情画布 468×290），
//                       打开 / 收起时牌面的屏幕位置完全不变，且不创建第二个窗口
//   G. drag          —— >4px 进入 dragging、清掉 hover / 提示、结束后不残留、不误触 detail
//   H. alwaysOnTop   —— 每个状态之后仍为 true，并用 Win32 检查 WS_EX_TOPMOST 与真实 z-order
//   I. 工作区约束    —— 窗口始终可见、bounds 合法、resize 后不会跑出 workArea
//
// Solo 工作区由 runtime-audit-solo.cjs 覆盖（它自带 Solo fixture）；
// 本脚本负责 Together 工作区，因为应用自身持有单实例锁、同一进程无法重启：
//   npx electron verify-v030-dock.cjs            # 依次 spawn together → restart
//   npx electron verify-v030-dock.cjs together
//   npx electron verify-v030-dock.cjs restart <dataDir>
const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { configureIsolatedUserData, seedWorkspace } = require('./scripts/electron-test-profile.cjs');

/**
 * 真实鼠标移动：SetCursorPos 只挪光标、不产生输入消息，而点击穿透窗口的
 * mouse 转发走的是低层鼠标钩子，因此这里额外注入一像素的相对 mouse_event。
 *
 * 坐标必须是**物理像素**：先把 PowerShell 设成 per-monitor DPI aware 再定位。
 * 否则 DPI-unaware 的进程会把坐标按 96-DPI 虚拟化，在 125% / 150% 的显示器上
 * 光标会被系统夹到屏幕角落 —— "真实光标 hover" 就成了假通过（hover 兜底守卫
 * 读到光标在窗口之外，第二行会在 150ms 内收回）。
 */
function moveCursor(x, y) {
  try {
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$dpi='[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);';` +
      `Add-Type -MemberDefinition $dpi -Name D -Namespace YD;[YD.D]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null;` +
      `Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point(${Math.round(x)},${Math.round(y)});` +
      `$sig='[DllImport("user32.dll")] public static extern void mouse_event(uint f,int dx,int dy,uint d,System.IntPtr e);';` +
      `Add-Type -MemberDefinition $sig -Name M -Namespace YD;[YD.M]::mouse_event(1,1,1,0,[System.IntPtr]::Zero);[YD.M]::mouse_event(1,-1,-1,0,[System.IntPtr]::Zero)`], { windowsHide: true });
  } catch {
    /* 鼠标定位失败时后续断言会明确失败，不静默通过 */
  }
}

/** Win32 真实窗口层级探针：WS_EX_TOPMOST 样式位 + 桌面 z-order 里的位置。 */
function windowLayerProbe(hwnds) {
  const script = `
$sig=@'
[DllImport("user32.dll",SetLastError=true)] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd,int nIndex);
[DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd,uint uCmd);
'@
Add-Type -MemberDefinition $sig -Name Z -Namespace YD
$targets=@(${hwnds.map(value => String(value)).join(',')})
$order=New-Object System.Collections.Generic.List[long]
$h=[YD.Z]::GetTopWindow([IntPtr]::Zero)
while($h -ne [IntPtr]::Zero -and $order.Count -lt 2000){$order.Add($h.ToInt64());$h=[YD.Z]::GetWindow($h,2)}
$result=@{}
foreach($t in $targets){
  $ex=[YD.Z]::GetWindowLongPtr([IntPtr]$t,-20).ToInt64()
  $result["$t"]=@{exstyle=$ex;topmost=(($ex -band 0x8) -ne 0);index=$order.IndexOf([long]$t)}
}
$result | ConvertTo-Json -Compress -Depth 4
`;
  try {
    const out = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8' });
    return JSON.parse(String(out.stdout).replace(/^\uFEFF/, '').trim());
  } catch {
    return null;
  }
}

const hwndOf = win => {
  const buffer = win.getNativeWindowHandle();
  return buffer.length >= 8 ? buffer.readBigUInt64LE(0).toString() : buffer.readUInt32LE(0);
};

const root = __dirname;
const output = path.join(root, 'test-data', 'v030-dock');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = [];
const check = (name, value, detail = '') => report.push({ name, ok: !!value, detail });
// 新几何契约（中档）：窗口 248×54（展开态足迹）；牌面 collapsed 176×36 / hover 240×46。
// 展开态比默认态宽是因为第二行辅助文案（"还有 1 小时 30 分"）必须完整显示。
// 牌面宽度由内容测量决定：这里只锁高度（牌面 56 + 8 阴影画布 = 64），宽度用关系断言。
const CANVAS = { height: 64, minWidth: 180 };
const PLATE = { height: 56, minWidth: 180 };
// 详情画布 = 卡片 460×236 + 10px 间距 + 牌面 36 + 两侧 4px 阴影画布（同一个窗口）。
// 详情画布 = 卡片 460×236 + 10 间距 + 牌面 56 + 两侧 4px 阴影画布。
const DETAIL = { width: 468, height: 310 };

async function boot(dataDir) {
  configureIsolatedUserData('dock', dataDir);
  // Phase 5A：Dock 的双人语义来自显式种下的合成 fixture；重启子进程复用同一份数据。
  if (!fs.existsSync(path.join(dataDir, 'dayhub.sqlite'))) seedWorkspace(dataDir, 'together');
  app.setAppPath(root);
  require('./dist/main.cjs');
  let panel, dock;
  // 渲染层错误必须出现在验收输出里：Dock 的交互问题以前正是"静默失败"。
  const attach = win => win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2 || /Error|error/.test(String(message))) console.log('[renderer]', String(message).slice(0, 400));
  });
  for (let i = 0; i < 140; i++) {
    const windows = BrowserWindow.getAllWindows();
    panel = windows.find(w => w.webContents.getURL().includes('index.html') && !w.webContents.getURL().includes('#'));
    dock = windows.find(w => w.webContents.getURL().endsWith('#orb'));
    if (panel && dock && !panel.webContents.isLoading() && !dock.webContents.isLoading()) break;
    await wait(100);
  }
  if (dock) attach(dock);
  return { panel, dock };
}

const windowOf = hash => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#' + hash));
const inside = (bounds, area) =>
  bounds.x >= area.x - 2 && bounds.y >= area.y - 2 &&
  bounds.x + bounds.width <= area.x + area.width + 2 && bounds.y + bounds.height <= area.y + area.height + 2;

/** 派发真实的 DOM 指针事件（走与运行时同一条 React 处理链，不是合成 IPC 消息）。 */

const pointerOver = target => `document.querySelector('${target}').dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'mouse',relatedTarget:document.documentElement}))`;
const pointerOut = target => `document.querySelector('${target}').dispatchEvent(new PointerEvent('pointerout',{bubbles:true,pointerType:'mouse',relatedTarget:document.documentElement}))`;

async function runTogether() {
  const dataDir = process.argv[3];
  if (!dataDir) throw new Error('Dock verifier requires an isolated userData directory');
  const { panel, dock } = await boot(dataDir);
  const run = code => panel.webContents.executeJavaScript(code);
  // 渲染层脚本失败时记录一条明确的失败项并继续，而不是让整个验收静默中断。
  /**
   * 真实光标进入状态牌：hover 兜底守卫会核对系统光标是否还在窗口内，
   * 因此定位之后必须**确认**光标真的落在窗口里（DPI / 多屏 / 虚拟化都可能让定位失败）。
   */
  const cursorInto = async () => {
    const b = dock.getBounds(), scale = screen.getDisplayMatching(b).scaleFactor || 1;
    for (let attempt = 0; attempt < 3; attempt++) {
      moveCursor(Math.round((b.x + b.width / 2) * scale), Math.round((b.y + b.height / 2) * scale));
      await wait(90);
      if (await pet('window.dayhub.cursorInside()')) return true;
    }
    check('真实光标能够进入 Dock 窗口（hover 兜底守卫依赖系统光标位置）', false, JSON.stringify({ bounds: b, scale, cursor: screen.getCursorScreenPoint() }));
    return false;
  };
  const pet = async code => {
    try {
      return await dock.webContents.executeJavaScript(code);
    } catch (error) {
      check(`Dock 渲染层脚本执行失败：${String(code).slice(0, 60)}…`, false, String(error && error.message ? error.message : error));
      return undefined;
    }
  };
  const dockView = () => pet("document.querySelector('.pet-dock')?.dataset.dockView ?? (document.querySelector('.pet-handle')?.dataset.dockView ?? '')");
  const topmost = () => dock.isAlwaysOnTop();
  check('主窗口与状态 Dock 窗口加载完成', !!panel && !!dock);

  const schedule = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'synthetic-schedule.json'), 'utf8'));
  await run(`window.dayhub.change({type:'importSchedule',value:${JSON.stringify(schedule)}})`);
  await run("window.dayhub.change({type:'settings',setup:true,pet:{mode:'orb',size:'medium'}})");
  await wait(900);

  /* ---------- A. 状态语义 ---------- */
  const structure = await pet(`(()=>{
    const rows=[...document.querySelectorAll('.person')];
    const surface=document.querySelector('.dock-surface');
    const rect=surface?.getBoundingClientRect();
    const style=surface?getComputedStyle(surface):null;
    const overflow=rows.map(row=>{const status=row.querySelector('.status-text');return status?status.scrollWidth-status.clientWidth:999;});
    return {
      rows:rows.map(r=>({person:r.dataset.person,alias:r.querySelector('.person-letter')?.textContent.trim(),status:r.querySelector('.status-text')?.textContent.trim(),extra:r.querySelector('.person-meta')?.textContent.trim(),kind:r.dataset.stateKind,dotColor:r.querySelector('.status-dot')?getComputedStyle(r.querySelector('.status-dot')).backgroundColor:null})),
      radius:style?.borderRadius,background:style?.backgroundColor,backdrop:style?.backdropFilter,
      rect:rect?{width:Math.round(rect.width),height:Math.round(rect.height)}:null,
      aliasFont:rows[0]?getComputedStyle(rows[0].querySelector('.person-letter')).fontFamily:null,
      overflow,
      legacy:!!document.querySelector('.presence-orb,.presence-surface,.identity-mark,.orb-shell,.split-orb')
    };
  })()`);
  check('两行状态：人物标签、状态点与此刻状态都来自档案 / CurrentState', structure.rows.length === 2 && structure.rows.every(r => r.alias && r.status && r.dotColor), JSON.stringify(structure.rows));
  // compact 只放此刻状态：日程阶段（今日结束 / 学期结束）只能出现在第二行。
  const contextWords = /今日|学期|未开课|无课|结束/;
  check('compact 状态是此刻状态，不再是"今日…"这类日程阶段长句', structure.rows.every(r => r.status && !contextWords.test(r.status)), structure.rows.map(r => r.status).join('|'));
  check('compact 内置状态完整显示（没有被 ellipsis 截断）', structure.overflow.every(value => value <= 1), JSON.stringify(structure.overflow));
  check('hover 第二行预置了有价值的上下文（默认不可见）', structure.rows.some(r => r.extra && r.extra.length > 1), JSON.stringify(structure.rows.map(r => r.extra)));
  // D / Y 是受控 serif 锚点（Georgia / Cambria / Times），不是装饰字体。
  check('D / Y 使用受控 serif 字体栈', /Georgia/.test(String(structure.aliasFont)) && !/cursive|fantasy|Script/i.test(String(structure.aliasFont)), String(structure.aliasFont));
  check('默认牌面高度 = 产品基准 56（54–60 口径）', structure.rect && Math.abs(structure.rect.height - PLATE.height) <= 1, JSON.stringify(structure.rect));
  check('默认牌面宽度由内容决定且不低于最小宽度', structure.rect && structure.rect.width >= PLATE.minWidth - 1, JSON.stringify(structure.rect));
  check('Dock 是固定状态牌（两端半圆、mist 白底、轻玻璃层）', parseFloat(structure.radius) >= 20 && /rgba?\(\s*250\s*,\s*252\s*,\s*251/.test(String(structure.background)) && /blur\(18px\)/.test(String(structure.backdrop)), JSON.stringify({ radius: structure.radius, background: structure.background }));
  check('legacy orb 结构已不在 DOM 中', structure.legacy === false);
  const dockSize = dock.getSize();
  // 窗口高度固定 = 牌面 56 + 8px 阴影画布；宽度随内容（至少要装下默认态牌面）。
  check('Dock 窗口高度 = 牌面 + 阴影画布（56+8=64），宽度随内容', Math.abs(dockSize[1] - CANVAS.height) <= 2 && dockSize[0] >= structure.rect.width + 8 - 1, JSON.stringify({ dockSize, plate: structure.rect }));
  check('默认态内容完整显示（没有被省略号截断）', structure.overflow.every(value => value <= 1), JSON.stringify(structure.overflow));
  /* ---------- H(1). alwaysOnTop：初始状态 ---------- */
  check('创建后 Dock 就是 alwaysOnTop', topmost() === true);

  /* ---------- C. hover：真正的信息展开 ---------- */
  const beforeHover = dock.getBounds();
  // 真实光标必须一起进入窗口：hover 的兜底守卫会用系统光标位置确认指针是否还在。
  await cursorInto();
  await pet(pointerOver('.pet-handle'));
  await wait(320);
  // 拆成几条极小的脚本：任何一条失败都能精确指认，而不是整块返回 undefined。
  const hoverView = await pet("document.querySelector('.pet-dock').dataset.dockView");
  const hoverExpanded = await pet("document.querySelector('.dock-surface').classList.contains('is-expanded')");
  const hoverPlate = await pet("(()=>{const r=document.querySelector('.dock-surface').getBoundingClientRect();return {width:Math.round(r.width),height:Math.round(r.height)}})()");
  const hoverRevealed = await pet("[...document.querySelectorAll('.person-meta')].filter(e=>Number(getComputedStyle(e).opacity)>0.9&&e.textContent.trim().length>1).length");
  // 用户报告过"hover 展开显示不完全"：第二行必须完整可见，不能被 ellipsis 截断。
  const hoverOverflow = await pet("[...document.querySelectorAll('.person-meta')].map(e=>Math.max(0,e.scrollWidth-e.clientWidth))");
  const hoverText = await pet("[...document.querySelectorAll('.person-meta')].map(e=>e.textContent.trim())");
  const hoverScale = await pet("getComputedStyle(document.querySelector('.dock-surface')).transform");
  const hover = { view: hoverView, expanded: hoverExpanded, width: hoverPlate && hoverPlate.width, height: hoverPlate && hoverPlate.height, revealed: hoverRevealed, scale: hoverScale };
  const afterHover = dock.getBounds();
  check('hover 进入 hover 状态并显露第二行（两块 person 区域同时展开）', hover.view === 'hover' && hover.expanded && hover.revealed === 2, JSON.stringify(hover));
  check('展开态牌面同样完整装进窗口（窗口按更宽的一态定尺寸）', afterHover.width >= hover.width + 8 - 3, JSON.stringify({ windowWidth: afterHover.width, hoverWidth: hover.width }));
  check('hover 是 layout 展开（宽度按内容变化），不是整体 scale，也不会缩回默认态', hover.expanded === true && hover.scale === 'none' && hover.width >= structure.rect.width - 1 && hover.height === structure.rect.height, JSON.stringify({ collapsedWidth: structure.rect.width, width: hover.width, height: hover.height, scale: hover.scale }));
  check('hover 第二行完整显示（没有被 ellipsis 截断）', Array.isArray(hoverOverflow) && hoverOverflow.every(value => value <= 1), JSON.stringify({ hoverText, hoverOverflow }));
  check('hover 不移动、不缩放窗口（anchor 完全稳定）', afterHover.x === beforeHover.x && afterHover.y === beforeHover.y && afterHover.width === beforeHover.width && afterHover.height === beforeHover.height, JSON.stringify({ beforeHover, afterHover }));
  fs.writeFileSync(path.join(output, 'dock-together-hover.png'), (await dock.capturePage()).toPNG());

  /* ---------- D. 指针离开必须 100% 回到 collapsed ---------- */
  let leaveFailures = 0;
  for (let i = 0; i < 6; i++) {
    await cursorInto();
    await pet(pointerOver('.pet-handle'));
    await wait(220);
    const entering = await dockView();
    moveCursor(6, 6);
    await pet(pointerOut('.pet-handle'));
    await wait(320);
    const leaving = await dockView();
    const collapsed = await pet("!document.querySelector('.dock-surface').classList.contains('is-expanded')");
    if (entering !== 'hover' || leaving !== 'collapsed' || !collapsed) leaveFailures++;
  }
  check('指针离开 6/6 次都回到 collapsed（不依赖 timer 的正确性）', leaveFailures === 0);

  /* ---------- C(2). 信息完整性：稍长状态也必须完整显示 ---------- */
  {
    const probe = async () => pet(`(()=>{const surfaces=[...document.querySelectorAll('.dock-surface')];
      const plate=surfaces[0];const rect=plate.getBoundingClientRect();
      const texts=[...plate.querySelectorAll('.status-text')];
      const metas=[...plate.querySelectorAll('.person-meta')];
      return {width:Math.round(rect.width),height:Math.round(rect.height),
        texts:texts.map(e=>e.textContent.trim()),
        overflow:texts.map(e=>Math.max(0,e.scrollWidth-e.clientWidth)),
        metaOverflow:metas.map(e=>Math.max(0,e.scrollWidth-e.clientWidth))}})()`);
    const before = await probe();
    // 自定义状态（用户自己写的词）是最长的一类文案，必须完整显示而不是省略。
    await run("window.dayhub.change({type:'manual',kind:'custom',label:'今天下午有课',endAt:null})");
    await wait(700);
    const long = await probe(), longBounds = dock.getBounds();
    check('稍长状态（今天下午有课）完整显示，没有被 ellipsis 截断', long.texts.some(value => value === '今天下午有课') && long.overflow.every(value => value <= 1), JSON.stringify(long));
    check('稍长状态让牌面与窗口一起变宽（内容自适应，不是固定宽度）', long.width > before.width + 10 && longBounds.width >= long.width + 8 - 3, JSON.stringify({ before, long, longBounds }));
    fs.writeFileSync(path.join(output, 'dock-together-long-status.png'), (await dock.capturePage()).toPNG());
    await run("window.dayhub.get().then(s=>Promise.all(s.manualOverrides.map(o=>window.dayhub.change({type:'manualCancel',id:o.id}))))");
    await wait(600);
    const restored = await probe();
    check('清除自定义状态后牌面回到原来的宽度', Math.abs(restored.width - before.width) <= 2, JSON.stringify({ before, restored }));
  }

  /* ---------- E. hover 中 resize：不卡住、锚点不跳 ---------- */
  {
    await cursorInto();
    await pet(pointerOver('.pet-handle'));
    await wait(260);
    const anchored = dock.getBounds();
    // 改变 Dock 尺寸（设置路径）——这正是线上"resize 后鼠标离开仍然放大"的嫌疑路径。
    await run("window.dayhub.change({type:'settings',pet:{mode:'orb',size:'large'}})");
    await wait(700);
    const resized = await pet(`(()=>{const surface=document.querySelector('.dock-surface');const rect=surface.getBoundingClientRect();return {width:Math.round(rect.width),view:document.querySelector('.pet-dock').dataset.dockView,expanded:surface.classList.contains('is-expanded')}})()`);
    const afterResize = dock.getBounds();
    const area = screen.getDisplayMatching(afterResize).workArea;
    check('hover 中确实发生了 resize（大档牌面更高，宽度仍按内容）', resized.width >= PLATE.minWidth && Math.abs(afterResize.height-66)<=1, JSON.stringify({ resized, afterResize }));
    await pet(pointerOut('.pet-handle'));
    await wait(340);
    const settled = await dockView();
    const settledSurface = await pet("!document.querySelector('.dock-surface').classList.contains('is-expanded')");
    check('resize 之后指针离开仍然回到 collapsed（不会永久保持展开）', settled === 'collapsed' && settledSurface, JSON.stringify({ settled, settledSurface }));
    // 靠右下角停靠：改尺寸时右边缘与底边保持，向左 / 上展开。
    const beforeRight = anchored.x + anchored.width, beforeBottom = anchored.y + anchored.height;
    const afterRight = afterResize.x + afterResize.width, afterBottom = afterResize.y + afterResize.height;
    check('Dock 尺寸变化保持右 / 下锚点（向左上展开，不是从两侧同时长）', Math.abs(afterRight - beforeRight) <= 2 && Math.abs(afterBottom - beforeBottom) <= 2, JSON.stringify({ anchored, afterResize }));
    check('resize 后窗口仍在工作区内', inside(afterResize, area), JSON.stringify({ afterResize, area }));
    check('resize 后仍为 alwaysOnTop', topmost() === true);
    // 恢复中档，后面的断言沿用产品基准。
    await run("window.dayhub.change({type:'settings',pet:{mode:'orb',size:'medium'}})");
    await wait(700);
  }

  /* ---------- F. 详情 = 同一个 floating 窗口的第 3 种画布 ---------- */
  const mini = windowOf('mini');
  // 牌面的**屏幕**矩形：窗口 bounds + 窗口内偏移。整个详情往返里它必须一模一样。
  const plateOnScreen = async () => {
    const b = dock.getBounds();
    const rect = await pet(`(()=>{const r=document.querySelector('.dock-surface').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}})()`);
    return rect ? { x: b.x + rect.x, y: b.y + rect.y, width: rect.width, height: rect.height } : null;
  };
  const beforeDetailBounds = dock.getBounds();
  const beforeDetailPlate = await plateOnScreen();
  await pet("document.querySelector('.pet-handle').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
  await wait(520);
  const detailBounds = dock.getBounds();
  const detailView = await dockView();
  const detailBody = await pet(`(()=>{const panel=document.querySelector('.mini-panel');if(!panel)return null;const pr=panel.getBoundingClientRect();
    const icon=panel.querySelector('.detail-icon');
    const plate=document.querySelector('.dock-surface').getBoundingClientRect();
    return {title:panel.querySelector('.mini-head h2')?.textContent.trim(),brand:panel.querySelector('.mini-brand b')?.textContent??null,
      people:panel.querySelectorAll('.detail-person').length,next:panel.querySelectorAll('.detail-next').length,
      icons:panel.querySelectorAll('.detail-icon').length,iconSrc:icon?icon.getAttribute('src'):null,
      foot:panel.querySelector('.detail-foot')?.textContent?.trim()??null,legacyTail:!!document.querySelector('.mini-tail'),
      rect:{x:Math.round(pr.x),y:Math.round(pr.y),width:Math.round(pr.width),height:Math.round(pr.height)},
      plate:{x:Math.round(plate.x),y:Math.round(plate.y),width:Math.round(plate.width),height:Math.round(plate.height)},
      overlap:!(pr.right<=plate.left||pr.left>=plate.right||pr.bottom<=plate.top||pr.top>=plate.bottom),
      overflow:panel.scrollHeight>panel.clientHeight+1}})()`);
  const afterDetailPlate = await plateOnScreen();
  const detailArea = screen.getDisplayMatching(detailBounds).workArea;
  check('单击 Dock 打开详情：是同一个窗口进入 detail 状态（没有第二个 BrowserWindow）', detailView === 'detail' && !mini.isVisible(), JSON.stringify({ detailView, miniVisible: mini.isVisible() }));
  check('详情画布 = 卡片 + 间距 + 状态牌（Together 中档 468×310）', Math.abs(detailBounds.width - DETAIL.width) <= 2 && Math.abs(detailBounds.height - DETAIL.height) <= 2, detailBounds.width + 'x' + detailBounds.height);
  check('打开详情不移动状态牌（牌面的屏幕矩形完全一致）', !!beforeDetailPlate && !!afterDetailPlate && Math.abs(afterDetailPlate.x - beforeDetailPlate.x) <= 2 && Math.abs(afterDetailPlate.y - beforeDetailPlate.y) <= 2, JSON.stringify({ beforeDetailPlate, afterDetailPlate }));
  check('详情卡片不与状态牌重叠，且完全落在工作区内', !!detailBody && detailBody.overlap === false && inside({ x: detailBounds.x + detailBody.rect.x, y: detailBounds.y + detailBody.rect.y, width: detailBody.rect.width, height: detailBody.rect.height }, detailArea), JSON.stringify({ rect: detailBody?.rect, detailBounds, detailArea }));
  check('详情头部是正常 UI 标题 + 极小 YD 签名（没有大 Logo / 大书法标题）', detailBody?.title === '我们 · 此刻' && detailBody?.brand === 'YD', JSON.stringify(detailBody));
  check('详情真正接入素材图 4 的原素材插图（每人一枚，路径指向 dock-icons）', detailBody?.icons >= 2 && /assets\/dock-icons\/[a-z]+\.png$/.test(String(detailBody?.iconSrc)), JSON.stringify({ icons: detailBody?.icons, iconSrc: detailBody?.iconSrc }));
  check('详情是两张 person context card，各有自己的「下一项」', detailBody?.people === 2 && detailBody?.next === 2, JSON.stringify(detailBody));
  check('详情不再有鸡汤页脚（只有真正共享的上下文或干脆不显示）', detailBody?.foot === null || /进行中的安排/.test(String(detailBody?.foot)), JSON.stringify({ foot: detailBody?.foot }));
  check('详情不再使用笨重的底部大三角 pointer', detailBody?.legacyTail === false, JSON.stringify({ legacyTail: detailBody?.legacyTail }));
  check('详情内容不被裁切（卡片无溢出）', detailBody?.overflow === false, JSON.stringify(detailBody));
  check('详情仍然在同一个 alwaysOnTop 窗口上', dock.isAlwaysOnTop() === true);
  fs.writeFileSync(path.join(output, 'dock-together-detail.png'), (await dock.capturePage()).toPNG());
  // 关闭：再点 Dock 自己（不是隐藏第二个窗口）。
  await pet("document.querySelector('.pet-handle').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
  await wait(520);
  const afterClose = await dockView();
  const afterCloseBounds = dock.getBounds();
  const afterClosePlate = await plateOnScreen();
  // 指针如果还在状态牌上就是 hover（第二行可见），但绝不能停留在 detail。
  check('再点 Dock 收起详情并回到状态牌画布', afterClose !== 'detail' && Math.abs(afterCloseBounds.width - beforeDetailBounds.width) <= 1 && Math.abs(afterCloseBounds.height - beforeDetailBounds.height) <= 1, JSON.stringify({ afterClose, afterCloseBounds, beforeDetailBounds }));
  // 详情是用"点击牌面"打开的，因此收起时指针仍然落在牌面上 —— 牌面处于 hover 展开档
  // （Phase 5B1 P0 起 hover 由主进程按真实光标位置驱动，不再依赖点击穿透窗口收不到的
  // DOM pointerenter）。因此这里锁定的是**右下锚点**：hover 只向左 / 上生长，牌面的
  // 屏幕落点不变。
  const plateRight = (p) => p.x + p.width, plateBottom = (p) => p.y + p.height;
  check('收起详情后牌面保持右下锚点（hover 展开只向左 / 上生长）',
    !!afterClosePlate && Math.abs(plateRight(afterClosePlate) - plateRight(beforeDetailPlate)) <= 3
    && Math.abs(plateBottom(afterClosePlate) - plateBottom(beforeDetailPlate)) <= 3,
    JSON.stringify({ beforeDetailPlate, afterClosePlate }));

  /* ---------- H(2). Win32 层级检查（真实 z-order，不是 Electron 缓存标志） ---------- */
  {
    // 放一个普通（非置顶）窗口正好盖在 Dock 上：真实层级必须仍然是 Dock 在上面。
    const cover = new BrowserWindow({ width: dock.getBounds().width + 120, height: dock.getBounds().height + 90, x: dock.getBounds().x - 60, y: dock.getBounds().y - 40, frame: false, show: false });
    cover.showInactive();
    await wait(400);
    const probe = windowLayerProbe([hwndOf(dock), hwndOf(cover)]);
    const dockLayer = probe ? probe[hwndOf(dock)] : null, coverLayer = probe ? probe[hwndOf(cover)] : null;
    check('Win32：Dock 带 WS_EX_TOPMOST 样式位', !!dockLayer && dockLayer.topmost === true, JSON.stringify(dockLayer));
    check('Win32：普通窗口盖不住 Dock（z-order 里 Dock 在上）', !!dockLayer && !!coverLayer && dockLayer.index >= 0 && coverLayer.index >= 0 && dockLayer.index < coverLayer.index, JSON.stringify({ dockLayer, coverLayer }));
    cover.destroy();
    await wait(300);
  }

  /* ---------- G. drag 与 hover 彻底隔离 ---------- */
  const start = dock.getBounds();
  const startPlate = await pet("(()=>{const r=document.querySelector('.dock-surface').getBoundingClientRect();return {width:Math.round(r.width),height:Math.round(r.height)}})()");
  check('Dock 窗口尺寸稳定（高度 = 牌面 + 阴影画布，宽度装得下牌面）', Math.abs(start.height - CANVAS.height) <= 1 && start.width >= startPlate.width + 8 - 3, JSON.stringify({ start, startPlate }));
  /**
   * 真实拖动：先把系统光标放到状态牌中心，再用 pointer 事件走渲染层同一套手势状态机
   * （pointerdown → pointermove 越过 4px → pointerup）。系统光标与指针增量保持一致，
   * 因此走的是"按指针计算"的生产路径，而不是直接调用 IPC 跳过状态机。
   */
  const dragBy = async (dx, dy, steps = 2) => {
    const b = dock.getBounds();
    const sx = b.x + Math.round(b.width / 2), sy = b.y + Math.round(b.height / 2);
    moveCursor(sx, sy);
    await pet(`(()=>{const el=document.querySelector('.pet-handle');const base={bubbles:true,pointerId:7,pointerType:'mouse',isPrimary:true,button:0,buttons:1};
      el.dispatchEvent(new PointerEvent('pointerover',{...base,relatedTarget:document.documentElement}));
      el.dispatchEvent(new PointerEvent('pointerdown',{...base,screenX:${sx},screenY:${sy}}));return true})()`);
    let viewDuring = '';
    for (let i = 1; i <= steps; i++) {
      const px = sx + Math.round(dx * i / steps), py = sy + Math.round(dy * i / steps);
      moveCursor(px, py);
      await pet(`document.querySelector('.pet-handle').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:7,pointerType:'mouse',isPrimary:true,button:0,buttons:1,screenX:${px},screenY:${py}}))`);
      if (i === 1) viewDuring = await dockView();
    }
    await pet(`document.querySelector('.pet-handle').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:7,pointerType:'mouse',isPrimary:true,button:0,buttons:0,screenX:${sx + dx},screenY:${sy + dy}}))`);
    return viewDuring;
  };
  // 在 hover 展开状态下开始拖动：必须立刻收起第二行，且不留下任何 hover / 提示残留。
  await pet(pointerOver('.pet-handle'));
  await wait(240);
  const draggingView = await dragBy(40, 26);
  const gridAfterDrag = await pet("document.querySelector('.dock-surface').classList.contains('is-expanded')");
  await wait(600);
  moveCursor(20, 20);
  await pet(pointerOut('.pet-handle'));
  await wait(200);
  const afterDrag = dock.getBounds();
  check('drag：越过 4px 后进入 dragging 并立刻收起 hover 第二行', draggingView === 'dragging', JSON.stringify({ draggingView, gridAfterDrag }));
  check('拖动改变窗口位置且尺寸完全保持', (afterDrag.x !== start.x || afterDrag.y !== start.y) && Math.abs(afterDrag.width - start.width) <= 1 && Math.abs(afterDrag.height - start.height) <= 1, JSON.stringify({ start, afterDrag }));
  check('拖动结束后没有遗留悬停提示 / 展开态 / dragging 类', !windowOf('tip').isVisible()
    && await pet("!document.querySelector('.pet-dock').classList.contains('is-dragging')&&!document.querySelector('.dock-surface').classList.contains('is-expanded')&&!document.querySelector('.person.is-hovered')&&!document.body.textContent.includes('undefined')")
    && await dockView() === 'collapsed');
  check('拖动结束后仍为 alwaysOnTop', topmost() === true);
  check('拖动结束后窗口仍在工作区内', inside(afterDrag, screen.getDisplayMatching(afterDrag).workArea), JSON.stringify(afterDrag));
  // 快速拖动：两次坐标内完成，不残留状态。
  await dragBy(-70, 34);
  moveCursor(20, 20);
  await pet(pointerOut('.pet-handle'));
  await wait(520);
  const rapid = dock.getBounds();
  check('快速拖动只移动窗口、不残留提示与形变', Math.abs(rapid.width - start.width) <= 1 && Math.abs(rapid.height - start.height) <= 1 && !windowOf('tip').isVisible() && await pet("!document.querySelector('.pet-dock').classList.contains('is-dragging')"), JSON.stringify(rapid));
  // 连续往返 20 次：每次都从新的 bounds 建锚。Windows 会把透明窗口重新对齐到物理
  // 像素（±1px），因此这里锁住的是"不会累积长大"，而不是逐像素相等。
  const widths = [];
  const heights = [];
  for (let i = 0; i < 20; i++) {
    const sign = i % 2 === 0 ? 1 : -1;
    await dragBy(sign * 18, sign * 8, 1);
    const current = dock.getBounds();
    widths.push(current.width);
    heights.push(current.height);
  }
  moveCursor(20, 20);
  await pet(pointerOut('.pet-handle'));
  await wait(320);
  const repeated = dock.getBounds();
  // 高度同样只允许 ±1px 的物理像素取整（Dock 高度是常量，绝不允许累积增长）。
  check('连续拖动 20 次后尺寸不累积增长（高度恒定 ±1px，宽度仅 ±1px 物理像素取整）', repeated.height <= start.height + 1 && Math.max(...heights) - Math.min(...heights) <= 1 && Math.max(...widths) - Math.min(...widths) <= 1 && Math.abs(repeated.width - start.width) <= 1, JSON.stringify({ start, repeated, widths: [...new Set(widths)], heights: [...new Set(heights)] }));
  // 未越过阈值的 potential click 与 double click 都不能触碰窗口 bounds。
  const beforeGestures = dock.getBounds();
  await pet(`(()=>{const el=document.querySelector('.pet-handle');const base={bubbles:true,pointerId:9,pointerType:'mouse',isPrimary:true,button:0,buttons:1};
    el.dispatchEvent(new PointerEvent('pointerdown',{...base,screenX:${beforeGestures.x + 20},screenY:${beforeGestures.y + 20}}));
    el.dispatchEvent(new PointerEvent('pointerup',{...base,buttons:0,screenX:${beforeGestures.x + 20},screenY:${beforeGestures.y + 20}}));return true})()`);
  await pet("document.querySelector('.pet-handle').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
  await wait(280);
  const afterGestures = dock.getBounds();
  check('click / double click 不改变 Dock 几何', Math.abs(afterGestures.width - beforeGestures.width) <= 1 && Math.abs(afterGestures.height - beforeGestures.height) <= 1 && afterGestures.x === beforeGestures.x && afterGestures.y === beforeGestures.y, JSON.stringify({ beforeGestures, afterGestures }));
  // drag → mouse leave：拖动中离开不产生提示。
  await pet(pointerOver('.pet-handle'));
  await wait(240);
  await pet(`(()=>{const el=document.querySelector('.pet-handle');const base={bubbles:true,pointerId:11,pointerType:'mouse',isPrimary:true,button:0,buttons:1};el.dispatchEvent(new PointerEvent('pointerdown',{...base,screenX:${rapid.x + 40},screenY:${rapid.y + 30}}));return true})()`);
  await pet(pointerOut('.pet-handle'));
  await wait(200);
  check('拖动中出现 pointerleave 也不显示提示', !windowOf('tip').isVisible());
  await pet(`(()=>{const el=document.querySelector('.pet-handle');el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:11,pointerType:'mouse',isPrimary:true,button:0,buttons:0,screenX:${rapid.x + 40},screenY:${rapid.y + 30}}));return true})()`);
  await wait(380);
  check('拖动结束且鼠标已离开时保持无提示', !windowOf('tip').isVisible());
  // drag → click：拖动后不应误开详情面板。
  const beforeMini = windowOf('mini').isVisible();
  await dragBy(38, 22);
  moveCursor(20, 20);
  await pet(pointerOut('.pet-handle'));
  await wait(520);
  check('drag→click 不误触详情浮层（>4px 的位移不产生 detail）', windowOf('mini').isVisible() === beforeMini, JSON.stringify({ beforeMini, after: windowOf('mini').isVisible() }));
  check('drag 后 Dock 仍是 collapsed 状态', await dockView() === 'collapsed');

  /* ---------- I. 位置落盘（供 restart 步骤核对） ---------- */
  const saved = await run("window.dayhub.get().then(s=>s.settings.orb)");
  const finalBounds = dock.getBounds();
  check('拖动结束后位置写入本地设置', !!saved && Math.abs(saved.x - finalBounds.x) <= 4 && Math.abs(saved.y - finalBounds.y) <= 4, JSON.stringify({ saved, finalBounds }));
  // 运行几秒后再从磁盘读一次：位置必须还在（不能被周期性任务覆盖掉）。
  await wait(3000);
  const savedLater = await run("window.dayhub.get().then(s=>s.settings.orb)");
  check('位置在后续运行中仍然持久（不被周期性更新覆盖）', !!savedLater && Math.abs(savedLater.x - saved.x) <= 4 && Math.abs(savedLater.y - saved.y) <= 4, JSON.stringify({ saved, savedLater }));
  check('最终状态：窗口可见、bounds 合法、始终置顶', dock.isVisible() && inside(finalBounds, screen.getDisplayMatching(finalBounds).workArea) && dock.isAlwaysOnTop() === true, JSON.stringify(finalBounds));
  fs.writeFileSync(path.join(output, 'dock-together.png'), (await dock.capturePage()).toPNG());
  fs.writeFileSync(path.join(output, 'together-saved.json'), JSON.stringify(saved));
}

async function runRestart(dataDir) {
  const expected = JSON.parse(fs.readFileSync(path.join(output, 'together-saved.json'), 'utf8'));
  const { panel, dock } = await boot(dataDir);
  await wait(900);
  const bounds = dock.getBounds();
  // 诊断：把启动时的模式 / 尺寸 / 落盘位置一起记录到报告里（供定位位置漂移）。
  check('诊断：启动状态', true, JSON.stringify({
    settings: await panel.webContents.executeJavaScript("window.dayhub.get().then(s=>({pet:s.settings.pet,orb:s.settings.orb}))"),
    bounds, expected, size: dock.getSize(),
  }));
  // 恢复的位置可能被工作区回收（clamp），因此比较的是"同样的回收规则"下的结果。
  // Dock 宽度随内容变化：新数据带窗口尺寸，锚点是牌面右下角（expected.x + w）。
  const area = screen.getDisplayMatching(bounds).workArea;
  const anchorX = Number.isFinite(expected.w) ? expected.x + expected.w : expected.x + bounds.width;
  const anchorY = Number.isFinite(expected.h) ? expected.y + expected.h : expected.y + bounds.height;
  const wantX = Math.max(area.x, Math.min(anchorX - bounds.width, area.x + area.width - bounds.width));
  const wantY = Math.max(area.y, Math.min(anchorY - bounds.height, area.y + area.height - bounds.height));
  check('重启后恢复状态 Dock 位置', Math.abs(bounds.x - wantX) <= 6 && Math.abs(bounds.y - wantY) <= 6, JSON.stringify({ bounds, expected, want: { x: wantX, y: wantY }, area }));
  check('重启后仍是 Dual Status Dock（两行状态牌）', await dock.webContents.executeJavaScript("!!document.querySelector('.dock-surface')&&document.querySelectorAll('.person').length===2"));
  check('重启后 Dock 仍然置顶', dock.isAlwaysOnTop() === true);
  fs.writeFileSync(path.join(output, 'dock-restarted.png'), (await dock.capturePage()).toPNG());
}

function summarize() {
  const failed = report.filter(item => !item.ok);
  fs.mkdirSync(output, { recursive: true });
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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-dock-'));
  const code = [
    spawnStep(['together', dataDir]),
    spawnStep(['restart', dataDir]),
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
