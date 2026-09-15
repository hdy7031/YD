const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

app.commandLine.appendSwitch('disable-gpu');

const root = path.join(__dirname, '..');
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
};
const phase = argument('--phase');
const dataDir = path.resolve(argument('--data-dir'));
const fixture = path.resolve(argument('--fixture'));
if (!['first', 'restart'].includes(phase) || !fs.existsSync(fixture)) throw new Error('ICS verifier 参数无效');
fs.mkdirSync(dataDir, { recursive: true });
process.env.DAYHUB_TEST_DATA = dataDir;
app.setPath('userData', dataDir);
app.setPath('sessionData', path.join(dataDir, 'session'));
app.setAppPath(root);

// Keep the test clock on the fixture day: 2026-09-18 09:30 Beijing.
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
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const panelReady = async () => {
  for (let index = 0; index < 160; index += 1) {
    const panel = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html') && !window.webContents.getURL().includes('#'));
    if (panel && !panel.webContents.isLoading()) return panel;
    await wait(100);
  }
  throw new Error('没有加载 YD 主窗口');
};

if (phase === 'first') {
  const original = dialog.showOpenDialog.bind(dialog);
  dialog.showOpenDialog = async (window, options) => {
    if (options?.filters?.some(filter => filter.extensions?.some(extension => String(extension).toLowerCase() === 'ics'))) {
      return { canceled: false, filePaths: [fixture] };
    }
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
    const selectDate = date => run("(()=>{const input=[...document.querySelectorAll('input[type=\"date\"]')].find(item=>item.getAttribute('aria-label')==='查看日期');if(!input)return false;const value=" + JSON.stringify(date) + ";const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;if(setter)setter.call(input,value);else input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
    await wait(1000);
    if (phase === 'first') {
      const initial = await run('window.dayhub.get()');
      check('fresh generic workspace has no Academic configuration', initial.profiles.length === 1 && initial.profiles[0].startDate === undefined);
      if (initial.settings.setup === false) {
        await run("window.dayhub.change({type:'completeSetup',value:{selfName:'测试用户',mode:'solo',petEnabled:false}})");
        await wait(500);
      }
      await run("document.querySelector('[data-tab=\"courses\"]').click(); true");
      await wait(350);
      const importButton = await run("[...document.querySelectorAll('.course-toolbar-actions button')].find(button=>button.textContent.includes('.ics'))?.textContent||''");
      check('Schedule page exposes the .ics import action', importButton.includes('.ics'), importButton);
      await run("[...document.querySelectorAll('.course-toolbar-actions button')].find(button=>button.textContent.includes('.ics')).click(); true");
      for (let index = 0; index < 100; index += 1) {
        if (await run('!!document.querySelector("[data-ics-import-dialog]")')) break;
        await wait(100);
      }
      check('real file picker result opens ICS Review', await run('!!document.querySelector("[data-ics-import-dialog]")'));
      const review = await run(`(()=>({
        file:document.querySelector('[data-ics-file-name]')?.textContent?.trim(),
        target:document.querySelector('[data-ics-target]')?.textContent?.trim(),
        events:document.querySelector('[data-ics-summary-events]')?.textContent?.trim(),
        valid:document.querySelector('[data-ics-summary-valid]')?.textContent?.trim(),
        issues:document.querySelector('[data-ics-summary-issues]')?.textContent?.trim(),
        candidate:document.querySelector('[data-ics-candidate]')?.textContent?.replace(/\\s+/g,' ').trim(),
      }))()`);
      check('Review shows file, target, count and candidate summary', review.file === 'basic.ics' && review.target === '测试用户' && review.events === '1 个事件' && review.valid === '1 个' && review.issues === '0 个', JSON.stringify(review));
      check('Review candidate shows time, title and location without raw technical fields', review.candidate.includes('项目评审') && review.candidate.includes('会议室 A101') && !review.candidate.includes('sourceRecordId') && !review.candidate.includes('originalValue'), review.candidate);
      const before = await run('window.dayhub.get()');
      check('formal Event data remains unchanged before final confirmation', before.events.length === 0, JSON.stringify(before.events));
      await run("document.querySelector('[data-ics-confirm]').click(); true");
      for (let index = 0; index < 120; index += 1) {
        const current = await run('window.dayhub.get()');
        if (current.events.length === 1) break;
        await wait(100);
      }
      const committed = await run('window.dayhub.get()');
      const saved = committed.events[0];
      check('final confirmation writes exactly one Event', committed.events.length === 1 && saved.title === '项目评审' && saved.person === committed.profiles[0].id);
      check('provenance retains source fingerprint, ICS importer and UID', saved.provenance?.importer === 'ics-v1' && saved.provenance?.sourceRecordId === 'basic-event@example.test' && saved.provenance?.source?.fingerprint?.length === 64, JSON.stringify(saved.provenance));
      await run("document.querySelector('[data-tab=\"today\"]').click(); true");
      await wait(350);
      check('daily view date control is available', await selectDate(saved.start.slice(0, 10)));
      await wait(350);
      check('Event appears in existing daily occurrence projection', await run("[...document.querySelectorAll('.daily-agenda-row')].some(row=>row.textContent.includes('项目评审'))"));
      const live = await run('window.dayhub.live()');
      check('imported Event participates in CurrentState as schedule', live.people.length === 1 && live.people[0].current.kind === 'meeting', JSON.stringify(live.people[0]?.current));
      check('success feedback is user-facing', await run("document.body.innerText.includes('已导入 1 项')"));
    } else {
      const restored = await run('window.dayhub.get()');
      check('fresh Electron restart restores the imported Event', restored.events.length === 1 && restored.events[0].title === '项目评审');
      check('restart preserves UID provenance and target Person', restored.events[0].person === restored.profiles[0].id && restored.events[0].provenance?.sourceRecordId === 'basic-event@example.test');
      await run("document.querySelector('[data-tab=\"today\"]').click(); true");
      await wait(350);
      check('restart daily view date control is available', await selectDate(restored.events[0].start.slice(0, 10)));
      await wait(350);
      check('restart still renders the Event in the daily Schedule', await run("[...document.querySelectorAll('.daily-agenda-row')].some(row=>row.textContent.includes('项目评审'))"));
      const live = await run('window.dayhub.live()');
      check('restart CurrentState still consumes the imported Event', live.people.length === 1 && live.people[0].current.kind === 'meeting', JSON.stringify(live.people[0]?.current));
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
