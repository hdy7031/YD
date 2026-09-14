// YD v0.3 Phase 2C 隔离运行时验收：用户在设置页编辑「日常节奏」。
//
// 用真实 Electron 打开设置页，通过界面完成：停用 / 修改 / 新增 / 删除 / 使用默认作息 /
// 清空 / 切换编辑对象，并确认：
//   * 每次写入都落到 profile.routine（来源变为 user，legacy 提示消失）；
//   * 桌宠在修改后**不重启**就跟着新时间变化；
//   * 非法输入在编辑框里被拦下，不会写库；
//   * Solo / Together 的人员选择来自实际档案。
//
// 运行：npx electron verify-v030-routine-settings.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');

const output = path.join(__dirname, 'test-data', `v030-routine-settings-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
// 空目录：默认双人工作区（同行者 = 桌宠主体，初始为 legacy 默认作息）。
process.env.DAYHUB_TEST_DATA = output;

// 受控虚拟时钟：2027-03-01（周一）13:15 —— 默认作息下桌宠正在午睡。
const realNow = Date.now.bind(Date);
let simAnchor = realNow(), realAnchor = realNow();
{ const target = new Date(2027, 2, 1, 13, 15, 0, 0); simAnchor = target.getTime(); realAnchor = realNow(); }
Date.now = () => simAnchor + (realNow() - realAnchor);

const passed = [], errors = [];
const check = (name, value, detail = '') => { assert.ok(value, `${name}${detail ? ': ' + detail : ''}`); passed.push(name); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { fs.writeFileSync(path.join(output, 'failure.txt'), 'routine settings acceptance timeout'); app.exit(1); }, 240000);
require('./dist/main.cjs');

app.on('web-contents-created', (_event, contents) => contents.on('console-message', (...args) => {
  const details = args[1];
  if (details && typeof details === 'object') { if (details.level === 'error' || details.level === 3) errors.push(String(details.message)); }
  else if (Number(details) >= 2) errors.push(String(args[2]));
}));

const setClock = (hour, minute) => {
  const target = new Date(simAnchor);
  target.setHours(hour, minute, 0, 0);
  simAnchor = target.getTime(); realAnchor = realNow();
};

app.whenReady().then(async () => {
  try {
    let panel, orb;
    for (let i = 0; i < 120; i++) {
      const windows = BrowserWindow.getAllWindows();
      panel = windows.find(w => !w.webContents.getURL().includes('#') && w.webContents.getURL().includes('index.html'));
      orb = windows.find(w => w.webContents.getURL().endsWith('#orb'));
      if (panel && orb && !panel.webContents.isLoading() && !orb.webContents.isLoading()) break;
      await wait(100);
    }
    check('主窗口与桌宠窗口加载完成', !!panel && !!orb);
    const run = code => panel.webContents.executeJavaScript(code);
    const click = selector => run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;el.click();return true})()`);
    const input = (selector, value) => run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;
      const proto=el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});
      el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return el.value})()`);
    const live = () => run('window.dayhub.live()');
    const routineOf = id => run(`window.dayhub.get().then(s=>s.profiles.find(p=>p.id===${JSON.stringify(id)}).routine)`);
    const rowIds = () => run("[...document.querySelectorAll('.routine-row[data-rule-id]')].map(row=>row.dataset.ruleId)");

    // 打开设置页并切到「节奏与状态」分区：VS2 设置页按分区挂载，日常节奏不在默认的
    // 「角色与陪伴」分区里（角色与陪伴 / 节奏与状态仍是同一页的两个分区）。
    await run("window.dayhub.window('settings')");
    await wait(400);
    await run(`(async()=>{
      const tab=[...document.querySelectorAll('.settings-nav button')].find(b=>b.textContent.trim()==='节奏与状态');
      tab?.click();
      await new Promise(r=>setTimeout(r,400));
    })()`);
    await wait(400);
    check('设置页出现「日常节奏」区域', await run("!!document.querySelector('.routine-settings')"));

    /* ---------- 1. 初始状态：默认作息 + 低调提示 + 跨午夜文案 ---------- */
    check('默认作息显示 5 条规则', (await rowIds()).length === 5, JSON.stringify(await rowIds()));
    check('跨午夜规则明确标注"次日"', (await run("document.querySelector('[data-rule-id=\"legacy-night-sleep\"] .routine-row-time')?.textContent??''")) === '23:30 → 次日 07:30');
    check('档期提示存在（迁移自旧版本的默认作息）', await run("!!document.querySelector('.routine-legacy-note')"));
    check('人物选择来自实际档案（本人 + 同行者）', await run("(()=>{const labels=[...document.querySelectorAll('[data-routine-person]')].map(b=>b.textContent.trim());return labels.length===2&&labels[0]==='我的'})()"));
    const before = await live();
    check('此刻桌宠正在午睡（默认作息）', before.display.scheduled === 'nap', JSON.stringify(before.display));

    /* ---------- 2. 停用：数据保留，桌宠立即不再午睡 ---------- */
    check('可以找到午睡规则的开关', await click('[data-rule-id="legacy-nap"] input[type=checkbox]'));
    await wait(1200);
    const afterDisable = await routineOf('partner');
    check('停用后规则仍在（只把 enabled 置 false）', afterDisable.rules.length === 5 && afterDisable.rules.find(r => r.id === 'legacy-nap')?.enabled === false, JSON.stringify(afterDisable.rules.map(r => [r.id, r.enabled])));
    check('停用后来源变为用户、提示消失', afterDisable.source === 'user' && !(await run("!!document.querySelector('.routine-legacy-note')")));
    check('桌宠立即不再午睡（无需重启）', (await live()).display.scheduled === null, JSON.stringify((await live()).display));
    check('停用后的行以"未启用"样式呈现', await run("document.querySelector('[data-rule-id=\"legacy-nap\"]').classList.contains('is-off')"));

    /* ---------- 3. 修改：睡觉 23:30–07:30 → 01:00–09:00 ---------- */
    check('打开现有规则的编辑框', await click('[data-rule-id="legacy-night-sleep"] [data-routine-action="edit"]'));
    await wait(300);
    check('编辑框读取到了当前规则', (await run("document.querySelector('.routine-editor [aria-label=\"开始时间\"]')?.value")) === '23:30');
    await input('.routine-editor [aria-label="开始时间"]', '01:00');
    await input('.routine-editor [aria-label="结束时间"]', '09:00');
    await click('.routine-editor [data-routine-action="save-rule"]');
    await wait(1200);
    const afterEdit = await routineOf('partner');
    const sleepRule = afterEdit.rules.find(r => r.id === 'legacy-night-sleep');
    check('修改写回档案且仍是同一条规则', sleepRule?.start === '01:00' && sleepRule?.end === '09:00' && afterEdit.rules.length === 5, JSON.stringify(sleepRule));
    check('编辑框已关闭', !(await run("!!document.querySelector('.routine-editor')")));
    // 08:30 落在新规则里（旧时间表此时是普通状态）。
    setClock(8, 30); await wait(1300);
    check('桌宠按新作息在 08:30 睡觉', (await live()).display.state === 'night_sleep', JSON.stringify((await live()).display));

    /* ---------- 4. 新增：晚饭 18:00–18:30 ---------- */
    check('可以打开"添加一条"', await click('[data-routine-action="add"]'));
    await wait(300);
    await input('.routine-editor [aria-label="作息名称"]', '晚饭');
    await input('.routine-editor [aria-label="开始时间"]', '18:00');
    await input('.routine-editor [aria-label="结束时间"]', '18:30');
    await click('.routine-editor [data-routine-action="save-rule"]');
    await wait(1200);
    const afterAdd = await routineOf('partner');
    check('新规则写入档案', afterAdd.rules.length === 6 && afterAdd.rules.some(r => r.label === '晚饭' && r.kind === 'meal'), JSON.stringify(afterAdd.rules.map(r => r.label)));
    setClock(18, 10); await wait(1300);
    check('桌宠在 18:10 吃饭（新增规则生效）', (await live()).display.state === 'eating', JSON.stringify((await live()).display));

    /* ---------- 5. 非法输入：在编辑框里被拦下，不写库 ---------- */
    await click('[data-routine-action="add"]');
    await wait(300);
    await input('.routine-editor [aria-label="开始时间"]', '10:00');
    await input('.routine-editor [aria-label="结束时间"]', '10:00');
    await click('.routine-editor [data-routine-action="save-rule"]');
    await wait(300);
    check('开始与结束相同被拦下', await run("(()=>{const t=document.querySelector('.routine-editor')?.textContent??'';return t.includes('不能相同')&&!!document.querySelector('.routine-editor')})()"));
    const stillSix = await routineOf('partner');
    check('非法输入没有写库', stillSix.rules.length === 6);
    await click('.routine-editor [data-routine-action="cancel-edit"]');
    await wait(200);

    /* ---------- 6. 删除：真正移除（与停用区分） ---------- */
    await click('[data-rule-id="legacy-morning-wake"] [data-routine-action="delete"]');
    await wait(200);
    check('删除前先确认', await run("!!document.querySelector('[data-routine-action=\"confirm-delete\"]')"));
    await click('[data-routine-action="confirm-delete"]');
    await wait(1200);
    const afterDelete = await routineOf('partner');
    check('规则被真正删除', afterDelete.rules.length === 5 && !afterDelete.rules.some(r => r.id === 'legacy-morning-wake'), JSON.stringify(afterDelete.rules.map(r => r.id)));
    check('被停用的午睡规则仍然保留', afterDelete.rules.some(r => r.id === 'legacy-nap' && r.enabled === false));

    /* ---------- 7. 使用默认作息 / 清空作息 ---------- */
    await click('[data-routine-action="template"]');
    await wait(200);
    await click('[data-routine-action="confirm-template"]');
    await wait(1200);
    const afterTemplate = await routineOf('partner');
    check('使用默认作息恢复 5 条规则并重新启用午睡', afterTemplate.rules.length === 5 && afterTemplate.rules.every(r => r.enabled), JSON.stringify(afterTemplate.rules.map(r => [r.id, r.enabled])));
    check('默认模板仍标记为用户自己的（不再提示 legacy）', afterTemplate.source === 'user' && !(await run("!!document.querySelector('.routine-legacy-note')")));

    /* ---------- 8. 切换编辑对象：本人与同行者互不影响 ---------- */
    await click('[data-routine-person="me"]');
    await wait(400);
    check('本人的空作息显示 Empty State', await run("(()=>{const t=document.querySelector('.routine-settings')?.textContent??'';return t.includes('还没有设置日常节奏')&&document.querySelectorAll('.routine-row[data-rule-id]').length===0})()"));
    check('同行者的规则没有被改动', (await routineOf('partner')).rules.length === 5);
    await click('[data-routine-person="partner"]');
    await wait(300);
    check('切回同行者后仍是 5 条规则', (await rowIds()).length === 5);

    /* ---------- 9. 清空：空状态 + 桌宠不再有时间状态 ---------- */
    await click('[data-routine-action="clear"]');
    await wait(200);
    await click('[data-routine-action="confirm-clear"]');
    await wait(1200);
    setClock(13, 15); await wait(1300);
    const cleared = await routineOf('partner');
    check('清空后规则为空', cleared.rules.length === 0, JSON.stringify(cleared));
    check('清空后显示 Empty State', await run("(()=>{const t=document.querySelector('.routine-settings')?.textContent??'';return t.includes('还没有设置日常节奏')})()"));
    check('清空后桌宠没有时间状态（回到普通状态）', (await live()).display.scheduled === null, JSON.stringify((await live()).display));
    check('清空后仍可一键恢复默认作息', await run("!!document.querySelector('[data-routine-action=\"template\"]')"));

    /* ---------- 10. 收尾 ---------- */
    check('没有产生损坏数据库副本', !fs.readdirSync(output).some(name => name.includes('.damaged-')));
    check('渲染进程没有报错', errors.length === 0, errors.join(' | '));

    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed }, null, 2));
    console.log(JSON.stringify({ output, passed }, null, 2));
    clearTimeout(deadline);
    app.quit();
  } catch (error) {
    clearTimeout(deadline);
    fs.writeFileSync(path.join(output, 'failure.txt'), error.stack || String(error));
    console.error(error);
    app.exit(1);
  }
});
