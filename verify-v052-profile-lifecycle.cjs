// YD Phase 5B2 · Profile Lifecycle + 可逆的 Solo / Together 切换（clean-room）。
//
// 运行：
//   node verify-v052-profile-lifecycle.cjs              # 源码级：真实 DOM 点击 + 三次重启
//   node verify-v052-profile-lifecycle.cjs --packaged   # 打包版：release/win-unpacked/YD.exe + CDP
//
// 它回答的问题：**模式切换会不会动到人**。
//
//   1) Together → Solo 只是"当前怎么用 YD"：companion 的 PersonId / 档案 / 课表 / 作息 /
//      Avatar / 临时状态全部逐字段保留，界面与导航立即按 Solo 收拢（不重启）；
//   2) Solo 下保留的 companion 必须一眼看出"当前未参与"，但仍然可以编辑资料；
//   3) 再次选择 Together 恢复的是**同一个人**（同一个 PersonId，不新建第二个 companion）；
//   4) 从来没有 companion 的人第一次打开双人模式才创建新人物，且是通用默认
//      （现代 UUID / 空作息 / 空课表 / 默认形象）；
//   5) 桌宠：petEnabled 与模式无关；Solo 下的存储偏好保留、运行时主体恒为本人，
//      恢复 Together 后原偏好立即生效（不需要重启）；
//   6) 档案身份只允许改 name / shortAlias（PersonId 与 role 不可编辑，界面也不暴露内部字段）。
//
// 每次都使用 os.tmpdir() 下的全新目录，绝不读取开发者 / 真实用户 AppData。
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = __dirname;
const packaged = process.argv.includes('--packaged');
const phase = argOf('phase');
const dataArg = argOf('data');
const port = Number(argOf('port') || 9381);
const identityFile = 'lifecycle.json';
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
const normalized = (value) => String(value || '').replace(/\s+/g, '');

// ---------------------------------------------------------------------------
// 渲染层驱动：所有用户动作都走真实 DOM（点击 / 输入），不直接调用领域命令跳过界面。
// （例外只有两处：种下 person-scoped 数据、以及"反复切换 10 次"的循环。
//   它们用正式命令，但不上 UI 表单——那些表单已经在各自的 verifier 里验收过。）
// ---------------------------------------------------------------------------
function domHelpers(run, pet) {
  const click = async (selector) => {
    const result = await run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return 'missing';el.click();return 'ok';})()`);
    await wait(180);
    return result;
  };
  const type = async (selector, value) => {
    const result = await run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return 'missing';const proto=el.tagName==='INPUT'?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));return 'ok';})()`);
    await wait(180);
    return result;
  };
  const settings = () => run(`(()=>{
    const attr=(selector,name)=>{const el=document.querySelector(selector);return el?el.getAttribute(name):''};
    const text=(selector)=>{const el=document.querySelector(selector);return el?el.textContent:''};
    const picked=(selector,name)=>[...document.querySelectorAll(selector)].filter(e=>e.getAttribute('aria-checked')==='true').map(e=>e.getAttribute(name));
    return {
      section:[...document.querySelectorAll('.settings-nav button')].find(e=>e.classList.contains('active'))?.textContent?.trim()||'',
      usageOptions:[...document.querySelectorAll('[data-usage-mode-option]')].map(e=>e.getAttribute('data-usage-mode-option')),
      usageChecked:attr('[data-usage-mode-option][aria-checked="true"]','data-usage-mode-option'),
      usageLabel:(document.querySelector('[data-usage-mode-option][aria-checked="true"]')||{}).textContent||'',
      feedback:text('[data-usage-feedback]'),
      usageError:text('[data-usage-error]'),
      rows:[...document.querySelectorAll('[data-profile-row]')].map(e=>({
        id:e.getAttribute('data-profile-row'),state:e.getAttribute('data-profile-state'),
        label:(e.querySelector('strong')||{}).textContent||'',note:(e.querySelector('small')||{}).textContent||'',
      })),
      createDialog:!!document.querySelector('[data-usage-dialog="create"]'),
      restoreDialog:!!document.querySelector('[data-usage-dialog="restore"]'),
      subjectOptions:[...document.querySelectorAll('[data-usage-subject-option]')].map(e=>e.getAttribute('data-usage-subject-option')),
      subjectChecked:picked('[data-usage-subject-option]','data-usage-subject-option'),
      editorDialog:attr('[data-profile-edit-dialog]','data-profile-edit-dialog'),
      editorTitle:text('[data-profile-edit-dialog] h2'),
      editorText:(document.querySelector('[data-profile-edit-dialog]')||{}).innerText||'',
      editorName:(document.querySelector('[data-profile-name-input]')||{}).value||'',
      editorAlias:(document.querySelector('[data-profile-alias-input]')||{}).value||'',
      editorError:text('[data-profile-error]'),
      subjectSetting:[...document.querySelectorAll('[data-pet-subject-option]')].map(e=>e.getAttribute('data-pet-subject-option')),
      subjectSettingChecked:picked('[data-pet-subject-option]','data-pet-subject-option'),
      petToggleChecked:!!(document.querySelector('[data-pet-enabled]')||{}).checked,
      avatarGroups:[...document.querySelectorAll('.avatar-person-picker')].map(e=>e.getAttribute('data-avatar-person')),
      routinePeople:[...document.querySelectorAll('[data-routine-person]')].map(e=>e.getAttribute('data-routine-person')),
    };
  })()`);
  const shell = () => run(`(()=>{const text=document.body.innerText;return {
    homeTitle:(document.querySelector('.page-head h1')||{}).textContent||'',
    title:(document.querySelector('.page-head h1')||{}).textContent||'',
    statusRows:document.querySelectorAll('.dual-status .person-status').length,
    navItems:[...document.querySelectorAll('.nav-item')].map(e=>e.textContent.trim()),
    navKinds:[...document.querySelectorAll('.nav-item')].map(e=>e.getAttribute('data-kind')),
    activeNav:[...document.querySelectorAll('.nav-item')].find(e=>e.getAttribute('aria-current')==='page')?.textContent?.trim()||'',
    onboarding:!!document.querySelector('[data-setup-panel]'),
    hasUndefined:/undefined/.test(text),
    text,
  };})()`);
  const dock = () => pet(`(()=>({
    people:document.querySelectorAll('.dock-surface .person').length,
    dividers:document.querySelectorAll('.dock-surface .dock-divider').length,
    soloSurface:!!document.querySelector('.dock-surface.solo'),
    letters:[...document.querySelectorAll('.dock-surface .person-letter')].map(e=>e.textContent.trim()),
    pack:(document.querySelector('.companion-figure')||{}).dataset?.avatarPack||'',
  }))()`);
  const view = async () => {
    const state = await run('window.dayhub.get()');
    const live = await run('window.dayhub.live()');
    return { state, live, shell: await shell(), settings: await settings(), dock: await dock() };
  };
  return { click, type, view, shell, settings, dock, run, pet };
}

/** 轮询等待一个条件成立（界面切换是异步的，固定 sleep 会变成不稳定的验收）。 */
async function waitFor(probe, predicate, timeoutMs = 6000, interval = 150) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await probe();
    if (predicate(last)) return last;
    await wait(interval);
  }
  return last;
}

/** 打开「设置 → 角色与陪伴」：先切到设置标签页，再切分区（两者都必须真实点击）。 */
async function openCompanionshipSettings(driver) {
  await driver.run("(()=>{const tab=[...document.querySelectorAll('.nav-item')].find(b=>b.getAttribute('data-kind')==='settings');if(!tab)return 'missing';tab.click();return 'ok';})()");
  await wait(260);
  await driver.run("(()=>{const btn=[...document.querySelectorAll('.settings-nav button')].find(b=>b.textContent.trim()==='角色与陪伴');if(!btn)return 'missing';btn.click();return 'ok';})()");
  await wait(260);
}

/** 回到首页并读取外壳 DOM（首页的状态行只在 Home 渲染，设置页上没有）。 */
async function goHome(driver) {
  await driver.run("(()=>{const tab=[...document.querySelectorAll('.nav-item')].find(b=>b.getAttribute('data-kind')==='today');if(!tab)return 'missing';tab.click();return 'ok';})()");
  await wait(260);
  return driver.shell();
}

/** 状态 Dock 形态（读"当前活跃人物"有几条）与角色形态（读真实渲染的 Pack）互斥。 */
const petView = (driver, mode) => driver.run(`window.dayhub.change({type:'settings',pet:{mode:${JSON.stringify(mode)},size:'medium'}})`);
const petDockMode = (driver) => petView(driver, 'orb');
const companionOf = (state) => state.profiles.find((profile) => profile.role === 'companion');
const selfOf = (state) => state.profiles.find((profile) => profile.role === 'self');
const personData = (state, personId) => JSON.stringify({
  profile: state.profiles.find((profile) => profile.id === personId) || null,
  courses: state.courses.filter((course) => course.person === personId),
  overrides: state.manualOverrides.filter((override) => override.personId === personId),
});

/** 通过正式命令种下同行者的 person-scoped 数据（课表 / 作息 / Avatar / 本人临时状态）。 */
async function seedPersonData(driver) {
  const state = await driver.run('window.dayhub.get()');
  const companion = companionOf(state);
  const now = state.lastTick;
  const routine = { source: 'user', updatedAt: now, rules: [{ id: 'sam-lunch', kind: 'meal', label: '午饭', start: '12:00', end: '13:00', days: [1, 2, 3, 4, 5], enabled: true, priority: 20 }] };
  await driver.run(`window.dayhub.change({type:'avatarSet',personId:${JSON.stringify(companion.id)},packId:'yd-pixel'})`);
  await driver.run(`window.dayhub.change({type:'save',entity:'profiles',value:${JSON.stringify({ ...companion, routine })}})`);
  await driver.run(`window.dayhub.change({type:'save',entity:'courses',value:${JSON.stringify({
    id: 'sam-course', person: companion.id, title: '同伴的课', place: 'B-201', notes: '', activity: 'teaching',
    weekday: 1, first: 1, last: 2, weeks: [1, 2, 3], reminders: [], checklist: [], updatedAt: now,
  })}})`);
  await driver.run("window.dayhub.change({type:'manual',kind:'focus',label:'写论文',endAt:null})");
  return companion.id;
}

// ---------------------------------------------------------------------------
// 阶段
// ---------------------------------------------------------------------------
/** 首次使用：真实点击完成 Together onboarding，再种下同行者数据。 */
async function phaseTogether(driver, dataDir) {
  const fresh = await driver.view();
  check('fresh：默认只有本人、没有任何 companion（5A 契约不变）',
    fresh.state.profiles.length === 1 && !companionOf(fresh.state) && fresh.state.settings.setup === false,
    JSON.stringify({ profiles: fresh.state.profiles.length, setup: fresh.state.settings.setup }));
  check('fresh：使用方式的推导结论是 Solo', fresh.state.settings.usageMode === undefined && fresh.shell.navItems.length > 0,
    JSON.stringify({ usageMode: fresh.state.settings.usageMode }));
  const selfId = fresh.state.profiles[0].id;
  await driver.type('[data-setup-name-input="self"]', '小宇');
  await driver.click('[data-setup-next]');
  await driver.click('[data-setup-mode-option="together"]');
  await driver.type('[data-setup-name-input="companion"]', '丹丹');
  await driver.click('[data-setup-next]');
  await driver.click('[data-setup-pet-option="on"]');
  await driver.click('[data-setup-next]');
  await driver.click('[data-setup-subject-option="companion"]');
  await driver.click('[data-setup-routine-later]');
  await waitFor(() => driver.shell(), (shell) => !shell.onboarding);
  const done = await driver.view();
  check('完成 Together onboarding：两个人物、导航出现 TA 的安排',
    done.state.profiles.length === 2 && done.shell.navItems.includes('丹丹的安排'),
    JSON.stringify(done.shell.navItems));
  const companionId = companionOf(done.state).id;
  check('完成 Together onboarding：本人身份没有被重建', selfOf(done.state).id === selfId);
  check('派生短代号：称呼前缀「小」不算身份信息，小宇的桌面代号是「宇」',
    done.live.people.find((person) => person.person === selfId)?.alias === '宇'
    && done.dock.letters.includes('宇'),
    JSON.stringify({ letters: done.dock.letters, people: done.live.people.map((person) => person.alias) }));
  check('完成 Together onboarding：桌宠表示 TA（主体偏好落盘）',
    done.state.settings.petSubjectRole === 'companion' && done.live.petInstance.subjectId === companionId,
    JSON.stringify({ subject: done.state.settings.petSubjectRole, instance: done.live.petInstance }));

  const seededCompanion = await seedPersonData(driver);
  const seeded = await driver.view();
  check('种下同行者数据：课表 / 作息 / Avatar / 本人临时状态都在',
    seeded.state.courses.some((course) => course.person === seededCompanion)
    && (companionOf(seeded.state).routine?.rules || []).length === 1
    && companionOf(seeded.state).avatar.packId === 'yd-pixel'
    && seeded.state.manualOverrides.length === 1,
    JSON.stringify({ instance: seeded.live.petInstance }));
  check('Together：桌面 Dock 两行 + 分隔线（当前活跃人物 = 2）',
    seeded.dock.people === 2 && seeded.dock.dividers === 1,
    JSON.stringify(seeded.dock));
  check('Together：桌宠消费同行者的形象（yd-pixel）', seeded.live.petInstance.avatarPackId === 'yd-pixel',
    JSON.stringify(seeded.live.petInstance));
  // 角色形态下读桌面真实渲染的 Pack：证明"换人"真的换了桌面上的形象。
  await petView(driver, 'custom');
  const rendered = await waitForDockPack(driver, 'yd-pixel');
  await petDockMode(driver);
  await wait(400);
  check('Together：桌面渲染的 Pack 就是同行者的 yd-pixel', rendered, JSON.stringify((await driver.dock()).pack));
  fs.writeFileSync(path.join(dataDir, identityFile), JSON.stringify({
    self: selfId, companion: seededCompanion, companionData: personData(seeded.state, seededCompanion),
  }), 'utf8');
}

/** Together → Solo：不删除任何数据，界面立即收拢。 */
async function phaseSwitchSolo(driver, dataDir) {
  const first = JSON.parse(fs.readFileSync(path.join(dataDir, identityFile), 'utf8'));
  const before = await driver.view();
  await openCompanionshipSettings(driver);
  const beforeSettings = await driver.settings();
  check('设置 · 角色与陪伴：使用方式是两个独立 Chip，当前选中「我和另一位」',
    beforeSettings.usageOptions.join(',') === 'solo,together' && beforeSettings.usageChecked === 'together'
    && normalized(beforeSettings.usageLabel) === '我和另一位',
    JSON.stringify({ options: beforeSettings.usageOptions, checked: beforeSettings.usageChecked }));
  check('设置 · 角色与陪伴：档案区列出两个可编辑的人',
    beforeSettings.rows.length === 2 && beforeSettings.rows.every((row) => row.state === 'active' || row.state === 'self'),
    JSON.stringify(beforeSettings.rows));

  await driver.click('[data-usage-mode-option="solo"]');
  const after = await waitFor(() => driver.view(), (view) => view.state.settings.usageMode === 'solo');
  const afterSettings = await driver.settings();
  check('Together → Solo：使用方式落盘为 solo', after.state.settings.usageMode === 'solo', String(after.state.settings.usageMode));
  check('Together → Solo：companion 的档案 / 课表 / 作息 / Avatar / 临时状态逐字段保留',
    personData(after.state, first.companion) === first.companionData,
    JSON.stringify({ before: first.companionData.length, after: personData(after.state, first.companion).length }));
  check('Together → Solo：没有删除任何人物（2 个档案仍在）',
    after.state.profiles.length === 2 && !!selfOf(after.state) && !!companionOf(after.state));
  check('Together → Solo：导航立即按 Solo 收拢（不重启，且没有"孤立页面"）',
    !after.shell.navItems.includes('丹丹的安排') && after.shell.navItems.includes('我的安排')
    && after.shell.activeNav === '设置与备份'
    && !after.live.people.some((person) => person.person === first.companion),
    JSON.stringify({ nav: after.shell.navItems, active: after.shell.activeNav }));
  check('Together → Solo：桌面 Dock 立即变回一行（当前活跃人物 = 1）',
    after.dock.people === 1 && after.dock.dividers === 0,
    JSON.stringify(after.dock));
  check('Together → Solo：存储的桌宠偏好仍是 companion，但运行时主体恒为本人（用自己的形象）',
    after.state.settings.petSubjectRole === 'companion'
    && after.live.petInstance.subjectId === first.self
    && after.live.petInstance.avatarPackId === selfOf(after.state).avatar.packId
    && after.live.petInstance.avatarPackId === 'yd-default',
    JSON.stringify({ stored: after.state.settings.petSubjectRole, instance: after.live.petInstance }));
  check('Together → Solo：petEnabled 不被模式切换改写',
    after.state.settings.petEnabled === before.state.settings.petEnabled,
    JSON.stringify({ before: before.state.settings.petEnabled, after: after.state.settings.petEnabled }));
  check('Together → Solo：一次性反馈出现（不是永久说明）',
    /已切换/.test(afterSettings.feedback), afterSettings.feedback);
  check('Solo + 保留的 companion：档案行标成「已保留」，仍然可以编辑',
    afterSettings.rows.length === 2
    && afterSettings.rows.find((row) => row.id === first.companion)?.state === 'retained'
    && !!afterSettings.rows.find((row) => row.id === first.companion)?.note,
    JSON.stringify(afterSettings.rows));
  check('Solo + 保留的 companion：桌宠表示选择器与 TA 的形象区都不再出现',
    afterSettings.subjectSetting.length === 0 && afterSettings.avatarGroups.length === 1
    && afterSettings.routinePeople.filter((id) => id === first.companion).length === 0,
    JSON.stringify({ subject: afterSettings.subjectSetting, avatars: afterSettings.avatarGroups }));
  const soloHome = await goHome(driver);
  check('Together → Solo：首页也只投影本人（没有幽灵同伴）',
    soloHome.statusRows === 1 && soloHome.homeTitle === '我的安排' && soloHome.hasUndefined === false,
    JSON.stringify({ rows: soloHome.statusRows, title: soloHome.homeTitle }));
  await openCompanionshipSettings(driver);

  // §44：Solo 下仍然可以编辑被保留的人（数据没丢，改的也是同一个人）。
  await driver.click(`[data-profile-edit="${first.companion}"]`);
  const editor = await driver.settings();
  check('Solo：保留的 companion 仍能打开档案编辑器，且里面没有内部字段',
    editor.editorDialog === first.companion && !editor.editorText.includes(first.companion)
    && !/PersonId|role|UUID|ProfileRole/.test(editor.editorText),
    JSON.stringify({ dialog: editor.editorDialog }));
  await driver.type('[data-profile-alias-input]', '丹');
  await driver.click('[data-profile-save]');
  const renamed = await waitFor(() => driver.view(), (view) => companionOf(view.state)?.shortAlias === '丹');
  check('Solo：编辑保留的 companion 只改身份，不改使用方式',
    companionOf(renamed.state).shortAlias === '丹'
    && renamed.state.settings.usageMode === 'solo'
    && !renamed.shell.navItems.includes('丹丹的安排')
    && renamed.state.courses.some((course) => course.person === first.companion),
    JSON.stringify({ alias: companionOf(renamed.state).shortAlias, mode: renamed.state.settings.usageMode }));
  fs.writeFileSync(path.join(dataDir, identityFile), JSON.stringify({
    ...first,
    companionAlias: '丹',
    companionData: personData(renamed.state, first.companion),
    selfData: personData(renamed.state, first.self),
  }), 'utf8');
}

/** Solo 重启：模式持久化，配对的资料仍然在。 */
async function phaseSoloRestart(driver, dataDir) {
  const first = JSON.parse(fs.readFileSync(path.join(dataDir, identityFile), 'utf8'));
  const view = await driver.view();
  check('Solo 重启：模式仍然是 solo', view.state.settings.usageMode === 'solo', String(view.state.settings.usageMode));
  check('Solo 重启：companion 与它的数据仍然完整保留',
    companionOf(view.state)?.id === first.companion && personData(view.state, first.companion) === first.companionData,
    JSON.stringify({ profiles: view.state.profiles.length }));
  check('Solo 重启：导航、首页与 Dock 仍然按 Solo 收拢',
    !view.shell.navItems.includes('丹丹的安排') && view.shell.navItems.includes('我的安排')
    && view.shell.statusRows === 1 && view.shell.hasUndefined === false,
    JSON.stringify(view.shell.navItems));
  check('Solo 重启：没有重新进入 onboarding', !view.shell.onboarding && view.state.settings.setup === true);
  await openCompanionshipSettings(driver);
  const settings = await driver.settings();
  check('Solo 重启：设置里仍然显示「已保留」且可编辑',
    settings.usageChecked === 'solo'
    && settings.rows.find((row) => row.id === first.companion)?.state === 'retained',
    JSON.stringify(settings.rows));
}

/** Solo → Together（有 retained companion）：恢复同一个人，不重建。 */
async function phaseRestoreTogether(driver, dataDir) {
  const first = JSON.parse(fs.readFileSync(path.join(dataDir, identityFile), 'utf8'));
  const before = await driver.view();
  await openCompanionshipSettings(driver);
  await driver.click('[data-usage-mode-option="together"]');
  const dialog = await driver.settings();
  check('Solo → Together（有保留的人）：先确认「恢复与丹丹的双人模式？」',
    dialog.restoreDialog && !dialog.createDialog, JSON.stringify(dialog));
  await driver.click('[data-usage-restore-confirm]');
  const after = await waitFor(() => driver.view(), (view) => view.state.settings.usageMode === 'together');
  check('恢复 Together：模式落盘，且没有创建第二个人',
    after.state.settings.usageMode === 'together' && after.state.profiles.length === 2
    && after.state.profiles.filter((profile) => profile.role === 'companion').length === 1,
    JSON.stringify(after.state.profiles.map((profile) => profile.id)));
  check('恢复 Together：PersonId 与全部 person-scoped 数据逐字段相同',
    companionOf(after.state).id === first.companion && personData(after.state, first.companion) === first.companionData
    && personData(after.state, first.self) === first.selfData,
    JSON.stringify({ companion: companionOf(after.state).id }));
  check('恢复 Together：导航与 Dock 立即回到双人（不重启）',
    after.shell.navItems.includes('丹丹的安排')
    && after.live.people.length === 2 && after.dock.people === 2 && after.dock.dividers === 1,
    JSON.stringify({ nav: after.shell.navItems, dock: after.dock }));
  const togetherHome = await goHome(driver);
  check('恢复 Together：首页状态行也恢复成两条',
    togetherHome.statusRows === 2 && togetherHome.hasUndefined === false,
    JSON.stringify({ rows: togetherHome.statusRows }));
  await petView(driver, 'custom');
  const rendered = await waitForDockPack(driver, companionOf(after.state).avatar.packId);
  await petDockMode(driver);
  await wait(400);
  check('恢复 Together：此前保留的桌宠偏好立即生效（主体回到 TA，桌面形象也是 TA 的）',
    after.live.petInstance.subjectId === first.companion
    && after.live.petInstance.avatarPackId === companionOf(after.state).avatar.packId
    && rendered,
    JSON.stringify({ instance: after.live.petInstance, rendered }));
  check('恢复 Together：petEnabled 仍然与模式无关',
    after.state.settings.petEnabled === before.state.settings.petEnabled,
    JSON.stringify({ before: before.state.settings.petEnabled, after: after.state.settings.petEnabled }));
  fs.writeFileSync(path.join(dataDir, identityFile), JSON.stringify({
    ...first, companionData: personData(after.state, first.companion), selfData: personData(after.state, first.self),
  }), 'utf8');
}

/** 档案身份编辑 + 反复切换不产生重复人物。 */
async function phaseIdentityEdit(driver, dataDir) {
  const first = JSON.parse(fs.readFileSync(path.join(dataDir, identityFile), 'utf8'));
  await openCompanionshipSettings(driver);

  await driver.click(`[data-profile-edit="${first.self}"]`);
  await driver.type('[data-profile-name-input]', '小宇子');
  await driver.type('[data-profile-alias-input]', '宇');
  await driver.click('[data-profile-save]');
  const edited = await waitFor(() => driver.view(), (view) => selfOf(view.state)?.name === '小宇子');
  const self = selfOf(edited.state);
  check('编辑本人资料：名称与短代号写入，PersonId / role / 形象 / 作息不变',
    self.name === '小宇子' && self.shortAlias === '宇' && self.id === first.self && self.role === 'self'
    && JSON.stringify(self.avatar) === JSON.stringify(JSON.parse(first.selfData).profile.avatar)
    && JSON.stringify(self.routine) === JSON.stringify(JSON.parse(first.selfData).profile.routine),
    JSON.stringify({ name: self.name, alias: self.shortAlias }));
  check('编辑本人资料后：导航 / 状态行不用重启就跟着新名字',
    edited.live.people.find((person) => person.person === first.self)?.alias === '宇',
    JSON.stringify(edited.live.people.map((person) => person.alias)));

  // 显式代号 → 显示代号跟着变（不是只有 State 变了）。
  await driver.click(`[data-profile-edit="${first.companion}"]`);
  await driver.type('[data-profile-alias-input]', 'D');
  await driver.click('[data-profile-save]');
  const aliased = await waitFor(() => driver.view(), (view) => companionOf(view.state)?.shortAlias === 'D');
  check('显式短代号：写入后桌面 / 状态行显示代号跟着变',
    companionOf(aliased.state).shortAlias === 'D'
    && aliased.live.people.find((person) => person.person === first.companion)?.alias === 'D'
    && aliased.dock.letters.includes('D'),
    JSON.stringify({ alias: aliased.live.people.map((person) => person.alias), dock: aliased.dock.letters }));

  // 清空短代号 → 回到按名称派生的规则（不是写死一个新值）。
  await driver.click(`[data-profile-edit="${first.companion}"]`);
  await driver.type('[data-profile-alias-input]', '');
  await driver.click('[data-profile-save]');
  const cleared = await waitFor(() => driver.view(), (view) => companionOf(view.state)?.shortAlias !== 'D');
  check('清空短代号：显示代号回到名称首字素（不写死新值）',
    cleared.live.people.find((person) => person.person === first.companion)?.alias === '丹'
    && cleared.live.people.find((person) => person.person === first.companion)?.name === '丹丹',
    JSON.stringify({ alias: cleared.live.people.map((person) => person.alias) }));

  // 非法名称被拒绝，且不改写任何数据。
  const beforeInvalid = await driver.run('window.dayhub.get()');
  await driver.click(`[data-profile-edit="${first.self}"]`);
  await driver.type('[data-profile-name-input]', '   ');
  await driver.click('[data-profile-save]');
  const invalid = await waitFor(() => driver.settings(), (settings) => !!settings.editorError);
  check('非法名称（纯空白）被拒绝并给出原因，编辑器不关闭',
    /请填写/.test(invalid.editorError) && invalid.editorDialog === first.self, invalid.editorError);
  await driver.click('[data-profile-cancel]');
  const afterInvalid = await driver.run('window.dayhub.get()');
  check('被拒绝的编辑不留下痕迹', JSON.stringify(afterInvalid) === JSON.stringify(beforeInvalid));

  // §39：反复 Solo ↔ Together 10 次都不产生重复人物。
  const ids = (await driver.run('window.dayhub.get()')).profiles.map((profile) => profile.id).sort();
  for (let i = 0; i < 10; i++) {
    await driver.run("window.dayhub.change({type:'usageMode',mode:'solo'})");
    await driver.run("window.dayhub.change({type:'usageMode',mode:'together'})");
  }
  await wait(400);
  const looped = await driver.view();
  check('反复切换 10 次：人数与 PersonId 完全不变（没有重复人物）',
    looped.state.profiles.length === 2 && JSON.stringify(looped.state.profiles.map((profile) => profile.id).sort()) === JSON.stringify(ids),
    JSON.stringify(looped.state.profiles.map((profile) => profile.name)));
  check('反复切换 10 次后：同行者数据仍然逐字段相同',
    JSON.stringify(looped.state.courses.filter((course) => course.person === first.companion))
    === JSON.stringify(JSON.parse(first.companionData).courses),
    JSON.stringify(looped.state.courses.length));
}

/** 最终重启：Together 与全部数据都持久化。 */
async function phaseFinalRestart(driver, dataDir) {
  const first = JSON.parse(fs.readFileSync(path.join(dataDir, identityFile), 'utf8'));
  const view = await driver.view();
  check('最终重启：模式是 together 且没有重复人物',
    view.state.settings.usageMode === 'together' && view.state.profiles.length === 2);
  check('最终重启：本人改名与 shortAlias 持久化，PersonId 不变',
    selfOf(view.state).id === first.self && selfOf(view.state).name === '小宇子' && selfOf(view.state).shortAlias === '宇',
    JSON.stringify({ name: selfOf(view.state).name }));
  check('最终重启：companion 的课表 / 作息 / 形象仍然逐字段保留',
    JSON.stringify(view.state.courses.filter((course) => course.person === first.companion))
    === JSON.stringify(JSON.parse(first.companionData).courses)
    && (companionOf(view.state).routine?.rules || []).length === 1
    && companionOf(view.state).avatar.packId === 'yd-pixel',
    JSON.stringify(companionOf(view.state).avatar));
  check('最终重启：导航 / 首页 / Dock 都是双人形态',
    view.shell.navItems.includes('丹丹的安排') && view.shell.statusRows === 2 && view.dock.people === 2);
  check('最终重启：界面没有 undefined', view.shell.hasUndefined === false);
}

/** 没有 companion 的人第一次打开双人模式：现场创建通用默认人物（桌宠关闭路径）。 */
async function phaseCreatePetOff(driver, dataDir) {
  const fresh = await driver.view();
  const selfId = fresh.state.profiles[0].id;
  await driver.type('[data-setup-name-input="self"]', '小宇');
  await driver.click('[data-setup-next]');
  await driver.click('[data-setup-next]');      // 使用方式：保持默认「只为自己」
  await driver.click('[data-setup-next]');      // 桌面陪伴：保持默认「暂时不用」
  await driver.click('[data-setup-complete]');
  await waitFor(() => driver.shell(), (shell) => !shell.onboarding);
  const done = await driver.view();
  check('Solo（不用桌宠）完成：没有 companion，也没有创建任何业务数据',
    done.state.profiles.length === 1 && !companionOf(done.state) && done.state.courses.length === 0,
    JSON.stringify({ profiles: done.state.profiles.length }));
  check('Solo（不用桌宠）完成：桌宠关闭', done.state.settings.petEnabled === false);

  await openCompanionshipSettings(driver);
  const soloSettings = await driver.settings();
  check('Solo：使用方式默认「只为自己」，档案区只有本人',
    soloSettings.usageChecked === 'solo' && soloSettings.rows.length === 1 && soloSettings.rows[0].state === 'self',
    JSON.stringify(soloSettings.rows));
  await driver.click('[data-usage-mode-option="together"]');
  const create = await driver.settings();
  check('第一次选择「我和另一位」：出现创建流程，且不问桌宠表示（桌宠关闭）',
    create.createDialog && create.subjectOptions.length === 0, JSON.stringify(create));
  await driver.type('[data-usage-companion-name]', '  阿丁 ');
  await driver.click('[data-usage-create-confirm]');
  const created = await waitFor(() => driver.view(), (view) => view.state.profiles.length === 2);
  const companion = companionOf(created.state);
  check('第一次 Together：新 companion 用现代 UUID、名字 trim 后写入',
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(companion.id)
    && companion.id !== selfId && companion.name === '阿丁' && companion.role === 'companion',
    JSON.stringify({ id: companion.id, name: companion.name }));
  check('第一次 Together：新 companion 是通用默认（空作息 / 空课表 / 默认形象）',
    (companion.routine?.rules || []).length === 0 && created.state.courses.length === 0
    && companion.avatar.packId === 'yd-default' && companion.avatar.source === 'default',
    JSON.stringify({ routine: companion.routine, avatar: companion.avatar }));
  check('第一次 Together：模式落盘、导航出现 TA 的安排、桌宠仍然关闭',
    created.state.settings.usageMode === 'together' && created.shell.navItems.includes('阿丁的安排')
    && created.state.settings.petEnabled === false,
    JSON.stringify({ nav: created.shell.navItems, petEnabled: created.state.settings.petEnabled }));

  await openCompanionshipSettings(driver);
  await driver.click('[data-usage-mode-option="solo"]');
  const backToSolo = await waitFor(() => driver.view(), (view) => view.state.settings.usageMode === 'solo');
  check('关闭桌宠的双人工作区切回 Solo：人物保留、桌宠仍然关闭、导航收拢',
    backToSolo.state.profiles.length === 2 && companionOf(backToSolo.state).id === companion.id
    && backToSolo.state.settings.petEnabled === false
    && !backToSolo.shell.navItems.includes('阿丁的安排'),
    JSON.stringify({ nav: backToSolo.shell.navItems }));
  fs.writeFileSync(path.join(dataDir, identityFile), JSON.stringify({ self: selfId, companion: companion.id }), 'utf8');
}

/** 桌宠关闭工作区的重启：模式、人物与开关都持久化。 */
async function phasePetOffRestart(driver, dataDir) {
  const first = JSON.parse(fs.readFileSync(path.join(dataDir, identityFile), 'utf8'));
  const view = await driver.view();
  check('桌宠关闭工作区重启：Solo 模式持久化，companion 保留',
    view.state.settings.usageMode === 'solo' && view.state.profiles.length === 2
    && companionOf(view.state).id === first.companion,
    JSON.stringify({ mode: view.state.settings.usageMode, profiles: view.state.profiles.length }));
  check('桌宠关闭工作区重启：petEnabled 仍然是 false（模式切换不会偷偷打开桌宠）',
    view.state.settings.petEnabled === false, String(view.state.settings.petEnabled));
  check('桌宠关闭工作区重启：导航只有本人页，Dock 只有一行',
    !view.shell.navItems.includes('阿丁的安排') && view.shell.statusRows === 1 && view.dock.people === 1,
    JSON.stringify({ nav: view.shell.navItems, dock: view.dock }));
}

/** Dock 上真实渲染的 Pack（证明桌面上的形象跟着主体走）。 */
async function waitForDockPack(driver, packId, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  let seen = '';
  while (Date.now() < deadline) {
    seen = (await driver.dock()).pack;
    if (seen === packId) return true;
    await wait(150);
  }
  return seen === packId;
}

const PHASES = {
  'together': phaseTogether,
  'switch-solo': phaseSwitchSolo,
  'solo-restart': phaseSoloRestart,
  'restore-together': phaseRestoreTogether,
  'identity-edit': phaseIdentityEdit,
  'final-restart': phaseFinalRestart,
  'create-pet-off': phaseCreatePetOff,
  'pet-off-restart': phasePetOffRestart,
};
async function runPhase(kind, driver, dataDir) {
  const fn = PHASES[kind];
  if (!fn) throw new Error(`未知阶段：${kind}`);
  // Dock 形态是读"当前活跃人物"的窗口：每次阶段开始先切到状态 Dock，再回到首页。
  await petDockMode(driver);
  await wait(500);
  await fn(driver, dataDir);
}

// ---------------------------------------------------------------------------
// 源码级：Electron 子进程（每个阶段一次启动）
// ---------------------------------------------------------------------------
async function runSourcePhase(kind, dataDir) {
  const { app, BrowserWindow } = require('electron');
  const { configureIsolatedUserData } = require('./scripts/electron-test-profile.cjs');
  configureIsolatedUserData(`v052-${kind}`, dataDir);
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
// 打包版：真实 exe + CDP
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

const LIFECYCLE_PLAN = [
  ['together'], ['switch-solo'], ['solo-restart'],
  ['restore-together'], ['identity-edit'], ['final-restart'],
];
const PET_OFF_PLAN = [['create-pet-off'], ['pet-off-restart']];

async function runPackaged() {
  // 打包清房：隔离 userData 下的完整生命周期（首次设置 → 切换 → 重启 → 恢复 → 再重启），
  // 外加"没用桌宠的人后来才打开双人模式"的路径。绝不触碰真实 AppData。
  const lifecycleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-v052-packaged-lifecycle-'));
  const petOffDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-v052-packaged-petoff-'));
  console.log(`Phase 5B2 packaged clean-room · lifecycle=${lifecycleDir} · petOff=${petOffDir}`);
  for (const [kind] of LIFECYCLE_PLAN) await withPackagedApp(lifecycleDir, (driver) => runPhase(kind, driver, lifecycleDir));
  for (const [kind] of PET_OFF_PLAN) await withPackagedApp(petOffDir, (driver) => runPhase(kind, driver, petOffDir));
}

// ---------------------------------------------------------------------------
(async () => {
  if (phase) { await runSourcePhase(phase, dataArg); return; }
  if (packaged) {
    await runPackaged();
  } else {
    const lifecycleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-v052-lifecycle-'));
    const petOffDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-v052-petoff-'));
    console.log(`Phase 5B2 source clean-room · lifecycle=${lifecycleDir} · petOff=${petOffDir}`);
    check('两个清房目录都是全新的（没有任何 dayhub 数据）',
      [lifecycleDir, petOffDir].every((dir) => !fs.existsSync(path.join(dir, 'dayhub.sqlite')) && fs.readdirSync(dir).length === 0));
    const plan = [...LIFECYCLE_PLAN.map(([kind]) => [kind, lifecycleDir]), ...PET_OFF_PLAN.map(([kind]) => [kind, petOffDir])];
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
