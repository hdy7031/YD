const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

app.commandLine.appendSwitch('disable-gpu');

const root = path.join(__dirname, '..');
const argument = name => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
};
const phase = argument('--phase');
const dataDir = path.resolve(argument('--data-dir'));
const csvFixture = path.resolve(argument('--csv'));
const xlsxFixture = path.resolve(argument('--xlsx'));
if (!['csv', 'xlsx', 'course', 'restart'].includes(phase) || !fs.existsSync(dataDir) || !fs.existsSync(csvFixture) || !fs.existsSync(xlsxFixture)) {
  throw new Error('表格导入 verifier 参数无效');
}

process.env.DAYHUB_TEST_DATA = dataDir;
app.setPath('userData', dataDir);
app.setPath('sessionData', path.join(dataDir, 'session'));
app.setAppPath(root);

// Keep the test clock on the fixture dates: 2026-09-18 09:30 Beijing.
const realNow = Date.now.bind(Date);
const simulated = new Date(2026, 8, 18, 9, 30, 0, 0).getTime();
const realAnchor = realNow();
Date.now = () => simulated + (realNow() - realAnchor);

const passed = [];
const errors = [];
const check = (name, value, detail = '') => {
  assert.ok(value, `${name}${detail ? `: ${detail}` : ''}`);
  passed.push(name);
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const panelReady = async () => {
  for (let index = 0; index < 160; index += 1) {
    const panel = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html') && !window.webContents.getURL().includes('#'));
    if (panel && !panel.webContents.isLoading()) return panel;
    await wait(100);
  }
  throw new Error('没有加载 YD 主窗口');
};

if (phase === 'csv' || phase === 'xlsx' || phase === 'course') {
  const original = dialog.showOpenDialog.bind(dialog);
  dialog.showOpenDialog = async (window, options) => {
    const extensions = (options?.filters ?? []).flatMap(filter => filter.extensions ?? []).map(value => String(value).toLowerCase());
    if (phase === 'csv' && extensions.includes('csv')) return { canceled: false, filePaths: [csvFixture] };
    if ((phase === 'xlsx' || phase === 'course') && extensions.includes('xlsx')) return { canceled: false, filePaths: [xlsxFixture] };
    return original(window, options);
  };
}

require(path.join(root, 'dist', 'main.cjs'));
app.on('web-contents-created', (_event, contents) => contents.on('console-message', (...args) => {
  const details = args[1];
  const level = details && typeof details === 'object' ? details.level : Number(details);
  const message = details && typeof details === 'object' ? details.message : args[2];
  if (level === 'error' || level >= 2 || level === 3) errors.push(String(message));
}));

app.whenReady().then(async () => {
  try {
    const panel = await panelReady();
    const run = code => panel.webContents.executeJavaScript(code);
    const waitFor = async (code, name, attempts = 160) => {
      for (let index = 0; index < attempts; index += 1) {
        if (await run(code)) return;
        await wait(100);
      }
      throw new Error(`等待 UI 条件超时：${name}`);
    };
    const click = async selector => run(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)return false;node.click();return true;})()`);
    const clickText = async (selector, text) => run(`(()=>{const node=[...document.querySelectorAll(${JSON.stringify(selector)})].find(item=>item.textContent?.includes(${JSON.stringify(text)}));if(!node)return false;node.click();return true;})()`);
    const setSelect = async (selector, value) => run(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)return false;const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')?.set;if(setter)setter.call(node,${JSON.stringify(String(value))});else node.value=${JSON.stringify(String(value))};node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));return node.value;})()`);
    const selectDate = date => run(`(()=>{const input=[...document.querySelectorAll('input[type="date"]')].find(item=>item.getAttribute('aria-label')==='查看日期');if(!input)return false;const value=${JSON.stringify(date)};const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;if(setter)setter.call(input,value);else input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);

    await wait(1000);
    const initial = await run('window.dayhub.get()');
    if (phase === 'csv') {
      check('fresh generic workspace has no Academic configuration', initial.profiles.length === 1 && initial.profiles[0].startDate === undefined);
      if (initial.settings.setup === false) {
        await run("window.dayhub.change({type:'completeSetup',value:{selfName:'测试用户',mode:'solo',petEnabled:false}})");
        await wait(500);
      }
    } else if (phase === 'xlsx') {
      check('CSV import is present before XLSX flow', initial.events.length === 1 && initial.events[0].title === '项目评审 CSV');
    } else if (phase === 'course') {
      check('CSV and XLSX imports are present before Course flow', initial.events.length === 2 && initial.events.some(event => event.title === '项目评审 CSV') && initial.events.some(event => event.title === '项目复盘 XLSX') && initial.courses.length === 0);
      const profile = initial.profiles[0];
      const academicCommand = {
        type: 'save',
        entity: 'profiles',
        value: {
          ...profile,
          startDate: '2026-09-14',
          weeks: 16,
          periods: [
            { start: '08:00', end: '08:45' },
            { start: '08:55', end: '09:40' },
            { start: '10:00', end: '10:45' },
            { start: '10:55', end: '11:40' },
          ],
        },
      };
      await run(`window.dayhub.change(${JSON.stringify(academicCommand)})`);
      await waitFor("window.dayhub.get().then(state=>state.profiles[0].startDate==='2026-09-14' && state.profiles[0].weeks===16 && state.profiles[0].periods.length===4)", 'Academic configuration');
      const configured = await run('window.dayhub.get()');
      check('Course flow uses an explicitly configured Academic target', configured.profiles[0].startDate === '2026-09-14' && configured.profiles[0].weeks === 16 && configured.courses.length === 0);
    } else {
      check('fresh Electron restart restores both tabular Events and Course', initial.events.length === 2 && initial.events.some(event => event.title === '项目评审 CSV') && initial.events.some(event => event.title === '项目复盘 XLSX') && initial.courses.length === 1 && initial.courses[0].title === '计算机视觉');
      const csvEvent = initial.events.find(event => event.title === '项目评审 CSV');
      const xlsxEvent = initial.events.find(event => event.title === '项目复盘 XLSX');
      const course = initial.courses[0];
      check('restart preserves target Person and source provenance', csvEvent?.person === initial.profiles[0].id && xlsxEvent?.person === initial.profiles[0].id && course?.person === initial.profiles[0].id && csvEvent?.provenance?.sourceRecordId === 'CSV#row-2' && xlsxEvent?.provenance?.sourceRecordId === '目标会议#row-4' && course?.provenance?.sourceRecordId === '课程表#row-3');
      check('restart preserves the Academic configuration used by Course', initial.profiles[0].startDate === '2026-09-14' && initial.profiles[0].weeks === 16 && initial.profiles[0].periods.length === 4);
      check('provenance does not retain the machine path', !JSON.stringify({ csv: csvEvent?.provenance, xlsx: xlsxEvent?.provenance, course: course?.provenance }).includes(dataDir));
      await click('[data-tab="today"]');
      await wait(350);
      check('restart daily view renders the CSV Event', await selectDate('2026-09-18'));
      await wait(350);
      check('restart CSV Event remains in the daily Schedule', await run("[...document.querySelectorAll('.daily-agenda-row')].some(row=>row.textContent.includes('项目评审 CSV'))"));
      const live = await run('window.dayhub.live()');
      check('restart CurrentState consumes the CSV Event', live.people.length === 1 && live.people[0].current.kind === 'meeting', JSON.stringify(live.people[0]?.current));
      check('restart daily view renders the XLSX Event', await selectDate('2026-09-19'));
      await wait(350);
      check('restart XLSX Event remains in the daily Schedule', await run("[...document.querySelectorAll('.daily-agenda-row')].some(row=>row.textContent.includes('项目复盘 XLSX'))"));
      check('restart Course occurrence remains in the daily Schedule', await selectDate('2026-09-18'));
      await wait(350);
      check('restart Course still renders through the existing occurrence projection', await run("[...document.querySelectorAll('.daily-agenda-row')].some(row=>row.textContent.includes('计算机视觉'))"));
    }

    if (phase === 'csv' || phase === 'xlsx') {
      await waitFor("!!document.querySelector('[data-tab=\"courses\"]')", 'Schedule management tab');
      await click('[data-tab="courses"]');
      await wait(350);
      check('Schedule page exposes the table import action', (await clickText('.course-toolbar-actions button', '导入表格')) === true);
      // The click above only returns true after clicking the action.
      await waitFor("!!document.querySelector('[data-tabular-import-dialog]')", 'table import dialog');

      const setup = await run(`(()=>({
        file:document.querySelector('[data-tabular-file-name]')?.textContent?.trim(),
        eventActive:document.querySelector('[data-tabular-mode="event"]')?.classList.contains('active'),
        target:document.querySelector('[data-tabular-target]')?.selectedOptions?.[0]?.textContent?.trim()
      }))()`);
      check('table setup fixes Event mode and target Person', setup.file === (phase === 'csv' ? 'schedule.csv' : 'schedule.xlsx') && setup.eventActive && setup.target === '我的安排', JSON.stringify(setup));
      await click('[data-tabular-next]');

      if (phase === 'xlsx') {
        await waitFor("!!document.querySelector('[data-tabular-sheet]')", 'XLSX sheet selection');
        const sheets = await run('[...document.querySelectorAll("[data-tabular-sheet]")].map(item=>item.textContent.replace(/\\s+/g," ").trim())');
        check('XLSX sheet selection lists visible sheets only', sheets.length === 3 && sheets.some(value => value.includes('不要导入')) && sheets.some(value => value.includes('目标会议')) && sheets.some(value => value.includes('课程表')) && !sheets.some(value => value.includes('隐藏数据')), JSON.stringify(sheets));
        check('selected XLSX sheet is not the first sheet', await run("(()=>{const node=document.querySelector('[data-tabular-sheet=\"目标会议\"]');if(!node)return false;node.click();return true;})()"));
        await wait(150);
        check('XLSX sheet selection visibly activates the chosen sheet', await run("document.querySelector('[data-tabular-sheet=\"目标会议\"]')?.classList.contains('active')"));
        await click('[data-tabular-next]');
        await waitFor("!!document.querySelector('[data-tabular-header-row]')", 'XLSX mapping step');
        check('XLSX initially suggests the first non-empty row as header', await run("document.querySelector('[data-tabular-header-row]')?.value === '1'"));
        await setSelect('[data-tabular-header-row]', 3);
        await wait(150);
        check('XLSX allows a non-first header row', await run("document.querySelector('[data-tabular-header-row]')?.value === '3'"));
      } else {
        await waitFor("!!document.querySelector('[data-tabular-header-row]')", 'CSV mapping step');
        check('CSV mapping starts at the first row header', await run("document.querySelector('[data-tabular-header-row]')?.value === '1'"));
      }

      const mapping = await run('[...document.querySelectorAll(".tabular-mapping-row select")].map(select=>select.value)');
      const expected = phase === 'csv' ? ['location', 'title', 'endTime', 'date', 'notes', 'startTime'] : ['location', 'title', 'endTime', 'date', 'notes', 'startTime'];
      check('column mapping is explicit and independent of source order', JSON.stringify(mapping) === JSON.stringify(expected), JSON.stringify(mapping));
      await click('[data-tabular-next]');
      await waitFor("!!document.querySelector('[data-tabular-candidate]')", 'tabular candidate review');

      const review = await run(`(()=>({
        file:document.querySelector('.tabular-review-step dd')?.textContent?.trim(),
        sheet:[...document.querySelectorAll('.tabular-review-step dt')].find(item=>item.textContent==='工作表')?.nextElementSibling?.textContent?.trim(),
        mode:[...document.querySelectorAll('.tabular-review-step dt')].find(item=>item.textContent==='导入类型')?.nextElementSibling?.textContent?.trim(),
        rows:document.querySelector('[data-tabular-summary-rows]')?.textContent?.trim(),
        valid:document.querySelector('[data-tabular-summary-valid]')?.textContent?.trim(),
        issues:document.querySelector('[data-tabular-summary-issues]')?.textContent?.trim(),
        candidate:document.querySelector('[data-tabular-candidate]')?.textContent?.replace(/\\s+/g,' ').trim()
      }))()`);
      const expectedTitle = phase === 'csv' ? '项目评审 CSV' : '项目复盘 XLSX';
      const expectedPlace = phase === 'csv' ? '会议室 A' : '会议室 B';
      check('Review shows selected table, row counts and candidate summary', review.sheet === (phase === 'csv' ? 'CSV' : '目标会议') && review.mode === '普通日程' && review.rows === '1 行' && review.valid === '1 条' && review.issues === '0 条' && review.candidate.includes(expectedTitle) && review.candidate.includes(expectedPlace) && review.candidate.includes('来源第'), JSON.stringify(review));
      check('Review candidate does not expose implementation metadata', !review.candidate.includes('sourceRecordId') && !review.candidate.includes('originalValue'), review.candidate);

      const before = await run('window.dayhub.get()');
      check('formal Schedule remains unchanged before confirmation', before.events.length === (phase === 'csv' ? 0 : 1), JSON.stringify(before.events));
      await click('[data-tabular-confirm]');
      const expectedCount = phase === 'csv' ? 1 : 2;
      await waitFor(`window.dayhub.get().then(state=>state.events.length===${expectedCount})`, 'tabular commit');
      const committed = await run('window.dayhub.get()');
      const saved = committed.events.find(event => event.title === expectedTitle);
      check('final confirmation writes exactly one selected Event', committed.events.length === expectedCount && saved?.person === committed.profiles[0].id && saved?.place === expectedPlace, JSON.stringify(saved));
      check('provenance retains importer, source fingerprint and row identity', saved?.provenance?.importer === 'tabular-v1' && saved?.provenance?.source?.originalName === (phase === 'csv' ? 'schedule.csv' : 'schedule.xlsx') && saved?.provenance?.source?.fingerprint?.length === 64 && saved?.provenance?.sourceRecordId === (phase === 'csv' ? 'CSV#row-2' : '目标会议#row-4'), JSON.stringify(saved?.provenance));
      check('provenance does not retain the machine path', !JSON.stringify(saved?.provenance).includes(dataDir));

      await click('[data-tab="today"]');
      await wait(350);
      const date = phase === 'csv' ? '2026-09-18' : '2026-09-19';
      check('daily view date control is available', await selectDate(date));
      await wait(350);
      check('imported Event appears in existing daily Schedule', await run(`[...document.querySelectorAll('.daily-agenda-row')].some(row=>row.textContent.includes(${JSON.stringify(expectedTitle)}))`));
      if (phase === 'csv') {
        const live = await run('window.dayhub.live()');
        check('imported CSV Event participates in CurrentState as schedule', live.people.length === 1 && live.people[0].current.kind === 'meeting', JSON.stringify(live.people[0]?.current));
      }
      check('success feedback is user-facing', await run("document.body.innerText.includes('已导入 1 项')"));
    }

    if (phase === 'course') {
      await waitFor("!!document.querySelector('[data-tab=\"courses\"]')", 'Schedule management tab for Course flow');
      await click('[data-tab="courses"]');
      await wait(350);
      check('Schedule page exposes the table import action for Course flow', (await clickText('.course-toolbar-actions button', '导入表格')) === true);
      await waitFor("!!document.querySelector('[data-tabular-import-dialog]')", 'Course table import dialog');
      const setup = await run(`(()=>({
        file:document.querySelector('[data-tabular-file-name]')?.textContent?.trim(),
        eventActive:document.querySelector('[data-tabular-mode="event"]')?.classList.contains('active'),
        target:document.querySelector('[data-tabular-target]')?.selectedOptions?.[0]?.textContent?.trim(),
        academicWarning:!!document.querySelector('[data-tabular-academic-required]')
      }))()`);
      check('Course setup starts with the configured target and no Academic warning', setup.file === 'schedule.xlsx' && setup.eventActive && setup.target === '我的安排' && !setup.academicWarning, JSON.stringify(setup));
      await click('[data-tabular-mode="course"]');
      await wait(150);
      check('Course mode is an explicit user choice', await run("document.querySelector('[data-tabular-mode=\"course\"]')?.classList.contains('active') && !document.querySelector('[data-tabular-mode=\"event\"]')?.classList.contains('active')"));
      await click('[data-tabular-next]');
      await waitFor("!!document.querySelector('[data-tabular-sheet]')", 'Course XLSX sheet selection');
      const sheets = await run('[...document.querySelectorAll("[data-tabular-sheet]")].map(item=>item.textContent.replace(/\\s+/g," ").trim())');
      check('Course flow can choose the dedicated row-wise sheet', sheets.length === 3 && sheets.some(value => value.includes('课程表')) && !sheets.some(value => value.includes('隐藏数据')), JSON.stringify(sheets));
      check('Course flow selects the course sheet', await run("(()=>{const node=document.querySelector('[data-tabular-sheet=\"课程表\"]');if(!node)return false;node.click();return true;})()"));
      await wait(150);
      await click('[data-tabular-next]');
      await waitFor("!!document.querySelector('[data-tabular-header-row]')", 'Course mapping step');
      check('Course flow initially identifies the first non-empty row', await run("document.querySelector('[data-tabular-header-row]')?.value === '1'"));
      await setSelect('[data-tabular-header-row]', 2);
      await wait(150);
      const mapping = await run('[...document.querySelectorAll(".tabular-mapping-row select")].map(select=>select.value)');
      check('Course mapping uses semantic fields in source order', JSON.stringify(mapping) === JSON.stringify(['title', 'weekday', 'weeks', 'periodRange', 'location']), JSON.stringify(mapping));
      await click('[data-tabular-next]');
      await waitFor("!!document.querySelector('[data-tabular-candidate]')", 'Course candidate review');
      const review = await run(`(()=>({
        sheet:[...document.querySelectorAll('.tabular-review-step dt')].find(item=>item.textContent==='工作表')?.nextElementSibling?.textContent?.trim(),
        mode:[...document.querySelectorAll('.tabular-review-step dt')].find(item=>item.textContent==='导入类型')?.nextElementSibling?.textContent?.trim(),
        rows:document.querySelector('[data-tabular-summary-rows]')?.textContent?.trim(),
        valid:document.querySelector('[data-tabular-summary-valid]')?.textContent?.trim(),
        issues:document.querySelector('[data-tabular-summary-issues]')?.textContent?.trim(),
        candidate:document.querySelector('[data-tabular-candidate]')?.textContent?.replace(/\\s+/g,' ').trim()
      }))()`);
      check('Course Review shows semantic fields and selected sheet', review.sheet === '课程表' && review.mode === '课程表' && review.rows === '1 行' && review.valid === '1 条' && review.issues === '0 条' && review.candidate.includes('计算机视觉') && review.candidate.includes('星期五') && review.candidate.includes('研楼201'), JSON.stringify(review));
      const before = await run('window.dayhub.get()');
      check('formal Course data remains unchanged before confirmation', before.courses.length === 0 && before.events.length === 2, JSON.stringify(before));
      await click('[data-tabular-confirm]');
      await waitFor('window.dayhub.get().then(state=>state.courses.length===1)', 'Course tabular commit');
      const committed = await run('window.dayhub.get()');
      const saved = committed.courses.find(course => course.title === '计算机视觉');
      check('final confirmation writes one Course to the existing domain', committed.courses.length === 1 && saved?.person === committed.profiles[0].id && saved?.weekday === 5 && saved?.first === 3 && saved?.last === 4 && JSON.stringify(saved?.weeks) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) && saved?.place === '研楼201', JSON.stringify(saved));
      check('Course provenance retains importer, source fingerprint and row identity', saved?.provenance?.importer === 'tabular-v1' && saved?.provenance?.source?.originalName === 'schedule.xlsx' && saved?.provenance?.source?.fingerprint?.length === 64 && saved?.provenance?.sourceRecordId === '课程表#row-3', JSON.stringify(saved?.provenance));
      check('Course provenance does not retain the machine path', !JSON.stringify(saved?.provenance).includes(dataDir));
      await click('[data-tab="today"]');
      await wait(350);
      check('Course occurrence date control is available', await selectDate('2026-09-18'));
      await wait(350);
      check('imported Course appears through the existing occurrence projection', await run("[...document.querySelectorAll('.daily-agenda-row')].some(row=>row.textContent.includes('计算机视觉'))"));
      check('Course success feedback is user-facing', await run("document.body.innerText.includes('已导入 1 项')"));
    }

    check('renderer emitted no console errors', errors.length === 0, errors.join(' | '));
    const report = { phase, dataDir, passed, errors };
    fs.writeFileSync(path.join(dataDir, `${phase}-report.json`), JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify(report, null, 2));
    app.exit(0);
  } catch (error) {
    fs.writeFileSync(path.join(dataDir, `${phase}-failure.txt`), String(error?.stack || error), 'utf8');
    console.error(error);
    app.exit(1);
  }
});
