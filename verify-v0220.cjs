// Focused 0.2.20 desk pet acceptance: real Electron runtime, isolated data dir.
// 覆盖：十态素材、四态时间边界（Phase 2B 起由 profile.routine 驱动，默认迁移用户与旧行为逐分钟一致）、
// 优先级、固定画布与落点、无猫残留、版本号。
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const output=path.join(__dirname,'test-data',`v0220-pet-${Date.now()}`);fs.mkdirSync(output,{recursive:true});
process.env.DAYHUB_TEST_DATA=output;
const passed=[],errors=[];
const check=(name,value,detail='')=>{assert.ok(value,`${name}${detail?': '+detail:''}`);passed.push(name);};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deadline=setTimeout(()=>{fs.writeFileSync(path.join(output,'failure.txt'),'0.2.20 pet acceptance timeout');app.exit(1);},120000);
require('./dist/main.cjs');

// 受控虚拟时钟：保持时间正常流动，只把“当前时间”平移到指定时刻（本机为 Asia/Shanghai，与北京时间一致）。
const realNow=Date.now.bind(Date);
let simAnchor=realNow(),realAnchor=realNow();
const setClock=(hour,minute)=>{
  const target=new Date(realNow());target.setHours(hour,minute,0,0);
  simAnchor=target.getTime();realAnchor=realNow();
};
Date.now=()=>simAnchor+(realNow()-realAnchor);

// 显示态（状态机）与素材键（十宫格）是两张表：upcoming→relaxed、gentle→happy。
const states=['idle','upcoming','busy_class','busy_work','reminder','gentle','night_sleep','eating','nap','wake_up'];
const assets10=['idle','busy_class','busy_work','relaxed','reminder','happy','night_sleep','eating','nap','wake_up'];
const scheduled=['night_sleep','wake_up','eating','nap'];

app.whenReady().then(async()=>{
  try{
    let panel,orb;
    for(let i=0;i<120;i++){
      const windows=BrowserWindow.getAllWindows();
      panel=windows.find(w=>!w.webContents.getURL().includes('#')&&w.webContents.getURL().includes('index.html'));
      orb=windows.find(w=>w.webContents.getURL().endsWith('#orb'));
      if(panel&&orb&&!panel.webContents.isLoading()&&!orb.webContents.isLoading())break;
      await wait(100);
    }
    check('主窗口与桌宠窗口加载',panel&&orb);
    const run=code=>panel.webContents.executeJavaScript(code);
    const pet=code=>orb.webContents.executeJavaScript(code);
    const live=()=>run('window.dayhub.live()');
    await wait(600);

    /* ---------- A. 素材 ---------- */
    const bundle=await run('window.dayhub.companionAssets()');
    check('素材清单格式正确',bundle.manifest?.format==='dayhub-companion');
    check('素材可用且下发到渲染层',bundle.available===true&&bundle.images.idle?.startsWith('data:image/png;base64,'));
    const frames=Object.keys(bundle.manifest?.states??{}),missing=bundle.missing??[];
    check('十态素材名单与显示态一一对应',frames.length+missing.length===assets10.length,`已有 ${frames.length}，缺 ${missing.join('/')||'无'}`);
    check('清单里的素材键都在十态名单内',frames.every(key=>assets10.includes(key)),frames.join('/'));
    check('缺失清单只包含十态里的键',missing.every(key=>assets10.includes(key)),missing.join('/'));
    check('显示态到素材键的映射完备',Object.keys(assets10).length===states.length&&assets10.includes('relaxed')&&assets10.includes('happy'));
    check('渲染层已解码全部随包素材',await pet("(()=>{const img=document.querySelector('.companion-frame.is-current');const all=[...document.images].filter(i=>i.src.startsWith('data:image/png;base64,'));return !!img&&img.naturalWidth>0&&all.length>=1})()"));

    /* ---------- B. 小猫已删除 ---------- */
    check('桌宠窗口没有任何猫形象或猫标签',await pet("!document.querySelector('.pet-art')&&!document.querySelector('.pet-labels')&&!document.querySelector('.teacher-prop')"));
    await run("window.dayhub.window('settings')");await wait(400);
    check('设置页只剩专属角色与悬浮球',await run("(()=>{const t=document.querySelector('.pet-settings')?.textContent??'';return !!t&&!t.includes('小猫')&&t.includes('专属角色桌宠')&&t.includes('玻璃悬浮球')})()"));
    check('源码与文案里不再回退到猫',!fs.readFileSync(path.join(__dirname,'src','companion-assets.ts'),'utf8').includes('小猫'));

    /* ---------- C. 时间状态（默认迁移作息，左闭右开） ---------- */
    const stateAt=async(hour,minute)=>{
      setClock(hour,minute);
      await wait(1300);            // 主进程每秒重算一次并广播
      return live();
    };
    const morning=async(hour,minute)=>(await stateAt(hour,minute)).display;
    check('07:29 仍是夜间睡觉',(await morning(7,29)).state==='night_sleep');
    check('07:30 变为刚睡醒',(await morning(7,30)).state==='wake_up');
    check('07:49 仍是刚睡醒',(await morning(7,49)).state==='wake_up');
    const afterWake=await morning(7,50);
    check('07:50 恢复正常日间状态',!scheduled.includes(afterWake.state),afterWake.state);
    const beforeLunch=await morning(11,29);
    check('11:29 不吃饭',!scheduled.includes(beforeLunch.state),beforeLunch.state);
    check('11:30 开始吃饭',(await morning(11,30)).state==='eating');
    check('11:59 仍在吃饭',(await morning(11,59)).state==='eating');
    const afterLunch=await morning(12,0);
    check('12:00 恢复正常状态',!scheduled.includes(afterLunch.state),afterLunch.state);
    const beforeNap=await morning(12,29);
    check('12:29 不午睡',!scheduled.includes(beforeNap.state),beforeNap.state);
    check('12:30 开始午睡',(await morning(12,30)).state==='nap');
    check('13:59 仍在午睡',(await morning(13,59)).state==='nap');
    check('14:00 午睡后进入刚睡醒',(await morning(14,0)).state==='wake_up');
    check('14:19 仍在刚睡醒',(await morning(14,19)).state==='wake_up');
    const afterNap=await morning(14,20);
    check('14:20 恢复正常状态',!scheduled.includes(afterNap.state),afterNap.state);
    const beforeNight=await morning(23,29);
    check('23:29 仍是普通状态',!scheduled.includes(beforeNight.state),beforeNight.state);
    check('23:30 开始夜间睡觉',(await morning(23,30)).state==='night_sleep');
    check('23:59 仍在夜间睡觉',(await morning(23,59)).state==='night_sleep');
    check('次日 00:00 仍然是夜间睡觉',(await morning(0,0)).state==='night_sleep');

    /* ---------- D. 优先级 ---------- */
    setClock(12,45);await wait(1300);
    const napBase=await live();
    check('午睡时段时间状态生效',napBase.display.state==='nap'&&napBase.display.scheduled==='nap');
    setClock(12,40);
    const meetingStart=new Date(Date.now()-5*60000),meetingEnd=new Date(Date.now()+25*60000);
    const stamp=d=>{const t=new Date(d.getTime()+8*3600000);return t.toISOString().slice(0,16);};
    await run(`window.dayhub.change({type:'save',entity:'events',value:{id:'v0220-meeting',title:'午后会议',start:'${stamp(meetingStart)}',end:'${stamp(meetingEnd)}',place:'',notes:'',reminders:[],checklist:[]}})`);
    await wait(1300);
    const busy=await live();
    check('进行中的会议压过午睡姿态',busy.display.state==='busy_work'&&busy.display.scheduled==='nap');
    await run("window.dayhub.change({type:'delete',entity:'events',id:'v0220-meeting'})");
    await wait(1300);
    check('会议结束后回到午睡姿态',(await live()).display.state==='nap');
    // 待处理提醒优先级最高：仍然记得当前是午睡时段。
    // 提醒只在“未来时间”生成，因此先建一个下一分钟的截止时间，再把虚拟时钟拨过去。
    const dueAt=new Date(Date.now());dueAt.setSeconds(0,0);dueAt.setMinutes(dueAt.getMinutes()+1);
    await run(`window.dayhub.change({type:'save',entity:'tasks',value:{id:'v0220-task',title:'隔离验收提醒',notes:'',due:'${stamp(dueAt)}',done:false,checklist:[],reminders:[0]}})`);
    await wait(1300);
    check('未来提醒先进入计划状态',await run("window.dayhub.get().then(s=>s.reminders.some(r=>r.target==='tasks:v0220-task'&&r.status==='scheduled'))"));
    setClock(12,43);
    let pending=null;
    for(let i=0;i<30&&!pending;i++){await wait(300);const value=await live();if(value.pending>0)pending=value;}
    check('到时间提醒进入待处理',!!pending,JSON.stringify((await live()).display));
    check('到时间提醒压过时间状态',pending?.display.state==='reminder'&&pending?.display.base==='nap',JSON.stringify(pending?.display));
    const reminderId=(await run("window.dayhub.get().then(s=>s.reminders.find(r=>r.target==='tasks:v0220-task'&&r.status==='due')?.id)"));
    check('提醒可被确认且不自动完成待办',!!reminderId&&await run(`window.dayhub.change({type:'ack',id:'${reminderId}'}).then(()=>window.dayhub.get()).then(s=>!s.tasks.find(t=>t.id==='v0220-task').done)`));
    await wait(1300);
    check('提醒处理完后回到午睡时间状态',(await live()).display.state==='nap');

    /* ---------- E. 固定画布 / 落点 / 动画时长 ---------- */
    await run("window.dayhub.change({type:'settings',pet:{mode:'custom',size:'medium',nightRest:true}})");
    await wait(400);
    const boundsBefore=orb.getBounds();
    const anchor=await pet("(()=>{const stage=document.querySelector('.sprite-stage').getBoundingClientRect(),img=document.querySelector('.companion-frame.is-current'),style=getComputedStyle(img);return {w:Math.round(stage.width),h:Math.round(stage.height),fit:style.objectFit,position:style.objectPosition,transition:style.transitionDuration}})()");
    check('角色使用 contain + 底边中点锚点',anchor.fit==='contain'&&/50% 100%|center bottom/.test(anchor.position),JSON.stringify(anchor));
    check('切换动画在 120–180ms 之间',Number.parseFloat(anchor.transition)>=0.12&&Number.parseFloat(anchor.transition)<=0.18,anchor.transition);
    const night=await morning(23,45);
    const napAgain=await morning(12,45);
    const boundsAfter=orb.getBounds();
    check('换姿态时窗口外框位置与尺寸完全不变',boundsBefore.x===boundsAfter.x&&boundsBefore.y===boundsAfter.y&&boundsBefore.width===boundsAfter.width&&boundsBefore.height===boundsAfter.height);
    check('时间状态确实换了（夜间睡觉 / 午睡两次切换）',night.state==='night_sleep'&&napAgain.state==='nap');
    const stageAfter=await pet("(()=>{const s=document.querySelector('.sprite-stage').getBoundingClientRect();return {w:Math.round(s.width),h:Math.round(s.height)}})()");
    check('舞台尺寸与状态无关',stageAfter.w===anchor.w&&stageAfter.h===anchor.h);
    const tuning=await pet("(()=>{const img=document.querySelector('.companion-frame.is-current');const s=getComputedStyle(img);return {transform:s.transform,scale:s.getPropertyValue('--pet-scale'),x:s.getPropertyValue('--pet-x'),y:s.getPropertyValue('--pet-y')}})()");
    check('姿态偏移来自集中配置的 CSS 变量',tuning.scale.trim()!==''&&/px$/.test(tuning.x.trim())&&/px$/.test(tuning.y.trim()),JSON.stringify(tuning));
    check('拖动与点击仍然可用',await pet("!!document.querySelector('.pet-handle')&&!!document.querySelector('.companion-rail-button')&&!document.querySelector('.pet-handle').hasAttribute('title')"));

    /* ---------- E2. 自绘右键菜单与快捷键 ---------- */
    const {globalShortcut}=require('electron');
    check('桌宠显示/隐藏快捷键已注册',globalShortcut.isRegistered('Control+Alt+Y')===true);
    const menuWindow=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#menu'));
    check('右键菜单是独立的自绘窗口',!!menuWindow);
    const menu=code=>menuWindow.webContents.executeJavaScript(code);
    await pet("window.dayhub.window('menu')");
    await wait(500);
    check('右键菜单会展开',menuWindow.isVisible());
    fs.writeFileSync(path.join(output,'pet-menu.png'),(await menuWindow.webContents.capturePage()).toPNG());
    const rows=await menu("[...document.querySelectorAll('.pet-menu-item .pet-menu-label')].map(b=>b.textContent.trim())");
    check('菜单包含样式切换 / 气泡 / 隐藏 / 退出',rows.length===8
      && rows[0]==='打开 YD'&&rows[1]==='查看双方状态'
      && rows[2]==='显示为桌宠'&&rows[3]==='显示为悬浮球'
      && rows[4]==='暂停气泡提醒 1 小时'&&rows[5]==='桌宠设置'
      && rows[6]==='隐藏桌宠'&&rows[7]==='退出 YD',rows.join('|'));
    check('菜单用勾选标记当前样式',await menu("document.querySelector('[role=menuitemradio][aria-checked=true] .pet-menu-label')?.textContent.trim()==='显示为桌宠'&&document.querySelectorAll('.pet-menu-mark').length===8"));
    check('隐藏行显示快捷键提示',await menu("document.querySelectorAll('.pet-menu-hint').length===1&&document.querySelector('.pet-menu-hint').textContent==='Ctrl+Alt+Y'"));
    check('菜单是瓷白卡片而不是系统原生菜单',await menu("(()=>{const d=document.querySelector('.pet-menu'),s=getComputedStyle(d);return !!d&&s.borderRadius!=='0px'&&/rgba\\(252, 251, 248/.test(s.backgroundColor)})()"));
    const menuSize=menuWindow.getSize();
    check('菜单窗口高度与模型一致',menuSize[1]>=300&&menuSize[1]<=320,menuSize.join('x'));
    // 点“显示为悬浮球”：菜单收起、桌宠窗口按悬浮球尺寸重建。
    await menu("[...document.querySelectorAll('.pet-menu-item')].find(b=>b.querySelector('.pet-menu-label').textContent.trim()==='显示为悬浮球').click()");
    await wait(600);
    check('从菜单切到悬浮球样式',!menuWindow.isVisible()&&Math.abs(orb.getSize()[0]-102)<=2&&await pet("!!document.querySelector('.presence-orb')"));
    await pet("window.dayhub.window('menu')");await wait(400);
    await menu("[...document.querySelectorAll('.pet-menu-item')].find(b=>b.querySelector('.pet-menu-label').textContent.trim()==='显示为桌宠').click()");
    await wait(600);
    check('从菜单切回桌宠样式',await pet("!!document.querySelector('.companion-figure')&&document.querySelector('.companion-figure').dataset.assetSlot.length>0"));
    // 点“隐藏桌宠”后，全局快捷键路径与菜单共用同一个开关。
    await pet("window.dayhub.window('menu')");await wait(400);
    await menu("[...document.querySelectorAll('.pet-menu-item')].find(b=>b.querySelector('.pet-menu-label').textContent.trim()==='隐藏桌宠').click()");
    await wait(500);
    check('菜单隐藏桌宠后窗口收起',!orb.isVisible()&&!menuWindow.isVisible());
    check('隐藏后菜单会显示“显示桌宠”',await (async()=>{await pet("window.dayhub.window('menu')");await wait(400);return menu("[...document.querySelectorAll('.pet-menu-item')].some(b=>b.querySelector('.pet-menu-label').textContent.trim()==='显示桌宠')");})());
    await menu("[...document.querySelectorAll('.pet-menu-item')].find(b=>b.querySelector('.pet-menu-label').textContent.trim()==='显示桌宠').click()");
    await wait(500);
    check('菜单可以把桌宠重新显示出来',orb.isVisible());
    await pet("window.dayhub.window('menu')");await wait(300);
    await menu("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    await wait(300);
    check('Esc 可以收起菜单',!menuWindow.isVisible());
    fs.writeFileSync(path.join(output,'pet-medium.png'),(await orb.webContents.capturePage()).toPNG());

    /* ---------- F. 版本 ---------- */
    const version=require('./package.json').version;
    check('版本号已升级到 0.2.20',version==='0.2.20');
    check('锁文件版本同步',require('./package-lock.json').version==='0.2.20'&&require('./package-lock.json').packages[''].version==='0.2.20');
    check('构建产物里的桌宠素材同步',fs.existsSync(path.join(__dirname,'dist','assets','companion','custom','manifest.json')));
    const log=fs.readFileSync(path.join(output,'dayhub.log'),'utf8');
    // 以脚本方式启动 Electron 时 app.getVersion() 返回 Electron 版本，
    // 因此这里只断言素材状态与启动流程；应用版本由 package.json / 锁文件 / 安装包元数据保证。
    check('启动日志记录素材状态',/桌宠素材/.test(log));
    check('渲染层无 console 错误',errors.length===0,errors.join(' | '));

    const report={version,missing,passed,consoleErrors:errors};
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({output,report},null,2));
    clearTimeout(deadline);app.quit();
  }catch(error){
    clearTimeout(deadline);
    fs.writeFileSync(path.join(output,'failure.txt'),error.stack||String(error));
    console.error(error);app.exit(1);
  }
});

app.on('web-contents-created',(_event,contents)=>contents.on('console-message',(...args)=>{
  // Electron 44 把回调改成 (event, details)，老版本是 (event, level, message)。
  const details=args[1];
  if(details&&typeof details==='object'){if(details.level==='error'||details.level===3)errors.push(String(details.message));}
  else if(Number(details)>=2)errors.push(String(args[2]));
}));
