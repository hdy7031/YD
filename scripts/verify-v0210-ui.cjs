const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const output=path.join(root,'test-data','v0210-ui');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report=[];
const check=(name,value)=>report.push({name,ok:!!value});

app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const win=new BrowserWindow({width:1366,height:768,show:false,backgroundColor:'#f6f8fb',webPreferences:{preload:path.join(__dirname,'audit-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  try{
    await win.loadFile(path.join(root,'dist','index.html'));
    await win.webContents.executeJavaScript(`(async()=>{
      const wait=()=>new Promise(resolve=>setTimeout(resolve,50));
      const now=new Date(),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
      const day=new Date(date+'T12:00:00Z').getUTCDay()||7;
      const monday=new Date(Date.parse(date+'T12:00:00Z')-((day-1)*86400000)).toISOString().slice(0,10);
      const clock=(offset)=>{const d=new Date(Date.now()+offset*60000);return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d);};
      await window.dayhub.change({type:'importSchedule',value:{format:'dayhub-schedule',version:1,termName:'0.2.10 视觉验收',profiles:[{id:'partner',name:'Ta',startDate:monday,weeks:1,periods:[{start:clock(-5),end:clock(15)}]}],courses:[{id:'v0210-course',person:'partner',title:'高二（105）语文',place:'',notes:'',activity:'teaching',weekday:day,first:1,last:1,weeks:[1],reminders:[],checklist:[]}]}});
      await wait();
      const nav=[...document.querySelectorAll('.nav-item')].find(button=>button.textContent.trim()==='Ta的课表');nav.click();await wait();
      return {date,day};
    })()`);
    const initial=await win.webContents.executeJavaScript(`({
      title:document.querySelector('h1')?.textContent,
      headline:document.querySelector('.partner-status-headline')?.textContent.trim(),
      current:document.querySelector('.partner-current-title')?.textContent.trim(),
      hasCurrentRow:!!document.querySelector('.partner-row.current'),
      hasList:!!document.querySelector('.partner-list'),
      hasY:/Y\\s*·/.test(document.querySelector('.main')?.textContent||''),
      hasOld:['预计','实际忙闲状态未确认','仅依据已录入课表'].some(text=>(document.querySelector('.main')?.textContent||'').includes(text)),
      noHorizontalScroll:document.querySelector('.main').scrollWidth<=document.querySelector('.main').clientWidth
    })`);
    check('Ta 页面标题',initial.title==='Ta的课表');
    check('当前课程显示为上课中',initial.headline==='上课中'&&initial.current==='高二（105）语文');
    check('当前课程列表行有轻量强调',initial.hasCurrentRow&&initial.hasList);
    check('Ta 页面不出现 Y 与旧不确定性文案',!initial.hasY&&!initial.hasOld);
    check('1366×768 无横向滚动',initial.noHorizontalScroll);

    await win.webContents.executeJavaScript(`(()=>{
      const input=document.querySelector('input[aria-label="查看 Ta 的日期"]');
      const future=new Date(input.value+'T12:00:00Z');future.setUTCDate(future.getUTCDate()+1);
      input.value=future.toISOString().slice(0,10);input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await wait(80);
    const future=await win.webContents.executeJavaScript(`({
      headline:document.querySelector('.partner-status-headline')?.textContent.trim(),
      dateTitle:document.querySelector('.partner-schedule-head')?.textContent.trim()
    })`);
    check('选择未来日期后顶部仍是真实当前状态',future.headline==='上课中'&&future.dateTitle.includes('Ta 的日程'));

    const layout=[];
    for(const [width,height] of [[1366,768],[1920,1080],[2560,1440]]){
      win.setSize(width,height);await wait(100);
      const result=await win.webContents.executeJavaScript(`({width:innerWidth,height:innerHeight,noHorizontalScroll:document.querySelector('.main').scrollWidth<=document.querySelector('.main').clientWidth,card:!!document.querySelector('.partner-status-card')})`);
      layout.push({width,height,...result});
      const label=width===2560&&result.width<2500?`${width}×${height} 请求（宿主限制为 ${result.width}×${result.height}）无横向滚动`:`${width}×${height} 布局无横向滚动`;
      check(label,result.noHorizontalScroll&&result.card);
    }
    for(const zoom of [1,1.25,1.5]){
      win.webContents.setZoomFactor(zoom);await wait(100);
      const result=await win.webContents.executeJavaScript(`({zoom:${zoom},noHorizontalScroll:document.querySelector('.main').scrollWidth<=document.querySelector('.main').clientWidth,card:!!document.querySelector('.partner-status-card')})`);
      layout.push(result);check(`缩放 ${Math.round(zoom*100)}% 布局可用`,result.noHorizontalScroll&&result.card);
    }
    win.webContents.setZoomFactor(1);win.setSize(1366,768);await wait(100);
    fs.writeFileSync(path.join(output,'partner.png'),(await win.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({report,layout},null,2));
    console.log(JSON.stringify({report,layout},null,2));
    win.close();app.exit(report.every(item=>item.ok)?0:1);
  }catch(error){console.error(error);fs.writeFileSync(path.join(output,'failure.txt'),error.stack||String(error));win.close();app.exit(1);}
});
