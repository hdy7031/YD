// 品牌字标 / 托盘图标渲染器。
//
// ## 边界说明（重要）
//
// **应用图标不在这里生成。** 程序图标（`brand/exports/yd.ico`、`icon-256.png`、
// `icon-512.png`、`png/yd-*.png`）由 `scripts/prepare-app-icon.py` 从定稿母版
// `brand/source/app-icon-master-v3.png` 导出。矢量化重绘会得到另一套（历史绿色）
// 图标，曾经覆盖过定稿资源；用途映射见 `docs/brand-assets.md`。
//
// 本脚本只负责"字标域"的资源：
//
//   brand/exports/tray-32.png          托盘 / 任务栏主用尺寸
//   brand/exports/png/tray-16/24.png   托盘小尺寸
//   brand/exports/png/tray-white-*.png 深色任务栏备用
//   brand/explore/directions.png       尺寸自检与方向留档
//
// 运行：npx electron scripts/brand-render.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// 统一 1:1 像素坐标：capturePage 的裁剪矩形就等于最终 PNG 的像素尺寸，
// 不会因为 125% / 150% 系统缩放把图标重采样成模糊结果。
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-http-cache');
// 目标机器上 GPU 进程可能在受限环境下起不来；图标只需要 CPU 光栅化。
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');

const root = path.join(__dirname, '..');
const outPng = path.join(root, 'brand', 'exports', 'png');
const outExplore = path.join(root, 'brand', 'explore');
const stage = path.join(root, '.build-cache', 'brand-render', 'page.html');

// 与 src/ui/brand.ts / prepare-visual-assets.py 一致的灰绿字标墨色。
// 视觉常量与路径定义在 scripts/brand-paths.mjs（品牌资源单一来源）。
let BP;
function monoHex() {
  const [r, g, b] = BP.MONO_INK;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
let MONO = '#365653';
const MONO_WHITE = '#F7FAFA';

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

// 固定 1024×1024 画布，只按需裁剪左上角目标尺寸的区域：
// Windows 不允许创建过小的窗口，而 16px 图标又必须在真实像素下渲染。
async function makeShot(win, html, width, height) {
  fs.mkdirSync(path.dirname(stage), { recursive: true });
  fs.writeFileSync(stage, html);
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await win.loadFile(stage, { query: { n: String(Date.now()) } });
      last = undefined;
      break;
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  if (last) throw last;
  await win.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,60))))');
  const image = await win.webContents.capturePage({ x: 0, y: 0, width, height }, { stayHidden: true, stayAwake: true });
  return image.toPNG();
}

function page(body, width, height, background = 'transparent') {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${width}px;height:${height}px;background:${background};overflow:hidden}
  svg{display:block;width:${width}px;height:${height}px}
  </style></head><body>${body}</body></html>`;
}

async function main() {
  await app.whenReady();
  const brand = await import('./brand-mark.mjs');
  BP = (await import('./brand-paths.mjs')).BRAND;
  MONO = monoHex();
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    // 离屏渲染：不需要真正弹出窗口，CPU 光栅化后直接截图。
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true },
  });
  await win.webContents.setZoomFactor(1);

  // 1) 可维护的矢量源文件（字标域）
  write(path.join(root, 'brand', 'exports', 'svg', 'yd-mark-mono.svg'), brand.markMonoSvg({}));
  write(path.join(root, 'brand', 'exports', 'svg', 'yd-mark-glyph.svg'), brand.markSvg({ tile: false, glyphColor: MONO }));
  write(path.join(root, 'brand', 'exports', 'svg', 'yd-mark-glyph-porcelain.svg'), brand.markSvg({ tile: false, glyphColor: MONO_WHITE }));

  // 2) 托盘字标：小尺寸用加粗字面，否则 16px 下笔画会糊
  const mono = {};
  for (const size of [16, 24, 32, 64, 128, 256, 512]) {
    const scale = size <= 24 ? 'small' : 'large';
    mono[size] = await makeShot(
      win,
      page(brand.markMonoSvg({ scale, color: MONO }), size, size),
      size,
      size
    );
    write(path.join(outPng, `yd-mono-${size}.png`), mono[size]);
    if (size <= 32) write(path.join(outPng, `tray-${size}.png`), mono[size]);
  }
  write(path.join(root, 'brand', 'exports', 'tray-32.png'), mono[32]);
  for (const size of [16, 24, 32]) {
    write(
      path.join(outPng, `tray-white-${size}.png`),
      await makeShot(win, page(brand.markMonoSvg({ scale: size <= 24 ? 'small' : 'large', color: MONO_WHITE }), size, size), size, size)
    );
  }
  write(path.join(outPng, 'yd-glyph-256.png'), await makeShot(win, page(brand.markSvg({ tile: false, glyphColor: MONO }), 256, 256), 256, 256));

  // 3) 尺寸自检图：托盘在浅底 / 深底上的真实观感
  const sheet = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#EFEDE7;font-family:"Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",sans-serif;color:#20261F}
  .wrap{display:grid;grid-template-columns:1fr 1fr;gap:22px;padding:26px}
  .card{background:#FBFAF7;border:1px solid #E1DED4;border-radius:14px;padding:18px}
  .t{font-size:12px;letter-spacing:.14em;color:#7C837A;margin-bottom:12px;text-transform:uppercase}
  .row{display:flex;align-items:flex-end;gap:22px;flex-wrap:wrap}
  .swatch{padding:10px;border-radius:10px}
  .sizes figure{margin:0;text-align:center;color:#8A9089;font-size:10px}
  .pixel{image-rendering:pixelated}
  </style></head><body><div class="wrap">
  <div class="card"><div class="t">托盘字标 · 浅色任务栏</div>
    <div class="row"><div class="swatch" style="background:#F5F3EE">
      ${[16, 24, 32].map((s) => `<figure><img class="pixel" src="${dataUri(mono[s])}" width="${s * 6}" height="${s * 6}"><figcaption>${s}px</figcaption></figure>`).join('')}
    </div></div></div>
  <div class="card"><div class="t">托盘字标 · 深色任务栏</div>
    <div class="row"><div class="swatch" style="background:#20272B">
      ${[16, 24, 32].map((s) => `<figure><img class="pixel" src="${dataUri(mono[s])}" width="${s * 6}" height="${s * 6}"><figcaption style="color:#9AA5A5">${s}px</figcaption></figure>`).join('')}
    </div></div></div>
  <div class="card" style="grid-column:1 / -1"><div class="t">落地形态 · 侧边栏 / 浅底 / 单色</div>
    <div class="row">
      <img src="${dataUri(mono[64])}" width="48" height="48">
      <img src="${dataUri(mono[128])}" width="128" height="128">
    </div></div>
  </div></body></html>`;
  await win.setContentSize(1000, 760);
  write(path.join(outExplore, 'directions.png'), await makeShot(win, sheet, 1000, 700));

  win.destroy();
  console.log('字标资源已生成：tray-32/tray-16/tray-24、tray-white-*、yd-mono-*、brand/explore/directions.png');
  console.log('应用图标请运行：python scripts/prepare-app-icon.py');
  app.quit();
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});

function dataUri(buffer) {
  return 'data:image/png;base64,' + buffer.toString('base64');
}
