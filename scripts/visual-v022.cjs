const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),output=path.join(root,'test-data','v027-visual-'+Date.now());
fs.mkdirSync(output,{recursive:true});app.setAppPath(root);process.env.DAYHUB_TEST_DATA=output;require('../dist/main.cjs');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{try{
  let panel,orb,mini,tip;
  for(let i=0;i<100;i++){
    const windows=BrowserWindow.getAllWindows();
    panel=windows.find(w=>!w.webContents.getURL().includes('#')&&w.webContents.getURL().includes('index.html'));
    orb=windows.find(w=>w.webContents.getURL().endsWith('#orb'));
    mini=windows.find(w=>w.webContents.getURL().endsWith('#mini'));
    tip=windows.find(w=>w.webContents.getURL().endsWith('#tip'));
    if(panel&&orb&&mini&&tip&&!panel.webContents.isLoading()&&!orb.webContents.isLoading()&&!mini.webContents.isLoading()&&!tip.webContents.isLoading())break;
    await wait(100);
  }
  const run=code=>panel.webContents.executeJavaScript(code);
  const schedule=JSON.parse(fs.readFileSync(path.join(root,'ingest','2026秋季双方课表.dayhub-schedule.json'),'utf8'));
  await run(`window.dayhub.change({type:'importSchedule',value:${JSON.stringify(schedule)}})`);
  await run("window.dayhub.change({type:'settings',pet:{mode:'orb',size:'medium'}})");await wait(180);
  const live=await run('window.dayhub.live()');
  orb.webContents.send('dayhub:live',{...live,people:live.people.map(p=>({...p,label:p.person==='me'?'会议/活动中':'暂无已记录安排'}))});await wait(80);
  fs.writeFileSync(path.join(output,'双状态核心悬浮球.png'),(await orb.webContents.capturePage()).toPNG());
  await orb.webContents.executeJavaScript("window.dayhub.presence('enter','me')");await wait(100);
  fs.writeFileSync(path.join(output,'悬停状态提示.png'),(await tip.webContents.capturePage()).toPNG());
  await orb.webContents.executeJavaScript("window.dayhub.presence('leave')");await wait(40);
  await orb.webContents.executeJavaScript("document.querySelector('.pet-handle').click()");await wait(120);
  fs.writeFileSync(path.join(output,'紧凑双方状态.png'),(await mini.webContents.capturePage()).toPNG());
  await mini.webContents.executeJavaScript("window.dayhub.window('settings')");await wait(150);
  fs.writeFileSync(path.join(output,'设置模块对齐.png'),(await panel.webContents.capturePage()).toPNG());
  const metrics={
    orb:orb.getBounds(),mini:mini.getBounds(),
    orbDom:await orb.webContents.executeJavaScript("(()=>{const e=document.querySelector('.presence-surface').getBoundingClientRect(),dot=document.querySelector('.status-dot').getBoundingClientRect(),ring=document.querySelector('.status-ring').getBoundingClientRect();return {x:e.x,y:e.y,width:e.width,height:e.height,text:document.body.textContent.trim(),zones:document.querySelectorAll('.presence-zone').length,marks:[...document.querySelectorAll('.identity-mark')].map(x=>x.textContent),dot:{width:dot.width,height:dot.height},ring:{width:ring.width,height:ring.height},legacy:!!document.querySelector('.split-orb,.orb-shell')}})()"),
    miniOverflow:await mini.webContents.executeJavaScript("document.documentElement.scrollHeight-document.documentElement.clientHeight"),
    settingsPadding:await run("getComputedStyle(document.querySelector('.pet-settings')).paddingLeft")
  };
  fs.writeFileSync(path.join(output,'metrics.json'),JSON.stringify(metrics,null,2));console.log(JSON.stringify({output,metrics},null,2));app.quit();
}catch(error){console.error(error);app.exit(1);}});
