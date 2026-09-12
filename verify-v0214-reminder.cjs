// Real-clock reminder acceptance with an isolated SQLite database.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const output=path.join(__dirname,'test-data','v0214-reminder-'+Date.now());fs.mkdirSync(output,{recursive:true});process.env.DAYHUB_TEST_DATA=output;
const passed=[],check=(name,value)=>{assert.ok(value,name);passed.push(name);},wait=ms=>new Promise(r=>setTimeout(r,ms));
const deadline=setTimeout(()=>{fs.writeFileSync(path.join(output,'failure.txt'),'Reminder acceptance timeout');app.exit(1);},150000);
require('./dist/main.cjs');
app.whenReady().then(async()=>{let panel,bubble;try{
  for(let i=0;i<120;i++){const windows=BrowserWindow.getAllWindows();panel=windows.find(w=>!w.webContents.getURL().includes('#')&&w.webContents.getURL().includes('index.html'));bubble=windows.find(w=>w.webContents.getURL().endsWith('#bubble'));if(panel&&bubble&&!panel.webContents.isLoading()&&!bubble.webContents.isLoading())break;await wait(100);}
  check('主窗口与提醒气泡窗口加载',panel&&bubble);const run=code=>panel.webContents.executeJavaScript(code);
  const due=Math.ceil((Date.now()+5000)/60000)*60000,stamp=new Date(due+8*3600000).toISOString().slice(0,16);
  await run(`window.dayhub.change({type:'save',entity:'tasks',value:{id:'real-clock',title:'真实计时验收',due:'${stamp}',notes:'',done:false,checklist:[],reminders:[0]}})`);
  check('未来提醒为scheduled',await run("window.dayhub.get().then(s=>s.reminders.some(r=>r.target==='tasks:real-clock'&&r.status==='scheduled'))"));
  let live;while(Date.now()<due+8000){live=await run('window.dayhub.live()');if(live.bubble?.text.includes('真实计时验收'))break;await wait(200);}
  check('真实时钟到点显示气泡',live?.bubble?.text.includes('真实计时验收')&&bubble.isVisible());
  const reminder=await run("window.dayhub.get().then(s=>s.reminders.find(r=>r.target==='tasks:real-clock'&&r.status==='due'))");check('到点状态为due',!!reminder);
  await run(`window.dayhub.change({type:'snooze',id:${JSON.stringify(reminder.id)},minutes:30})`);const state=await run('window.dayhub.get()');
  check('延后后原提醒为snoozed',state.reminders.some(r=>r.id===reminder.id&&r.status==='snoozed'));
  const snoozed=state.reminders.find(r=>r.id===reminder.id);
  check('只生成一条从处理时刻起30分钟的scheduled',!!snoozed?.handledAt&&state.reminders.filter(r=>r.target==='tasks:real-clock'&&r.status==='scheduled'&&r.snoozedFrom===reminder.id&&r.snoozeMinutes===30&&r.due===snoozed.handledAt+30*60000).length===1);
  check('延后提醒不完成Todo',state.tasks.find(t=>t.id==='real-clock').done===false);
  check('未处理提醒从统一快照消失',(await run('window.dayhub.live()')).pending===0);
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({due,passed},null,2));clearTimeout(deadline);app.quit();
}catch(error){clearTimeout(deadline);fs.writeFileSync(path.join(output,'failure.txt'),error.stack||String(error));console.error(error);app.exit(1);}});
