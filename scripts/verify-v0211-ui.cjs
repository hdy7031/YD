const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const output=path.join(root,'test-data','v0211-ui');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report=[];
const check=(name,value,detail='')=>report.push({name,ok:!!value,detail});

app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const win=new BrowserWindow({width:1366,height:768,show:false,backgroundColor:'#f6f8fb',webPreferences:{preload:path.join(__dirname,'audit-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  const run=code=>win.webContents.executeJavaScript(code);
  const shot=async name=>fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());
  try{
    await win.loadFile(path.join(root,'dist','index.html'));
    await run(`(async()=>{
      const wait=()=>new Promise(resolve=>setTimeout(resolve,60));
      const find=(selector,text,scope=document)=>[...scope.querySelectorAll(selector)].find(el=>el.textContent.trim()===text);
      const click=async(text,scope=document)=>{const el=find('button',text,scope);if(!el)throw new Error('未找到按钮：'+text);el.click();await wait();return el;};
      window.__t={wait,find,click,setValue:(el,value)=>{const setter=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;setter.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}};
      await wait();
      if(find('button','已核对，开始使用'))await click('已核对，开始使用');
    })()`);
    await wait(120);

    const initial=await run(`(()=>{
      const frame=document.querySelector('.page-frame'),main=document.querySelector('.main');
      const f=frame.getBoundingClientRect(),m=main.getBoundingClientRect();
      const cols=getComputedStyle(document.querySelector('.home-grid')).gridTemplateColumns.split(' ').filter(Boolean).length;
      return {
        title:document.querySelector('h1')?.textContent,
        hasHomeGrid:!!document.querySelector('.home-grid'),
        homeColumns:cols,
        hasTaskPanel:[...document.querySelectorAll('.panel h2')].some(h=>h.textContent.trim()==='今天与逾期待办'),
        hasSchedulePanel:[...document.querySelectorAll('.panel h2')].some(h=>/日程$/.test(h.textContent.trim())),
        hasSummary:[...document.querySelectorAll('.panel h2')].some(h=>h.textContent.trim()==='今日概览'),
        summaryCount:document.querySelectorAll('.summary-grid > div').length,
        primaryHeight:document.querySelector('.home-primary').getBoundingClientRect().height,
        secondaryHeight:document.querySelector('.home-secondary').getBoundingClientRect().height,
        leftGap:f.left-m.left,
        rightGap:m.right-f.right,
        noHorizontalScroll:main.scrollWidth<=main.clientWidth
      };
    })()`);
    check('首页使用分栏布局',initial.hasHomeGrid&&initial.homeColumns===2,`columns=${initial.homeColumns}`);
    check('首页包含今日日程、今天与逾期待办与今日概览模块',initial.hasTaskPanel&&initial.hasSchedulePanel&&initial.hasSummary);
    check('今日概览包含四项摘要',initial.summaryCount===4,`items=${initial.summaryCount}`);
    check('首页左右两列高度基本平衡',Math.abs(initial.primaryHeight-initial.secondaryHeight)/Math.max(initial.primaryHeight,initial.secondaryHeight)<0.35,`primary=${initial.primaryHeight.toFixed(0)} secondary=${initial.secondaryHeight.toFixed(0)}`);
    check('首页主内容容器居中',Math.abs(initial.leftGap-initial.rightGap)<3,`left=${initial.leftGap.toFixed(1)} right=${initial.rightGap.toFixed(1)}`);
    check('1366×768 无横向滚动',initial.noHorizontalScroll);
    await shot('01-home-1366');

    await run(`window.dayhub.change({type:'delete',entity:'tasks',id:'audit-task'})`);
    await wait(150);
    const emptyTask=await run(`(()=>{
      const box=[...document.querySelectorAll('.empty-state')].find(el=>el.textContent.includes('今天没有待办'));
      return {exists:!!box,text:box?.textContent||'',hasCreate:!!box&&[...box.querySelectorAll('button')].some(b=>b.textContent.trim()==='新建待办'),hasManage:!!box&&[...box.querySelectorAll('button')].some(b=>b.textContent.trim()==='查看事项与会议')};
    })()`);
    check('首页待办为空时显示空状态卡片',emptyTask.exists&&emptyTask.hasCreate&&emptyTask.hasManage,emptyTask.text.slice(0,80));
    await shot('02-home-empty-tasks');

    const modal=await run(`(async()=>{
      const {wait,find,click}=window.__t;
      const target=find('button','本次调课 / 停课');
      if(!target)return {error:'未找到本次调课 / 停课按钮'};
      target.click();await wait();
      const dialog=document.querySelector('[role="dialog"][aria-label="仅修改这一次课程"]');
      if(!dialog)return {error:'未打开仅修改这一次课程弹窗'};
      const summary=dialog.querySelector('.original-course');
      const text=summary?.textContent||'';
      const select=dialog.querySelector('select');
      const fields=[...dialog.querySelectorAll('input')].map(input=>({type:input.type,value:input.value}));
      const result={
        hasSummary:!!summary,
        text,
        hasTitle:text.includes('界面验收课程'),
        hasWeekday:text.includes('（周'),
        hasTime:text.includes('08:00')&&text.includes('09:40'),
        hasPeriod:text.includes('第 1—2 节'),
        hasPlace:text.includes('教学楼 201'),
        hasSection:!![...dialog.querySelectorAll('h3')].find(h=>h.textContent.trim()==='本次处理'),
        selectValue:select?.value,
        timeFields:fields.filter(f=>f.type==='datetime-local').map(f=>f.value)
      };
      const setter=window.__t.setValue;
      setter(select,'cancel');await wait();
      result.cancelFields=!!dialog.querySelector('input[type="datetime-local"]');
      setter(select,'move');await wait();
      result.moveFields=[...dialog.querySelectorAll('input[type="datetime-local"]')].map(input=>input.value);
      return result;
    })()`);
    check('弹窗原课程摘要包含课程名、日期、星期、时间段、节次与地点',modal.hasSummary&&modal.hasTitle&&modal.hasWeekday&&modal.hasTime&&modal.hasPeriod&&modal.hasPlace,JSON.stringify(modal).slice(0,220));
    check('弹窗处理方式层级清晰且默认调课',modal.hasSection&&modal.selectValue==='move');
    check('选择停课不显示多余时间字段',modal.cancelFields===false);
    check('从停课切回调课时预填原课程时间',Array.isArray(modal.moveFields)&&modal.moveFields.length===2&&modal.moveFields.every(Boolean),JSON.stringify(modal.moveFields));
    await shot('03-exception-modal');

    await run(`(async()=>{const {wait,click}=window.__t;const dialog=document.querySelector('[role="dialog"]');const setter=window.__t.setValue;setter(dialog.querySelector('select'),'cancel');await wait();await click('核对并保存',dialog);await wait(160);await click('课表管理');await wait(140);})()`);
    const afterCancel=await run(`(()=>{const card=document.querySelector('.exception-card');return {closed:!document.querySelector('[role="dialog"][aria-label="仅修改这一次课程"]'),text:card?.textContent||'',badge:card?.querySelector('.type-badge')?.textContent.trim()||''};})()`);
    check('停课可保存并生成记录',afterCancel.closed&&afterCancel.badge==='停课'&&afterCancel.text.includes('08:00 — 09:40'),afterCancel.text.slice(0,140));
    await shot('04-courses-exception-record');

    const move=await run(`(async()=>{
      const {wait,find,click,setValue}=window.__t;
      const card=document.querySelector('.exception-card');
      const edit=find('button','编辑',card);edit.click();await wait();
      const dialog=document.querySelector('[role="dialog"][aria-label="仅修改这一次课程"]');
      setValue(dialog.querySelector('select'),'move');await wait();
      const inputs=[...dialog.querySelectorAll('input[type="datetime-local"]')];
      setValue(inputs[0],inputs[0].value.slice(0,11)+'15:00');
      setValue(inputs[1],inputs[1].value.slice(0,11)+'15:45');
      await click('核对并保存',dialog);await wait(180);
      const next=document.querySelector('.exception-card');
      return {badge:next?.querySelector('.type-badge')?.textContent.trim()||'',text:next?.textContent||''};
    })()`);
    check('调课可保存并展示调整后时间',move.badge==='调课'&&move.text.includes('调整后')&&move.text.includes('15:00')&&move.text.includes('15:45'),move.text.slice(0,180));

    await run(`(async()=>{
      const {wait,find}=window.__t;
      const card=document.querySelector('.exception-card');
      const restore=find('button','恢复原课',card);restore.click();await wait();
      const confirm=[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()==='确认');
      if(confirm)confirm.click();
      await wait(180);
    })()`);
    await wait(160);
    const emptyException=await run(`(()=>{const box=[...document.querySelectorAll('.empty-state')].find(el=>el.textContent.includes('还没有单次调课或停课'));return {exists:!!box,text:box?.textContent||'',hasCta:!!box&&[...box.querySelectorAll('button')].some(b=>b.textContent.trim()==='查看可修改课程')};})()`);
    check('课表管理页无调停课时显示空状态模块',emptyException.exists&&emptyException.hasCta,emptyException.text.slice(0,120));
    await shot('05-courses-empty-exceptions');

    await run(`window.dayhub.change({type:'ack',id:'audit-reminder'})`);
    await run(`(async()=>{const {wait,click}=window.__t;await click('未处理提醒');await wait(120);})()`);
    const emptyReminder=await run(`(()=>{const box=[...document.querySelectorAll('.empty-state')].find(el=>el.textContent.includes('没有未处理提醒'));return {exists:!!box,text:box?.textContent||''};})()`);
    check('未处理提醒为空时显示空状态',emptyReminder.exists,emptyReminder.text.slice(0,100));

    await run(`window.dayhub.change({type:'delete',entity:'notices',id:'audit-notice'})`);
    await run(`(async()=>{const {wait,click}=window.__t;await click('通知收件箱');await wait(120);})()`);
    const emptyInbox=await run(`(()=>{const box=[...document.querySelectorAll('.empty-state')].find(el=>el.textContent.includes('还没有通知'));return {exists:!!box,text:box?.textContent||'',hasCreate:!!box&&[...box.querySelectorAll('button')].some(b=>b.textContent.trim()==='新建文字通知')};})()`);
    check('通知收件箱为空时显示空状态与新建入口',emptyInbox.exists&&emptyInbox.hasCreate,emptyInbox.text.slice(0,120));
    await shot('06-inbox-empty');

    await run(`(async()=>{const {wait,click}=window.__t;await click('我的安排');await wait(120);})()`);
    const layout=[];
    for(const [width,height] of [[1366,768],[1440,900],[1600,900],[1920,1080],[2560,1440]]){
      win.setSize(width,height);await wait(140);
      const result=await run(`(()=>{
        const frame=document.querySelector('.page-frame'),main=document.querySelector('.main');
        const f=frame.getBoundingClientRect(),m=main.getBoundingClientRect();
        const grid=document.querySelector('.home-grid');
        return {innerWidth,innerHeight,leftGap:f.left-m.left,rightGap:m.right-f.right,delta:Math.abs((f.left-m.left)-(m.right-f.right)),frameWidth:f.width,mainWidth:m.width,columns:grid?getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length:0,noHorizontalScroll:main.scrollWidth<=main.clientWidth};
      })()`);
      layout.push({requested:`${width}×${height}`,...result});
      check(`${width}×${height} 无横向滚动且内容居中`,result.noHorizontalScroll&&result.delta<3,`实际 ${result.innerWidth}×${result.innerHeight} delta=${result.delta.toFixed(1)}`);
    }
    await shot('07-home-1920');
    for(const zoom of [1,1.25,1.5]){
      win.webContents.setZoomFactor(zoom);await wait(160);
      const result=await run(`(()=>{const main=document.querySelector('.main');return {zoom:${zoom},innerWidth,noHorizontalScroll:main.scrollWidth<=main.clientWidth,hasFrame:!!document.querySelector('.page-frame')};})()`);
      check(`缩放 ${Math.round(zoom*100)}% 无横向滚动`,result.noHorizontalScroll&&result.hasFrame,`视口 ${result.innerWidth}px`);
    }
    for(const zoom of [0.8,0.6]){
      win.webContents.setZoomFactor(zoom);await wait(180);
      const result=await run(`(()=>{const main=document.querySelector('.main'),frame=document.querySelector('.page-frame');const f=frame.getBoundingClientRect(),m=main.getBoundingClientRect();return {innerWidth,noHorizontalScroll:main.scrollWidth<=main.clientWidth,delta:Math.abs((f.left-m.left)-(m.right-f.right)),frameWidth:f.width};})()`);
      check(`虚拟大视口 ${Math.round(result.innerWidth)}px 内容居中且无横向滚动`,result.noHorizontalScroll&&result.delta<3,`frame=${result.frameWidth.toFixed(0)}`);
    }
    win.webContents.setZoomFactor(1);await wait(140);
    const audit=await run(`(()=>{
      const bad=[];
      for(const el of document.querySelectorAll('body *')){
        if(el.closest('.schedule-scroll,.notice-excerpt,pre,.modal,.cloud-text'))continue;
        if(el.scrollWidth>el.clientWidth+2)bad.push({tag:el.tagName,cls:String(el.className||'').slice(0,60),sw:el.scrollWidth,cw:el.clientWidth});
      }
      const panel=document.querySelector('.panel'),empty=document.querySelector('.empty-state');
      return {bad:bad.slice(0,10),panelRadius:panel?parseFloat(getComputedStyle(panel).borderRadius):0,emptyBorder:empty?parseFloat(getComputedStyle(empty).borderTopWidth):0,sidebarWidth:document.querySelector('.sidebar').getBoundingClientRect().width};
    })()`);
    check('无主要元素横向溢出',audit.bad.length===0,JSON.stringify(audit.bad));
    check('模块容器与空状态使用统一描边和圆角',audit.panelRadius>=16&&audit.emptyBorder>0,`radius=${audit.panelRadius} border=${audit.emptyBorder}`);
    check('侧边栏宽度保持稳定',Math.abs(audit.sidebarWidth-190)<1,`sidebar=${audit.sidebarWidth}`);
    win.setSize(1366,768);await wait(140);
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({report,layout},null,2));
    console.log(JSON.stringify({report,layout},null,2));
    win.close();app.exit(report.every(item=>item.ok)?0:1);
  }catch(error){console.error(error);fs.writeFileSync(path.join(output,'failure.txt'),error.stack||String(error));win.close();app.exit(1);}
});
