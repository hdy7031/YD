// YD Phase 5A · Fresh Install Contract 验证（clean-room）。
//
// 运行：
//   node verify-v050-generalization.cjs              # 源码级：空 userData → 启动两次
//   node verify-v050-generalization.cjs --packaged   # 打包版：release/win-unpacked/YD.exe
//
// 它回答一个问题：一台**从来没有 YD 数据**的电脑，第一次装好启动，系统会不会仍然
// 正确、完整、安全？因此：
//   * 每次都用 os.tmpdir() 下的全新目录，绝不读取开发者 AppData；
//   * 第一次启动必须是 Solo（1 个 self、没有 companion）、业务集合全空、作息为空、
//     CurrentState = idle、UI 里没有 undefined / 假同行者 / 私人默认值；
//   * 第二次启动必须复用同一个 PersonId，不重复建档案。
//
// 源码级用「两次 Electron 子进程」验证持久化；--packaged 用打包版 exe + CDP。
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = __dirname;
const packaged = process.argv.includes('--packaged');
const phase = argOf('phase');
const dataArg = argOf('data');
const port = Number(argOf('port') || 9350);
// 第一阶段把"我是谁"交给第二阶段（不要和 phase-<kind>.json 报告文件重名）。
const selfFile = 'first-identity.json';
// 私有 / 合成哨兵：fresh install 的 state 与渲染结果都不允许出现。
const SENTINELS = ['黄德宇', '喻丹', '研究生英语', '高二', '湖南大学', 'hdy', 'Alex', 'Sam', 'Computer Vision', 'TA ·', 'undefined'];
const failures = [];
const passed = [];

function argOf(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}
function check(name, ok, detail = '') {
  if (ok) passed.push(name);
  else failures.push(`${name}${detail ? ' | ' + detail : ''}`);
  return !!ok;
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// 断言：所有模式共用（输入是一份 State + 一份 Live 快照 + 关键 DOM 事实）
// ---------------------------------------------------------------------------
function assertFreshContract(view, notes) {
  const { state, live, dom } = view;
  const self = state.profiles[0];
  // Identity
  check('fresh：只有一个档案', state.profiles.length === 1, JSON.stringify(state.profiles.map((p) => p.id)));
  check('fresh：档案角色是 self', self?.role === 'self', String(self?.role));
  check('fresh：没有 companion', !state.profiles.some((p) => p.role === 'companion'));
  check('fresh：PersonId 是现代 UUID（不是 legacy me / partner）',
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(self?.id)) && !['me', 'partner'].includes(self?.id), String(self?.id));
  check('fresh：档案带中性临时身份（不是私人姓名 / 随机测试名）', self?.name === '我', String(self?.name));
  // Data
  check('fresh：课表为空', state.courses.length === 0 && state.exceptions.length === 0);
  check('fresh：待办 / 会议 / 通知 / 提醒为空',
    state.tasks.length === 0 && state.events.length === 0 && state.notices.length === 0 && state.reminders.length === 0);
  check('fresh：临时手动状态为空', state.manualOverrides.length === 0);
  check('fresh：作息为空（不替新用户决定生活作息）',
    Array.isArray(self?.routine?.rules) && self.routine.rules.length === 0, JSON.stringify(self?.routine));
  check('fresh：Avatar 用官方默认 Pack', self?.avatar?.packId === 'yd-default' && self.avatar.source === 'default', JSON.stringify(self?.avatar));
  // Phase 5B3：学业语义（学期 / 教学周 / 节次）是可选能力 —— fresh install 不带假学期，
  // 普通用户不需要为了"让 Profile 合法"而背一个 20 周的占位校历。
  check('fresh：没有伪造的学期与节次（Academic 可选）',
    self?.startDate === undefined && self?.weeks === undefined && self?.periods === undefined
    && !JSON.stringify(state.profiles).includes('startDate')
    && !JSON.stringify(state.profiles).includes('periods'),
    JSON.stringify({ startDate: self?.startDate, weeks: self?.weeks, periods: self?.periods }));
  // Phase 5B1：fresh install 不静默创建桌面悬浮物 —— 桌宠要在首次设置里显式选择。
  check('fresh：桌面桌宠默认关闭（petEnabled=false）', state.settings.petEnabled === false, String(state.settings.petEnabled));
  // 源码级能直接读 BrowserWindow.isVisible()（真实窗口状态）；打包版只有 CDP，
  // 读不到主进程窗口状态（隐藏窗口的 document.visibilityState 仍是 visible），
  // 因此打包版只锁定状态字段，窗口可见性由源码级证据覆盖。
  if (dom.dock.windowVisible !== undefined) {
    check('fresh：桌宠窗口没有出现在桌面上', dom.dock.windowVisible === false, JSON.stringify({ windowVisible: dom.dock.windowVisible }));
  } else {
    check('fresh：桌宠仍然关闭（打包版：窗口可见性由源码级 verify-v050 覆盖）',
      state.settings.petEnabled === false, String(state.settings.petEnabled));
  }
  // Phase 5B1：schema 升到 7（桌宠主体偏好）；Fresh Install Contract 本身不放宽。
  check('fresh：DOMAIN_VERSION = 7', state.settings.domainVersion === 7, String(state.settings.domainVersion));
  check('fresh：桌宠主体偏好是本人（默认 Solo 没有歧义）', state.settings.petSubjectRole === 'self', String(state.settings.petSubjectRole));
  // State
  check('fresh：CurrentState = idle', live.current.kind === 'idle' && live.current.source === 'idle', JSON.stringify(live.current));
  check('fresh：只有一个投影人且未处理提醒为 0', live.people.length === 1 && live.pending === 0);
  check('fresh：桌宠显示层是空闲（没有 first-run 姿态）', live.display.state === 'idle', String(live.display.state));
  // UI
  check('fresh：主窗口渲染首页', dom.title === '我的安排', JSON.stringify(dom.title));
  check('fresh：首页状态卡只有一个人', dom.statusRows === 1, String(dom.statusRows));
  check('fresh：Solo 导航没有同行者页', !dom.navItems.some((label) => label.includes('的安排') && !label.includes('我的安排')), JSON.stringify(dom.navItems));
  check('fresh：状态 Dock 单行、无分隔线', dom.dockPeople === 1 && dom.dockDividers === 0, JSON.stringify(dom.dock));
  check('fresh：设置页角色区只有 1 个 Picker', dom.pickers === 1, String(dom.pickers));
  // Phase 5B3：没有学业配置时，课表管理页给配置入口，而不是空网格或占位文案。
  check('fresh：课表管理页没有空网格 / 学业占位，只有配置入口',
    dom.courses?.academicAbsent === true && dom.courses.grid === false && dom.courses.weekSwitch === false
    && /设置学期与节次/.test(dom.courses.text ?? '')
    && !/第 0 周|未设置学期|尚未录入课表/.test(dom.courses.text ?? ''),
    JSON.stringify(dom.courses));
  check('fresh：界面没有 undefined', !dom.hasUndefined);
  if (notes) {
    check('fresh：界面与状态里没有私人 / 合成哨兵',
      !SENTINELS.some((token) => notes.includes(token)),
      SENTINELS.filter((token) => notes.includes(token)).join(','));
  }
}

function projectFresh(view) {
  const { state, live, dom } = view;
  return { state, live, dom };
}

// ---------------------------------------------------------------------------
// 源码级：Electron 子进程（first / second 两个阶段）
// ---------------------------------------------------------------------------
async function runSourcePhase(kind, dataDir) {
  const { app, BrowserWindow } = require('electron');
  const { configureIsolatedUserData } = require('./scripts/electron-test-profile.cjs');
  configureIsolatedUserData(`v050-${kind}`, dataDir);
  require('./dist/main.cjs');
  const deadline = setTimeout(() => { fs.writeFileSync(path.join(dataDir, `failure-${kind}.txt`), 'timeout'); app.exit(1); }, 120000);
  app.whenReady().then(async () => {
    try {
      let panel, dock;
      for (let i = 0; i < 140; i++) {
        const windows = BrowserWindow.getAllWindows();
        panel = windows.find((w) => w.webContents.getURL().includes('index.html') && !w.webContents.getURL().includes('#'));
        dock = windows.find((w) => w.webContents.getURL().endsWith('#orb'));
        if (panel && dock && !panel.webContents.isLoading() && !dock.webContents.isLoading()) break;
        await wait(100);
      }
      if (!panel || !dock) throw new Error('fresh install 没有渲染出主窗口与状态 Dock');
      await wait(900);
      const run = (code) => panel.webContents.executeJavaScript(code);
      const pet = (code) => dock.webContents.executeJavaScript(code);
      const readState = () => readFresh(run, pet);
      const view = await readState();
      // fresh install 的桌宠窗口状态：直接读 Electron 的真实可见性。
      view.dom.dock.windowVisible = dock.isVisible();
      if (kind === 'first') {
        assertFreshContract(projectFresh(view), `${view.dom.text}\n${view.dom.dock.text}\n${JSON.stringify(view.state)}`);
        fs.writeFileSync(path.join(dataDir, selfFile), JSON.stringify({
          id: view.state.profiles[0].id,
          name: view.state.profiles[0].name,
          profiles: view.state.profiles.length,
        }), 'utf8');
      } else {
        const first = JSON.parse(fs.readFileSync(path.join(dataDir, selfFile), 'utf8'));
        check('second：第二次启动复用同一个 PersonId', view.state.profiles[0].id === first.id, `${first.id} → ${view.state.profiles[0].id}`);
        check('second：没有重复创建档案', view.state.profiles.length === 1, String(view.state.profiles.length));
        check('second：仍然是 Solo 的空状态', view.state.courses.length === 0 && view.state.tasks.length === 0 && view.state.manualOverrides.length === 0);
        check('second：界面仍然只有一个人', view.dom.statusRows === 1 && view.dom.hasUndefined === false);
      }
      fs.writeFileSync(path.join(dataDir, `phase-${kind}.json`), JSON.stringify({ passed, failures }, null, 2));
    } catch (error) {
      failures.push(`${kind} 阶段异常：${error && error.message ? error.message : error}`);
      fs.writeFileSync(path.join(dataDir, `phase-${kind}.json`), JSON.stringify({ passed, failures }, null, 2));
    } finally {
      clearTimeout(deadline);
      app.exit(failures.length ? 1 : 0);
    }
  });
}

// ---------------------------------------------------------------------------
// 打包版：真实 exe + CDP（fresh install 清房）
// ---------------------------------------------------------------------------
/**
 * 读取 fresh install 的真实状态：先看首页（标题 / 状态行 / 导航），再把桌宠切到状态 Dock
 * 看单人形态，然后打开设置页看 Picker 数量，最后看课表管理页在"没有学业配置"时的形态。
 * 顺序固定，避免"在设置页上断言首页标题"。
 */
async function readFresh(run, pet) {
  const home = await run(`(()=>{const text=document.body.innerText;return {
    title:document.querySelector('.page-head h1')?.textContent??'',
    statusRows:document.querySelectorAll('.dual-status .person-status').length,
    navItems:[...document.querySelectorAll('.nav-item')].map(e=>e.textContent.trim()),
    hasUndefined:/undefined/.test(text),text};})()`);
  await run("window.dayhub.change({type:'settings',pet:{mode:'orb',size:'medium'}})");
  await wait(700);
  const dock = await pet("(()=>({people:document.querySelectorAll('.person').length,dividers:document.querySelectorAll('.dock-divider').length,chips:document.querySelectorAll('.rail-chip').length,visibility:document.visibilityState,text:document.body.innerText}))()");
  await run("window.dayhub.window('settings')");
  await wait(700);
  const settings = await run("(()=>({pickers:document.querySelectorAll('.avatar-person-picker').length,text:document.body.innerText,hasUndefined:/undefined/.test(document.body.innerText)}))()");
  // Phase 5B3：fresh install 没有学期与节次 —— 课表管理页必须给出配置入口，
  // 而不是渲染空网格或「第 0 周 / 未设置学期」这类占位。
  await run("(()=>{const tab=[...document.querySelectorAll('.nav-item')].find(b=>b.getAttribute('data-kind')==='courses');if(tab)tab.click();})()");
  await wait(500);
  const courses = await run(`(()=>{const text=document.querySelector('.page-courses')?.innerText??'';return {
    academicAbsent:!!document.querySelector('[data-academic-absent]'),
    grid:!!document.querySelector('.schedule-grid'),
    weekSwitch:!!document.querySelector('[aria-label="查看教学周"]'),
    text,
  };})()`);
  const state = await run('window.dayhub.get()');
  const live = await run('window.dayhub.live()');
  return {
    state,
    live: { ...live, current: live.people[0]?.current },
    dom: {
      ...home,
      pickers: settings.pickers,
      hasUndefined: home.hasUndefined || settings.hasUndefined,
      text: `${home.text}\n${settings.text}\n${courses.text}`,
      courses,
      dock,
      dockPeople: dock.people,
      dockDividers: dock.dividers,
    },
  };
}

class Session {
  constructor(url) {
    this.id = 0; this.pending = new Map();
    this.socket = new WebSocket(url);
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const resolver = this.pending.get(message.id);
      if (resolver) { this.pending.delete(message.id); resolver(message); }
    });
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', () => resolve());
      this.socket.addEventListener('error', reject);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => this.pending.set(id, resolve));
  }
  async eval(expression) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text ?? 'eval failed');
    return response.result?.result?.value;
  }
  close() { try { this.socket.close(); } catch { /* ignore */ } }
}

async function cdpPages() {
  for (let i = 0; i < 120; i++) {
    try {
      const pages = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === 'page');
      if (pages.length >= 5) return pages;
    } catch { /* 端口还没起来 */ }
    await wait(500);
  }
  throw new Error('打包版未在 60 秒内暴露调试端口');
}

async function withPackagedApp(dataDir, fn) {
  const exe = path.join(root, 'release', 'win-unpacked', 'YD.exe');
  if (!fs.existsSync(exe)) throw new Error(`缺少打包产物：${exe}`);
  const child = spawn(exe, [`--remote-debugging-port=${port}`], { env: { ...process.env, DAYHUB_TEST_DATA: dataDir }, stdio: 'ignore' });
  const sessions = [];
  try {
    const pages = await cdpPages();
    const panel = new Session(pages.find((t) => !t.url.includes('#') && t.url.includes('index.html')).webSocketDebuggerUrl);
    const dock = new Session(pages.find((t) => t.url.endsWith('#orb')).webSocketDebuggerUrl);
    sessions.push(panel, dock);
    await panel.ready; await dock.ready;
    await wait(1200);
    return await fn(panel, dock);
  } finally {
    for (const session of sessions) session.close();
    try { child.kill(); } catch { /* ignore */ }
    await wait(800);
    try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已退出 */ }
  }
}

async function packagedRead(panel, dock) {
  return readFresh((code) => panel.eval(code), (code) => dock.eval(code));
}

async function runPackaged() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-v050-packaged-'));
  console.log(`Phase 5A packaged clean-room · userData=${dataDir}`);
  let first = null;
  await withPackagedApp(dataDir, async (panel, dock) => {
    const view = await packagedRead(panel, dock);
    assertFreshContract(projectFresh(view), `${view.dom.text}\n${view.dom.dock.text}\n${JSON.stringify(view.state)}`);
    first = view.state.profiles[0];
  });
  await withPackagedApp(dataDir, async (panel, dock) => {
    const view = await packagedRead(panel, dock);
    check('packaged second：复用同一个 PersonId', view.state.profiles[0].id === first?.id, `${first?.id} → ${view.state.profiles[0].id}`);
    check('packaged second：没有重复创建档案', view.state.profiles.length === 1, String(view.state.profiles.length));
  });
}

// ---------------------------------------------------------------------------
function spawnSourcePhase(kind, dataDir) {
  const electron = require('electron'); // 本地 Electron 可执行文件路径
  const result = spawnSync(electron, [__filename, `--phase=${kind}`, `--data=${dataDir}`], { cwd: root, stdio: 'inherit' });
  return result.status ?? 1;
}

(async () => {
  if (phase) { await runSourcePhase(phase, dataArg); return; }
  if (packaged) {
    await runPackaged();
  } else {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-v050-source-'));
    console.log(`Phase 5A source clean-room · userData=${dataDir}`);
    check('fresh install 启动目录是全新的（没有任何 dayhub 数据）',
      !fs.existsSync(path.join(dataDir, 'dayhub.sqlite')) && fs.readdirSync(dataDir).length === 0);
    const first = spawnSourcePhase('first', dataDir);
    const second = first === 0 ? spawnSourcePhase('second', dataDir) : 1;
    for (const kind of ['first', 'second']) {
      const file = path.join(dataDir, `phase-${kind}.json`);
      if (!fs.existsSync(file)) { failures.push(`${kind} 阶段没有产出报告（exit=${kind === 'first' ? first : second}）`); continue; }
      const report = JSON.parse(fs.readFileSync(file, 'utf8'));
      passed.push(...report.passed.map((name) => `${kind} · ${name}`));
      failures.push(...report.failures.map((name) => `${kind} · ${name}`));
    }
  }
  console.log(JSON.stringify({ mode: packaged ? 'packaged' : 'source', passed: passed.length, failed: failures.length, failures }, null, 2));
  process.exit(failures.length ? 1 : 0);
})().catch((error) => {
  console.error(String(error && error.stack || error));
  process.exit(1);
});
