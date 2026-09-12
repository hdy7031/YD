const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),output=path.join(root,'test-data','v021-visual-'+Date.now());fs.mkdirSync(output,{recursive:true});
app.setAppPath(root);process.env.DAYHUB_TEST_DATA=output;require('../dist/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{try{
 let panel,orb;for(let i=0;i<100;i++){const ws=BrowserWindow.getAllWindows();panel=ws.find(w=>!w.webContents.getURL().includes('#')&&w.webContents.getURL().includes('index.html'));orb=ws.find(w=>w.webContents.getURL().endsWith('#orb'));if(panel&&orb&&!panel.webContents.isLoading()&&!orb.webContents.isLoading())break;await wait(100);}
 const run=code=>panel.webContents.executeJavaScript(code),schedule=JSON.parse(fs.readFileSync(path.join(__dirname,'..','ingest','2026秋季双方课表.dayhub-schedule.json'),'utf8'));
 await run(`window.dayhub.change({type:'importSchedule',value:${JSON.stringify(schedule)}})`);await wait(250);
 await run("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='课表管理').click()");await wait(150);
 await run(`(()=>{const s=document.querySelector('[aria-label="查看教学周"]'),set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,'9');s.dispatchEvent(new Event('change',{bubbles:true}));})()`);await wait(200);
 fs.writeFileSync(path.join(output,'课表第9周.png'),(await panel.webContents.capturePage()).toPNG());
 await run("Promise.all([window.dayhub.change({type:'save',entity:'tasks',value:{id:'sample-task',title:'准备机器学习课程资料',due:'2026-09-15T20:00',notes:'整理阅读材料与问题',done:false,checklist:[],reminders:[]}}),window.dayhub.change({type:'save',entity:'events',value:{id:'sample-meeting',title:'课题组周会',start:'2026-09-16T19:00',end:'2026-09-16T20:00',place:'线上会议',notes:'汇报本周进展',checklist:[],reminders:[]}})])");await wait(150);
 await run("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='事项与会议').click()");await wait(200);
  fs.writeFileSync(path.join(output,'事项与会议.png'),(await panel.webContents.capturePage()).toPNG());
  const now=Date.now(),local=t=>new Date(t+8*3600000).toISOString(),date=local(now).slice(0,10),time=t=>local(t).slice(11,16),day=(new Date(date+'T12:00:00Z').getUTCDay()||7),monday=new Date(Date.parse(date+'T00:00:00+08:00')-(day-1)*86400000+8*3600000).toISOString().slice(0,10);
  await run(`window.dayhub.change({type:'importSchedule',value:{format:'dayhub-schedule',version:1,termName:'视觉状态',profiles:[{id:'partner',name:'Ta',startDate:'${monday}',weeks:1,periods:[{start:'${time(now-60000)}',end:'${time(now+600000)}'}]}],courses:[{id:'visual-teaching',person:'partner',title:'语文课',place:'教室',notes:'',activity:'teaching',weekday:${day},first:1,last:1,weeks:[1],reminders:[],checklist:[]}]}})`);
  await run(`window.dayhub.change({type:'save',entity:'events',value:{id:'visual-my-meeting',title:'我的会议',start:'${local(now-60000).slice(0,16)}',end:'${local(now+600000).slice(0,16)}',place:'线上',notes:'',checklist:[],reminders:[]}})`);await wait(1300);
  fs.writeFileSync(path.join(output,'桌宠上课状态.png'),(await orb.webContents.capturePage()).toPNG());
  await run("window.dayhub.change({type:'settings',pet:{mode:'orb'}})");await wait(200);
 fs.writeFileSync(path.join(output,'双方分半悬浮球.png'),(await orb.webContents.capturePage()).toPNG());
 console.log(JSON.stringify({output,files:fs.readdirSync(output).filter(x=>x.endsWith('.png'))},null,2));app.quit();
}catch(e){console.error(e);app.exit(1);}});
