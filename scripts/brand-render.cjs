// 用 Electron 自带渲染引擎把品牌标记栅格化成多尺寸 PNG / ICO。
// 每个尺寸都在真实像素尺寸下渲染（不是先出大图再缩），小尺寸才不会被重采样糊掉。
// 运行：npx electron scripts/brand-render.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// 统一 1:1 像素坐标：capturePage 的裁剪矩形就等于最终 PNG 的像素尺寸，
// 不会因为 125% / 150% 系统缩放把图标重采样成模糊结果。
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-http-cache');
// 目标机器上 GPU 进程可能在受限环境下起不来；图标只需要 CPU 光栅化，
// 关掉硬件加速可以稳定拿到带 alpha 的截图结果。
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');

const root = path.join(__dirname, '..');
const outSvg = path.join(root, 'brand', 'exports', 'svg');
const outPng = path.join(root, 'brand', 'exports', 'png');
const outExplore = path.join(root, 'brand', 'explore');
const stage = path.join(root, '.build-cache', 'brand-render', 'page.html');

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

(async () => {
  await app.whenReady();
  const brand = await import('./brand-mark.mjs');
  const { packIco } = await import('./make-ico.mjs');
  const { BRAND } = brand;
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    // 离屏渲染：不需要真正弹出窗口，CPU 光栅化后直接截图，适合无人值守生成资源。
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true },
  });
  await win.webContents.setZoomFactor(1);

  // 1) 可维护的矢量源文件
  write(path.join(outSvg, 'yd-mark.svg'), brand.markSvg({}));
  write(path.join(outSvg, 'yd-mark-small.svg'), brand.markSvg({ scale: 'small' }));
  write(path.join(outSvg, 'yd-mark-porcelain.svg'), brand.markSvg({ tileColor: BRAND.color.porcelain, glyphColor: BRAND.color.brandDeep, hairline: false }));
  write(path.join(outSvg, 'yd-mark-mono.svg'), brand.markMonoSvg({}));
  write(path.join(outSvg, 'yd-mark-glyph.svg'), brand.markSvg({ tile: false, glyphColor: BRAND.color.brand }));
  write(path.join(outSvg, 'yd-mark-glyph-porcelain.svg'), brand.markSvg({ tile: false, glyphColor: BRAND.color.porcelain }));

  // 2) 多尺寸 PNG：≤24 用加粗小尺寸字面，其余用标准字面
  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512];
  const png = {};
  for (const size of sizes) {
    const scale = size <= 24 ? 'small' : 'large';
    png[size] = await makeShot(win, page(brand.markSvg({ scale }), size, size), size, size);
    write(path.join(outPng, `yd-${size}.png`), png[size]);
  }
  // 3) 浅底 / 单色 / 透明底字标（托盘与深色任务栏备用）
  write(path.join(root, 'brand', 'exports', 'icon-256.png'), png[256]);
  write(path.join(root, 'brand', 'exports', 'icon-512.png'), png[512]);
  write(path.join(root, 'brand', 'exports', 'tray-32.png'), png[32]);
  write(path.join(outPng, 'yd-porcelain-32.png'), await makeShot(win, page(brand.markSvg({ tileColor: BRAND.color.porcelain, glyphColor: BRAND.color.brandDeep, hairline: false }), 32, 32), 32, 32));
  const mono = {};
  for (const size of [64, 128, 256, 512]) {
    mono[size] = await makeShot(win, page(brand.markMonoSvg({}), size, size), size, size);
    write(path.join(outPng, `yd-mono-${size}.png`), mono[size]);
  }
  write(path.join(outPng, 'yd-glyph-256.png'), await makeShot(win, page(brand.markSvg({ tile: false, glyphColor: BRAND.color.brand }), 256, 256), 256, 256));

  // 4) Windows 程序图标（含 256 层，供桌面 / 任务栏 / 安装包 / 托盘共用）
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  write(path.join(root, 'brand', 'exports', 'yd.ico'), packIco(icoSizes.map((size) => ({ size, data: png[size] }))));

  // 5) 方向探索与尺寸自检图
  const sheet = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#EFEDE7;font-family:"Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",sans-serif;color:#20261F}
  .wrap{display:grid;grid-template-columns:1fr 1fr;gap:22px;padding:26px}
  .card{background:#FBFAF7;border:1px solid #E1DED4;border-radius:14px;padding:18px}
  .t{font-size:12px;letter-spacing:.14em;color:#7C837A;margin-bottom:12px;text-transform:uppercase}
  .row{display:flex;align-items:center;gap:18px;flex-wrap:wrap}
  .sizes{display:flex;align-items:flex-end;gap:14px;padding-top:12px;border-top:1px solid #E7E4DB;margin-top:14px}
  .sizes figure{margin:0;text-align:center;color:#8A9089;font-size:10px}
  .sizes img{display:block;image-rendering:auto}
  .pixel{image-rendering:pixelated}
  .side{display:flex;gap:14px;align-items:center}
  .mock{display:flex;align-items:center;gap:10px;background:#1E2A22;border-radius:12px;padding:12px 16px}
  .mock b{color:#F4F2EA;font-size:15px;letter-spacing:.04em}
  .mock small{display:block;color:#93A093;font-size:9.5px;letter-spacing:.18em}
  </style></head><body><div class="wrap">
  <div class="card"><div class="t">方向 A · 软方徽记 + YD 联结字标</div><div class="row">
    <img src="${dataUri(png[128])}" width="128" height="128">
    <div><div style="font-size:40px;font-weight:600;letter-spacing:.06em">YD</div>
    <div style="font-size:11px;letter-spacing:.3em;color:#7E877E;margin-top:2px">YOUR DAY</div>
    <div style="font-size:11px;color:#9AA097;margin-top:10px">your day, quietly organized.</div></div>
  </div><div class="sizes">${[16, 24, 32, 48, 64, 128].map((s) => `<figure><img class="${s <= 32 ? 'pixel' : ''}" src="${dataUri(png[s])}" width="${s}" height="${s}"><figcaption>${s}px</figcaption></figure>`).join('')}</div></div>
  <div class="card"><div class="t">方向 B · 字标优先 + 日线</div><div class="row">
    ${inline(brand.directionB())}
  </div></div>
  <div class="card"><div class="t">方向 C · 圆徽记 + 日弧</div><div class="row">
    ${inline(brand.directionC())}
  </div></div>
  <div class="card"><div class="t">落地形态 · 侧边栏 / 浅底 / 单色</div>
    <div class="side">
      <div class="mock"><img src="${dataUri(png[48])}" width="34" height="34"><div><b>YD</b><small>YOUR DAY</small></div></div>
      <img src="${dataUri(png[64])}" width="64" height="64" style="border:1px solid #E1DED4;border-radius:12px">
    </div>
    <div class="sizes">${[64, 128].map((s) => `<figure><img src="${dataUri(mono[s])}" width="${s}" height="${s}"><figcaption>单色 ${s}px</figcaption></figure>`).join('')}</div>
  </div>
  <div class="card" style="grid-column:1 / -1"><div class="t">小尺寸实拍（8 倍放大 · 浅色 / 深色任务栏）</div>
    <div class="row" style="gap:26px">
      ${[16, 24, 32].map((s) => `<div><div style="font-size:10px;color:#8A9089;margin-bottom:6px">${s}px 浅底</div><div style="background:#F5F3EE;padding:8px;border-radius:8px"><img class="pixel" src="${dataUri(png[s])}" width="${s * 8}" height="${s * 8}"></div></div>`).join('')}
      ${[16, 24, 32].map((s) => `<div><div style="font-size:10px;color:#8A9089;margin-bottom:6px">${s}px 深底</div><div style="background:#20272B;padding:8px;border-radius:8px"><img class="pixel" src="${dataUri(png[s])}" width="${s * 8}" height="${s * 8}"></div></div>`).join('')}
    </div>
  </div>
  </div></body></html>`;
  await win.setContentSize(1180, 1260);
  const sheetPng = await makeShot(win, sheet, 1180, 1220);
  write(path.join(outExplore, 'directions.png'), sheetPng);

  win.destroy();
  console.log('品牌资源已生成：brand/exports（svg / png / ico）、brand/explore/directions.png');
  app.quit();
})().catch((error) => {
  console.error(error);
  app.exit(1);
});

function dataUri(buffer) {
  return 'data:image/png;base64,' + buffer.toString('base64');
}

function inline(svg) {
  return svg.replace(/width="240" height="200"/, 'width="330" height="275"');
}
