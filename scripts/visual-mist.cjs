// Main-window visual regression for the mist/grey-green visual system.
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const output = path.join(root, 'test-data', 'visual-mist-' + Date.now());
fs.mkdirSync(output, { recursive: true });
app.setAppPath(root);
const { configureIsolatedUserData, seedWorkspace } = require('./electron-test-profile.cjs');
const userData = configureIsolatedUserData('visual-mist');
// Phase 5A：主窗口视觉回归用双人合成工作区（不再依赖生产 fresh default）。
if (!fs.existsSync(path.join(userData, 'dayhub.sqlite'))) seedWorkspace(userData, 'together');
require('../dist/main.cjs');
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  let panel, orb;
  try {
    for (let i = 0; i < 120; i++) {
      const windows = BrowserWindow.getAllWindows();
      panel = windows.find(w => w.webContents.getURL().includes('index.html') && !w.webContents.getURL().includes('#'));
      orb = windows.find(w => w.webContents.getURL().endsWith('#orb'));
      if (panel && orb && !panel.webContents.isLoading() && !orb.webContents.isLoading()) break;
      await wait(100);
    }
    if (!panel) throw new Error('Main window did not become ready');
    const run = code => panel.webContents.executeJavaScript(code);
    const shot = async name => {
      await wait(260);
      fs.writeFileSync(path.join(output, name + '.png'), (await panel.capturePage()).toPNG());
    };
    const selectKind = async kind => {
      await run(`document.querySelector('[data-kind="${kind}"]')?.click()`);
      await wait(180);
    };
    const schedule = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'synthetic-schedule.json'), 'utf8'));
    await run(`window.dayhub.change({type:'importSchedule',value:${JSON.stringify(schedule)}})`);
    await run("window.dayhub.change({type:'settings',setup:true})");

    panel.setContentSize(1366, 768);
    await selectKind('today'); await shot('01-today-1366');
    await selectKind('courses'); await shot('02-courses-1366');
    await selectKind('tasks'); await shot('03-tasks-1366');
    await selectKind('person'); await shot('04-partner-1366');
    await selectKind('inbox'); await shot('05-inbox-empty-1366');
    await selectKind('reminders'); await shot('06-reminders-empty-1366');
    await selectKind('settings'); await shot('07-settings-1366');

    panel.setContentSize(1000, 700);
    await selectKind('today'); await shot('08-today-compact');
    panel.setContentSize(1920, 1080);
    await shot('09-today-wide');
    if (orb) {
      await wait(260);
      fs.writeFileSync(path.join(output, '10-companion-regression.png'), (await orb.capturePage()).toPNG());
    }

    const report = await run(`(() => {
      const root = document.documentElement;
      const body = document.body;
      const active = document.querySelector('.nav-item.active');
      const rects = [...document.querySelectorAll('.nav-item')].map(el => ({
        kind: el.dataset.kind, width: el.getBoundingClientRect().width,
        scrollWidth: el.scrollWidth, height: el.getBoundingClientRect().height,
        scrollHeight: el.scrollHeight
      }));
      return {
        bodyClass: body.className,
        titlebar: document.querySelector('.titlebar-brand')?.textContent,
        navKinds: [...document.querySelectorAll('.nav-item')].map(el => el.dataset.kind),
        navIcons: document.querySelectorAll('.nav-icon').length,
        activeKind: active?.dataset.kind,
        tagline: document.querySelector('.page-tagline')?.textContent,
        horizontalOverflow: root.scrollWidth > root.clientWidth,
        navOverflow: rects.filter(x => x.scrollWidth > x.width + 1 || x.scrollHeight > x.height + 1),
        colors: {
          canvas: getComputedStyle(body).getPropertyValue('--yd-canvas').trim(),
          brand: getComputedStyle(body).getPropertyValue('--yd-brand').trim(),
          ink: getComputedStyle(body).getPropertyValue('--yd-ink').trim()
        }
      };
    })()`);
    const icon = nativeImage.createFromPath(path.join(root, 'brand', 'exports', 'icon-256.png'));
    // 托盘资源自 2026-09-14 起是 Asset 06/07 导出的 dark-*/light-* 三档尺寸。
    const tray = nativeImage.createFromPath(path.join(root, 'brand', 'exports', 'tray', 'dark-32.png'));
    report.assets = { icon: icon.getSize(), tray: tray.getSize(), iconEmpty: icon.isEmpty(), trayEmpty: tray.isEmpty() };
    report.companion = orb ? await orb.webContents.executeJavaScript(`({bodyClass:document.body.className, mainTheme:document.body.classList.contains('main-body')})`) : null;
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, userData, report }, null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (panel && !panel.isDestroyed()) panel.destroy();
    app.quit();
  }
});
