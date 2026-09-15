// YD Phase 5B1 · 一天安排列表的信息密度与语义（targeted UI verifier）。
//
// 运行：npx electron verify-v051-day-density.cjs
//
// 锁死四件事（只读取真实 DOM，不重写任何数据）：
//   1. provenance（"依据教师课表图片录入…"）只属于详情层，不出现在日常列表行；
//   2. 没有地点就省略地点字段，不显示"地点未填写"；
//   3. 真实课程按课程语义显示（授课不显示类型标签、教研显示教研、有编辑课程入口），
//      不会退化成"会议 / 活动"；真正的事件仍然显示"会议 / 活动"；
//   4. 摘要只报时间范围本身（09:50–17:30），行高明显压缩。
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configureIsolatedUserData, seedWorkspace } = require('./scripts/electron-test-profile.cjs');

const root = __dirname;
const output = path.join(root, 'test-data', 'v051-day-density');
fs.mkdirSync(output, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-v051-day-density-'));
configureIsolatedUserData('v051-day-density', dataDir);
seedWorkspace(dataDir, 'solo');
app.setAppPath(root);

const report = [];
const check = (name, ok, detail = '') => report.push({ name, ok: !!ok, detail });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PROVENANCE = '依据教师课表图片录入；暂按 20 教学周，每个节次独立保存以正确显示课间';

require('./dist/main.cjs');

app.whenReady().then(async () => {
  try {
    let panel;
    for (let i = 0; i < 140; i++) {
      panel = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html') && !w.webContents.getURL().includes('#'));
      if (panel && !panel.webContents.isLoading()) break;
      await wait(100);
    }
    if (!panel) throw new Error('没有渲染出主窗口');
    const run = (code) => panel.webContents.executeJavaScript(code);
    await wait(900);

    // 把工作区对齐到"本周的第一教学周"，再写入两门今天的课程 + 一场会议。
    await run(`(async()=>{
      const state = await window.dayhub.get();
      const now = Date.now();
      const day = new Date(now + 8 * 3600000);
      const iso = day.toISOString().slice(0, 10);
      const weekday = day.getUTCDay() || 7;
      const monday = new Date(Date.parse(iso + 'T00:00:00Z') - (weekday - 1) * 86400000).toISOString().slice(0, 10);
      const self = state.profiles[0];
      await window.dayhub.change({ type: 'save', entity: 'profiles', value: { ...self, startDate: monday, weeks: 20 } });
      const base = { person: self.id, weekday, first: 3, last: 3, weeks: [1], reminders: [], checklist: [], updatedAt: now, createdAt: now };
      await window.dayhub.change({ type: 'save', entity: 'courses', value: { ...base, id: 'density-teaching', title: '高二（105）语文', place: '', notes: ${JSON.stringify(PROVENANCE)}, activity: 'teaching' } });
      await window.dayhub.change({ type: 'save', entity: 'courses', value: { ...base, id: 'density-research', title: '高一高二语文教研', place: '教学楼 A302', notes: '', activity: 'research', first: 4, last: 4 } });
      const today = iso;
      await window.dayhub.change({ type: 'save', entity: 'events', value: { id: 'density-event', person: self.id, title: '教研组会', start: today + 'T14:00', end: today + 'T15:00', place: '会议室 2', notes: '', reminders: [], checklist: [], updatedAt: now, createdAt: now } });
      return true;
    })()`);
    await wait(1200);

    const view = await run(`(()=>{
      const rows=[...document.querySelectorAll('.daily-agenda-row')].map(row=>({
        text:row.innerText.replace(/\\s+/g,' ').trim(),
        height:Math.round(row.getBoundingClientRect().height),
        kindBadges:[...row.querySelectorAll('.daily-agenda-kind')].map(e=>e.textContent.trim()),
        places:[...row.querySelectorAll('.daily-agenda-place')].map(e=>e.textContent.trim()),
        // 菜单在关闭的 <details> 里：innerText 取不到，必须用 textContent。
        menu:row.querySelector('.action-menu-pop')?row.querySelector('.action-menu-pop').textContent.replace(/\\s+/g,' ').trim():'',
      }));
      return {
        rows,
        range:(document.querySelector('.daily-summary-range')||{}).textContent||'',
        count:(document.querySelector('.daily-summary-count')||{}).textContent||'',
        bodyText:document.body.innerText,
      };
    })()`);

    const teaching = view.rows.find((row) => row.text.includes('高二（105）语文'));
    const research = view.rows.find((row) => row.text.includes('高一高二语文教研'));
    const meeting = view.rows.find((row) => row.text.includes('教研组会'));
    check('今天渲染出 2 门课程 + 1 场会议', view.rows.length === 3 && !!teaching && !!research && !!meeting,
      JSON.stringify(view.rows.map((row) => row.text.slice(0, 40))));
    check('列表行不再出现 provenance（导入说明）',
      !view.bodyText.includes('依据教师课表图片录入') && !view.bodyText.includes('每个节次独立保存'),
      teaching ? teaching.text.slice(0, 80) : 'no row');
    check('没有地点时省略地点字段（不再显示"地点未填写"）',
      !view.bodyText.includes('地点未填写') && (teaching ? teaching.places.length === 0 : false),
      teaching ? JSON.stringify(teaching.places) : 'no row');
    check('有地点才显示地点', !!research && research.places.includes('教学楼 A302'), research ? JSON.stringify(research.places) : 'no row');
    check('真实课程不会显示成"会议 / 活动"，也不重复无信息量的"授课"标签',
      !!teaching && !teaching.text.includes('会议 / 活动') && !teaching.text.includes('授课') && teaching.kindBadges.length === 0,
      teaching ? JSON.stringify({ badges: teaching.kindBadges, text: teaching.text }) : 'no row');
    check('教研仍然是教研（保留真实区分）', !!research && research.kindBadges.includes('教研'),
      research ? JSON.stringify(research.kindBadges) : 'no row');
    check('课程行提供课程菜单（编辑课程 / 本次调课）',
      !!teaching && teaching.menu.includes('编辑课程') && teaching.menu.includes('本次调课'),
      teaching ? teaching.menu : 'no row');
    check('真正的事件仍然显示"会议 / 活动"', !!meeting && meeting.text.includes('会议 / 活动'),
      meeting ? meeting.text : 'no row');
    check('摘要只报时间范围（HH:MM–HH:MM），没有标签前缀',
      /^\d{2}:\d{2}–\d{2}:\d{2}$/.test(view.range.trim()) && !view.range.includes('第一项') && !view.range.includes('时间范围'),
      JSON.stringify(view.range));
    check('数量摘要保留（今天 3 项安排）', /今天\s*3\s*项安排/.test(view.count), JSON.stringify(view.count));
    // 密度：行高明显压缩，而且"数据里带 provenance 的课程"不会比别的行更高（说明它不再被渲染出来撑高卡片）。
    check('普通课程行明显压缩（行高 ≤ 76px 且各行等高）',
      view.rows.every((row) => row.height <= 76)
      && !!teaching && !!research && Math.abs(teaching.height - research.height) <= 2,
      JSON.stringify(view.rows.map((row) => row.height)));
    fs.writeFileSync(path.join(output, 'day-density.png'), (await panel.webContents.capturePage()).toPNG());

    const failed = report.filter((entry) => !entry.ok);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ dataDir, report }, null, 2));
    console.log(JSON.stringify({ passed: report.length - failed.length, failed: failed.length, failures: failed }, null, 2));
    app.exit(failed.length ? 1 : 0);
  } catch (error) {
    console.error(error);
    fs.writeFileSync(path.join(output, 'failure.txt'), String(error && error.stack || error));
    app.exit(1);
  }
});
