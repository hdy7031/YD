const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const output = path.join(root, 'test-data', `product-demo-0213-${Date.now()}`);
const preload = path.join(__dirname, 'product-demo-preload.cjs');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', output);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { console.error('capture timeout'); app.exit(1); }, 60000);

app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  const options = { show:false, frame:false, backgroundColor:'#f7f8fa', webPreferences:{preload,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false} };
  const panel = new BrowserWindow({ ...options, width:1366, height:900, minWidth:750, minHeight:550 });
  const orb = new BrowserWindow({ ...options, width:300, height:128, transparent:true, backgroundColor:'#00000000' });
  const mini = new BrowserWindow({ ...options, width:360, height:270, transparent:true, backgroundColor:'#00000000' });
  const tip = new BrowserWindow({ ...options, width:330, height:84, transparent:true, backgroundColor:'#00000000' });
  const bubble = new BrowserWindow({ ...options, width:360, height:180, transparent:true, backgroundColor:'#00000000' });
  try {
    const page = path.join(root, 'dist', 'index.html');
    await Promise.all([panel.loadFile(page),orb.loadFile(page,{hash:'orb'}),mini.loadFile(page,{hash:'mini'}),tip.loadFile(page,{hash:'tip'}),bubble.loadFile(page,{hash:'bubble'})]);
    await wait(500);
    const run = code => panel.webContents.executeJavaScript(code);
    const shot = async (name, target=panel) => {
      const wake = target === panel;
      if (wake) { target.setOpacity(0); target.showInactive(); }
      target.webContents.invalidate(); await wait(90);
      fs.writeFileSync(path.join(output, `${name}.png`),(await target.webContents.capturePage()).toPNG());
      if (wake) { target.hide(); target.setOpacity(1); }
    };
    const click = async (label, prefix=false) => {
      await run(`(() => { const el=[...document.querySelectorAll('button')].find(b=>${prefix ? `b.textContent.trim().startsWith(${JSON.stringify(label)})` : `b.textContent.trim()===${JSON.stringify(label)}`}); if(!el)throw new Error('missing '+${JSON.stringify(label)}); el.click(); })()`);
      await wait(220);
    };
    const closeModal = async () => {
      await run(`(() => { const d=document.querySelector('[role="dialog"]'); const el=[...d.querySelectorAll('button')].find(b=>['取消','关闭'].includes(b.textContent.trim())); if(!el)throw new Error('modal close missing'); el.click(); })()`);
      await wait(160);
    };

    await shot('01-首次使用与作息引导');
    await run(`window.dayhub.change({type:'settings',setup:true})`); await wait(160);
    await shot('02-首页工作区');
    await click('Ta的课表'); await shot('03-Ta的课表与状态');
    await click('课表管理'); await shot('04-课表管理周网格');
    await run(`document.querySelector('.exceptions-panel').scrollIntoView({block:'start'})`); await wait(160); await shot('05-单次调课记录');
    await click('事项与会议'); await shot('06-事项与会议总览');
    await run(`(() => { const input=document.querySelector('input[aria-label="搜索事项与会议"]'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(input,'不存在的事项'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`); await wait(160); await shot('07-搜索无结果状态');
    await run(`(() => { const input=document.querySelector('input[aria-label="搜索事项与会议"]'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(input,''); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await click('通知收件箱'); await shot('08-通知大厅宽屏');
    await run(`document.querySelector('.status-NEEDS_REVIEW').click()`); await wait(180); await shot('09-通知核对详情宽屏');
    panel.setSize(750,850); await wait(180); await shot('10-通知详情窄窗');
    panel.setSize(1366,900); await wait(180); await click('删除通知'); await shot('11-通知删除确认'); await click('取消'); await click('返回通知大厅');
    await click('未处理提醒',true); await shot('12-未处理提醒');
    await click('设置与备份'); await run(`window.scrollTo(0,0)`); await shot('13-设置与备份');

    await click('我的安排'); await click('新建待办'); await shot('14-待办编辑器'); await closeModal();
    await click('新建会议'); await shot('15-会议活动编辑器'); await closeModal();
    await click('课表管理'); await click('学校作息'); if(!await run(`!!document.querySelector('[role="dialog"][aria-label="学校作息与学期"]')`))throw new Error('profile dialog missing'); await shot('16-学期与节次编辑器'); await closeModal();
    await click('添加课程'); await shot('17-课程编辑器'); await closeModal();
    await run(`document.querySelector('.course-block').click()`); await wait(180); await shot('18-已有课程编辑与管理');
    await click('删除课程'); await shot('19-课程删除确认'); await click('取消');
    await click('载入整理后的课表'); await wait(180); await shot('20-课表导入核对'); await closeModal();
    await click('我的安排'); await click('本次调课 / 停课'); if(!await run(`!!document.querySelector('[role="dialog"][aria-label="仅修改这一次课程"]')`))throw new Error('exception dialog missing'); await shot('21-单次调课停课编辑器'); await closeModal();

    await shot('22-专属角色桌宠',orb);
    orb.setSize(96,96); await orb.loadFile(page,{query:{mode:'orb'},hash:'orb'}); await wait(240); await shot('23-玻璃悬浮球',orb);
    await shot('24-悬浮球状态提示',tip); await shot('25-双方状态迷你面板',mini); await shot('26-桌面提醒气泡',bubble);

    const manifest={version:'0.2.13',capturedAt:new Date().toISOString(),output,files:fs.readdirSync(output).filter(x=>x.endsWith('.png')).sort()};
    fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2));
    console.log(JSON.stringify(manifest));
    clearTimeout(deadline); app.exit(0);
  } catch (error) {
    clearTimeout(deadline); fs.writeFileSync(path.join(output,'failure.txt'),error.stack||String(error));
    fs.writeFileSync(path.join(output,'failure.png'),(await panel.webContents.capturePage()).toPNG());
    console.error(error); app.exit(1);
  }
});
