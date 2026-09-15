// VS2（Visual System 2.0）维护中的视觉 / 运行时验收脚本。
//
// 取代已删除的 scripts/visual-v022.cjs 与 scripts/ui-audit.cjs：那两个脚本分别
// 对应旧的悬浮球视觉与刷新前的主窗口按钮文案，在 VS2 下已经不可能通过。
//
// 覆盖范围
//   1. 三种窗口宽度（紧凑 780×600 / 常规 1050×780 / 宽屏 1600×960）× 六个页面：
//      可见标题、根与页面两级无横向溢出、正文不含 undefined。
//   2. 课表页：没有"一览模式"残留、有"编辑课表"、八节完整 HH:mm–HH:mm 表侧时间、有周次切换。
//   3. 设置页：六个顶部分区、按宽度切换的导航布局、共享 setting-row 结构、关于页版本号。
//   4. Together Dock：两块同高同基线的 person 区域（牌面宽度由内容决定）、无旧 Orb DOM、
//      hover 几何固定、点 Dock 在同一个窗口里打开两张卡详情（Mini 窗口保持隐藏）。
//   5. Solo Dock：单行、无分隔线与空槽、牌面按内容宽度收敛、hover 几何固定、
//      详情是同一窗口里的单张全宽卡。
//
// 数据隔离：所有 Electron 进程都通过 scripts/electron-test-profile.cjs 使用
// os.tmpdir() 下的独立 userData，绝不读取、迁移、恢复或修改 %APPDATA%\事务助手。
//
// 运行：
//   npx electron scripts/visual-vs2.cjs                 # 依次跑 Together → Solo
//   npx electron scripts/visual-vs2.cjs --mode=together --data=<dir>
//   npx electron scripts/visual-vs2.cjs --mode=solo     --data=<dir>
// 或经由编排器：npm run verify:vs2
const { app, BrowserWindow, screen } = require('electron');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configureIsolatedUserData, seedWorkspace } = require('./electron-test-profile.cjs');

const root = path.join(__dirname, '..');
const output = path.join(root, 'test-data', 'vs2-visual');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
// 以脚本方式（npx electron <script>）启动时，Electron 的 app.getVersion() 返回的是
// Electron 自身版本，而不是 package.json 里的产品版本；只有打包后的 YD.exe 才返回
// 真实产品版本。因此"关于 YD"这一项在开发态只校验 API / 渲染层 / package.json
// 三方一致，打包态再追加 0.2.21 这个具体版本号断言。
const packagedHarness = path.basename(process.execPath).toLowerCase().startsWith('yd');

// 受控虚拟时钟：把"现在"平移到合成课表的学期内（2027-03-01 周一 10:10，Alex 正在上
// Computer Vision），让课表页是"有课"的真实密度，而不是学期外的空表。
// 锚点必须与 tests/fixtures/synthetic-schedule.json 的 startDate 保持一致。
function useVirtualTermClock() {
  const realNow = Date.now.bind(Date);
  const realAnchor = realNow();
  const simAnchor = new Date(2027, 2, 1, 10, 10, 0, 0).getTime();
  Date.now = () => simAnchor + (realNow() - realAnchor);
}

const argOf = (name) => {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
};

const report = [];
const consoleErrors = [];
const check = (name, value, detail = '') => {
  report.push({ name, ok: !!value, detail: detail === undefined ? '' : String(detail) });
  return !!value;
};

app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (...args) => {
    const details = args[1];
    if (details && typeof details === 'object') {
      if (details.level === 'error' || details.level === 3) consoleErrors.push(String(details.message));
    } else if (Number(details) >= 2) {
      consoleErrors.push(String(args[2]));
    }
  });
});

function summarize(mode) {
  const failed = report.filter((entry) => !entry.ok);
  fs.mkdirSync(output, { recursive: true });
  const payload = {
    mode,
    passed: report.length - failed.length,
    failed,
    displays: screen.getAllDisplays().map((display) => ({
      id: display.id,
      scaleFactor: display.scaleFactor,
      size: display.size,
      workArea: display.workArea,
    })),
    report,
  };
  fs.writeFileSync(path.join(output, `report-${mode}.json`), JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));
  return failed.length;
}

function windows() {
  const all = BrowserWindow.getAllWindows();
  return {
    panel: all.find((win) => !win.webContents.getURL().includes('#') && win.webContents.getURL().includes('index.html')),
    dock: all.find((win) => win.webContents.getURL().endsWith('#orb')),
    mini: all.find((win) => win.webContents.getURL().endsWith('#mini')),
    tip: all.find((win) => win.webContents.getURL().endsWith('#tip')),
  };
}

async function waitForWindows() {
  for (let attempt = 0; attempt < 160; attempt++) {
    const found = windows();
    if (found.panel && found.dock && found.mini && !found.panel.webContents.isLoading() && !found.dock.webContents.isLoading()) {
      return found;
    }
    await wait(100);
  }
  return windows();
}

// ---------------------------------------------------------------------------
// Together / Solo 面板
// ---------------------------------------------------------------------------
const SIZES = [
  { key: 'compact', width: 780, height: 600 },
  { key: 'normal', width: 1050, height: 780 },
  { key: 'wide', width: 1600, height: 960 },
];
const PAGES = [
  { key: 'today', label: '我的安排', heading: '我的安排' },
  { key: 'courses', label: '课表管理', heading: '课表管理' },
  { key: 'tasks', label: '事项与会议', heading: '事项与会议' },
  { key: 'inbox', label: '通知收件箱', heading: '通知收件箱' },
  { key: 'reminders', label: '未处理提醒', heading: '未处理提醒' },
  { key: 'settings', label: '设置与备份', heading: '设置与备份' },
];

// 主导航按钮的可见文案会被未处理提醒徽标追加数字（"未处理提醒1"），
// 因此按 data-tab 定位页面，而不是按 textContent 精确匹配。
const TAB_OF_PAGE = { today: 'today', courses: 'courses', tasks: 'tasks', inbox: 'inbox', reminders: 'reminders', settings: 'settings' };

async function inspectPage(panel) {
  return panel.webContents.executeJavaScript(`(() => {
    const root = document.documentElement;
    const main = document.querySelector('.main');
    const text = (document.querySelector('.main') || document.body).innerText;
    return {
      heading: (document.querySelector('.main h1') || document.querySelector('h1'))?.textContent?.trim() ?? '',
      rootOverflow: root.scrollWidth - root.clientWidth,
      mainOverflow: main ? main.scrollWidth - main.clientWidth : 0,
      mainClient: main ? main.clientWidth : 0,
      hasUndefined: /undefined/.test(text),
      bodyText: text.slice(0, 240),
    };
  })()`);
}

async function navigate(panel, label) {
  const clicked = await panel.webContents.executeJavaScript(
    `(() => { const el = [...document.querySelectorAll('.nav-item')].find(node => node.textContent.trim() === ${JSON.stringify(label)}); if (!el) return false; el.click(); return true; })()`
  );
  await wait(180);
  return clicked;
}

async function navigateTab(panel, tab) {
  const clicked = await panel.webContents.executeJavaScript(
    `(() => { const el = document.querySelector('.nav-item[data-tab=${JSON.stringify(tab)}]'); if (!el) return false; el.click(); return true; })()`
  );
  await wait(180);
  return clicked;
}

async function checkViews(panel, mode) {
  for (const size of SIZES) {
    panel.setContentSize(size.width, size.height);
    await wait(240);
    const actual = panel.getContentSize();
    check(
      `主窗口 ${size.key} 视口可用（${size.width}×${size.height}）`,
      actual[0] === size.width && actual[1] === size.height,
      actual.join('x')
    );
    for (const page of PAGES) {
      const ok = await navigateTab(panel, TAB_OF_PAGE[page.key]);
      if (!check(`${size.key} · 导航到 ${page.label}`, ok)) continue;
      const view = await inspectPage(panel);
      check(`${size.key} · ${page.key} 标题可见`, view.heading === page.heading, view.heading);
      check(`${size.key} · ${page.key} 根节点无横向溢出`, view.rootOverflow <= 1, `overflow=${view.rootOverflow}`);
      check(`${size.key} · ${page.key} 页面框架无横向溢出`, view.mainOverflow <= 1, `overflow=${view.mainOverflow}`);
      check(`${size.key} · ${page.key} 正文不含 undefined`, !view.hasUndefined);
      fs.writeFileSync(path.join(output, `${mode}-${size.key}-${page.key}.png`), (await panel.webContents.capturePage()).toPNG());
    }
  }
}

async function checkSchedule(panel, mode) {
  panel.setContentSize(1050, 780);
  await wait(220);
  await navigate(panel, '课表管理');
  const detail = await panel.webContents.executeJavaScript(`(() => {
    const scroll = document.querySelector('.schedule-scroll');
    const gutter = [...document.querySelectorAll('.period-label small')].map(node => node.textContent.trim());
    const store = document.querySelector('[aria-label="查看教学周"]');
    return {
      mode: scroll?.dataset.scheduleMode ?? null,
      days: document.querySelectorAll('.schedule-day').length,
      periods: document.querySelectorAll('.period-label').length,
      gutter,
      completeRanges: gutter.filter(value => /^\\d{2}:\\d{2}–\\d{2}:\\d{2}$/.test(value)).length,
      weekSwitch: !!store && store.tagName === 'SELECT',
      weekOptions: store ? store.options.length : 0,
      prev: !!document.querySelector('[aria-label="上一教学周"]'),
      next: !!document.querySelector('[aria-label="下一教学周"]'),
      hasOverviewLabel: document.body.innerText.includes('一览模式'),
      hasEdit: [...document.querySelectorAll('button')].some(node => node.textContent.trim() === '编辑课表'),
      hasGrid: !!document.querySelector('.schedule-grid'),
      hasUndefined: /undefined/.test(document.querySelector('.main').innerText),
    };
  })()`);
  check('课表页保留了周课表网格', detail.hasGrid && detail.days === 7, JSON.stringify({ days: detail.days }));
  check('课表页没有"一览模式"残留', detail.hasOverviewLabel === false);
  check('课表页有"编辑课表"入口', detail.hasEdit);
  check(
    '课表页八节表侧时间完整为 HH:mm–HH:mm',
    detail.periods === 8 && detail.completeRanges === 8,
    JSON.stringify({ periods: detail.periods, completed: detail.completeRanges, gutter: detail.gutter })
  );
  check('课表页有周次切换（下拉 + 前后一周）', detail.weekSwitch && detail.weekOptions > 1 && detail.prev && detail.next, JSON.stringify({ options: detail.weekOptions }));
  check('课表页正文不含 undefined', !detail.hasUndefined);
  fs.writeFileSync(path.join(output, `${mode}-schedule.png`), (await panel.webContents.capturePage()).toPNG());
  return detail;
}

async function checkSettings(panel, mode) {
  panel.setContentSize(1050, 780);
  await wait(200);
  await navigate(panel, '设置与备份');
  const atNormal = await panel.webContents.executeJavaScript(`(() => {
    const tabs = [...document.querySelectorAll('.settings-nav button')];
    const layout = document.querySelector('.settings-layout');
    return {
      tabs: tabs.map(node => node.textContent.trim()),
      layoutDisplay: layout ? getComputedStyle(layout).display : '',
      navDisplay: getComputedStyle(document.querySelector('.settings-nav')).display,
      navOverflow: document.querySelector('.settings-nav').scrollWidth - document.querySelector('.settings-nav').clientWidth,
      hasUndefined: /undefined/.test(document.querySelector('.settings-content').innerText),
    };
  })()`);
  check(
    '设置页有六个顶部分区标签',
    atNormal.tabs.length === 6 &&
      ['角色与陪伴', '节奏与状态', '课表与学校', '运行与提醒', '数据与备份', '关于 YD'].every((label) => atNormal.tabs.includes(label)),
    JSON.stringify(atNormal.tabs)
  );
  check('设置页标签不溢出导航容器', atNormal.navOverflow <= 1, `overflow=${atNormal.navOverflow}`);
  // VS2 设置页是"顶部导航 + 单列内容"的收敛版式：.settings-layout 为 block，
  // 分区导航是一条横向 flex，内容区单列铺满。旧的两栏 168px 侧栏版式已被取代。
  check(
    '常规宽度设置页为顶部导航 + 单列内容',
    (atNormal.layoutDisplay === 'block' || atNormal.layoutDisplay === 'grid') && atNormal.navDisplay === 'flex',
    JSON.stringify({ layout: atNormal.layoutDisplay, nav: atNormal.navDisplay })
  );
  const footer = await panel.webContents.executeJavaScript(`(() => {
    const content = document.querySelector('.settings-content');
    const block = content.querySelector('.settings-section, .settings-stack, .about-brand, .pet-settings');
    const style = content ? getComputedStyle(content) : null;
    return { width: content?.getBoundingClientRect().width ?? 0, maxWidth: style?.maxWidth ?? '', sections: content?.children.length ?? 0, blockWidth: block?.getBoundingClientRect().width ?? 0 };
  })()`);
  check(
    '设置页内容区为单列收敛宽度',
    footer.sections >= 1 && footer.width > 0 && footer.width <= 1000,
    JSON.stringify(footer)
  );

  const rows = await panel.webContents.executeJavaScript(`(() => {
    const list = [...document.querySelectorAll('.setting-row')];
    return {
      count: list.length,
      shared: list.every(node => node.querySelector('.setting-row-copy strong') && node.querySelector('.setting-row-control')),
      minHeights: list.map(node => Math.round(node.getBoundingClientRect().height)),
    };
  })()`);
  check('设置页使用统一的 setting-row 结构（当前分区）', rows.count >= 1 && rows.shared, JSON.stringify({ count: rows.count }));
  const rhythmRows = await panel.webContents.executeJavaScript(`(async () => {
    [...document.querySelectorAll('.settings-nav button')].find(node => node.textContent.trim() === '节奏与状态').click();
    await new Promise(resolve => setTimeout(resolve, 240));
    const list = [...document.querySelectorAll('.setting-row')];
    return {
      count: list.length,
      shared: list.every(node => node.querySelector('.setting-row-copy strong') && node.querySelector('.setting-row-control')),
      labels: list.map(node => node.querySelector('.setting-row-copy strong')?.textContent.trim() ?? ''),
      heights: list.map(node => Math.round(node.getBoundingClientRect().height)),
    };
  })()`);
  check(
    '设置分区共用同一套 setting-row 行结构',
    rhythmRows.count >= 2 && rhythmRows.shared && rhythmRows.heights.every((height) => height >= 40),
    JSON.stringify(rhythmRows)
  );

  panel.setContentSize(780, 600);
  await wait(240);
  const atCompact = await panel.webContents.executeJavaScript(`(() => {
    const nav = document.querySelector('.settings-nav');
    const layout = document.querySelector('.settings-layout');
    return {
      layoutDisplay: getComputedStyle(layout).display,
      navDisplay: getComputedStyle(nav).display,
      rootOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      navOverflow: nav.scrollWidth - nav.clientWidth,
    };
  })()`);
  check('紧凑宽度设置页切换为一列 + 顶部横向导航', atCompact.layoutDisplay === 'block' && atCompact.navDisplay === 'flex', JSON.stringify(atCompact));
  check('紧凑宽度设置页无横向溢出', atCompact.rootOverflow <= 1, `overflow=${atCompact.rootOverflow}`);
  fs.writeFileSync(path.join(output, `${mode}-settings-compact.png`), (await panel.webContents.capturePage()).toPNG());

  const about = await panel.webContents.executeJavaScript(`(async () => {
    const tab = [...document.querySelectorAll('.settings-nav button')].find(node => node.textContent.trim() === '关于 YD');
    tab.click();
    await new Promise(resolve => setTimeout(resolve, 260));
    const content = document.querySelector('.settings-content');
    return {
      version: document.querySelector('.about-meta dd')?.textContent?.trim() ?? '',
      isAbout: !!document.querySelector('.about-brand'),
      text: content.innerText.slice(0, 200),
      api: await window.dayhub.version(),
    };
  })()`);
  // 渲染层必须原样展示 API 返回的版本，不能自己拼一个数字。
  check('关于分区展示的版本与 dayhub.version() 一致', about.isAbout && !!about.version && about.version === about.api, JSON.stringify(about));
  if (packagedHarness) {
    check(
      `打包运行下关于分区展示产品版本 ${packageVersion}`,
      about.version === packageVersion,
      JSON.stringify({ shown: about.version, expected: packageVersion })
    );
  } else {
    check(
      '开发态关于分区版本来源为 Electron 运行时（非产品版本）',
      about.version === about.api,
      JSON.stringify({ shown: about.version, api: about.api, expectedInPackage: packageVersion })
    );
  }
  check('关于分区展示 Electron 运行环境说明', /本地优先/.test(about.text), about.text.slice(0, 120));
  fs.writeFileSync(path.join(output, `${mode}-settings-about.png`), (await panel.webContents.capturePage()).toPNG());
}

// ---------------------------------------------------------------------------
// Dock / Mini
// ---------------------------------------------------------------------------
const LEGACY_ORB = '.presence-orb,.presence-surface,.identity-mark,.orb-shell,.split-orb';

// 牌面宽度契约："内容完整优先" —— 渲染层实测内容后由主进程定窗口，
// 因此这里按同一份口径复算：children + gap + 内边距 + 边框，不足时由最小宽度兜底。
// 最小宽度与 src/companion-layout.ts 的 companionDock.minWidth/soloMinWidth（中档）一致。
const DOCK_MIN_WIDTH = { together: 180, solo: 158 };
const DOCK_PLATE_HEIGHT = 56;
const DOCK_CONTENT_MEASURE = `(() => {
  const surface = document.querySelector('.dock-surface');
  if (!surface) return null;
  const style = getComputedStyle(surface);
  const kids = [...surface.children].map(child => child.getBoundingClientRect().width);
  const gap = parseFloat(style.columnGap) || 0;
  return {
    content: kids.reduce((sum, value) => sum + value, 0) + Math.max(0, kids.length - 1) * gap,
    padding: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight),
    border: parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth),
  };
})()`;

/** 牌面右下角在**屏幕**上的位置：详情展开 / 收起时它必须原地不动。 */
async function dockPlateAnchor(dock) {
  const bounds = dock.getBounds();
  const rect = await dock.webContents.executeJavaScript(
    "(()=>{const r=document.querySelector('.dock-surface').getBoundingClientRect();return {right:Math.round(r.right),bottom:Math.round(r.bottom)}})()"
  );
  return { x: bounds.x + rect.right, y: bounds.y + rect.bottom };
}

/** 详情形态：0.3 收口后详情与状态牌共用同一个 floating 窗口（没有第二个 BrowserWindow）。 */
async function dockDetailState(dock) {
  return dock.webContents.executeJavaScript(`(() => {
    const panel = document.querySelector('.mini-panel.dock');
    const cards = [...document.querySelectorAll('.detail-person')];
    const card = cards[0]?.getBoundingClientRect();
    return {
      view: document.querySelector('.pet-dock')?.dataset.dockView ?? null,
      panel: !!panel,
      solo: panel?.classList.contains('solo') ?? false,
      title: panel?.querySelector('.mini-head h2')?.textContent ?? '',
      cards: cards.length,
      next: panel?.querySelectorAll('.detail-next').length ?? 0,
      people: cards.map(entry => entry.dataset.person),
      cardWidth: Math.round(card?.width ?? 0),
      panelWidth: Math.round(panel?.getBoundingClientRect().width ?? 0),
      hasUndefined: /undefined/.test(document.body.innerText),
    };
  })()`);
}

async function clickDock(dock) {
  // 单击有 220ms 去抖，且展开要走一次 IPC；这里轮询到状态真的变化再继续，
  // 避免机器繁忙时把"慢"误判成"没打开"。
  const view = () => dock.webContents.executeJavaScript("document.querySelector('.pet-dock')?.dataset.dockView ?? ''");
  const before = await view();
  await dock.webContents.executeJavaScript(
    `document.querySelector('.pet-handle').dispatchEvent(new MouseEvent('click', { bubbles: true }))`
  );
  for (let i = 0; i < 25; i++) {
    await wait(100);
    const now = await view();
    if (now !== before) { await wait(180); return now; }
  }
  await wait(200);
  return before;
}

// 悬浮区域必须用"当前工作区真实存在的 PersonId"：Solo fixture 的本人 id 不是 'me'，
// 主进程会直接以"无效状态区域"拒绝。因此从 Dock 自己的 data-person 读取。
async function firstDockPerson(dock) {
  return dock.webContents.executeJavaScript(
    `document.querySelector('.person')?.dataset.person ?? null`
  );
}

async function checkDockGeometry(dock, person) {
  if (!person) return { before: null, during: null, after: null, hovered: { rows: 0, extra: false }, tipVisible: false, person: null };
  const before = dock.getBounds();
  await dock.webContents.executeJavaScript(`window.dayhub.presence('enter', ${JSON.stringify(person)})`);
  await wait(340);
  const during = dock.getBounds();
  const hovered = await dock.webContents.executeJavaScript(
    `({ rows: document.querySelectorAll('.person.is-hovered').length, extra: !!document.querySelector('.person.is-hovered .person-meta') })`
  );
  await dock.webContents.executeJavaScript("window.dayhub.presence('leave')");
  await wait(300);
  const after = dock.getBounds();
  const tip = windows().tip;
  return { before, during, after, hovered, tipVisible: tip ? tip.isVisible() : false };
}

async function checkDuoDock(panel, dock, mini) {
  const structure = await dock.webContents.executeJavaScript(`(() => {
    const surface = document.querySelector('.dock-surface');
    const rows = [...document.querySelectorAll('.person')].map(row => row.getBoundingClientRect());
    const style = surface ? getComputedStyle(surface) : null;
    const box = surface ? surface.getBoundingClientRect() : null;
    return {
      rows: rows.map(rect => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })),
      solo: surface?.classList.contains('solo') ?? null,
      people: [...document.querySelectorAll('.person')].map(row => row.dataset.person),
      hasLegacy: !!document.querySelector('${LEGACY_ORB}'),
      hasUndefined: /undefined/.test(document.body.innerText),
      surface: box ? { left: box.left, right: box.right, width: box.width, height: box.height } : null,
      dividers: document.querySelectorAll('.dock-divider').length,
      background: style?.backgroundColor ?? '',
    };
  })()`);
  check('Together Dock 渲染两块并列 person 区域', structure.rows.length === 2 && structure.solo === false, JSON.stringify(structure.people));
  const [first, second] = structure.rows;
  check(
    'Together Dock 两块 person 区域同高同基线并由中线分隔',
    !!first && !!second && Math.abs(first.height - second.height) <= 2 && Math.abs(first.top - second.top) <= 2 && structure.dividers === 1,
    JSON.stringify({ rows: structure.rows, dividers: structure.dividers })
  );
  check(
    'Together Dock 两块区域都在状态牌内并左右排列',
    !!structure.surface && !!first && !!second &&
      first.left >= structure.surface.left - 1 && second.left > first.left &&
      second.left + second.width <= structure.surface.right + 1,
    JSON.stringify({ surface: structure.surface, rows: structure.rows })
  );
  const measure = await dock.webContents.executeJavaScript(DOCK_CONTENT_MEASURE);
  const expectedPlate = measure ? Math.max(DOCK_MIN_WIDTH.together, Math.ceil(measure.content + measure.padding + measure.border)) : 0;
  check(
    'Together Dock 牌面按实测内容定宽（内容完整优先）',
    !!measure && !!structure.surface && Math.abs(structure.surface.width - expectedPlate) <= 2 &&
      Math.abs(structure.surface.height - DOCK_PLATE_HEIGHT) <= 1,
    JSON.stringify({ surface: structure.surface, measure, expectedPlate })
  );
  check('Together Dock 无旧 Orb DOM 残留', !structure.hasLegacy);
  check('Together Dock 文案不含 undefined', !structure.hasUndefined);

  const duoPerson = await firstDockPerson(dock);
  check('Together Dock 暴露真实本人 PersonId 供悬浮验收', !!duoPerson, String(duoPerson));
  const geometry = await checkDockGeometry(dock, duoPerson);
  check(
    'Together Dock hover 前后外框几何固定',
    Math.abs(geometry.during.width - geometry.before.width) <= 8 &&
      Math.abs(geometry.during.height - geometry.before.height) <= 1 &&
      Math.abs(geometry.after.width - geometry.before.width) <= 8 &&
      geometry.after.height === geometry.before.height,
    JSON.stringify({ before: geometry.before, during: geometry.during, after: geometry.after })
  );
  check('Together Dock hover 只在固定几何内展开补充信息', geometry.hovered.rows === 1 && geometry.hovered.extra, JSON.stringify(geometry.hovered));
  check('Together Dock hover 不弹出外置 tooltip', !geometry.tipVisible);

  // 单击 = 在同一个窗口里展开详情（0.3 收口后不再是第二个 BrowserWindow）。
  const plateBefore = await dockPlateAnchor(dock);
  const canvasBefore = dock.getBounds();
  await clickDock(dock);
  const detail = await dockDetailState(dock);
  check(
    'Together Dock 单击在同一个窗口里打开详情（Mini 窗口保持隐藏）',
    detail.view === 'detail' && detail.panel && !mini.isVisible(),
    JSON.stringify({ view: detail.view, panel: detail.panel, miniVisible: mini.isVisible() })
  );
  check('Together 详情是两张平级状态卡，各有自己的「下一项」', detail.cards === 2 && new Set(detail.people).size === 2 && detail.next === 2, JSON.stringify(detail));
  check('Together 详情文案不含 undefined', !detail.hasUndefined);
  if (detail.panel) fs.writeFileSync(path.join(output, 'together-detail.png'), (await dock.capturePage()).toPNG());
  const plateAfter = await dockPlateAnchor(dock);
  check(
    'Together Dock 打开详情不移动状态牌',
    Math.abs(plateAfter.x - plateBefore.x) <= 2 && Math.abs(plateAfter.y - plateBefore.y) <= 2,
    JSON.stringify({ plateBefore, plateAfter })
  );
  await clickDock(dock);
  const closed = await dockDetailState(dock);
  const canvasAfter = dock.getBounds();
  check(
    'Together Dock 再点收起详情并回到默认画布',
    closed.view !== 'detail' && !closed.panel &&
      Math.abs(canvasAfter.width - canvasBefore.width) <= 2 && Math.abs(canvasAfter.height - canvasBefore.height) <= 2,
    JSON.stringify({ view: closed.view, canvasBefore, canvasAfter })
  );
  await wait(200);
}

async function checkSoloDock(dock, mini) {
  const structure = await dock.webContents.executeJavaScript(`(() => {
    const surface = document.querySelector('.dock-surface');
    const rows = [...document.querySelectorAll('.person')];
    const rect = rows[0]?.getBoundingClientRect();
    const box = surface ? surface.getBoundingClientRect() : null;
    return {
      rowCount: rows.length,
      solo: surface?.classList.contains('solo') ?? null,
      width: rect?.width ?? 0,
      surfaceWidth: box?.width ?? 0,
      surfaceHeight: box?.height ?? 0,
      dividers: document.querySelectorAll('.dock-divider').length,
      hasLegacy: !!document.querySelector('${LEGACY_ORB}'),
      hasUndefined: /undefined/.test(document.body.innerText),
    };
  })()`);
  check('Solo Dock 只有一行 person 区域', structure.rowCount === 1 && structure.solo === true, JSON.stringify(structure));
  check('Solo Dock 没有中线分隔与空槽', structure.dividers === 0 && structure.rowCount === 1, JSON.stringify({ dividers: structure.dividers, rows: structure.rowCount }));
  const measure = await dock.webContents.executeJavaScript(DOCK_CONTENT_MEASURE);
  const expectedPlate = measure ? Math.max(DOCK_MIN_WIDTH.solo, Math.ceil(measure.content + measure.padding + measure.border)) : 0;
  check(
    'Solo Dock 单行按实测内容定宽（不保留空槽宽度）',
    !!measure && structure.width > 0 && Math.abs(structure.surfaceWidth - expectedPlate) <= 2 &&
      Math.abs(structure.surfaceHeight - DOCK_PLATE_HEIGHT) <= 1,
    JSON.stringify({ row: structure.width, surface: structure.surfaceWidth, measure, expectedPlate })
  );
  check('Solo Dock 无旧 Orb DOM 残留', !structure.hasLegacy);
  check('Solo Dock 文案不含 undefined', !structure.hasUndefined);

  const soloPerson = await firstDockPerson(dock);
  check('Solo Dock 暴露真实本人 PersonId 供悬浮验收', !!soloPerson, String(soloPerson));
  const geometry = await checkDockGeometry(dock, soloPerson);
  check(
    'Solo Dock hover 前后外框几何固定',
    Math.abs(geometry.during.width - geometry.before.width) <= 8 &&
      Math.abs(geometry.during.height - geometry.before.height) <= 1 &&
      Math.abs(geometry.after.width - geometry.before.width) <= 8 &&
      geometry.after.height === geometry.before.height,
    JSON.stringify({ before: geometry.before, during: geometry.during, after: geometry.after })
  );
  check('Solo Dock hover 展开本人补充信息且无外置 tooltip', geometry.hovered.rows === 1 && geometry.hovered.extra && !geometry.tipVisible);

  const plateBefore = await dockPlateAnchor(dock);
  const canvasBefore = dock.getBounds();
  await clickDock(dock);
  const detail = await dockDetailState(dock);
  check(
    'Solo Dock 单击在同一个窗口里打开详情（Mini 窗口保持隐藏）',
    detail.view === 'detail' && detail.panel && detail.solo && detail.title === '此刻' && !mini.isVisible(),
    JSON.stringify({ view: detail.view, panel: detail.panel, solo: detail.solo, title: detail.title, miniVisible: mini.isVisible() })
  );
  check('Solo 详情只有一个平级人物区', detail.cards === 1 && new Set(detail.people).size === 1, JSON.stringify(detail));
  check('Solo 详情单张卡铺满一行', detail.cardWidth >= detail.panelWidth - 40 && detail.cardWidth > 0, JSON.stringify({ card: detail.cardWidth, panel: detail.panelWidth }));
  check('Solo 详情文案不含 undefined', !detail.hasUndefined);
  if (detail.panel) fs.writeFileSync(path.join(output, 'solo-detail.png'), (await dock.capturePage()).toPNG());
  const plateAfter = await dockPlateAnchor(dock);
  check(
    'Solo Dock 打开详情不移动状态牌',
    Math.abs(plateAfter.x - plateBefore.x) <= 2 && Math.abs(plateAfter.y - plateBefore.y) <= 2,
    JSON.stringify({ plateBefore, plateAfter })
  );
  await clickDock(dock);
  const closed = await dockDetailState(dock);
  const canvasAfter = dock.getBounds();
  check(
    'Solo Dock 再点收起详情并回到默认画布',
    closed.view !== 'detail' && !closed.panel &&
      Math.abs(canvasAfter.width - canvasBefore.width) <= 2 && Math.abs(canvasAfter.height - canvasBefore.height) <= 2,
    JSON.stringify({ view: closed.view, canvasBefore, canvasAfter })
  );
}

// ---------------------------------------------------------------------------
// 模式入口
// ---------------------------------------------------------------------------
async function runTogether(dataDir) {
  const togetherData = configureIsolatedUserData('vs2-together', dataDir);
  // Phase 5A：生产 fresh install 是 Solo；双人视觉验收显式种下合成 fixture。
  if (!fs.existsSync(path.join(togetherData, 'dayhub.sqlite'))) seedWorkspace(togetherData, 'together');
  useVirtualTermClock();
  app.setAppPath(root);
  require('../dist/main.cjs');
  const { panel, dock, mini } = await waitForWindows();
  if (!check('Together：主窗口 / Dock / Mini 三个窗口加载完成', !!panel && !!dock && !!mini)) return;
  fs.mkdirSync(output, { recursive: true });
  await wait(600);

  const schedule = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'synthetic-schedule.json'), 'utf8'));
  await panel.webContents.executeJavaScript(`window.dayhub.change({ type: 'importSchedule', value: ${JSON.stringify(schedule)} })`);
  await panel.webContents.executeJavaScript("window.dayhub.change({ type: 'settings', setup: true, pet: { mode: 'orb', size: 'medium' } })");
  await wait(700);

  const profiles = await panel.webContents.executeJavaScript('window.dayhub.get().then(state => state.profiles.map(profile => profile.id))');
  check('Together：工作区是两个档案', profiles.length === 2, JSON.stringify(profiles));
  await checkViews(panel, 'together');
  await checkSchedule(panel, 'together');
  await checkSettings(panel, 'together');
  await checkDuoDock(panel, dock, mini);
  fs.writeFileSync(path.join(output, 'together-dock.png'), (await dock.capturePage()).toPNG());
  await panel.webContents.executeJavaScript("window.dayhub.change({ type: 'settings', pet: { mode: 'orb', size: 'medium' } })");
  await wait(150);
}

async function runSolo(dataDir) {
  const userData = configureIsolatedUserData('vs2-solo', dataDir);
  const fixture = path.join(root, 'tests', 'fixtures', 'v3-solo-synthetic.sqlite');
  if (fs.existsSync(fixture)) fs.copyFileSync(fixture, path.join(userData, 'dayhub.sqlite'));
  useVirtualTermClock();
  app.setAppPath(root);
  require('../dist/main.cjs');
  const { panel, dock, mini } = await waitForWindows();
  if (!check('Solo：主窗口 / Dock / Mini 三个窗口加载完成', !!panel && !!dock && !!mini)) return;
  fs.mkdirSync(output, { recursive: true });
  await wait(700);

  const profiles = await panel.webContents.executeJavaScript('window.dayhub.get().then(state => state.profiles.map(profile => profile.id))');
  check('Solo：工作区只有一个档案', profiles.length === 1, JSON.stringify(profiles));
  await panel.webContents.executeJavaScript("window.dayhub.change({ type: 'settings', setup: true, pet: { mode: 'orb', size: 'medium' } })");
  await wait(400);
  await checkViews(panel, 'solo');
  await checkSoloDock(dock, mini);
  fs.writeFileSync(path.join(output, 'solo-dock.png'), (await dock.capturePage()).toPNG());
}

// ---------------------------------------------------------------------------
// 编排：Together 与 Solo 各自一个独立 Electron 进程（应用持有单实例锁）
// ---------------------------------------------------------------------------
function spawnMode(mode, dataDir) {
  const result = spawnSync(process.execPath, [__filename, `--mode=${mode}`, `--data=${dataDir}`], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  return result.status ?? 1;
}

const mode = argOf('mode');
const dataArg = argOf('data');

// 关键生命周期约束：Electron 的 screen 模块（以及 display / DPI 读数）只能在
// app 的 'ready' 事件之后使用，否则主进程会直接抛出
// "The 'screen' module can't be used before the app 'ready' event"。
// 所以把编排与单模式两个分支都收进 main()，await app.whenReady() 之后才碰 screen。
async function main() {
  await app.whenReady();

  if (!mode) {
    fs.mkdirSync(output, { recursive: true });
    const togetherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-vs2-together-'));
    const soloDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-vs2-solo-'));
    console.log(`VS2 视觉验收 · Together userData=${togetherDir}`);
    const togetherCode = spawnMode('together', togetherDir);
    console.log(`VS2 视觉验收 · Solo userData=${soloDir}`);
    const soloCode = spawnMode('solo', soloDir);
    const code = togetherCode !== 0 ? togetherCode : soloCode;
    // 多显示器 / DPI 读数：在 app ready 之后取值，把每块屏幕的 scaleFactor
    // 写进报告，供 100% / 125% 验收对照。
    const primaryId = screen.getPrimaryDisplay().id;
    const displays = screen.getAllDisplays().map((display) => ({
      id: display.id,
      scaleFactor: display.scaleFactor,
      size: display.size,
      workAreaSize: display.workAreaSize,
      primary: display.id === primaryId,
    }));
    const cursor = screen.getCursorScreenPoint();
    console.log(
      JSON.stringify(
        {
          output,
          togetherUserData: togetherDir,
          soloUserData: soloDir,
          displays,
          cursor,
          togetherExit: togetherCode,
          soloExit: soloCode,
        },
        null,
        2
      )
    );
    app.exit(code);
    return;
  }

  const dataDir = dataArg ?? fs.mkdtempSync(path.join(os.tmpdir(), `yd-vs2-${mode}-`));
  const deadline = setTimeout(() => {
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, `failure-${mode}.txt`), 'VS2 visual gate timeout');
    app.exit(1);
  }, 240000);

  try {
    if (mode === 'together') await runTogether(dataDir);
    else if (mode === 'solo') await runSolo(dataDir);
    else throw new Error(`未知模式：${mode}`);
  } catch (error) {
    console.error(error);
    check(`${mode}：执行过程无异常`, false, error && error.stack ? String(error.stack).slice(0, 800) : String(error));
  } finally {
    if (consoleErrors.length) check(`${mode}：渲染层无报错`, false, consoleErrors.join(' | '));
    clearTimeout(deadline);
    const failed = summarize(mode);
    app.exit(failed ? 1 : 0);
  }
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
