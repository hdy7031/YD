// 视觉迭代用的轻量截图回路：只灌必要的测试数据，抓首页 / Ta / 课表 / 事项 / 收件箱 / 提醒 / 设置。
// 与 ui-catalog.cjs 共用同一套启动与注入方式，但把耗时压到最低，方便改一版配色就立刻看一眼。
//
// Run: npx electron ui-shots.cjs    （必须放在项目根目录，app.getAppPath() 才指向本项目）
// Env: UI_SHOTS_OUT=<输出目录>  （默认 deliverables/ui-shots-<version>）
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = __dirname;
const version = require(path.join(root, 'package.json')).version;
const outRoot = process.env.UI_SHOTS_OUT || path.join(root, 'deliverables', 'ui-shots-' + version);
const shotsDir = path.join(outRoot, 'shots');
const appData = path.join(root, 'test-data', 'ui-shots-' + Date.now());
for (const dir of [outRoot, shotsDir, appData]) fs.mkdirSync(dir, { recursive: true });
process.env.DAYHUB_TEST_DATA = appData;

const scheduleFile = path.join(root, 'ingest', '2026秋季双方课表.dayhub-schedule.json');
const sourceImage = path.join(root, 'test-data', 'v0213-ocr.png');
let openQueue = [];
dialog.showOpenDialog = async () => openQueue.shift() ?? { canceled: true, filePaths: [] };
dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(appData, 'ui-shots-export.dayhub') });
dialog.showMessageBox = async () => ({ response: 1 });
dialog.showErrorBox = () => {};

require(path.join(root, 'dist', 'main.cjs'));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let panel, orb, bubble, mini, tip;
const shots = [];
const run = (code) => panel.webContents.executeJavaScript(code);
const change = async (cmd) => {
  await run(`window.dayhub.change(${JSON.stringify(cmd)}).then(()=>{})`);
  await wait(140);
};
const stamp = (ms) => new Date(ms + 8 * 3600000).toISOString().slice(0, 16);
const dateOf = (ms) => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
const addDays = (date, n) => {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function shot(id, meta = {}) {
  const image = await panel.webContents.capturePage();
  fs.writeFileSync(path.join(shotsDir, id + '.png'), image.toPNG());
  shots.push({ id, ...meta, file: `shots/${id}.png`, size: panel.getSize() });
  console.log('[shot]', id);
}
const setSize = async (width, height) => {
  panel.setSize(width, height);
  await wait(340);
};
const scrollTo = async (y) => {
  await run(`window.scrollTo(0,${y})`);
  await wait(300);
};
const scrollBottom = async () => {
  await run(`window.scrollTo(0,document.body.scrollHeight)`);
  await wait(320);
};
async function clickText(selector, text) {
  await run(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!el)throw new Error('not found: '+${JSON.stringify(text)});el.click();})()`);
  await wait(280);
}
// 切页可能撞上同一次渲染里的其它更新，因此点击后校验高亮项，最多重试三次。
const nav = async (label) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ok = await run(`(()=>{const el=[...document.querySelectorAll('.nav-item')].find(e=>e.textContent.includes(${JSON.stringify(label)}));if(!el)return false;el.click();return true})()`);
    await wait(460);
    const active = await run(`(()=>{const el=document.querySelector('.nav-item.active');return el?el.textContent:''})()`);
    if (ok && active.includes(label)) return true;
  }
  console.log('[nav] 未能切到：' + label);
  return false;
};
async function seatSchedule() {
  openQueue.push({ canceled: false, filePaths: [scheduleFile] });
  await clickText('button', '导入课表');
  await wait(600);
  await clickText('button', '确认载入课表');
  await wait(800);
}

const draft = (over = {}) => ({
  schemaVersion: 1, type: 'UNKNOWN', title: '', date: '', startTime: '', endTime: '', location: '', note: '',
  reminderMinutes: null, confidence: 0.8, warnings: [], missingFields: [], courseId: '', operation: 'CANCEL',
  newDate: '', first: null, last: null, correction: false, ...over,
});

app.whenReady().then(async () => {
  try {
    for (let i = 0; i < 120; i++) {
      const ws = BrowserWindow.getAllWindows();
      panel = ws.find((w) => !w.webContents.getURL().includes('#') && w.webContents.getURL().includes('index.html'));
      orb = ws.find((w) => w.webContents.getURL().endsWith('#orb'));
      bubble = ws.find((w) => w.webContents.getURL().endsWith('#bubble'));
      mini = ws.find((w) => w.webContents.getURL().endsWith('#mini'));
      tip = ws.find((w) => w.webContents.getURL().endsWith('#tip'));
      if (panel && orb && bubble && mini && tip && !panel.webContents.isLoading()) break;
      await wait(100);
    }
    if (!panel) throw new Error('panel window not ready');
    await wait(800);

    const now = Date.now();
    const today = dateOf(now);
    const tomorrow = addDays(today, 1);

    await setSize(1320, 880);
    await shot('01-today-empty', { title: '我的安排 · 空数据', entry: '启动默认页' });

    // 灌入一个有内容的日常场景
    await nav('课表管理');
    await seatSchedule();
    const state = await run('window.dayhub.get()');
    const partnerCourses = state.courses.filter((c) => c.person === 'partner');
    const partner = state.profiles.find((p) => p.id === 'partner');
    const mineCourses = state.courses.filter((c) => c.person === 'me');
    const course = partnerCourses[0] ?? mineCourses[0];
    const weekOf = (c) => (c.weeks.includes(1) ? 1 : Math.min(...c.weeks));
    const dateOfCourse = (c, week) =>
      addDays(partner.startDate, (week - 1) * 7 + c.weekday - 1);

    await change({ type: 'save', entity: 'tasks', value: { id: 'shot-task-1', title: '准备下周家长会材料', notes: '打印名单、准备发言提纲。', due: '', done: false, checklist: [], reminders: [] } });
    await change({ type: 'save', entity: 'tasks', value: { id: 'shot-task-2', title: '整理本单元测验卷', notes: '', due: `${tomorrow}T17:00`, done: false, checklist: [{ id: 'c1', text: '收齐两个班试卷', done: true }, { id: 'c2', text: '登记分数', done: false }], reminders: [120] } });
    await change({ type: 'save', entity: 'tasks', value: { id: 'shot-task-3', title: '提交开题报告', notes: '导师邮箱提交。', due: `${addDays(today, -2)}T09:00`, done: false, checklist: [], reminders: [] } });
    await change({ type: 'save', entity: 'events', value: { id: 'shot-event-1', title: '教研组例会', start: stamp(now - 30 * 60000), end: stamp(now + 40 * 60000), place: '办公楼 302', notes: '带上本周听课记录。', reminders: [], checklist: [] } });
    await change({ type: 'save', entity: 'events', value: { id: 'shot-event-2', title: '家长开放日', start: `${tomorrow}T15:00`, end: `${tomorrow}T17:00`, place: '信息楼报告厅', notes: '需要提前布置座位。', reminders: [60], checklist: [] } });
    if (course) {
      const date = dateOfCourse(course, weekOf(course));
      await change({ type: 'save', entity: 'exceptions', value: { id: 'shot-ex-1', courseId: course.id, date, cancelled: false, start: `${date}T10:00`, end: `${date}T10:45`, place: '实验楼 501' } });
    }

    const imageName = crypto.createHash('sha256').update(fs.readFileSync(sourceImage)).digest('hex') + '.png';
    fs.copyFileSync(sourceImage, path.join(appData, 'attachments', imageName));
    const notice = (id, over) => change({ type: 'save', entity: 'notices', value: { id, title: '', text: '', state: 'inbox', updatedAt: Date.now(), createdAt: Date.now(), originalText: '', sourceType: 'MANUAL', ...over } });
    await notice('shot-notice-1', { title: '年级组通知', text: '明天下午3点在信息楼报告厅进行新生大会，请提前10分钟到场。', originalText: '明天下午3点在信息楼报告厅进行新生大会，请提前10分钟到场。', parseStatus: 'NEEDS_REVIEW', detectedType: 'EVENT', confidence: 0.82, parsedData: draft({ type: 'EVENT', title: '新生大会（待核对）', date: tomorrow, startTime: '15:00', endTime: '17:00', location: '信息楼报告厅', note: '提前 10 分钟到场', reminderMinutes: 30, confidence: 0.82, warnings: ['结束时间来自正文推断，请核对'] }) });
    await notice('shot-notice-2', { title: '教研通知', text: '本周五前把开题报告交给导师。', originalText: '本周五前把开题报告交给导师。', parseStatus: 'NEEDS_REVIEW', detectedType: 'TODO', confidence: 0.9, parsedData: draft({ type: 'TODO', title: '提交开题报告（待核对）', date: tomorrow, startTime: '09:00', reminderMinutes: 1440, confidence: 0.9 }) });
    await notice('shot-notice-3', { title: '校历通知', text: '国庆假期调整已发布，请查阅办公群文件。', originalText: '国庆假期调整已发布，请查阅办公群文件。', parseStatus: 'CONFIRMED', detectedType: 'GENERAL_NOTICE', confidence: 0.95, processedAt: Date.now(), targetEntityType: 'notice', parsedData: draft({ type: 'GENERAL_NOTICE', title: '国庆假期调整（已处理）', confidence: 0.95 }) });
    await notice('shot-notice-4', { title: '无关消息', text: '转发一条与教学无关的活动广告。', originalText: '转发一条与教学无关的活动广告。', parseStatus: 'IGNORED', detectedType: 'GENERAL_NOTICE', confidence: 0.4 });
    const reminderFire = Math.ceil((Date.now() + 20000) / 60000) * 60000;
    await change({ type: 'save', entity: 'tasks', value: { id: 'shot-task-reminder', title: '交家长会报名表', notes: '', due: stamp(reminderFire + 24 * 3600000), done: false, checklist: [], reminders: [1440] } });
    await change({ type: 'settings', setup: true });
    await wait(500);

    // 我的安排
    await nav('我的安排');
    await wait(500);
    await shot('02-today', { title: '我的安排 · 有数据', entry: '我的安排' });

    // Ta 的课表
    await nav('Ta的课表');
    await wait(400);
    await shot('03-partner', { title: 'Ta 的课表', entry: '侧栏 → Ta的课表', partner: partner?.displayName });
    await setSize(1920, 1000);
    await shot('03b-partner-wide', { title: 'Ta 的课表 · 最大化 1920px', entry: '侧栏 → Ta的课表（最大化窗口）' });
    await setSize(1320, 880);

    // 课表管理
    await nav('课表管理');
    await wait(400);
    await shot('04-courses', { title: '课表管理', entry: '侧栏 → 课表管理' });

    // 事项与会议
    await nav('事项与会议');
    await wait(400);
    await shot('05-tasks', { title: '事项与会议', entry: '侧栏 → 事项与会议' });

    // 通知收件箱
    await nav('通知收件箱');
    await wait(500);
    await shot('06-inbox', { title: '通知收件箱', entry: '侧栏 → 通知收件箱' });

    // 未处理提醒
    await nav('未处理提醒');
    await wait(400);
    await shot('07-reminders', { title: '未处理提醒', entry: '侧栏 → 未处理提醒' });

    // 设置与备份
    await nav('设置与备份');
    await change({ type: 'settings', pet: { nightRest: true } });
    await wait(400);
    await shot('08-settings-top', { title: '设置与备份 · 顶部', entry: '侧栏 → 设置与备份' });
    await scrollBottom();
    await shot('09-settings-bottom', { title: '设置与备份 · 底部', entry: '设置与备份 → 向下滚动' });
    await scrollTo(0);

    // 窄窗
    await nav('我的安排');
    await setSize(750, 760);
    await shot('10-today-narrow', { title: '我的安排 · 窄窗 750px', entry: '我的安排（窄窗）' });

    const result = {
      generatedAt: new Date().toISOString(),
      app: { name: 'YD', version, packaged: app.isPackaged },
      output: outRoot,
      data: appData,
      shots,
    };
    fs.writeFileSync(path.join(outRoot, 'shots.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ output: outRoot, count: shots.length }, null, 2));
    app.exit(0);
  } catch (error) {
    fs.writeFileSync(path.join(outRoot, 'failure.txt'), (error && error.stack) || String(error));
    console.error(error);
    app.exit(1);
  }
});
