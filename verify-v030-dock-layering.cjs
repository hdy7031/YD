// v0.3 Dock 收口：**浮层层级 / 可见性 / 阴影**运行时验收。
//
// 这一轮要回答的不是"代码里写了 alwaysOnTop 吗"，而是三个只能用真实桌面证据回答的问题：
//
//   1. Dock 的原生窗口在整条生命周期里是否始终是 WS_EX_TOPMOST？
//      （Electron 的 isAlwaysOnTop() 只回读 JS 侧标志，掩盖真实样式位，因此这里用
//        PowerShell + Win32 EnumWindows 直接读 ex-style 与 z-order。）
//   2. 当另一个普通窗口（模拟浏览器）铺满屏幕并拿到焦点时，Dock 的像素是否仍然
//      出现在屏幕上？（desktopCapturer 抓真实屏幕，不依赖任何窗口自报状态。）
//   3. 白色网页上 Dock 四周的阴影有多深？（量化 ring 亮度，用证据而不是观感。）
//
// 运行：npx electron verify-v030-dock-layering.cjs
const { app, BrowserWindow, desktopCapturer, nativeImage, nativeTheme, screen, Tray } = require('electron');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configureIsolatedUserData, seedWorkspace } = require('./scripts/electron-test-profile.cjs');

const root = __dirname;
const output = path.join(root, 'test-data', 'v030-dock-layering');
const probeScript = path.join(root, '.build-cache', 'dock-layering-probe.ps1');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = [];
const check = (name, value, detail = '') => report.push({ name, ok: !!value, detail });

// GWL_EXSTYLE / 样式位
const WS_EX_TOPMOST = 0x8;
const WS_EX_TOOLWINDOW = 0x80;
const WS_EX_LAYERED = 0x80000;

const PROBE_SOURCE = `
$source = @'
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;
public class YDWindowProbe {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
  delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern IntPtr GetTopWindow(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static string[] List() {
    var rows = new List<string>();
    IntPtr h = GetTopWindow(IntPtr.Zero);
    int z = 0;
    while (h != IntPtr.Zero && z < 5000) {
      var title = new StringBuilder(300);
      var cls = new StringBuilder(300);
      GetWindowTextW(h, title, 300);
      GetClassNameW(h, cls, 300);
      int ex = GetWindowLong(h, -20);
      uint pid = 0;
      GetWindowThreadProcessId(h, out pid);
      rows.Add(z + "\\t" + h.ToInt64() + "\\t" + pid + "\\t" + title.ToString().Replace("\\t", " ") + "\\t" + cls.ToString() + "\\t" + ex + "\\t" + (IsWindowVisible(h) ? 1 : 0));
      h = GetWindow(h, 2);
      z++;
    }
    return rows.ToArray();
  }
}
'@
Add-Type -TypeDefinition $source -Language CSharp | Out-Null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[YDWindowProbe]::List() -join "\`n"
`;

function probeWindows() {
  fs.mkdirSync(path.dirname(probeScript), { recursive: true });
  fs.writeFileSync(probeScript, PROBE_SOURCE, 'utf8');
  const stdout = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', probeScript], { encoding: 'utf8', windowsHide: true });
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [z, hwnd, pid, title, cls, exStyle, visible] = line.split('\t');
      return { z: Number(z), hwnd: Number(hwnd), pid: Number(pid), title, cls, exStyle: Number(exStyle), visible: visible === '1' };
    });
}

/** Electron 的原生句柄 == Win32 HWND：用它精确定位窗口，不依赖标题编码。 */
function hwndOf(window) {
  const handle = window.getNativeWindowHandle();
  return handle.length >= 8 ? Number(handle.readBigInt64LE(0)) : handle.readInt32LE(0);
}

function findWindow(list, window) {
  const hwnd = hwndOf(window);
  return list.find((item) => item.hwnd === hwnd) ?? null;
}

function styleOf(entry) {
  return {
    topmost: !!(entry.exStyle & WS_EX_TOPMOST),
    toolWindow: !!(entry.exStyle & WS_EX_TOOLWINDOW),
    layered: !!(entry.exStyle & WS_EX_LAYERED),
    visible: entry.visible,
    z: entry.z,
  };
}

async function captureScreen() {
  const display = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) },
  });
  const source = sources.find((item) => String(item.display_id) === String(display.id)) ?? sources[0];
  return { display, image: source.thumbnail };
}

/** 窗口自身的合成 alpha：外圈不为 0 就说明 CSS 阴影被窗口边界裁断。 */
async function edgeAlpha(window) {
  const image = await window.capturePage();
  const size = image.getSize();
  const bitmap = image.getBitmap();
  const alphaAt = (x, y) => bitmap[(y * size.width + x) * 4 + 3];
  const rows = [];
  for (let y = 0; y < size.height; y++) {
    let sum = 0;
    for (let x = 0; x < size.width; x++) sum += alphaAt(x, y);
    rows.push(sum / size.width);
  }
  const cols = [];
  for (let x = 0; x < size.width; x++) {
    let sum = 0;
    for (let y = 0; y < size.height; y++) sum += alphaAt(x, y);
    cols.push(sum / size.height);
  }
  return { size, top: rows[0], bottom: rows[rows.length - 1], left: cols[0], right: cols[cols.length - 1] };
}

/**
 * 在整屏截图里采样窗口矩形：
 *   * median：窗口内缩 6px 的中位亮度（Dock surface 的底色）
 *   * min：窗口内侧最暗像素（状态文字 / 状态点）——被盖住时不会存在暗像素
 *   * ring：窗口外侧 3–12px 的亮度分布（只取屏幕上真实存在的上 / 左 / 右三边，
 *           避开任务栏与屏幕边缘，避免把系统 UI 当成 Dock 的阴影）
 */
async function sampleWindow(bounds, ring) {
  const { display, image } = await captureScreen();
  const size = image.getSize();
  const scale = size.width / display.size.width;
  const bitmap = image.getBitmap(); // BGRA
  const inside = (x, y) => x >= 2 && y >= 2 && x <= size.width - 3 && y <= size.height - 3;
  const pixel = (x, y) => {
    const px = Math.round(x);
    const py = Math.round(y);
    const index = (py * size.width + px) * 4;
    return [bitmap[index + 2], bitmap[index + 1], bitmap[index]];
  };
  const rect = {
    left: (bounds.x - display.bounds.x) * scale,
    top: (bounds.y - display.bounds.y) * scale,
    right: (bounds.x - display.bounds.x + bounds.width) * scale,
    bottom: (bounds.y - display.bounds.y + bounds.height) * scale,
  };
  const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  };
  const inset = 6;
  const inner = [];
  for (let y = rect.top + inset; y <= rect.bottom - inset; y += 2) {
    for (let x = rect.left + inset; x <= rect.right - inset; x += 2) {
      if (inside(x, y)) inner.push(luma(pixel(x, y)));
    }
  }
  const ringSamples = [];
  for (let offset = 3; offset <= ring; offset++) {
    for (let x = rect.left; x <= rect.right; x += 2) {
      if (inside(x, rect.top - offset)) ringSamples.push(luma(pixel(x, rect.top - offset)));
    }
    for (let y = rect.top; y <= rect.bottom; y += 2) {
      if (inside(rect.left - offset, y)) ringSamples.push(luma(pixel(rect.left - offset, y)));
      if (inside(rect.right + offset, y)) ringSamples.push(luma(pixel(rect.right + offset, y)));
    }
  }
  return {
    scale,
    inner: { median: median(inner), min: Math.min(...inner), max: Math.max(...inner) },
    ring: {
      median: median(ringSamples),
      mean: ringSamples.reduce((a, b) => a + b, 0) / ringSamples.length,
      min: Math.min(...ringSamples),
      p05: [...ringSamples].sort((a, b) => a - b)[Math.floor(ringSamples.length * 0.05)],
    },
    crop: image.crop({
      x: Math.max(0, Math.round(rect.left - 24 * scale)),
      y: Math.max(0, Math.round(rect.top - 24 * scale)),
      width: Math.round(rect.right - rect.left + 48 * scale),
      height: Math.round(rect.bottom - rect.top + 48 * scale),
    }),
  };
}

async function boot(dataDir) {
  // 记录每一次托盘换图标：用真实的 nativeImage 位图与 dist 里的托盘文件逐字节比对，
  // 断言"系统主题 → 字标版本"的映射，而不是只看源码。
  trayImages.length = 0;
  if (!trayPatched) {
    trayPatched = true;
    const original = Tray.prototype.setImage;
    Tray.prototype.setImage = function patchedSetImage(image) {
      trayImages.push(image);
      return original.call(this, image);
    };
  }
  configureIsolatedUserData('dock-layering', dataDir);
  // Phase 5A：双人语义由合成 fixture 显式种下，不再依赖生产 fresh default。
  if (!fs.existsSync(path.join(dataDir, 'dayhub.sqlite'))) seedWorkspace(dataDir, 'together');
  app.setAppPath(root);
  require('./dist/main.cjs');
  let panel, dock;
  for (let i = 0; i < 140; i++) {
    const windows = BrowserWindow.getAllWindows();
    panel = windows.find((w) => w.webContents.getURL().includes('index.html') && !w.webContents.getURL().includes('#'));
    dock = windows.find((w) => w.webContents.getURL().endsWith('#orb'));
    if (panel && dock && !panel.webContents.isLoading() && !dock.webContents.isLoading()) break;
    await wait(100);
  }
  return { panel, dock };
}

const trayImages = [];
let trayPatched = false;

function bitmapOf(file) {
  return Buffer.from(nativeImage.createFromPath(path.join(root, file)).toBitmap());
}

function trayMatches(file) {
  const expected = bitmapOf(file);
  return trayImages.some((image) => Buffer.from(image.toBitmap()).equals(expected));
}

const windowOf = (hash) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('#' + hash));

/**
 * 采样区域 = 窗口里**真正可见的那一块**（状态牌 / 详情卡），而不是整个透明画布。
 * Dock 画布按设计大部分是透明的，用整窗矩形采样会把桌面像素算成 Dock 的一部分。
 */
async function visibleBounds(win, selector) {
  const rect = await win.webContents.executeJavaScript(`(()=>{const el=document.querySelector('${selector}');if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
  if (!rect) return win.getBounds();
  const b = win.getBounds();
  return { x: b.x + rect.x, y: b.y + rect.y, width: rect.width, height: rect.height };
}

function coverPage(color, label) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(
    `<!doctype html><html><head><style>html,body{margin:0;height:100%;background:${color};color:#111;font:14px "Segoe UI"}</style></head><body><h1 style="padding:24px">${label}</h1></body></html>`
  )}`;
}

/** 用独立 user-data-dir 启动一个被验证用的 Edge：不碰用户正在用的浏览器会话。 */
function launchEdge() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const exe = candidates.find((item) => fs.existsSync(item));
  if (!exe) return null;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-edge-profile-'));
  const child = spawn(exe, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--start-maximized', 'about:blank'], { stdio: 'ignore', windowsHide: false });
  return { pid: child.pid, profile };
}

function maximizeAndFocus(hwnd) {
  execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `$s='using System;using System.Runtime.InteropServices;public class W{[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);}';` +
    `Add-Type -TypeDefinition $s;[W]::ShowWindow([IntPtr]${hwnd},3) | Out-Null;[W]::SetForegroundWindow([IntPtr]${hwnd}) | Out-Null`,
  ], { windowsHide: true });
}

function showDesktop() {
  execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    '(New-Object -ComObject Shell.Application).ToggleDesktop()',
  ], { windowsHide: true });
}

function closeEdge(edge) {
  if (!edge) return;
  try {
    execFileSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { windowsHide: true });
  } catch {
    /* 已经被用户或系统关闭 */
  }
  try {
    fs.rmSync(edge.profile, { recursive: true, force: true });
  } catch {
    /* 临时 profile 清理失败不影响验收结论 */
  }
}

async function run(dataDir) {
  const { panel, dock } = await boot(dataDir);
  const pet = (code) => dock.webContents.executeJavaScript(code);
  const runIn = (code) => panel.webContents.executeJavaScript(code);
  check('主窗口与状态浮标窗口加载完成', !!panel && !!dock);
  await runIn("window.dayhub.change({type:'settings',setup:true,pet:{mode:'orb',size:'medium'}})");
  await wait(900);

  const dockBounds = dock.getBounds();
  const dockStates = [];
  const record = async (label) => {
    const list = probeWindows();
    const entry = findWindow(list, dock);
    const state = entry ? styleOf(entry) : null;
    dockStates.push({ label, title: dock.getTitle(), state, electron: { visible: dock.isVisible(), destroyed: dock.isDestroyed(), alwaysOnTop: dock.isAlwaysOnTop(), bounds: dock.getBounds() } });
    return { list, entry, state };
  };

  /* ---------- A. 原生样式位：Dock 必须是 topmost + toolwindow + layered ---------- */
  const baseline = await record('启动后');
  check('Dock 原生窗口可被枚举到（Win32 视角）', !!baseline.entry, JSON.stringify(baseline.entry));
  check('启动后 WS_EX_TOPMOST 已设置', !!baseline.state?.topmost, JSON.stringify(baseline.state));
  check('Dock 是透明分层窗口（WS_EX_LAYERED）', !!baseline.state?.layered, JSON.stringify(baseline.state));
  // 窗口标题是运行期定位窗口的第一线索：Dock 与主窗口不能同名，
  // 否则线上排查"是不是它掉了层级"时无法区分两个窗口。
  check('Dock 窗口标题与主窗口可区分', dock.getTitle() !== panel.getTitle() && /Dock|桌宠/.test(dock.getTitle()), JSON.stringify({ dock: dock.getTitle(), panel: panel.getTitle() }));

  /* ---------- B. 普通窗口铺满屏幕并抢焦点：Dock 像素必须仍在屏幕上 ---------- */
  const cover = new BrowserWindow({ width: 1200, height: 800, frame: false, show: false, focusable: true, alwaysOnTop: false, backgroundColor: '#ffffff' });
  cover.setTitle('YD Layer Cover');
  await cover.loadURL(coverPage('#ffffff', 'cover · light'));
  const target = screen.getDisplayMatching(dockBounds);
  cover.setBounds({ x: target.workArea.x, y: target.workArea.y, width: target.workArea.width, height: target.workArea.height });
  cover.show();
  cover.focus();
  await wait(700);

  const overCover = await record('普通窗口铺满并聚焦后');
  check('普通窗口聚焦后 Dock 仍是 WS_EX_TOPMOST（未被降级）', !!overCover.state?.topmost, JSON.stringify(overCover.state));
  const lightSample = await sampleWindow(await visibleBounds(dock, '.dock-surface'), 14);
  // 被白色网页盖住时：窗口矩形内只会是纯白（min ≈ 255）；Dock 真的在渲染时，
  // 一定同时存在 mist 底面（中位亮度高）与深色状态文字（最暗像素低）。
  check('浅色网页上 Dock 像素仍然可见（不是被盖住 / 没有停止绘制）', lightSample.inner.median > 200 && lightSample.inner.min < 150, JSON.stringify({ inner: lightSample.inner, ring: lightSample.ring }));
  {
    const side = findWindow(probeWindows(), cover);
    check('Dock 在 z-order 上高于铺满的普通窗口', !!side && !!overCover.entry && overCover.entry.z < side.z, JSON.stringify({ dockZ: overCover.entry?.z, coverZ: side?.z }));
  }
  fs.writeFileSync(path.join(output, 'over-light-cover.png'), lightSample.crop.toPNG());

  /* ---------- C. 阴影量化：白底上的 ring 不能出现明显黑边 ---------- */
  check('白色网页上 Dock 外圈没有明显暗环（ring p05 ≥ 215）', lightSample.ring.p05 >= 215, JSON.stringify(lightSample.ring));
  check('白色网页上 Dock 外圈阴影上限（ring 中位亮度 ≥ 245）', lightSample.ring.median >= 245, JSON.stringify(lightSample.ring));
  // 原生窗口阴影 + 透明窗口 = Windows 会按窗口矩形画一圈黑边；Dock 四件套都必须关掉，
  // CSS 阴影则必须在窗口边界前收敛（边缘 alpha ≤ 6/255），否则就是"被切断的黑边"。
  {
    const miniForShadow = windowOf('mini');
    const sheetForShadow = windowOf('menu');
    const tipForShadow = windowOf('tip');
    const bubbleForShadow = windowOf('bubble');
    const shadows = { orb: dock.hasShadow(), mini: miniForShadow.hasShadow(), sheet: sheetForShadow.hasShadow(), tip: tipForShadow.hasShadow(), bubble: bubbleForShadow.hasShadow() };
    check('所有浮层窗口都关闭了原生窗口阴影（避免 native + CSS 双层阴影）', Object.values(shadows).every((value) => value === false), JSON.stringify(shadows));
    const dockAlpha = await edgeAlpha(dock);
    check('Dock 的 CSS 阴影在窗口边界前收敛（边缘 alpha ≤ 6/255）', dockAlpha.top <= 6 && dockAlpha.bottom <= 6 && dockAlpha.left <= 6 && dockAlpha.right <= 6, JSON.stringify(dockAlpha));
    fs.writeFileSync(path.join(output, 'dock-edge-alpha.json'), JSON.stringify(dockAlpha, null, 2));
  }

  /* ---------- D. 生命周期操作不得丢掉 topmost ---------- */
  await pet('window.dayhub.pointer(true)');
  await wait(160);
  await pet('window.dayhub.pointer(false)');
  await wait(160);
  const afterPointer = await record('点击穿透切换后');
  check('悬停点击穿透切换后 WS_EX_TOPMOST 保持', !!afterPointer.state?.topmost, JSON.stringify(afterPointer.state));

  await pet("document.querySelector('.pet-handle').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
  await wait(420);
  const mini = windowOf('mini');
  const withDetail = await record('详情打开后');
  const detailState = await pet("(()=>{const panel=document.querySelector('.mini-panel');return {view:document.querySelector('.pet-dock').dataset.dockView,panel:!!panel,icons:panel?panel.querySelectorAll('.detail-icon').length:0}})()");
  // 详情是**同一个** floating 窗口的第三种画布：没有第二个窗口去抢层级，
  // Dock 的 topmost 语义自动覆盖详情。
  check('详情打开后 Dock 仍是 WS_EX_TOPMOST', !!withDetail.state?.topmost, JSON.stringify(withDetail.state));
  check('详情渲染在 Dock 自己的窗口里（没有第二个 BrowserWindow）', detailState.view === 'detail' && detailState.panel === true && mini.isVisible() === false, JSON.stringify({ detailState, miniVisible: mini.isVisible() }));
  check('详情真正使用素材图 4 的原素材插图', detailState.icons >= 1, JSON.stringify(detailState));
  check('详情打开后 Dock 窗口仍然在屏幕上（没有被浏览器盖住）', dock.isVisible() && withDetail.state?.visible === true, JSON.stringify(withDetail.state));
  {
    const detailAlpha = await edgeAlpha(dock);
    check('详情画布的 CSS 阴影在窗口边界前收敛（边缘 alpha ≤ 6/255）', detailAlpha.top <= 6 && detailAlpha.bottom <= 6 && detailAlpha.left <= 6 && detailAlpha.right <= 6, JSON.stringify(detailAlpha));
    fs.writeFileSync(path.join(output, 'detail-edge-alpha.json'), JSON.stringify(detailAlpha, null, 2));
  }
  // 详情展开期间，普通窗口依旧铺满屏幕（但没有焦点）：详情像素必须还在。
  // 注意不能去 focus 那个普通窗口 —— 点击外部 = 收起详情，那是产品定义的行为，
  // 这里要验证的是"详情不会被盖住"，不是"详情不理会点击外部"。
  await wait(420);
  const detailUnderCover = await record('详情打开且普通窗口聚焦后');
  const detailSample = await sampleWindow(await visibleBounds(dock, '.mini-panel'), 14);
  check('详情打开时普通窗口聚焦，Dock 仍是 WS_EX_TOPMOST', !!detailUnderCover.state?.topmost, JSON.stringify(detailUnderCover.state));
  check('详情打开且被普通窗口覆盖时，详情像素仍然可见', detailSample.inner.median > 200 && detailSample.inner.min < 150, JSON.stringify({ inner: detailSample.inner, ring: detailSample.ring }));
  fs.writeFileSync(path.join(output, 'detail-over-cover.png'), detailSample.crop.toPNG());
  await pet("window.dayhub.window('detail-close')");
  await wait(420);
  const afterDetail = await record('详情关闭后');
  check('详情关闭后 Dock 仍是 WS_EX_TOPMOST', !!afterDetail.state?.topmost, JSON.stringify(afterDetail.state));
  check('详情关闭后 Dock 仍可见且回到状态牌画布', dock.isVisible() && (await pet("document.querySelector('.pet-dock').dataset.dockView")) !== 'detail');

  await pet("document.querySelector('.pet-handle').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))");
  await wait(420);
  const sheet = windowOf('menu');
  const withSheet = await record('右键菜单打开后');
  check('右键菜单（自绘 sheet）打开时 Dock 仍是 WS_EX_TOPMOST', !!withSheet.state?.topmost, JSON.stringify(withSheet.state));
  if (sheet.isVisible()) sheet.blur();
  await wait(380);
  const afterSheet = await record('右键菜单关闭后');
  check('右键菜单关闭后 Dock 仍是 WS_EX_TOPMOST', !!afterSheet.state?.topmost, JSON.stringify(afterSheet.state));

  const beforeDrag = dock.getBounds();
  await pet(`window.dayhub.beginDrag(${beforeDrag.x + 30},${beforeDrag.y + 24})`);
  await pet(`window.dayhub.drag(${beforeDrag.x + 90},${beforeDrag.y + 60})`);
  await pet('window.dayhub.endDrag()');
  await wait(420);
  const afterDrag = await record('拖动结束后');
  check('拖动结束后 Dock 仍是 WS_EX_TOPMOST', !!afterDrag.state?.topmost, JSON.stringify(afterDrag.state));

  await runIn("window.dayhub.menuAction('toggle')"); // 隐藏
  await wait(500);
  const hidden = await record('隐藏后');
  check('隐藏后 Dock 不再可见（工具窗口保留在窗口列表里）', !hidden.state?.visible || hidden.electron.visible === false, JSON.stringify(hidden.state));
  const beforeReshow = dock.getBounds();
  await runIn("window.dayhub.menuAction('toggle')"); // 重新显示
  await wait(600);
  const reshown = await record('重新显示后');
  check('重新显示后 WS_EX_TOPMOST 仍然保持', !!reshown.state?.topmost, JSON.stringify(reshown.state));
  check('重新显示后 Dock 可见且位置未漂移', dock.isVisible() && dock.getBounds().x === beforeReshow.x && dock.getBounds().y === beforeReshow.y && dock.getBounds().width === beforeReshow.width && dock.getBounds().height === beforeReshow.height, JSON.stringify({ beforeReshow, after: dock.getBounds() }));

  /* ---------- E. 深色网页上的可见性 ---------- */
  await cover.loadURL(coverPage('#111418', 'cover · dark'));
  cover.focus();
  await wait(600);
  const darkSample = await sampleWindow(await visibleBounds(dock, '.dock-surface'), 14);
  check('深色网页上 Dock 像素仍然可见', darkSample.inner.median > 200 && darkSample.inner.min < 150, JSON.stringify({ inner: darkSample.inner, ring: darkSample.ring }));
  fs.writeFileSync(path.join(output, 'over-dark-cover.png'), darkSample.crop.toPNG());
  check('深色网页上 Dock 外圈没有明显亮边 / 脏灰 halo（ring 中位亮度 ≤ 45）', darkSample.ring.median <= 45, JSON.stringify(darkSample.ring));

  /* ---------- G. 托盘：系统主题 → 字标版本（Asset 06 / 07） ---------- */
  {
    const original = nativeTheme.themeSource;
    nativeTheme.themeSource = 'dark';
    await wait(600);
    check('切到深色系统主题后托盘换成近白字标（Asset 07）', trayMatches('dist/tray-light-16.png'), JSON.stringify({ calls: trayImages.length }));
    nativeTheme.themeSource = 'light';
    await wait(600);
    check('切回浅色系统主题后托盘换回深灰青字标（Asset 06）', trayMatches('dist/tray-dark-16.png'), JSON.stringify({ calls: trayImages.length }));
    check('主题切换只换图标、没有重建 Tray（每次切换恰好一次 setImage）', trayImages.length === 2, String(trayImages.length));
    nativeTheme.themeSource = original;
    await wait(300);
  }

  /* ---------- F. 真实浏览器（Edge 最大化）覆盖：用户报告的原始场景 ---------- */
  const edge = launchEdge();
  let edgeWindow = null;
  if (edge) {
    for (let i = 0; i < 60; i++) {
      edgeWindow = probeWindows().find((item) => item.pid === edge.pid && item.cls === 'Chrome_WidgetWin_1' && item.visible && !item.title.includes('YD')) ?? null;
      if (edgeWindow) break;
      await wait(250);
    }
  }
  check('真实浏览器（Edge）窗口已启动并枚举到', !!edgeWindow, JSON.stringify({ pid: edge?.pid, edgeWindow }));
  if (edgeWindow) {
    maximizeAndFocus(edgeWindow.hwnd);
    await wait(1500);
    const overEdge = await record('Edge 最大化并聚焦后');
    check('Edge 最大化聚焦后 Dock 仍是 WS_EX_TOPMOST', !!overEdge.state?.topmost, JSON.stringify(overEdge.state));
    const edgeSample = await sampleWindow(await visibleBounds(dock, '.dock-surface'), 14);
    check('Edge 白页上 Dock 像素仍然可见（真实浏览器场景）', edgeSample.inner.median > 200 && edgeSample.inner.min < 150, JSON.stringify({ inner: edgeSample.inner, ring: edgeSample.ring }));
    check('Edge 白页上 Dock 外圈没有明显暗环（ring p05 ≥ 215）', edgeSample.ring.p05 >= 215, JSON.stringify(edgeSample.ring));
    {
      const list = probeWindows();
      const currentEdge = list.find((item) => item.hwnd === edgeWindow.hwnd);
      check('Dock 在 z-order 上高于 Edge 窗口', !!currentEdge && !!overEdge.entry && overEdge.entry.z < currentEdge.z, JSON.stringify({ dockZ: overEdge.entry?.z, edgeZ: currentEdge?.z }));
    }
    fs.writeFileSync(path.join(output, 'over-edge-white.png'), edgeSample.crop.toPNG());
    // 用户报告的原始场景：浏览器最大化时点开 Dock 详情，详情必须出现在 Edge 之上
    // （点击 Dock 会让 Dock 取得焦点、Edge 失去焦点，但 Edge 仍然铺满整个屏幕）。
    await pet("document.querySelector('.pet-handle').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
    await wait(620);
    const detailOverEdge = await record('Edge 最大化 + 详情打开后');
    const edgeDetailSample = await sampleWindow(await visibleBounds(dock, '.mini-panel'), 14);
    check('Edge 最大化时打开详情：Dock 仍是 WS_EX_TOPMOST', !!detailOverEdge.state?.topmost, JSON.stringify(detailOverEdge.state));
    check('Edge 最大化时打开详情：详情像素出现在 Edge 之上', edgeDetailSample.inner.median > 200 && edgeDetailSample.inner.min < 150, JSON.stringify({ inner: edgeDetailSample.inner, ring: edgeDetailSample.ring }));
    {
      const list = probeWindows();
      const currentEdge = list.find((item) => item.hwnd === edgeWindow.hwnd);
      check('Edge 最大化时打开详情：Dock 的 z-order 仍在 Edge 之上', !!currentEdge && !!detailOverEdge.entry && detailOverEdge.entry.z < currentEdge.z, JSON.stringify({ dockZ: detailOverEdge.entry?.z, edgeZ: currentEdge?.z }));
    }
    fs.writeFileSync(path.join(output, 'detail-over-edge.png'), edgeDetailSample.crop.toPNG());
    // 点击浏览器（= Dock 失去焦点）应当收起详情。跨进程 SetForegroundWindow 会被
    // Windows 前台锁拒绝，所以这里用同一个应用里的普通窗口取得焦点：效果完全一致
    // （Dock 收到 blur，走的就是"点击外部"那条产品路径）。
    cover.focus();
    await wait(900);
    const afterBlurView = await pet("document.querySelector('.pet-dock').dataset.dockView");
    const afterBlur = await record('详情自动收起后');
    check('普通窗口取得焦点后详情自动收起（点击外部 = collapsed）', afterBlurView !== 'detail' && afterBlur.state?.topmost === true, JSON.stringify({ afterBlurView, dockFocused: dock.isFocused(), state: afterBlur.state }));
    // 切到桌面（等价于用户"回到桌面"的动作）后再确认一次层级没有变化。
    showDesktop();
    await wait(1200);
    const afterDesktop = await record('显示桌面后');
    check('切到桌面后 Dock 仍是 WS_EX_TOPMOST 且可见', !!afterDesktop.state?.topmost && dock.isVisible(), JSON.stringify(afterDesktop.state));
  }
  closeEdge(edge);

  cover.destroy();
  fs.writeFileSync(path.join(output, 'layering-states.json'), JSON.stringify(dockStates, null, 2));
  fs.writeFileSync(path.join(output, 'dock-bounds.json'), JSON.stringify(dock.getBounds(), null, 2));
}

if (!app.requestSingleInstanceLock()) {
  app.exit(1);
} else {
  app.whenReady().then(async () => {
    fs.mkdirSync(output, { recursive: true });
    const dataDir = process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'yd-dock-layering-'));
    try {
      await run(dataDir);
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      const failed = report.filter((item) => !item.ok);
      fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ passed: report.length - failed.length, failed, report }, null, 2));
      app.exit(failed.length ? 1 : 0);
    }
  });
}
