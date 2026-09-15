// YD Phase 5B1 · First-Run Onboarding 验证（clean-room）。
//
// 运行：
//   node verify-v051-onboarding.cjs              # 源码级：空 userData → 真实点击完成 onboarding
//   node verify-v051-onboarding.cjs --packaged   # 打包版：release/win-unpacked/YD.exe + CDP
//
// 它回答一个问题：一个从来没有 YD 数据的用户第一次打开，能不能用最少的步骤
// 建立自己的身份并进入正常 Home？因此：
//   * 每次都用 os.tmpdir() 下的全新目录，绝不读取开发者 / 真实用户 AppData；
//   * settings.setup === false 是显示 onboarding 的唯一条件（不靠姓名 / 档案数量猜）；
//   * Solo 与 Together 各走一条完整真实点击路径，之后重启验证持久化；
//   * 中途关闭不清空 draft：下次启动仍然显示 onboarding，且没有 ghost companion；
//   * 完成后不 seed 课表 / 待办 / 作息，CurrentState 仍然由状态引擎决定。
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = __dirname;
const packaged = process.argv.includes('--packaged');
const phase = argOf('phase');
const dataArg = argOf('data');
const port = Number(argOf('port') || 9371);
const identityFile = 'first-identity.json';
// 私有 / 合成 / 领域术语哨兵：新用户的界面里都不允许出现。
const SENTINELS = ['黄德宇', '喻丹', '研究生英语', '高二', '湖南大学', 'hdy', 'Alex', 'Sam', 'Computer Vision', 'undefined'];
const FORBIDDEN_TERMS = ['Solo', 'Together', 'companion', 'Profile', 'partner'];
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
// 进度文案只用于人读（1 / 3）；断言时去掉空格，避免为了空格改动界面文案。
const normalized = (value) => String(value || '').replace(/\s+/g, '');

// ---------------------------------------------------------------------------
// 渲染层驱动：所有动作都走真实 DOM（点击 / 输入），不直接调用领域命令跳过界面。
// ---------------------------------------------------------------------------
function domHelpers(run, pet) {
  const click = async (selector) => {
    const result = await run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return 'missing';el.click();return 'ok';})()`);
    await wait(160);
    return result;
  };
  const type = async (selector, value) => {
    const result = await run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return 'missing';const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));return 'ok';})()`);
    await wait(160);
    return result;
  };
  const setup = () => run(`(()=>{const panel=document.querySelector('[data-setup-panel]');return {
    present:!!panel,
    step:panel?panel.getAttribute('data-setup-step'):'',
    progress:(document.querySelector('[data-setup-progress]')||{}).textContent||'',
    panelText:panel?panel.innerText:'',
    hint:(document.querySelector('[data-setup-hint]')||{}).textContent||'',
    modes:[...document.querySelectorAll('[data-setup-mode-option]')].map(e=>e.getAttribute('data-setup-mode-option')),
    packs:[...document.querySelectorAll('[data-avatar-pack-option]')].map(e=>e.getAttribute('data-avatar-pack-option')),
    selected:[...document.querySelectorAll('[data-avatar-pack-option]')].filter(e=>e.getAttribute('aria-pressed')==='true').map(e=>e.getAttribute('data-avatar-pack-option')),
    canFinish:!!document.querySelector('[data-setup-complete]'),
    primary:(document.querySelector('[data-setup-next],[data-setup-complete]')||{}).textContent||'',
    homeTitle:(document.querySelector('.page-head h1')||{}).textContent||'',
    statusRows:document.querySelectorAll('.dual-status .person-status').length,
    navItems:[...document.querySelectorAll('.nav-item')].map(e=>e.textContent.trim()),
    bodyText:document.body.innerText,
    hasUndefined:/undefined/.test(document.body.innerText),
  };})()`);
  const view = async () => {
    const state = await run('window.dayhub.get()');
    const live = await run('window.dayhub.live()');
    const setupDom = await setup();
    return { state, live, setup: setupDom };
  };
  return { click, type, setup, view, run, pet };
}

async function waitForGone(driver) {
  for (let i = 0; i < 60; i++) {
    if (!(await driver.setup()).present) return true;
    await wait(200);
  }
  return false;
}

// ---------------------------------------------------------------------------
// 阶段：每条路径都是一个真实的首次启动
// ---------------------------------------------------------------------------
async function phaseSolo(driver, dataDir) {
  const fresh = await driver.view();
  check('fresh：settings.setup=false', fresh.state.settings.setup === false, String(fresh.state.settings.setup));
  check('fresh：显示 onboarding 第一步「关于你」', fresh.setup.present && fresh.setup.step === 'name' && normalized(fresh.setup.progress) === '1/3',
    JSON.stringify({ present: fresh.setup.present, step: fresh.setup.step, progress: fresh.setup.progress }));
  check('fresh：onboarding 文字里没有领域术语 / 私人与合成哨兵 / undefined',
    !FORBIDDEN_TERMS.some((term) => fresh.setup.panelText.includes(term)) && !SENTINELS.some((token) => fresh.setup.panelText.includes(token)),
    FORBIDDEN_TERMS.filter((term) => fresh.setup.panelText.includes(term)).concat(SENTINELS.filter((token) => fresh.setup.panelText.includes(token))).join(','));
  check('fresh：状态与投影里也没有私人与合成哨兵',
    !SENTINELS.some((token) => `${JSON.stringify(fresh.state)}${JSON.stringify(fresh.live)}`.includes(token)),
    SENTINELS.filter((token) => `${JSON.stringify(fresh.state)}${JSON.stringify(fresh.live)}`.includes(token)).join(','));
  check('fresh：背景首页仍是合法的 5A 空状态（1 个人 / 空数据）',
    fresh.setup.homeTitle === '我的安排' && fresh.setup.statusRows === 1
    && fresh.state.profiles.length === 1 && fresh.state.profiles[0].name === '我'
    && fresh.state.courses.length === 0 && fresh.state.tasks.length === 0,
    JSON.stringify({ title: fresh.setup.homeTitle, rows: fresh.setup.statusRows, profiles: fresh.state.profiles.length }));
  check('fresh：未完成前没有任何 setup 结果（默认形象 / 中性身份）',
    fresh.state.profiles[0].avatar.source === 'default' && fresh.state.profiles[0].name === '我'
    && (typeof fresh.state.profiles[0].shortAlias === 'undefined' || fresh.state.profiles[0].shortAlias === '我'),
    JSON.stringify({ avatar: fresh.state.profiles[0].avatar, alias: fresh.state.profiles[0].shortAlias, name: fresh.state.profiles[0].name }));
  const selfId = fresh.state.profiles[0].id;

  // —— 名称 validation 的真实界面路径 ——
  await driver.type('[data-setup-name-input="self"]', 'x'.repeat(60));
  await driver.click('[data-setup-next]');
  const tooLong = await driver.setup();
  check('名称超长：停在第一步并给出原因', tooLong.step === 'name' && tooLong.present && /最多 40/.test(tooLong.hint), JSON.stringify({ step: tooLong.step, hint: tooLong.hint }));
  await driver.type('[data-setup-name-input="self"]', '小宇');
  await driver.click('[data-setup-next]');

  // —— 使用方式：默认「只为自己」，不创建 companion ——
  const modeStep = await driver.setup();
  const soloChecked = await driver.run("(document.querySelector('[data-setup-mode-option=\"solo\"]')||{}).getAttribute&&document.querySelector('[data-setup-mode-option=\"solo\"]').getAttribute('aria-checked')");
  check('第二步：可选两种使用方式，默认选中「只为自己」',
    modeStep.step === 'mode' && modeStep.modes.join(',') === 'solo,together' && soloChecked === 'true' && normalized(modeStep.progress) === '2/3',
    JSON.stringify({ step: modeStep.step, modes: modeStep.modes, soloChecked, progress: modeStep.progress }));
  await driver.click('[data-setup-next]');
  const beforePick = await driver.view();
  check('第三步：Avatar 选择来自 Registry（不是写死名单）',
    beforePick.setup.step === 'avatar' && beforePick.setup.packs.length >= 2 && beforePick.setup.packs.includes('yd-default') && beforePick.setup.canFinish,
    JSON.stringify(beforePick.setup.packs));
  check('第三步：Solo 只问一个人的桌宠', beforePick.setup.packs.length === 2, JSON.stringify(beforePick.setup.packs));
  await driver.click('[data-avatar-pack-option="yd-pixel"]');
  const picked = await driver.setup();
  check('Avatar 卡片可选择（aria-pressed 跟随）', picked.selected.includes('yd-pixel') && !picked.selected.includes('yd-default'), JSON.stringify(picked.selected));

  await driver.click('[data-setup-complete]');
  const gone = await waitForGone(driver);
  const done = await driver.view();
  check('完成 Solo：onboarding 消失并进入 Home', gone && !done.setup.present && done.setup.homeTitle === '我的安排' && !done.setup.hasUndefined);
  check('完成 Solo：settings.setup=true', done.state.settings.setup === true);
  check('完成 Solo：本人 PersonId 不变（不重新创建身份）', done.state.profiles[0].id === selfId, `${selfId} → ${done.state.profiles[0].id}`);
  check('完成 Solo：名称与 Avatar 按要求写入（yd-pixel / source=user）',
    done.state.profiles[0].name === '小宇' && done.state.profiles[0].avatar.packId === 'yd-pixel' && done.state.profiles[0].avatar.source === 'user',
    JSON.stringify({ name: done.state.profiles[0].name, avatar: done.state.profiles[0].avatar }));
  check('完成 Solo：没有 companion，也没有 seed 课表 / 待办 / 会议 / 作息',
    done.state.profiles.length === 1 && !done.state.profiles.some((profile) => profile.role === 'companion')
    && done.state.courses.length === 0 && done.state.tasks.length === 0 && done.state.events.length === 0
    && (done.state.profiles[0].routine?.rules || []).length === 0,
    JSON.stringify({ profiles: done.state.profiles.length, courses: done.state.courses.length, tasks: done.state.tasks.length }));
  check('完成 Solo：CurrentState 仍由状态引擎决定（idle）', done.live.people.length === 1 && done.live.people[0].current.kind === 'idle', JSON.stringify(done.live.people[0].current));
  check('完成 Solo：桌宠代表本人', done.live.petInstance.subjectId === done.state.profiles[0].id, String(done.live.petInstance.subjectId));
  check('完成 Solo：显示代号跟随新名字派生（不需要用户填 shortAlias）',
    done.live.people[0].alias === '小', JSON.stringify({ alias: done.live.people[0].alias, shortAlias: done.state.profiles[0].shortAlias }));
  check('完成 Solo：DOM 首页只有一个状态行', done.setup.statusRows === 1 && !done.setup.navItems.some((label) => label.includes('的安排') && !label.includes('我的安排')), JSON.stringify(done.setup.navItems));
  fs.writeFileSync(path.join(dataDir, identityFile), JSON.stringify({
    id: done.state.profiles[0].id, name: done.state.profiles[0].name, avatar: done.state.profiles[0].avatar,
  }), 'utf8');
}

async function phaseSoloRestart(driver, dataDir) {
  const first = JSON.parse(fs.readFileSync(path.join(dataDir, identityFile), 'utf8'));
  const view = await driver.view();
  check('重开：onboarding 不再出现', !view.setup.present && view.state.settings.setup === true);
  check('重开：PersonId / 名称 / Avatar 全部保持', view.state.profiles[0].id === first.id
    && view.state.profiles[0].name === first.name
    && view.state.profiles[0].avatar.packId === first.avatar.packId
    && view.state.profiles[0].avatar.source === first.avatar.source,
    JSON.stringify({ id: view.state.profiles[0].id, name: view.state.profiles[0].name, avatar: view.state.profiles[0].avatar }));
  check('重开：仍然是 Solo，没有多出档案', view.state.profiles.length === 1, String(view.state.profiles.length));
  check('重开：CurrentState 仍然合法（idle）', view.live.people.length === 1 && view.live.people[0].current.kind === 'idle');
  check('重开：显示代号保持派生结果', view.live.people[0].alias === '小', JSON.stringify(view.live.people[0].alias));
  check('重开：首页正常且没有 undefined', view.setup.homeTitle === '我的安排' && !view.setup.hasUndefined, JSON.stringify(view.setup.homeTitle));
}

async function phaseTogether(driver, dataDir) {
  const fresh = await driver.view();
  const selfId = fresh.state.profiles[0].id;
  check('Together fresh：显示 onboarding', fresh.setup.present && fresh.state.settings.setup === false);
  await driver.type('[data-setup-name-input="self"]', '小宇');
  await driver.click('[data-setup-next]');
  await driver.click('[data-setup-mode-option="together"]');
  const chosen = await driver.setup();
  const togetherChecked = await driver.run("document.querySelector('[data-setup-mode-option=\"together\"]').getAttribute('aria-checked')");
  check('选择「我和另一位」后才要求填写 TA 的称呼',
    togetherChecked === 'true' && !!(await driver.run("!!document.querySelector('[data-setup-name-input=\"companion\"]')")),
    JSON.stringify({ step: chosen.step }));
  // 没填 TA 的称呼时不能继续（不允许 TA 作为最终正式姓名）。
  await driver.click('[data-setup-next]');
  const blocked = await driver.view();
  check('TA 名称为空时停在第二步并给出提示', blocked.setup.step === 'mode' && /请填写/.test(blocked.setup.hint) && blocked.state.profiles.length === 1,
    JSON.stringify({ step: blocked.setup.step, hint: blocked.setup.hint, profiles: blocked.state.profiles.length }));
  await driver.type('[data-setup-name-input="companion"]', '丹丹');
  await driver.click('[data-setup-next]');
  const step3 = await driver.setup();
  check('第三步：Together 同时提供两个人的桌宠', step3.step === 'avatar' && normalized(step3.progress) === '3/3'
    && !!(await driver.run("!!document.querySelector('[data-setup-avatar-person=\"companion\"]')")),
    JSON.stringify({ step: step3.step, progress: step3.progress }));
  // 返回上一步不丢 draft，也不在 Store 里产生任何东西。
  await driver.click('[data-setup-back]');
  const back = await driver.view();
  check('返回上一步：draft 保留且 Store 仍未写入',
    back.setup.step === 'mode' && back.state.profiles.length === 1 && back.state.settings.setup === false
    && (await driver.run("(document.querySelector('[data-setup-name-input=\"companion\"]')||{}).value")) === '丹丹',
    JSON.stringify({ step: back.setup.step, profiles: back.state.profiles.length }));
  await driver.click('[data-setup-next]');
  await driver.click('[data-setup-complete]');
  const gone = await waitForGone(driver);
  const done = await driver.view();
  const self = done.state.profiles.find((profile) => profile.role === 'self');
  const companion = done.state.profiles.find((profile) => profile.role === 'companion');
  check('完成 Together：onboarding 消失并进入 Home', gone && !done.setup.present && done.setup.homeTitle === '我的安排');
  check('完成 Together：恰好一个 self + 一个 companion，ID 互不相同',
    done.state.profiles.length === 2 && !!self && !!companion && self.id === selfId && companion.id !== selfId
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(companion.id),
    JSON.stringify(done.state.profiles.map((profile) => [profile.id, profile.role, profile.name])));
  check('完成 Together：双方名称来自用户输入（没有 TA / D 之类占位）',
    self.name === '小宇' && companion.name === '丹丹', JSON.stringify([self.name, companion.name]));
  check('完成 Together：没动过的默认卡片保持 source=default',
    self.avatar.packId === 'yd-default' && self.avatar.source === 'default'
    && companion.avatar.packId === 'yd-default' && companion.avatar.source === 'default',
    JSON.stringify([self.avatar, companion.avatar]));
  check('完成 Together：companion 是通用空状态（空作息 / 空课表 / 独立档案）',
    (companion.routine?.rules || []).length === 0 && done.state.courses.length === 0 && done.state.tasks.length === 0
    && Object.keys(companion).sort().join(',') === Object.keys(fresh.state.profiles[0]).sort().join(','),
    JSON.stringify({ rules: (companion.routine?.rules || []).length, courses: done.state.courses.length }));
  check('完成 Together：CurrentState 对两个人都仍然合法（idle）',
    done.live.people.length === 2 && done.live.people.every((person) => person.current.kind === 'idle'),
    JSON.stringify(done.live.people.map((person) => person.current.kind)));
  check('完成 Together：桌宠代表同行者', done.live.petInstance.subjectId === companion.id, String(done.live.petInstance.subjectId));
  check('完成 Together：导航出现 TA 的页面，状态行有两个',
    done.setup.navItems.includes('丹丹的安排') && done.setup.statusRows === 2, JSON.stringify(done.setup.navItems));
  check('完成 Together：界面没有 undefined', !done.setup.hasUndefined);
  fs.writeFileSync(path.join(dataDir, identityFile), JSON.stringify({
    self: self.id, companion: companion.id, profiles: done.state.profiles.length,
  }), 'utf8');
}

async function phaseTogetherRestart(driver, dataDir) {
  const first = JSON.parse(fs.readFileSync(path.join(dataDir, identityFile), 'utf8'));
  const view = await driver.view();
  const self = view.state.profiles.find((profile) => profile.role === 'self');
  const companion = view.state.profiles.find((profile) => profile.role === 'companion');
  check('Together 重开：onboarding 不再出现', !view.setup.present && view.state.settings.setup === true);
  check('Together 重开：两个身份都复用同一 PersonId',
    view.state.profiles.length === first.profiles && self?.id === first.self && companion?.id === first.companion,
    JSON.stringify(view.state.profiles.map((profile) => profile.id)));
  check('Together 重开：姓名 / 模式 / Avatar 不变',
    self?.name === '小宇' && companion?.name === '丹丹'
    && self?.avatar.packId === 'yd-default' && companion?.avatar.packId === 'yd-default');
  check('Together 重开：桌宠仍然代表同行者', view.live.petInstance.subjectId === companion?.id);
  check('Together 重开：导航与状态行保持双人', view.setup.navItems.includes('丹丹的安排') && view.setup.statusRows === 2);
}

async function phaseAbandon(driver, dataDir) {
  const fresh = await driver.view();
  const selfId = fresh.state.profiles[0].id;
  await driver.type('[data-setup-name-input="self"]', '小宇');
  await driver.click('[data-setup-next]');
  // Solo → Together → Solo：draft 反复切换，但不产生 ghost companion。
  await driver.click('[data-setup-mode-option="together"]');
  await driver.type('[data-setup-name-input="companion"]', '丹丹');
  await driver.click('[data-setup-mode-option="solo"]');
  const mid = await driver.setup();
  check('切换使用方式：仍然停在 onboarding，Store 里没有第二个人',
    mid.present && mid.step === 'mode' && !(await driver.run("!!document.querySelector('[data-setup-name-input=\"companion\"]')")),
    JSON.stringify({ step: mid.step }));
  const view = await driver.view();
  check('未完成关闭前：settings.setup 仍是 false，Profile 保持中立身份',
    view.state.settings.setup === false && view.state.profiles.length === 1 && view.state.profiles[0].id === selfId
    && view.state.profiles[0].name === '我' && view.state.profiles[0].avatar.source === 'default'
    && !view.state.profiles.some((profile) => profile.role === 'companion'),
    JSON.stringify({ setup: view.state.settings.setup, profiles: view.state.profiles.map((profile) => profile.name) }));
  fs.writeFileSync(path.join(dataDir, identityFile), JSON.stringify({ id: selfId }), 'utf8');
}

async function phaseAbandonRestart(driver, dataDir) {
  const first = JSON.parse(fs.readFileSync(path.join(dataDir, identityFile), 'utf8'));
  const view = await driver.view();
  check('未完成重开：onboarding 再次出现（第一步）',
    view.setup.present && view.setup.step === 'name' && normalized(view.setup.progress) === '1/3',
    JSON.stringify({ present: view.setup.present, step: view.setup.step }));
  check('未完成重开：没有 ghost companion，也没有保留的 draft',
    view.state.profiles.length === 1 && view.state.profiles[0].id === first.id && view.state.profiles[0].name === '我'
    && view.state.settings.setup === false
    && (await driver.run("(document.querySelector('[data-setup-name-input=\"self\"]')||{}).value")) === '',
    JSON.stringify({ profiles: view.state.profiles.map((profile) => profile.name), setup: view.state.settings.setup }));
  check('未完成重开：fresh state 仍然合法（CurrentState=idle，无业务数据）',
    view.live.people.length === 1 && view.live.people[0].current.kind === 'idle'
    && view.state.courses.length === 0 && view.state.tasks.length === 0);
}

const PHASES = {
  solo: phaseSolo, 'solo-restart': phaseSoloRestart,
  together: phaseTogether, 'together-restart': phaseTogetherRestart,
  abandon: phaseAbandon, 'abandon-restart': phaseAbandonRestart,
};
async function runPhase(kind, driver, dataDir) {
  const fn = PHASES[kind];
  if (!fn) throw new Error(`未知阶段：${kind}`);
  await fn(driver, dataDir);
}

// ---------------------------------------------------------------------------
// 源码级：Electron 子进程（每个阶段一次启动）
// ---------------------------------------------------------------------------
async function runSourcePhase(kind, dataDir) {
  const { app, BrowserWindow } = require('electron');
  const { configureIsolatedUserData } = require('./scripts/electron-test-profile.cjs');
  configureIsolatedUserData(`v051-${kind}`, dataDir);
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
      if (!panel || !dock) throw new Error('启动后没有渲染出主窗口与状态 Dock');
      await wait(900);
      const run = (code) => panel.webContents.executeJavaScript(code);
      const pet = (code) => dock.webContents.executeJavaScript(code);
      await runPhase(kind, domHelpers(run, pet), dataDir);
    } catch (error) {
      failures.push(`${kind} 阶段异常：${error && error.message ? error.message : error}`);
    } finally {
      clearTimeout(deadline);
      fs.writeFileSync(path.join(dataDir, `phase-${kind}.json`), JSON.stringify({ passed, failures }, null, 2));
      app.exit(failures.length ? 1 : 0);
    }
  });
}

function spawnSourcePhase(kind, dataDir) {
  const electron = require('electron');
  const result = spawnSync(electron, [__filename, `--phase=${kind}`, `--data=${dataDir}`], { cwd: root, stdio: 'inherit' });
  return result.status ?? 1;
}

// ---------------------------------------------------------------------------
// 打包版：真实 exe + CDP（每个阶段一次启动）
// ---------------------------------------------------------------------------
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
    await wait(1300);
    return await fn(domHelpers((code) => panel.eval(code), (code) => dock.eval(code)));
  } finally {
    for (const session of sessions) session.close();
    try { child.kill(); } catch { /* ignore */ }
    await wait(800);
    try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已退出 */ }
  }
}

async function runPackaged() {
  const soloDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-v051-packaged-solo-'));
  const togetherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-v051-packaged-together-'));
  console.log(`Phase 5B1 packaged clean-room · solo=${soloDir} · together=${togetherDir}`);
  await withPackagedApp(soloDir, (driver) => runPhase('solo', driver, soloDir));
  await withPackagedApp(soloDir, (driver) => runPhase('solo-restart', driver, soloDir));
  await withPackagedApp(togetherDir, (driver) => runPhase('together', driver, togetherDir));
  await withPackagedApp(togetherDir, (driver) => runPhase('together-restart', driver, togetherDir));
}

// ---------------------------------------------------------------------------
(async () => {
  if (phase) { await runSourcePhase(phase, dataArg); return; }
  if (packaged) {
    await runPackaged();
  } else {
    const soloDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-v051-solo-'));
    const togetherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-v051-together-'));
    const abandonDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-v051-abandon-'));
    console.log(`Phase 5B1 source clean-room · solo=${soloDir} · together=${togetherDir} · abandon=${abandonDir}`);
    check('每个清房目录都是全新的（没有任何 dayhub 数据）',
      [soloDir, togetherDir, abandonDir].every((dir) => !fs.existsSync(path.join(dir, 'dayhub.sqlite')) && fs.readdirSync(dir).length === 0));
    const plan = [
      ['solo', soloDir], ['solo-restart', soloDir],
      ['together', togetherDir], ['together-restart', togetherDir],
      ['abandon', abandonDir], ['abandon-restart', abandonDir],
    ];
    for (const [kind, dir] of plan) {
      const code = spawnSourcePhase(kind, dir);
      const file = path.join(dir, `phase-${kind}.json`);
      if (!fs.existsSync(file)) { failures.push(`${kind} 阶段没有产出报告（exit=${code}）`); break; }
      const report = JSON.parse(fs.readFileSync(file, 'utf8'));
      passed.push(...report.passed.map((name) => `${kind} · ${name}`));
      failures.push(...report.failures.map((name) => `${kind} · ${name}`));
      if (code !== 0) break;
    }
  }
  console.log(JSON.stringify({ mode: packaged ? 'packaged' : 'source', passed: passed.length, failed: failures.length, failures }, null, 2));
  process.exit(failures.length ? 1 : 0);
})().catch((error) => {
  console.error(String(error && error.stack || error));
  process.exit(1);
});
