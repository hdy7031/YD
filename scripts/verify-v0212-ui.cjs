const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const output=path.join(root,'test-data','v0212-ui');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report=[];
const layouts=[];
const check=(name,value,detail='')=>report.push({name,ok:!!value,detail});

app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const win=new BrowserWindow({width:1366,height:768,show:false,backgroundColor:'#f6f8fb',webPreferences:{preload:path.join(__dirname,'audit-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  const run=code=>win.webContents.executeJavaScript(code);
  const shot=async name=>fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());
  const click=async label=>{
    await run(`(()=>{const el=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(label)});if(!el)throw new Error('missing button: '+${JSON.stringify(label)});el.click();})()`);
    await wait(100);
  };
  const measure=()=>run(`(()=>{
    const main=document.querySelector('.main'),frame=document.querySelector('.page-frame');
    const rect=frame.getBoundingClientRect(),mainRect=main.getBoundingClientRect();
    const overflow=[...document.querySelectorAll('body *')].filter(el=>{
      if(el.closest('.schedule-scroll,.notice-excerpt,pre,.modal,.cloud-text'))return false;
      return el.scrollWidth>el.clientWidth+2;
    }).slice(0,8).map(el=>({tag:el.tagName,cls:String(el.className||''),sw:el.scrollWidth,cw:el.clientWidth}));
    return {innerWidth,innerHeight,frameWidth:rect.width,mainWidth:mainRect.width,left:rect.left-mainRect.left,right:mainRect.right-rect.right,noHorizontalScroll:main.scrollWidth<=main.clientWidth,overflow};
  })()`);
  try{
    await win.loadFile(path.join(root,'dist','index.html'));
    await wait(160);
    if(await run(`!![...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='已核对，开始使用')`))await click('已核对，开始使用');

    const policies=await run(`(()=>{const frame=document.querySelector('.page-frame');return {adaptive:frame.classList.contains('width-adaptive'),summary:!![...document.querySelectorAll('h2')].find(x=>x.textContent.trim()==='今日概览'),columns:getComputedStyle(document.querySelector('.home-grid')).gridTemplateColumns.split(' ').filter(Boolean).length};})()`);
    check('首页使用 Adaptive Grid',policies.adaptive&&policies.columns===2,JSON.stringify(policies));
    check('首页移除四宫格今日概览',!policies.summary);
    await shot('01-home-1366');

    await run(`window.dayhub.change({type:'importSchedule',value:{format:'dayhub-schedule',version:1,termName:'0.2.12 宽屏验收',profiles:[{id:'partner',name:'Ta',startDate:(()=>{const d=new Date(Date.now()+28800000);const date=d.toISOString().slice(0,10);return new Date(Date.parse(date+'T00:00:00+08:00')-(((new Date(date+'T12:00:00Z').getUTCDay()||7)-1)*86400000)+28800000).toISOString().slice(0,10)})(),weeks:20,periods:[{start:'08:00',end:'08:45'},{start:'08:55',end:'09:40'},{start:'10:00',end:'10:45'},{start:'10:55',end:'11:40'},{start:'14:00',end:'14:45'}]}],courses:[0,1,2,3,4].map((i)=>({id:'partner-'+i,person:'partner',title:['高二（105）语文','高二（105）数学','高二（105）英语','教研活动','班会'][i],place:i===0?'':'教学楼 '+(201+i),notes:'',activity:i===3?'research':'teaching',weekday:new Date(Date.now()+28800000).getUTCDay()||7,first:i+1,last:i+1,weeks:[1,2],reminders:[],checklist:[]}))}})`);
    await click('Ta的课表');
    win.setSize(1920,1080);await wait(160);
    const partner=await run(`(()=>{
      const reading=document.querySelector('.partner-reading').getBoundingClientRect();
      const row=document.querySelector('.partner-row');
      const rowRect=row.getBoundingClientRect(),time=row.querySelector('.partner-row-time').getBoundingClientRect(),main=row.querySelector('.partner-row-main').getBoundingClientRect(),actions=row.querySelector('.partner-row-actions').getBoundingClientRect();
      const statusMain=getComputedStyle(document.querySelector('.partner-status-main'));
      return {policy:document.querySelector('.page-frame').classList.contains('width-partner'),readingWidth:reading.width,rowWidth:rowRect.width,timeToMain:main.left-time.right,mainToActions:actions.left-main.right,statusColumns:statusMain.gridTemplateColumns.split(' ').filter(Boolean).length,noOverflow:row.scrollWidth<=row.clientWidth};
    })()`);
    check('Ta 课表使用受控阅读宽度',partner.policy&&partner.readingWidth<=1081&&partner.noOverflow,JSON.stringify(partner));
    check('Ta 课表行为时间/主信息/操作受控三列',partner.timeToMain<24&&partner.mainToActions<24,JSON.stringify(partner));
    check('Ta 状态卡宽屏内部分为两区',partner.statusColumns===2,JSON.stringify(partner));
    await shot('02-partner-1920');

    await click('事项与会议');
    const tasks=await run(`(()=>{const bar=document.querySelector('.management-toolbar'),r=bar.getBoundingClientRect(),input=bar.querySelector('input').getBoundingClientRect(),select=bar.querySelector('select').getBoundingClientRect(),tabs=bar.querySelector('.segmented').getBoundingClientRect(),buttons=[...bar.querySelectorAll('.segmented button')].map(x=>x.getBoundingClientRect());return {policy:document.querySelector('.page-frame').classList.contains('width-adaptive'),width:r.width,searchFilterGap:select.left-input.right,filterTabsGap:tabs.left-select.right,tabsOneLine:buttons.every(x=>Math.abs(x.top-buttons[0].top)<1)};})()`);
    check('事项工具栏在合理宽度内聚合',tasks.policy&&tasks.width<=981&&tasks.searchFilterGap<=16&&tasks.filterTabsGap<180,JSON.stringify(tasks));
    check('事项分类 Tabs 保持单行',tasks.tabsOneLine,JSON.stringify(tasks));
    await shot('03-tasks-1920');

    await run(`window.dayhub.change({type:'delete',entity:'notices',id:'audit-notice'})`);await wait(80);
    await click('通知收件箱');
    const inbox=await run(`(()=>{const frame=document.querySelector('.page-frame'),stage=document.querySelector('.page-empty-stage'),box=stage.querySelector('.empty-state'),head=document.querySelector('.page-head').getBoundingClientRect();const f=frame.getBoundingClientRect(),s=stage.getBoundingClientRect(),b=box.getBoundingClientRect();return {policy:frame.classList.contains('width-constrained'),width:f.width,topGap:s.top-head.bottom,height:b.height,actions:box.querySelectorAll('button').length,flexGrow:getComputedStyle(stage).flexGrow};})()`);
    check('通知收件箱为 Constrained Content',inbox.policy&&inbox.width<=1181,JSON.stringify(inbox));
    check('通知空状态在正常文档流且不重复 CTA',inbox.topGap<180&&inbox.height>=180&&inbox.height<=260&&inbox.actions===0&&inbox.flexGrow==='0',JSON.stringify(inbox));
    await shot('04-inbox-1920');

    await run(`window.dayhub.change({type:'ack',id:'audit-reminder'})`);await wait(80);
    await click('未处理提醒');
    const reminders=await run(`(()=>{const frame=document.querySelector('.page-frame'),stage=document.querySelector('.page-empty-stage'),box=stage.querySelector('.empty-state'),head=document.querySelector('.page-head').getBoundingClientRect();const f=frame.getBoundingClientRect(),s=stage.getBoundingClientRect(),b=box.getBoundingClientRect();return {policy:frame.classList.contains('width-constrained'),width:f.width,topGap:s.top-head.bottom,height:b.height,flexGrow:getComputedStyle(stage).flexGrow};})()`);
    check('未处理提醒为 Constrained Content',reminders.policy&&reminders.width<=1081,JSON.stringify(reminders));
    check('提醒空状态在正常文档流',reminders.topGap<180&&reminders.height>=180&&reminders.height<=260&&reminders.flexGrow==='0',JSON.stringify(reminders));
    await shot('05-reminders-1920');

    await click('设置与备份');
    const settings=await run(`(()=>{const frame=document.querySelector('.page-frame'),main=document.querySelector('.main'),card=document.querySelector('.settings-stack > .entry'),f=frame.getBoundingClientRect(),m=main.getBoundingClientRect(),c=card.getBoundingClientRect();return {policy:frame.classList.contains('width-constrained'),frameWidth:f.width,cardWidth:c.width,left:f.left-m.left,right:m.right-f.right,stack:!!document.querySelector('.settings-stack')};})()`);
    check('设置页居中受限且卡片不超宽',settings.policy&&settings.stack&&settings.frameWidth<=1121&&settings.cardWidth<=1121&&Math.abs(settings.left-settings.right)<3,JSON.stringify(settings));
    await shot('06-settings-1920');

    await click('课表管理');
    const courses=await run(`(()=>{const frame=document.querySelector('.page-frame'),main=document.querySelector('.main'),f=frame.getBoundingClientRect(),m=main.getBoundingClientRect(),style=getComputedStyle(main),available=m.width-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);return {fluid:frame.classList.contains('width-fluid'),frameWidth:f.width,available};})()`);
    check('课表管理保持 Fluid',courses.fluid&&Math.abs(courses.frameWidth-courses.available)<2,JSON.stringify(courses));
    await shot('07-courses-1920');

    await click('我的安排');
    const navRect=await run(`(()=>{const el=document.querySelector('.nav-item:not(.active)'),r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    win.webContents.sendInputEvent({type:'mouseDown',x:Math.round(navRect.x),y:Math.round(navRect.y),button:'left',clickCount:1});
    win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(navRect.x),y:Math.round(navRect.y),button:'left',clickCount:1});
    await wait(100);
    const pointerFocus=await run(`(()=>{const el=document.activeElement,s=getComputedStyle(el);return {tag:el.tagName,cls:String(el.className||''),visible:el.matches(':focus-visible'),outline:s.outlineStyle+' '+s.outlineWidth};})()`);
    check('鼠标点击导航不留高强调 Focus Ring',!pointerFocus.visible&&pointerFocus.outline.startsWith('none'),JSON.stringify(pointerFocus));
    await run(`document.activeElement?.blur()`);
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9});
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9});
    win.webContents.debugger.detach();await wait(80);
    const keyboardFocus=await run(`(()=>{const el=document.activeElement,s=getComputedStyle(el);return {tag:el.tagName,visible:el.matches(':focus-visible'),outlineWidth:s.outlineWidth};})()`);
    check('键盘 Tab 保留 focus-visible',keyboardFocus.visible&&parseFloat(keyboardFocus.outlineWidth)>=2,JSON.stringify(keyboardFocus));

    for(const [width,height] of [[1366,768],[1440,900],[1600,900],[1920,1080],[2560,1440]]){
      win.setSize(width,height);await wait(130);
      for(const label of ['我的安排','Ta的课表','课表管理','事项与会议','通知收件箱','未处理提醒','设置与备份']){
        await click(label);
        const value=await measure();layouts.push({requested:`${width}×${height}`,page:label,...value});
        check(`${width}×${height} ${label} 无横向滚动`,value.noHorizontalScroll&&value.overflow.length===0,JSON.stringify(value.overflow));
      }
    }
    for(const zoom of [1,1.25,1.5]){
      win.webContents.setZoomFactor(zoom);await wait(130);await click('设置与备份');const value=await measure();
      check(`${Math.round(zoom*100)}% 缩放无横向滚动`,value.noHorizontalScroll&&value.overflow.length===0,JSON.stringify(value.overflow));
    }
    win.webContents.setZoomFactor(.6);await wait(150);await click('课表管理');
    const virtualWide=await run(`(()=>{const frame=document.querySelector('.page-frame'),main=document.querySelector('.main'),f=frame.getBoundingClientRect(),m=main.getBoundingClientRect(),style=getComputedStyle(main),available=m.width-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);return {fluid:frame.classList.contains('width-fluid'),frameWidth:f.width,available,noHorizontalScroll:main.scrollWidth<=main.clientWidth};})()`);
    check('虚拟宽视口课表仍为 Fluid',virtualWide.fluid&&Math.abs(virtualWide.frameWidth-virtualWide.available)<2&&virtualWide.noHorizontalScroll,JSON.stringify(virtualWide));
    win.webContents.setZoomFactor(1);

    const result={report,layouts,passed:report.every(item=>item.ok)};
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
    win.close();app.exit(result.passed?0:1);
  }catch(error){console.error(error);fs.writeFileSync(path.join(output,'failure.txt'),error.stack||String(error));win.close();app.exit(1);}
});
