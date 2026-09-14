// 0.2.17 品牌改版截图：主窗口各页 + 侧栏品牌区 + 小尺寸图标实拍。
// 运行：npx electron scripts/visual-v0217.cjs
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const output = path.join(root, 'test-data', 'v0217-visual-' + Date.now());
fs.mkdirSync(output, { recursive: true });
app.setAppPath(root);
process.env.DAYHUB_TEST_DATA = output;
require('../dist/main.cjs');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  try {
    let panel, orb;
    for (let i = 0; i < 120; i++) {
      const windows = BrowserWindow.getAllWindows();
      panel = windows.find((w) => w.webContents.getURL().includes('index.html') && !w.webContents.getURL().includes('#'));
      orb = windows.find((w) => w.webContents.getURL().endsWith('#orb'));
      if (panel && orb && !panel.webContents.isLoading() && !orb.webContents.isLoading()) break;
      await wait(100);
    }
    const run = (code) => panel.webContents.executeJavaScript(code);
    const shot = async (name, rect) => {
      await wait(260);
      const image = rect ? await panel.webContents.capturePage(rect) : await panel.webContents.capturePage();
      fs.writeFileSync(path.join(output, name + '.png'), image.toPNG());
    };
    const schedule = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'synthetic-schedule.json'), 'utf8'));
    await run(`window.dayhub.change({type:'importSchedule',value:${JSON.stringify(schedule)}})`);
    await run("window.dayhub.change({type:'settings',setup:true})");
    panel.setContentSize(1180, 820);
    await shot('01-today');
    await shot('02-brand-sidebar', { x: 0, y: 0, width: 360, height: 470 });
    const tabs = [['3', '03-courses'], ['4', '04-tasks'], ['2', '05-partner'], ['7', '06-settings']];
    for (const [key, name] of tabs) {
      await run(`document.querySelectorAll('.nav-item')[${Number(key) - 1}].click()`);
      await shot(name);
    }
    await run("document.querySelectorAll('.nav-item')[0].click()");
    panel.setContentSize(1000, 700);
    await shot('07-today-compact');
    // 收件箱（含一条待核对通知）也过一遍新皮肤：宽窗主从布局最容易看出配色问题
    panel.setContentSize(1180, 820);
    await run("window.dayhub.change({type:'inbound',id:'brand-review',payload:{text:'周五 14:00 教研组会议，地点 A302，请提前准备材料。'}})");
    await wait(600);
    await run("document.querySelectorAll('.nav-item')[4].click()");
    await shot('11-inbox-list');
    await run("document.querySelector('.inbox-list-item')?.click()");
    await shot('12-inbox-detail');
    await run("document.querySelectorAll('.nav-item')[5].click()");
    await shot('13-reminders');
    // 桌宠：切换三种外观各截一张，确认状态点颜色与品牌一致
    const orbShot = async (name) => {
      await wait(320);
      fs.writeFileSync(path.join(output, name + '.png'), (await orb.webContents.capturePage()).toPNG());
    };
    await run("window.dayhub.change({type:'settings',pet:{mode:'orb',size:'medium'}})");
    await orbShot('08-orb');
    await orb.webContents.executeJavaScript("document.querySelector('.pet-handle').click()");
    const mini = (await (async () => {
      for (let i = 0; i < 40; i++) {
        const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().endsWith('#mini'));
        if (w && w.isVisible()) return w;
        await wait(120);
      }
      return null;
    })());
    if (mini) {
      await wait(320);
      fs.writeFileSync(path.join(output, '09-mini-panel.png'), (await mini.webContents.capturePage()).toPNG());
    }
    await run("window.dayhub.change({type:'settings',pet:{mode:'custom',size:'medium'}})");
    await orbShot('10-companion');
    const ico = path.join(root, 'brand', 'exports', 'yd.ico');
    // 托盘资源自 2026-09-14 起是 Asset 06/07 导出的 dark-*/light-* 三档尺寸。
    const tray = path.join(root, 'brand', 'exports', 'tray', 'dark-32.png');
    const metrics = {
      output,
      icon: { exists: fs.existsSync(ico), size: fs.statSync(ico).size },
      tray: { exists: fs.existsSync(tray), size: fs.statSync(tray).size },
      traySize: nativeImage.createFromPath(tray).getSize(),
      brandText: await run("document.querySelector('.brand').textContent"),
      bottomText: await run("document.querySelector('.sidebar-bottom').textContent"),
      titlebar: await run("document.querySelector('.titlebar').textContent.replace('−□×','')"),
      status: await run("[...document.querySelectorAll('.dual-status .person-status')].map(e=>e.textContent)"),
      page: await run("document.querySelector('.page-head').textContent"),
      version: app.getVersion(),
      orbDots: await orb.webContents.executeJavaScript("(()=>[...document.querySelectorAll('.rail-dot')].map(el=>({tone:el.dataset.tone,color:getComputedStyle(el).backgroundColor})))()"),
    };
    fs.writeFileSync(path.join(output, 'metrics.json'), JSON.stringify(metrics, null, 2));
    console.log(JSON.stringify(metrics, null, 2));
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
