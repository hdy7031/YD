// YD Phase 5B1 · First-Run Onboarding + 可选桌面桌宠（petEnabled / petSubjectRole）验证（clean-room）。
//
// 运行：
//   node verify-v051-onboarding.cjs              # 源码级：空 userData → 真实点击完成 onboarding
//   node verify-v051-onboarding.cjs --packaged   # 打包版：release/win-unpacked/YD.exe + CDP
//
// 它回答三个问题：
//   1) 一个从来没有 YD 数据的用户第一次打开，能不能用最少的步骤建立身份并进入正常 Home？
//   2) 不用桌宠时 YD 是否完整可用（不出现桌面悬浮物、不要求形象 / 主体 / 节奏）；
//   3) 用桌宠时，桌面桌宠代表谁 —— Person / Avatar / Pet Subject 三层是不是真的解耦。
// 因此：
//   * 每次都用 os.tmpdir() 下的全新目录，绝不读取开发者 / 真实用户 AppData；
//   * settings.setup === false 是显示 onboarding 的唯一条件（不靠姓名 / 档案数量猜）；
//   * Solo（不用桌宠 / 用桌宠）与 Together 各走完整真实点击路径，之后重启验证持久化；
//   * 最后一步：Solo 只出现一个形象区；Together 才出现"你的 / TA 的形象 + 桌宠代表谁"；
//   * 节奏引导只做引导：可以去设置补，也可以稍后再说，绝不替用户 seed 作息；
//   * 设置 → 桌面陪伴 可以关掉桌宠（立即隐藏、数据保留）再打开（主体与形象完整恢复）；
//   * 设置 → 桌面陪伴 → 桌宠表示 可以热切换，桌面桌宠同步换人换形象，不重启；
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
// 进度文案只用于人读（1 / 4）；断言时去掉空格，避免为了空格改动界面文案。
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
  const setup = () => run(`(()=>{const panel=document.querySelector('[data-setup-panel]');
    const attr=(selector,name)=>{const el=document.querySelector(selector);return el?el.getAttribute(name):''};
    const text=(selector)=>{const el=document.querySelector(selector);return el?el.textContent:''};
    return {
    present:!!panel,
    step:panel?panel.getAttribute('data-setup-step'):'',
    progress:text('[data-setup-progress]'),
    title:text('#setup-title'),
    panelText:panel?panel.innerText:'',
    hint:text('[data-setup-hint]'),
    modes:[...document.querySelectorAll('[data-setup-mode-option]')].map(e=>e.getAttribute('data-setup-mode-option')),
    modeChecked:attr('[data-setup-mode-option][aria-checked="true"]','data-setup-mode-option'),
    petOptions:[...document.querySelectorAll('[data-setup-pet-option]')].map(e=>e.getAttribute('data-setup-pet-option')),
    petChecked:attr('[data-setup-pet-option][aria-checked="true"]','data-setup-pet-option'),
    avatarGroups:[...document.querySelectorAll('[data-setup-avatar-person]')].map(e=>e.getAttribute('data-setup-avatar-person')),
    packs:[...document.querySelectorAll('[data-avatar-pack-option]')].map(e=>e.getAttribute('data-avatar-pack-option')),
    selected:[...document.querySelectorAll('[data-avatar-pack-option]')].filter(e=>e.getAttribute('aria-pressed')==='true').map(e=>e.getAttribute('data-avatar-pack-option')),
    hasSubject:!!document.querySelector('[data-setup-subject]'),
    subjectOptions:[...document.querySelectorAll('[data-setup-subject-option]')].map(e=>e.getAttribute('data-setup-subject-option')),
    subjectChecked:attr('[data-setup-subject-option][aria-checked="true"]','data-setup-subject-option'),
    canFinish:!!document.querySelector('[data-setup-routine-now]'),
    canSkip:!!document.querySelector('[data-setup-routine-later]'),
    routineNow:text('[data-setup-routine-now]'),
    primary:text('[data-setup-next]')||text('[data-setup-routine-now]'),
    homeTitle:text('.page-head h1'),
    activeTab:[...document.querySelectorAll('.nav-item')].find(e=>e.getAttribute('aria-current')==='page')?.textContent?.trim()||'',
    settingsSection:[...document.querySelectorAll('.settings-nav button')].find(e=>e.classList.contains('active'))?.textContent?.trim()||'',
    avatarTitles:[...document.querySelectorAll('.avatar-person-picker h4')].map(e=>e.textContent.trim()),
    subjectSetting:[...document.querySelectorAll('[data-pet-subject-option]')].map(e=>e.getAttribute('data-pet-subject-option')),
    subjectSettingChecked:attr('[data-pet-subject-option][aria-checked="true"]','data-pet-subject-option'),
    petToggle:!!document.querySelector('[data-pet-enabled]'),
    petToggleChecked:!!(document.querySelector('[data-pet-enabled]')||{}).checked,
    routinePerson:attr('[data-routine-person][aria-checked="true"]','data-routine-person'),
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

/** 桌宠窗口当前渲染的 Pack —— 证明"桌面上的形象"真的跟着主体换，而不是只有 State 变了。 */
async function waitForDockPack(driver, packId, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  let seen = '';
  while (Date.now() < deadline) {
    seen = await driver.pet("(()=>{const el=document.querySelector('.companion-figure');return el&&el.dataset?el.dataset.avatarPack||'':'';})()");
    if (seen === packId) return true;
    await wait(150);
  }
  return seen === packId;
}

/** 打开"设置 → 角色与陪伴"（桌面陪伴分区）。 */
async function openCompanionshipSettings(driver) {
  await driver.run("(()=>{const btn=[...document.querySelectorAll('.settings-nav button')].find(b=>b.textContent.trim()==='角色与陪伴');if(!btn)return 'missing';btn.click();return 'ok';})()");
  await wait(220);
}

// ---------------------------------------------------------------------------
// 阶段：每条路径都是一个真实的首次启动
// ---------------------------------------------------------------------------
/** Solo + 不用桌宠：三步完成，桌宠窗口始终不出现。 */
async function phaseSoloOff(driver, dataDir) {
  const fresh = await driver.view();
  check('fresh：settings.setup=false', fresh.state.settings.setup === false, String(fresh.state.settings.setup));
  check('fresh：显示 onboarding 第一步「关于你」', fresh.setup.present && fresh.setup.step === 'name' && normalized(fresh.setup.progress) === '1/3',
    JSON.stringify({ present: fresh.setup.present, step: fresh.setup.step, progress: fresh.setup.progress }));
  check('fresh：桌面桌宠默认关闭（petEnabled=false）', fresh.state.settings.petEnabled === false, String(fresh.state.settings.petEnabled));
  check('fresh：桌宠窗口没有出现在桌面上', driver.orbVisible ? driver.orbVisible() === false : true, String(driver.orbVisible ? driver.orbVisible() : 'n/a'));
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
  check('fresh：未完成前没有任何 setup 结果（默认形象 / 中性身份 / 桌宠关闭）',
    fresh.state.profiles[0].avatar.source === 'default' && fresh.state.profiles[0].name === '我'
    && fresh.state.settings.petSubjectRole === 'self'
    && (typeof fresh.state.profiles[0].shortAlias === 'undefined' || fresh.state.profiles[0].shortAlias === '我'),
    JSON.stringify({ avatar: fresh.state.profiles[0].avatar, subject: fresh.state.settings.petSubjectRole, name: fresh.state.profiles[0].name }));
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
  check('第二步：可选两种使用方式，默认选中「只为自己」',
    modeStep.step === 'mode' && modeStep.modes.join(',') === 'solo,together' && modeStep.modeChecked === 'solo' && normalized(modeStep.progress) === '2/3',
    JSON.stringify({ step: modeStep.step, modes: modeStep.modes, checked: modeStep.modeChecked, progress: modeStep.progress }));
  await driver.click('[data-setup-next]');

  // —— 第三步：桌面陪伴（可选能力，默认「暂时不用」） ——
  const petStep = await driver.setup();
  check('第三步：询问是否使用桌面桌宠，默认「暂时不用」',
    petStep.step === 'pet' && petStep.petOptions.join(',') === 'on,off' && petStep.petChecked === 'off' && normalized(petStep.progress) === '3/3',
    JSON.stringify({ step: petStep.step, options: petStep.petOptions, checked: petStep.petChecked }));
  check('第三步：不出现形象 / 主体 / 节奏这些只在用桌宠时才需要的配置',
    petStep.packs.length === 0 && !petStep.hasSubject && !petStep.canFinish && !petStep.canSkip,
    JSON.stringify({ packs: petStep.packs, hasSubject: petStep.hasSubject }));
  await driver.click('[data-setup-complete]');

  const gone = await waitForGone(driver);
  const done = await driver.view();
  check('完成 Solo（不用桌宠）：onboarding 消失并进入 Home', gone && !done.setup.present && done.setup.homeTitle === '我的安排' && !done.setup.hasUndefined);
  check('完成 Solo：settings.setup=true', done.state.settings.setup === true);
  check('完成 Solo：settings.petEnabled=false', done.state.settings.petEnabled === false, String(done.state.settings.petEnabled));
  check('完成 Solo：桌宠窗口始终没有出现', driver.orbVisible ? driver.orbVisible() === false : true, String(driver.orbVisible ? driver.orbVisible() : 'n/a'));
  check('完成 Solo：本人 PersonId 不变（不重新创建身份）', done.state.profiles[0].id === selfId, `${selfId} → ${done.state.profiles[0].id}`);
  check('完成 Solo：名称写入，形象保持合法默认（用户没有选择桌宠形象）',
    done.state.profiles[0].name === '小宇' && done.state.profiles[0].avatar.packId === 'yd-default' && done.state.profiles[0].avatar.source === 'default',
    JSON.stringify({ name: done.state.profiles[0].name, avatar: done.state.profiles[0].avatar }));
  check('完成 Solo：没有 companion，也没有 seed 课表 / 待办 / 会议 / 作息',
    done.state.profiles.length === 1 && !done.state.profiles.some((profile) => profile.role === 'companion')
    && done.state.courses.length === 0 && done.state.tasks.length === 0 && done.state.events.length === 0
    && (done.state.profiles[0].routine?.rules || []).length === 0,
    JSON.stringify({ profiles: done.state.profiles.length, courses: done.state.courses.length, tasks: done.state.tasks.length }));
  check('完成 Solo：桌宠主体偏好是本人', done.state.settings.petSubjectRole === 'self', String(done.state.settings.petSubjectRole));
  check('完成 Solo：CurrentState 仍由状态引擎决定（idle）', done.live.people.length === 1 && done.live.people[0].current.kind === 'idle', JSON.stringify(done.live.people[0].current));
  // Phase 5B2 细化了派生规则：「小 / 老 / 阿」这类称呼前缀不算身份信息，短代号取后面的字素。
  check('完成 Solo：显示代号跟随新名字派生（不需要用户填 shortAlias）',
    done.live.people[0].alias === '宇', JSON.stringify({ alias: done.live.people[0].alias, shortAlias: done.state.profiles[0].shortAlias }));
  check('完成 Solo：DOM 首页只有一个状态行', done.setup.statusRows === 1 && !done.setup.navItems.some((label) => label.includes('的安排') && !label.includes('我的安排')), JSON.stringify(done.setup.navItems));
  fs.writeFileSync(path.join(dataDir, identityFile), JSON.stringify({
    id: done.state.profiles[0].id, name: done.state.profiles[0].name, avatar: done.state.profiles[0].avatar,
    petEnabled: done.state.settings.petEnabled,
  }), 'utf8');
}

/** Solo + 使用桌宠：四步完成（形象与节奏引导都在最后一步）。 */
async function phaseSoloOn(driver, dataDir) {
  const fresh = await driver.view();
  const selfId = fresh.state.profiles[0].id;
  check('Solo+桌宠 fresh：桌宠关闭且窗口未出现',
    fresh.state.settings.petEnabled === false && (!driver.orbVisible || driver.orbVisible() === false),
    JSON.stringify({ enabled: fresh.state.settings.petEnabled }));
  await driver.type('[data-setup-name-input="self"]', '小宇');
  await driver.click('[data-setup-next]');
  await driver.click('[data-setup-next]');   // 使用方式：保持默认「只为自己」
  const petStep = await driver.setup();
  check('Solo+桌宠：第三步默认仍是「暂时不用」', petStep.step === 'pet' && petStep.petChecked === 'off', JSON.stringify({ checked: petStep.petChecked }));
  await driver.click('[data-setup-pet-option="on"]');
  const picked = await driver.setup();
  check('Solo+桌宠：选择「使用桌宠」后步骤变成四步',
    picked.petChecked === 'on' && normalized(picked.progress) === '3/4', JSON.stringify({ checked: picked.petChecked, progress: picked.progress }));
  await driver.click('[data-setup-next]');
  const last = await driver.setup();
  check('第四步（Solo+桌宠）：只有一个形象区 + 节奏引导，不问桌宠代表谁',
    last.step === 'pet-setup' && last.avatarGroups.join(',') === 'self' && !last.hasSubject
    && last.packs.length >= 2 && last.packs.includes('yd-default') && normalized(last.progress) === '4/4',
    JSON.stringify({ step: last.step, groups: last.avatarGroups, packs: last.packs, hasSubject: last.hasSubject }));
  check('第四步：节奏引导指向本人（不出现 Routine / 规则 / StateEngine）',
    /让你的状态更准确/.test(last.panelText) && /补充你的睡眠/.test(last.panelText) && !/Routine|规则|StateEngine/.test(last.panelText),
    last.panelText.slice(0, 90));
  await driver.click('[data-avatar-pack-option="yd-pixel"]');
  check('第四步：形象卡片可选择（Registry 驱动）', (await driver.setup()).selected.includes('yd-pixel'));
  await driver.click('[data-setup-routine-later]');
  const gone = await waitForGone(driver);
  const done = await driver.view();
  check('完成 Solo+桌宠（稍后再说）：onboarding 消失并进入 Home',
    gone && !done.setup.present && done.setup.homeTitle === '我的安排');
  check('完成 Solo+桌宠：petEnabled=true，主体是本人',
    done.state.settings.petEnabled === true && done.state.settings.petSubjectRole === 'self',
    JSON.stringify({ enabled: done.state.settings.petEnabled, subject: done.state.settings.petSubjectRole }));
  check('完成 Solo+桌宠：形象写入 yd-pixel / source=user',
    done.state.profiles[0].avatar.packId === 'yd-pixel' && done.state.profiles[0].avatar.source === 'user',
    JSON.stringify(done.state.profiles[0].avatar));
  check('完成 Solo+桌宠：桌宠窗口出现，桌面渲染的是 yd-pixel',
    (!driver.orbVisible || driver.orbVisible() === true) && await waitForDockPack(driver, 'yd-pixel'));
  check('完成 Solo+桌宠：桌宠 = 本人的状态 + 本人的形象',
    done.live.petInstance.subjectId === selfId && done.live.petInstance.avatarPackId === 'yd-pixel',
    JSON.stringify(done.live.petInstance));
  check('完成 Solo+桌宠：没有 seed 作息（稍后再说就是稍后再说）',
    (done.state.profiles[0].routine?.rules || []).length === 0);
  fs.writeFileSync(path.join(dataDir, identityFile), JSON.stringify({
    id: done.state.profiles[0].id, name: done.state.profiles[0].name, avatar: done.state.profiles[0].avatar,
    petEnabled: done.state.settings.petEnabled,
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
  check('重开：桌宠开关保持（没选桌宠就不会出现）',
    view.state.settings.petEnabled === first.petEnabled && (!driver.orbVisible || driver.orbVisible() === Boolean(first.petEnabled)),
    JSON.stringify({ enabled: view.state.settings.petEnabled, was: first.petEnabled }));
  check('重开：主体偏好与形象保持', view.state.settings.petSubjectRole === 'self'
    && view.live.petInstance.subjectId === view.state.profiles[0].id
    && view.live.petInstance.avatarPackId === first.avatar.packId,
    JSON.stringify({ subject: view.state.settings.petSubjectRole, avatar: view.state.profiles[0].avatar }));
  check('重开：CurrentState 仍然合法（idle）', view.live.people.length === 1 && view.live.people[0].current.kind === 'idle');
  check('重开：显示代号保持派生结果', view.live.people[0].alias === '宇', JSON.stringify(view.live.people[0].alias));
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
  check('选择「我和另一位」后才要求填写 TA 的称呼',
    chosen.modeChecked === 'together' && !!(await driver.run("!!document.querySelector('[data-setup-name-input=\"companion\"]')")),
    JSON.stringify({ step: chosen.step }));
  // 没填 TA 的称呼时不能继续（不允许 TA 作为最终正式姓名）。
  await driver.click('[data-setup-next]');
  const blocked = await driver.view();
  check('TA 名称为空时停在第二步并给出提示', blocked.setup.step === 'mode' && /请填写/.test(blocked.setup.hint) && blocked.state.profiles.length === 1,
    JSON.stringify({ step: blocked.setup.step, hint: blocked.setup.hint, profiles: blocked.state.profiles.length }));
  await driver.type('[data-setup-name-input="companion"]', '丹丹');
  await driver.click('[data-setup-next]');

  // —— 第三步：桌面陪伴（可选能力） ——
  const petStep = await driver.setup();
  check('第三步（Together）：先问是否使用桌面桌宠，默认「暂时不用」',
    petStep.step === 'pet' && petStep.petOptions.join(',') === 'on,off' && petStep.petChecked === 'off' && normalized(petStep.progress) === '3/3',
    JSON.stringify({ step: petStep.step, options: petStep.petOptions, checked: petStep.petChecked, progress: petStep.progress }));
  await driver.click('[data-setup-pet-option="on"]');
  check('选择「使用桌宠」后步骤变成四步（形象 / 主体 / 节奏才出现）',
    normalized((await driver.setup()).progress) === '3/4');
  await driver.click('[data-setup-next]');

  // —— 第四步（Together）：两个人的形象 + 桌宠代表谁 + 节奏引导 ——
  const step3 = await driver.setup();
  check('第四步（Together）：同时提供两个人的形象区',
    step3.step === 'pet-setup' && step3.avatarGroups.join(',') === 'self,companion' && normalized(step3.progress) === '4/4',
    JSON.stringify({ step: step3.step, groups: step3.avatarGroups, progress: step3.progress }));
  check('第四步（Together）：两个形象区各自有完整的 Registry 卡片（两边可以选择同一个 Pack）',
    step3.packs.length === 4
    && (await driver.run("document.querySelectorAll('[data-setup-avatar-person=\"self\"] [data-avatar-pack-option]').length")) === 2
    && (await driver.run("document.querySelectorAll('[data-setup-avatar-person=\"companion\"] [data-avatar-pack-option]').length")) === 2,
    JSON.stringify(step3.packs));
  check('第四步（Together）：明确给出「桌面桌宠代表谁」，默认是 TA',
    step3.hasSubject && step3.subjectOptions.join(',') === 'self,companion' && step3.subjectChecked === 'companion',
    JSON.stringify({ hasSubject: step3.hasSubject, options: step3.subjectOptions, checked: step3.subjectChecked }));
  check('第四步（Together）：说明桌宠 = 这个人的形象 + 这个人的状态',
    /桌宠会使用这个人的形象/.test(step3.panelText) && /跟随这个人的状态变化/.test(step3.panelText),
    step3.panelText.slice(0, 80));
  // 两个人分别选形象：本人 yd-pixel、TA 不动（保持默认 yd-default）。
  await driver.click('[data-setup-avatar-person="self"] [data-avatar-pack-option="yd-pixel"]');
  const pickedBoth = await driver.setup();
  check('第四步：两个人的形象互不影响',
    pickedBoth.selected.length === 2 && pickedBoth.selected.includes('yd-pixel') && pickedBoth.selected.includes('yd-default'),
    JSON.stringify(pickedBoth.selected));
  // 返回上一步不丢 draft，也不在 Store 里产生任何东西。
  await driver.click('[data-setup-back]');
  const back = await driver.view();
  check('返回上一步：draft 保留且 Store 仍未写入',
    back.setup.step === 'pet' && back.state.profiles.length === 1 && back.state.settings.setup === false
    && back.state.settings.petEnabled === false,
    JSON.stringify({ step: back.setup.step, profiles: back.state.profiles.length }));
  await driver.click('[data-setup-back]');
  const backAgain = await driver.setup();
  check('连退两步：TA 的名称仍然是 draft 里的值（没有清空）',
    backAgain.step === 'mode'
    && (await driver.run("(document.querySelector('[data-setup-name-input=\"companion\"]')||{}).value")) === '丹丹',
    JSON.stringify({ step: backAgain.step }));
  await driver.click('[data-setup-next]');
  await driver.click('[data-setup-next]');

  // —— 第四步的节奏引导：对象是当前主体（TA） ——
  const step4 = await driver.setup();
  check('第四步：节奏引导跟随当前桌宠主体（TA）',
    step4.step === 'pet-setup' && /让 丹丹 的状态更准确/.test(step4.panelText)
    && /补充 丹丹 的睡眠/.test(step4.panelText)
    && /现在设置 丹丹 的日常节奏/.test(step4.routineNow),
    JSON.stringify({ title: step4.title, now: step4.routineNow }));
  check('第四步：不复制 Routine 编辑器（只有去设置 / 稍后再说两个动作）',
    step4.canFinish && step4.canSkip && !(await driver.run("!!document.querySelector('[data-routine-action]')")),
    JSON.stringify({ canFinish: step4.canFinish, canSkip: step4.canSkip }));
  await driver.click('[data-setup-routine-now]');

  const gone = await waitForGone(driver);
  const done = await driver.view();
  const self = done.state.profiles.find((profile) => profile.role === 'self');
  const companion = done.state.profiles.find((profile) => profile.role === 'companion');
  check('完成 Together（现在设置节奏）：onboarding 消失', gone && !done.setup.present);
  check('完成 Together：直接落到「设置 → 节奏与状态」', done.setup.activeTab === '设置与备份' && done.setup.settingsSection === '节奏与状态',
    JSON.stringify({ tab: done.setup.activeTab, section: done.setup.settingsSection }));
  check('完成 Together：节奏编辑聚焦当前桌宠主体（TA）', done.setup.routinePerson === companion?.id,
    JSON.stringify({ focused: done.setup.routinePerson, companion: companion?.id }));
  check('完成 Together：恰好一个 self + 一个 companion，ID 互不相同',
    done.state.profiles.length === 2 && !!self && !!companion && self.id === selfId && companion.id !== selfId
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(companion.id),
    JSON.stringify(done.state.profiles.map((profile) => [profile.id, profile.role, profile.name])));
  check('完成 Together：双方名称来自用户输入（没有 TA / D 之类占位）',
    self.name === '小宇' && companion.name === '丹丹', JSON.stringify([self.name, companion.name]));
  check('完成 Together：形象按人独立（本人 yd-pixel/user，TA 未动过默认/yd-default）',
    self.avatar.packId === 'yd-pixel' && self.avatar.source === 'user'
    && companion.avatar.packId === 'yd-default' && companion.avatar.source === 'default',
    JSON.stringify([self.avatar, companion.avatar]));
  check('完成 Together：companion 是通用空状态（空作息 / 空课表 / 独立档案）',
    (companion.routine?.rules || []).length === 0 && done.state.courses.length === 0 && done.state.tasks.length === 0
    && Object.keys(companion).sort().join(',') === Object.keys(fresh.state.profiles[0]).sort().join(','),
    JSON.stringify({ rules: (companion.routine?.rules || []).length, courses: done.state.courses.length }));
  check('完成 Together：没有 seed 任何人的作息', done.state.profiles.every((profile) => (profile.routine?.rules || []).length === 0));
  check('完成 Together：CurrentState 对两个人都仍然合法（idle）',
    done.live.people.length === 2 && done.live.people.every((person) => person.current.kind === 'idle'),
    JSON.stringify(done.live.people.map((person) => person.current.kind)));
  check('完成 Together：桌宠主体偏好是 companion', done.state.settings.petSubjectRole === 'companion', String(done.state.settings.petSubjectRole));
  check('完成 Together：桌宠 = TA 的状态 + TA 的形象（不是本人的 yd-pixel）',
    done.live.petInstance.subjectId === companion.id && done.live.petInstance.avatarPackId === 'yd-default',
    JSON.stringify(done.live.petInstance));
  check('完成 Together：桌面桌宠实际渲染 TA 的形象', await waitForDockPack(driver, 'yd-default'));
  check('完成 Together：界面没有 undefined', !done.setup.hasUndefined);

  // —— 长期设置：设置 → 桌面陪伴 → 开关 + 桌宠表示（无需重启） ——
  await openCompanionshipSettings(driver);
  const settingsView = await driver.setup();
  check('设置 → 桌面陪伴：桌宠开关处于打开状态',
    settingsView.petToggle && settingsView.petToggleChecked === true,
    JSON.stringify({ hasToggle: settingsView.petToggle, checked: settingsView.petToggleChecked }));
  check('设置 → 桌面陪伴：桌宠表示给出「我 / TA」，当前是 TA',
    settingsView.subjectSetting.join(',') === 'self,companion' && settingsView.subjectSettingChecked === 'companion',
    JSON.stringify({ options: settingsView.subjectSetting, checked: settingsView.subjectSettingChecked }));
  check('设置 → 桌面陪伴：形象仍然按人分组（我的形象 / TA 的形象），不是"当前桌宠形象"',
    settingsView.avatarTitles.join(',') === '我的形象,丹丹的形象', JSON.stringify(settingsView.avatarTitles));
  const beforeSwitch = await driver.view();
  // —— 关掉桌宠：立即隐藏，数据保留 ——
  await driver.click('[data-pet-enabled]');
  await wait(600);
  const disabled = await driver.view();
  check('关掉桌宠：petEnabled=false，桌宠窗口立即隐藏',
    disabled.state.settings.petEnabled === false && (!driver.orbVisible || driver.orbVisible() === false),
    JSON.stringify({ enabled: disabled.state.settings.petEnabled, visible: driver.orbVisible ? driver.orbVisible() : 'n/a' }));
  check('关掉桌宠：不删除任何档案 / 形象 / 作息',
    JSON.stringify(disabled.state.profiles) === JSON.stringify(done.state.profiles)
    && JSON.stringify(disabled.state.settings.petSubjectRole) === JSON.stringify(done.state.settings.petSubjectRole),
    JSON.stringify({ profiles: disabled.state.profiles.length, subject: disabled.state.settings.petSubjectRole }));
  check('关掉桌宠：只隐藏呈现，CurrentState 照常',
    disabled.live.people.length === 2 && disabled.live.people.every((person) => person.current.kind === 'idle'));
  check('关掉桌宠：不再显示「桌宠表示」（无意义的配置项）',
    (await driver.setup()).subjectSetting.length === 0 && (await driver.setup()).petToggleChecked === false);
  // —— 重新打开：恢复此前的形象与主体 ——
  await driver.click('[data-pet-enabled]');
  await wait(700);
  const enabled = await driver.view();
  check('重新打开桌宠：petEnabled=true，桌宠窗口恢复',
    enabled.state.settings.petEnabled === true && (!driver.orbVisible || driver.orbVisible() === true),
    JSON.stringify({ enabled: enabled.state.settings.petEnabled, visible: driver.orbVisible ? driver.orbVisible() : 'n/a' }));
  check('重新打开桌宠：主体与形象完整恢复（没有 reset）',
    enabled.live.petInstance.subjectId === companion.id && enabled.live.petInstance.avatarPackId === 'yd-default'
    && await waitForDockPack(driver, 'yd-default'),
    JSON.stringify(enabled.live.petInstance));
  check('重新打开桌宠：桌宠表示重新出现且仍是我 / TA', 
    (await driver.setup()).subjectSetting.join(',') === 'self,companion');
  // —— 主体热切换（无需重启） ——
  await openCompanionshipSettings(driver);
  await driver.click('[data-pet-subject-option="self"]');
  const toSelf = await driver.view();
  check('热切换 TA → 我：无需重启，主体与形象立刻变成本人',
    toSelf.live.petInstance.subjectId === selfId && toSelf.live.petInstance.avatarPackId === 'yd-pixel',
    JSON.stringify(toSelf.live.petInstance));
  check('热切换 TA → 我：桌面桌宠真的换成本人的形象', await waitForDockPack(driver, 'yd-pixel'));
  check('热切换 TA → 我：两个人的 CurrentState 都没有被改写',
    JSON.stringify(toSelf.live.people.map((person) => person.current))
    === JSON.stringify(beforeSwitch.live.people.map((person) => person.current)),
    JSON.stringify(toSelf.live.people.map((person) => person.current.kind)));
  await openCompanionshipSettings(driver);
  await driver.click('[data-pet-subject-option="companion"]');
  const toCompanion = await driver.view();
  check('热切换 我 → TA：主体、形象与桌面渲染都回到同行者',
    toCompanion.live.petInstance.subjectId === companion.id && toCompanion.live.petInstance.avatarPackId === 'yd-default'
    && await waitForDockPack(driver, 'yd-default'),
    JSON.stringify(toCompanion.live.petInstance));
  check('热切换不改写任何 Person 或业务集合',
    JSON.stringify(toCompanion.state.profiles) === JSON.stringify(done.state.profiles)
    && JSON.stringify(toCompanion.state.courses) === JSON.stringify(done.state.courses));
  check('完成 Together：导航出现 TA 的页面', toCompanion.setup.navItems.includes('丹丹的安排'), JSON.stringify(toCompanion.setup.navItems));
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
  check('Together 重开：姓名 / 模式 / 各自形象不变',
    self?.name === '小宇' && companion?.name === '丹丹'
    && self?.avatar.packId === 'yd-pixel' && self?.avatar.source === 'user'
    && companion?.avatar.packId === 'yd-default' && companion?.avatar.source === 'default',
    JSON.stringify([self?.avatar, companion?.avatar]));
  check('Together 重开：桌宠主体偏好保持 companion（热切换结果落盘）', view.state.settings.petSubjectRole === 'companion');
  check('Together 重开：桌宠仍然代表同行者，用的是 TA 的形象',
    view.live.petInstance.subjectId === companion?.id && view.live.petInstance.avatarPackId === 'yd-default');
  check('Together 重开：导航与状态行保持双人', view.setup.navItems.includes('丹丹的安排') && view.setup.statusRows === 2);
}

/** Solo → Together → 选主体 → 回 Solo → 完成：不产生 ghost companion，主体不残留。 */
async function phaseToggle(driver, dataDir) {
  const fresh = await driver.view();
  const selfId = fresh.state.profiles[0].id;
  await driver.type('[data-setup-name-input="self"]', '小宇');
  await driver.click('[data-setup-next]');
  await driver.click('[data-setup-mode-option="together"]');
  await driver.type('[data-setup-name-input="companion"]', '丹丹');
  await driver.click('[data-setup-next]');
  await driver.click('[data-setup-pet-option="on"]');
  await driver.click('[data-setup-next]');
  const togetherStep = await driver.setup();
  check('draft 切到双人：第四步出现主体选择', togetherStep.step === 'pet-setup' && togetherStep.hasSubject, JSON.stringify({ step: togetherStep.step }));
  await driver.click('[data-setup-subject-option="companion"]');
  check('draft 选择 TA 作为主体', (await driver.setup()).subjectChecked === 'companion');
  await driver.click('[data-setup-back]');   // pet-setup → pet
  await driver.click('[data-setup-back]');   // pet → mode
  await driver.click('[data-setup-mode-option="solo"]');
  await driver.click('[data-setup-next]');
  const backToSolo = await driver.setup();
  check('回退到「只为自己」：桌面陪伴步骤仍然是用户选过的「使用桌宠」',
    backToSolo.step === 'pet' && backToSolo.petChecked === 'on', JSON.stringify({ step: backToSolo.step, checked: backToSolo.petChecked }));
  await driver.click('[data-setup-next]');
  const soloShape = await driver.setup();
  check('回退到「只为自己」：不再有 TA 的形象区，也没有主体选择',
    soloShape.step === 'pet-setup' && soloShape.avatarGroups.join(',') === 'self' && !soloShape.hasSubject,
    JSON.stringify({ step: soloShape.step, groups: soloShape.avatarGroups, hasSubject: soloShape.hasSubject }));
  await driver.click('[data-setup-routine-later]');
  const gone = await waitForGone(driver);
  const done = await driver.view();
  check('切换回 Solo 后完成：不产生 ghost companion', gone && done.state.profiles.length === 1
    && !done.state.profiles.some((profile) => profile.role === 'companion'),
    JSON.stringify(done.state.profiles.map((profile) => profile.role)));
  check('切换回 Solo 后完成：主体被强制为本人（不残留 draft 里的 companion）',
    done.state.settings.petSubjectRole === 'self', String(done.state.settings.petSubjectRole));
  check('切换回 Solo 后完成：本人身份没有被重建', done.state.profiles[0].id === selfId && done.state.profiles[0].name === '小宇');
  check('切换回 Solo 后完成：桌宠代表本人，窗口出现',
    done.live.petInstance.subjectId === selfId && done.live.people.length === 1
    && (!driver.orbVisible || driver.orbVisible() === true));
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

/**
 * 老用户升级（打包清房用）：把 v3 双人 fixture 复制进隔离 userData 后启动。
 * 断言"升级不会把已经存在的桌宠弄没"：petEnabled=true、主体仍是同行者、
 * 桌面桌宠仍然用 TA 的形象；同时不能重新进入 onboarding。
 */
async function phaseLegacyMigration(driver, dataDir) {
  const view = await driver.view();
  const self = view.state.profiles.find((profile) => profile.role === 'self');
  const companion = view.state.profiles.find((profile) => profile.role === 'companion');
  check('老库升级：不重新进入 onboarding（setup=true → 直接 Home）',
    !view.setup.present && view.state.settings.setup === true && view.setup.homeTitle === '我的安排',
    JSON.stringify({ setup: view.state.settings.setup, title: view.setup.homeTitle }));
  check('老库升级：DOMAIN_VERSION = 7', view.state.settings.domainVersion === 7, String(view.state.settings.domainVersion));
  check('老库升级：桌宠仍然启用（不会因为升级突然消失）',
    view.state.settings.petEnabled === true, String(view.state.settings.petEnabled));
  check('老库升级：桌宠主体仍是同行者', view.state.settings.petSubjectRole === 'companion', String(view.state.settings.petSubjectRole));
  check('老库升级：桌面桌宠仍然代表 TA，并用 TA 的形象',
    view.live.petInstance.subjectId === companion?.id && view.live.petInstance.avatarPackId === companion?.avatar?.packId,
    JSON.stringify({ instance: view.live.petInstance, companion: companion?.id }));
  check('老库升级：双方档案与状态照常投影',
    !!self && !!companion && view.live.people.length === 2, String(view.live.people.length));
  check('老库升级：界面没有 undefined', !view.setup.hasUndefined);
}

const PHASES = {
  'solo-off': phaseSoloOff, 'solo-on': phaseSoloOn, 'solo-restart': phaseSoloRestart,
  together: phaseTogether, 'together-restart': phaseTogetherRestart,
  toggle: phaseToggle,
  abandon: phaseAbandon, 'abandon-restart': phaseAbandonRestart,
  legacy: phaseLegacyMigration,
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
  const deadline = setTimeout(() => { fs.writeFileSync(path.join(dataDir, `failure-${kind}.txt`), 'timeout'); app.exit(1); }, 180000);
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
      const driver = domHelpers(run, pet);
      // 桌宠窗口的真实可见性（只有源码级能读；打包版退化为只读渲染层状态）。
      driver.orbVisible = () => dock.isVisible();
      await runPhase(kind, driver, dataDir);
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
  const soloOffDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-v051-packaged-solo-off-'));
  const soloOnDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-v051-packaged-solo-on-'));
  const togetherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-v051-packaged-together-'));
  // 老库升级：把 v3 双人 fixture 复制进隔离 userData，启动后必须仍然保留桌宠。
  const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-v051-packaged-legacy-'));
  require('./scripts/electron-test-profile.cjs').seedWorkspace(legacyDir, 'together');
  console.log(`Phase 5B1 packaged clean-room · soloOff=${soloOffDir} · soloOn=${soloOnDir} · together=${togetherDir} · legacy=${legacyDir}`);
  await withPackagedApp(soloOffDir, (driver) => runPhase('solo-off', driver, soloOffDir));
  await withPackagedApp(soloOffDir, (driver) => runPhase('solo-restart', driver, soloOffDir));
  await withPackagedApp(soloOnDir, (driver) => runPhase('solo-on', driver, soloOnDir));
  await withPackagedApp(soloOnDir, (driver) => runPhase('solo-restart', driver, soloOnDir));
  await withPackagedApp(togetherDir, (driver) => runPhase('together', driver, togetherDir));
  await withPackagedApp(togetherDir, (driver) => runPhase('together-restart', driver, togetherDir));
  await withPackagedApp(legacyDir, (driver) => runPhase('legacy', driver, legacyDir));
}

// ---------------------------------------------------------------------------
(async () => {
  if (phase) { await runSourcePhase(phase, dataArg); return; }
  if (packaged) {
    await runPackaged();
  } else {
    const soloDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-v051-solo-'));
    const soloOnDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-v051-solo-on-'));
    const togetherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-v051-together-'));
    const toggleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-v051-toggle-'));
    const abandonDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-v051-abandon-'));
    console.log(`Phase 5B1 source clean-room · solo=${soloDir} · soloOn=${soloOnDir} · together=${togetherDir} · toggle=${toggleDir} · abandon=${abandonDir}`);
    check('每个清房目录都是全新的（没有任何 dayhub 数据）',
      [soloDir, soloOnDir, togetherDir, toggleDir, abandonDir].every((dir) => !fs.existsSync(path.join(dir, 'dayhub.sqlite')) && fs.readdirSync(dir).length === 0));
    const plan = [
      ['solo-off', soloDir], ['solo-restart', soloDir],
      ['solo-on', soloOnDir], ['solo-restart', soloOnDir],
      ['together', togetherDir], ['together-restart', togetherDir],
      ['toggle', toggleDir],
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
