// Focused 0.2.14 UI acceptance. Always uses an isolated data directory.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const scale=process.argv.find(x=>x.startsWith('--acceptance-scale='))?.split('=')[1]||'system';
const output=path.join(__dirname,'test-data',`v0214-${scale}-${Date.now()}`);fs.mkdirSync(output,{recursive:true});
process.env.DAYHUB_TEST_DATA=output;
const errors=[],passed=[];let panel;
const check=(name,value,detail='')=>{assert.ok(value,`${name}${detail?': '+detail:''}`);passed.push(name);};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deadline=setTimeout(()=>{fs.writeFileSync(path.join(output,'failure.txt'),'UI acceptance timeout');app.exit(1);},45000);
require('./dist/main.cjs');
app.whenReady().then(async()=>{
  try{
    for(let i=0;i<120;i++){panel=BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('#')&&w.webContents.getURL().includes('index.html'));if(panel&&!panel.webContents.isLoading())break;await wait(100);}
    check('主窗口加载',!!panel);panel.webContents.on('console-message',(_event,details)=>{if(details.level==='error')errors.push(details.message);});
    const run=code=>panel.webContents.executeJavaScript(code);
    await run("window.dayhub.change({type:'settings',setup:true})");
    await run("window.dayhub.change({type:'inbound',id:'review-needed',payload:{text:'待人工核对的原始通知'}})");
    await run("window.dayhub.change({type:'save',entity:'tasks',value:{id:'overdue',title:'已逾期待办',due:'2026-01-01T09:00',notes:'用于隔离验收',done:false,checklist:[],reminders:[]}})");
    await wait(250);
    check('首页双方状态来自统一快照',await run("document.querySelectorAll('.dual-status .person-status').length===2"));
    check('需要处理按内容出现并汇总',await run("document.querySelector('.attention-panel')?.textContent.includes('需要处理 2')&&document.querySelector('.attention-panel')?.textContent.includes('1 条通知待核对')&&document.querySelector('.attention-panel')?.textContent.includes('1 个待办已逾期')"));
    check('首页层级顺序正确',await run("(()=>{const a=document.querySelector('.dual-status'),b=document.querySelector('.attention-panel'),c=document.querySelector('.focus-strip'),d=document.querySelector('.panel');return a&&b&&c&&d&&a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING&&b.compareDocumentPosition(c)&Node.DOCUMENT_POSITION_FOLLOWING&&c.compareDocumentPosition(d)&Node.DOCUMENT_POSITION_FOLLOWING})()"));
    for(const [width,height] of [[1920,1080],[1050,780],[750,600]]){
      panel.setSize(width,height);await wait(180);
      const metrics=await run("(()=>{const m=document.querySelector('.main'),f=document.querySelector('.page-frame');return {overflow:m.scrollWidth-m.clientWidth,frame:f.getBoundingClientRect().width,dpr:devicePixelRatio}})()");
      check(`首页无横向溢出 ${width}x${height}`,metrics.overflow<=1,JSON.stringify(metrics));
      fs.writeFileSync(path.join(output,`home-${width}x${height}.png`),(await panel.webContents.capturePage()).toPNG());
    }
    await run("[...document.querySelectorAll('.nav-item')].find(b=>b.textContent==='事项与会议').click()");await wait(120);
    // 0.2.16：一级筛选是“全部 / 待办 / 会议”，时间筛选只在进入某个类型后出现。
    check('事项筛选后保留搜索控件',await run("(()=>{const bar=document.querySelector('.management-toolbar');return !!bar&&!!document.querySelector('[aria-label=\"搜索事项与会议\"]')&&bar.querySelectorAll('.segmented button').length===3})()"));
    check('危险低频操作收进菜单',await run("!!document.querySelector('.action-menu')&&!document.querySelector('.management-section > .entry > .actions .text-button')"));
    await run("[...document.querySelectorAll('.nav-item')].find(b=>b.textContent==='我的安排').click()");await wait(80);await run("[...document.querySelectorAll('button')].find(b=>b.textContent==='新建待办').click()");await wait(100);
    check('窄窗编辑器不超出屏幕',await run("(()=>{const m=document.querySelector('[role=dialog]').getBoundingClientRect();return m.top>=0&&m.bottom<=innerHeight+1&&m.left>=0&&m.right<=innerWidth+1})()"));
    await run("(()=>{const m=document.querySelector('[role=dialog]');m.scrollTop=m.scrollHeight})()");await wait(60);
    check('窄窗编辑器footer可滚动点击',await run("(()=>{const m=document.querySelector('[role=dialog]').getBoundingClientRect(),f=document.querySelector('.modal-foot').getBoundingClientRect();return f.top>=m.top&&f.bottom<=m.bottom+1})()"));
    // 0.2.15 起这条回归脚本跟随当前源码版本，避免每次发版都要改断言。
    const productVersion=require('./package.json').version;check('源码版本与 package.json 一致',/^0\.2\.\d+$/.test(productVersion));
    check('开发者控制台无错误',errors.length===0,errors.join(' | '));
    const report={version:productVersion,scale,devicePixelRatio:await run('devicePixelRatio'),passed,consoleErrors:errors};
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output,report},null,2));
    clearTimeout(deadline);app.quit();
  }catch(error){clearTimeout(deadline);fs.writeFileSync(path.join(output,'failure.txt'),error.stack||String(error));if(panel)fs.writeFileSync(path.join(output,'failure.png'),(await panel.webContents.capturePage()).toPNG());console.error(error);app.exit(1);}
});
