// Isolated integration test: never connects to the user's app data.
const {app,BrowserWindow,Menu}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const output=path.join(__dirname,'test-data','v02-runtime-'+Date.now());fs.mkdirSync(output,{recursive:true});
process.env.DAYHUB_TEST_DATA=output;
require('./dist/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const report=[];
function check(name,value){assert.ok(value,name);report.push(name);}
app.whenReady().then(async()=>{
 try{
  let panel,orb,bubble,mini,tip;
  for(let i=0;i<100;i++){const ws=BrowserWindow.getAllWindows();panel=ws.find(w=>!w.webContents.getURL().includes('#')&&w.webContents.getURL().includes('index.html'));orb=ws.find(w=>w.webContents.getURL().endsWith('#orb'));bubble=ws.find(w=>w.webContents.getURL().endsWith('#bubble'));mini=ws.find(w=>w.webContents.getURL().endsWith('#mini'));tip=ws.find(w=>w.webContents.getURL().endsWith('#tip'));if(panel&&orb&&bubble&&mini&&tip&&!panel.webContents.isLoading()&&!mini.webContents.isLoading()&&!tip.webContents.isLoading())break;await wait(100);}
  check('五个真实窗口完成加载',panel&&orb&&bubble&&mini&&tip);
  const run=code=>panel.webContents.executeJavaScript(code);
  await wait(500);
  // v0.3 Phase 0：改用完全合成的课表 fixture（Alex / Sam），不再读取私人课表。
  const schedule=JSON.parse(fs.readFileSync(path.join(__dirname,'tests','fixtures','synthetic-schedule.json'),'utf8'));
  await run(`window.dayhub.change({type:'importSchedule',value:${JSON.stringify(schedule)}})`);await wait(200);
  check('默认英文菜单已移除',Menu.getApplicationMenu()===null);
  check('窗口标题控制按钮齐全',await run(`['最小化','最大化或还原','收起到托盘'].every(t=>document.querySelector('[aria-label="'+t+'"]'))`));
  check('合成课表课程15条（含2条research）',await run(`window.dayhub.get().then(s=>s.courses.length===15&&s.courses.filter(c=>c.activity==='research').length===2)`));
  const clock=await run('window.dayhub.live()');await wait(1100);const next=await run('window.dayhub.live()');check('主进程时钟实时前进',next.now-clock.now>=1000);
  check('双方实时状态常驻主窗口',await run("document.querySelectorAll('.dual-status .person-status').length===2"));
  await run("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='课表管理').click()");await wait(100);
  check('周课表含七天和八节次',await run("document.querySelectorAll('.schedule-day').length===7&&document.querySelectorAll('.period-label').length===8"));
  const switchWeek=async week=>run(`(()=>{const s=document.querySelector('[aria-label="查看教学周"]'),set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,'${week}');s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await switchWeek(8);await wait(100);check('第8周显示前半学期课程',await run("document.querySelector('.schedule-grid').textContent.includes('Academic English')&&!document.querySelector('.schedule-grid').textContent.includes('Machine Learning')"));
  await switchWeek(9);await wait(100);check('第9周切换后半学期课程',await run("document.querySelector('.schedule-grid').textContent.includes('Machine Learning')&&!document.querySelector('.schedule-grid').textContent.includes('Academic English')"));
  check('非首页无重复新建按钮',await run("![...document.querySelectorAll('button')].some(b=>['新建待办','新建会议'].includes(b.textContent.trim()))"));
  await run("Promise.all([window.dayhub.change({type:'save',entity:'tasks',value:{id:'overview-task',title:'一览待办',due:'',notes:'',done:false,checklist:[],reminders:[]}}),window.dayhub.change({type:'save',entity:'events',value:{id:'overview-event',title:'一览会议',start:'2030-01-01T10:00',end:'2030-01-01T11:00',place:'会议室',notes:'',checklist:[],reminders:[]}})])");await wait(100);
  await run("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='事项与会议').click()");await wait(100);check('事项与会议统一双栏',await run("document.querySelectorAll('.management-section').length===2&&document.body.textContent.includes('一览待办')&&document.body.textContent.includes('一览会议')"));
  await run("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='我的安排').click()");await wait(100);check('新建入口只在我的安排',await run("['新建待办','新建会议'].every(t=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===t))"));
  await run("window.dayhub.change({type:'settings',pet:{mode:'custom',size:'medium'}})");await wait(120);
  check('桌宠底部状态条显示双方',await orb.webContents.executeJavaScript("document.querySelectorAll('.companion-rail .rail-chip').length===2"));
  // 0.2.20：唯一形象是专属角色桌宠，注入快照时必须带上当前偏好与显示态。
  const injectPet=(display)=>({...next,preferences:{...next.preferences,mode:'custom'},display:{...next.display,...display}});
  let stateArt=false;for(let i=0;i<5&&!stateArt;i++){orb.webContents.send('dayhub:live',injectPet({state:'busy_class',asset:'busy_class',label:'上课中'}));await wait(30);stateArt=await orb.webContents.executeJavaScript("(()=>{const f=document.querySelector('.companion-figure');const img=document.querySelector('.companion-frame.is-current');return !!f&&f.dataset.assetSlot==='busy_class'&&f.dataset.assetKey==='busy_class'&&!!img&&img.complete&&img.naturalWidth>0&&img.src.startsWith('data:image/png;base64,')})()");}
  check('Ta上课切换教学动作且使用专属素材',stateArt);
  let nightArt=false;for(let i=0;i<5&&!nightArt;i++){orb.webContents.send('dayhub:live',injectPet({state:'night_sleep',asset:'night_sleep',label:'夜间睡觉'}));await wait(40);nightArt=await orb.webContents.executeJavaScript("(()=>{const f=document.querySelector('.companion-figure'),img=document.querySelector('.companion-frame.is-current');return !!f&&f.dataset.assetSlot==='night_sleep'&&!!img&&img.naturalWidth>0})()");}
  check('夜间睡觉使用独立素材（与午睡不同帧）',nightArt);
  let napArt=false;for(let i=0;i<5&&!napArt;i++){orb.webContents.send('dayhub:live',injectPet({state:'nap',asset:'nap',label:'午睡中'}));await wait(40);napArt=await orb.webContents.executeJavaScript("(()=>{const f=document.querySelector('.companion-figure'),img=document.querySelector('.companion-frame.is-current');return !!f&&f.dataset.assetSlot==='nap'&&!!img&&img.naturalWidth>0})()");}
  check('午睡与夜间睡觉是两个独立状态',napArt);
  // 换姿态只换帧：舞台尺寸与窗口外框都不能动。
  const petBox=await orb.webContents.executeJavaScript("(()=>{const s=document.querySelector('.sprite-stage').getBoundingClientRect();return {w:Math.round(s.width),h:Math.round(s.height),slot:document.querySelector('.companion-figure').dataset.assetSlot}})()");
  await wait(1400);
  const petBoxAgain=await orb.webContents.executeJavaScript("(()=>{const s=document.querySelector('.sprite-stage').getBoundingClientRect();return {w:Math.round(s.width),h:Math.round(s.height),slot:document.querySelector('.companion-figure').dataset.assetSlot}})()");
  check('换姿态不改变 stage 尺寸',petBox.w===petBoxAgain.w&&petBox.h===petBoxAgain.h);
  check('没有小猫桌宠的任何残留',await orb.webContents.executeJavaScript("!document.querySelector('.pet-art')&&!document.querySelector('.pet-labels')&&!/小猫/.test(document.body.textContent)"));
  fs.writeFileSync(path.join(output,'main.png'),(await panel.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(output,'pet.png'),(await orb.webContents.capturePage()).toPNG());
  await run("document.querySelector('[aria-label=\"最大化或还原\"]').click()");await wait(200);check('最大化按钮',panel.isMaximized());
  await run("document.querySelector('[aria-label=\"最大化或还原\"]').click()");await wait(200);check('还原按钮',!panel.isMaximized());
  await run("document.querySelector('[aria-label=\"最小化\"]').click()");await wait(200);check('最小化按钮',panel.isMinimized());
  await orb.webContents.executeJavaScript("window.dayhub.window('open')");await wait(200);check('桌宠重新打开主窗口',panel.isVisible()&&!panel.isMinimized());
  await run("document.querySelector('[aria-label=\"收起到托盘\"]').click()");check('关闭收起到托盘',!panel.isVisible()&&orb.isVisible());
  await orb.webContents.executeJavaScript("document.querySelector('.companion-rail-button').click()");await wait(100);check('单击打开双方小面板',mini.isVisible());
  check('双方小面板紧凑且内容完整',mini.getSize()[0]<=336&&mini.getSize()[1]<=280&&await mini.webContents.executeJavaScript("document.documentElement.scrollHeight<=document.documentElement.clientHeight"));
  fs.writeFileSync(path.join(output,'mini.png'),(await mini.webContents.capturePage()).toPNG());
  await mini.webContents.executeJavaScript("window.dayhub.window('settings')");await wait(100);check('桌宠设置导航',await run("document.querySelector('h1').textContent==='设置与备份'"));
  // 画布 = 上下透明安全区 28 + 可见人物（148/172/200）+ 间隙 4 + 状态条 32。
  const sizeSteps=[];for(const [size,expected] of [['small',212],['medium',236],['large',264]]){await run(`window.dayhub.change({type:'settings',pet:{size:'${size}'}})`);await wait(150);const [,height]=orb.getSize();sizeSteps.push(height);console.log('size',size,orb.getSize());check('桌宠尺寸 '+size+' 与画布常量一致',Math.abs(height-expected)<=2);}
  check('三档尺寸单调递增且人物等比放大',sizeSteps[0]<sizeSteps[1]&&sizeSteps[1]<sizeSteps[2]);
  await run("window.dayhub.change({type:'settings',pet:{mode:'orb',size:'medium'}})");await wait(100);
  check('双状态核心结构和D/Y字母标记',await orb.webContents.executeJavaScript("document.querySelectorAll('.presence-zone').length===2&&[...document.querySelectorAll('.identity-mark')].map(e=>e.textContent).join('')==='DY'&&document.querySelectorAll('.status-core').length===2"));
  check('球体为96px严格正圆',await orb.webContents.executeJavaScript("(()=>{const r=document.querySelector('.presence-surface').getBoundingClientRect();return Math.abs(r.width-96)<.1&&Math.abs(r.width-r.height)<.1&&getComputedStyle(document.querySelector('.presence-surface')).aspectRatio==='1 / 1'})()"));
  const symmetry=await orb.webContents.executeJavaScript("(()=>{const s=document.querySelector('.presence-surface').getBoundingClientRect(),m=[...document.querySelectorAll('.identity-mark')].map(e=>e.getBoundingClientRect()),d=[...document.querySelectorAll('.status-dot')].map(e=>e.getBoundingClientRect()),cx=r=>r.x+r.width/2,cy=r=>r.y+r.height/2;return {surface:{x:s.x,y:s.y,width:s.width,height:s.height},marks:m.map(r=>({cx:cx(r),cy:cy(r),width:r.width,height:r.height})),dots:d.map(r=>({cx:cx(r),cy:cy(r),width:r.width,height:r.height}))}})()");console.log('symmetry',symmetry);
  check('D/Y与左右状态点严格对称',Math.abs((symmetry.marks[0].cx+symmetry.marks[1].cx)/2-(symmetry.surface.x+symmetry.surface.width/2))<.1&&Math.abs(symmetry.marks[0].cy-symmetry.marks[1].cy)<.1&&Math.abs((symmetry.dots[0].cx+symmetry.dots[1].cx)/2-(symmetry.surface.x+symmetry.surface.width/2))<.1&&Math.abs(symmetry.dots[0].cy-symmetry.dots[1].cy)<.1&&Math.abs(symmetry.dots[0].width-6)<.1&&Math.abs(symmetry.dots[0].width-symmetry.dots[1].width)<.1);
  check('中央分割线和原生title均已删除',await orb.webContents.executeJavaScript("!document.querySelector('.presence-seam')&&!document.querySelector('.pet-handle').hasAttribute('title')"));
  check('默认球体仅显示D/Y且无旧贴图',await orb.webContents.executeJavaScript("document.body.textContent.trim()==='DY'&&!/[我Ta]/.test(document.body.textContent)&&!document.querySelector('.split-orb')&&!document.querySelector('.orb-shell')"));
  // 状态语义来自统一 StateEngine 的 CurrentState.kind（不再是 code / research 标记）：
  // me → meeting（忙碌色），partner → research（专注色）。
  const injectKinds=value=>({...value,preferences:{...value.preferences,mode:'orb'},people:value.people.map(p=>({...p,current:{...p.current,kind:p.person==='me'?'meeting':'research'}}))});
  orb.webContents.send('dayhub:live',injectKinds(next));await wait(80);
  // 主进程每秒会广播一次真实快照，注入的快照可能被下一帧覆盖，因此重试几次。
  let zones=false;
  for(let i=0;i<6&&!zones;i++){
    orb.webContents.send('dayhub:live',injectKinds(next));
    await wait(60);
    zones=await orb.webContents.executeJavaScript("!!document.querySelector('.presence-me.state-busy')&&!!document.querySelector('.presence-partner.state-focus')");
  }
  check('忙碌与专注状态映射到独立状态核心',zones);
  await orb.webContents.executeJavaScript("window.dayhub.presence('enter','me')");await wait(80);check('CASE 1 进入球体显示自定义tooltip',tip.isVisible());
  console.log('tip size',tip.getSize());
  check('悬停提示为独立紧凑窗口',tip.isVisible()&&tip.getSize()[0]<=152&&tip.getSize()[1]<=40);
  check('提示使用D/Y短代号且不暴露关系身份',await tip.webContents.executeJavaScript("/^[DY] · (空闲|上课中|教研中|活动中|会议中|即将有安排|今日课程已结束|今天无课|课表尚未开始|本学期课程已结束|尚未录入课表)$/.test(document.body.textContent.trim())"));
  await orb.webContents.executeJavaScript("window.dayhub.presence('leave')");await wait(40);check('CASE 2 离开球体立即收起tooltip',!tip.isVisible());
  // Windows 会把透明无边框窗口对齐到物理像素栅格（150% 缩放下会 +1px），
  // 因此窗口尺寸允许 2px 误差；球体本身的正圆由上面的 DOM 断言保证。
  check('悬浮球窗口为102px正方形',Math.abs(orb.getSize()[0]-102)<=2&&Math.abs(orb.getSize()[1]-102)<=2);
  const beforeDrag=orb.getBounds(),pointer={x:beforeDrag.x+51,y:beforeDrag.y+51};
  await orb.webContents.executeJavaScript("window.dayhub.presence('enter','me')");await wait(30);
  await orb.webContents.executeJavaScript(`window.dayhub.beginDrag(${pointer.x},${pointer.y})`);
  await wait(30);check('CASE 3 开始拖动立即隐藏tooltip',!tip.isVisible());
  await orb.webContents.executeJavaScript("window.dayhub.presence('enter','partner')");await wait(30);check('CASE 4 拖动期间禁止tooltip',!tip.isVisible());
  for(let i=1;i<=30;i++)await orb.webContents.executeJavaScript(`window.dayhub.drag(${pointer.x-i*3},${pointer.y})`);
  await orb.webContents.executeJavaScript("window.dayhub.presence('enter','me')");await wait(20);check('拖动移出视觉区域仍无tooltip',!tip.isVisible());
  await orb.webContents.executeJavaScript("window.dayhub.endDrag()");
  await wait(30);check('CASE 5/6 松开后不继承旧tooltip',!tip.isVisible());
  // 0.2.16：拖动路径改成 setPosition + 系统光标锚点，Windows 仍会把窗口对齐到
  // 物理像素（150% 下偶发 ±1px），因此尺寸允许 2px 误差，位置必须真的移动。
  const afterDrag=orb.getBounds();console.log('drag bounds',{beforeDrag,afterDrag});check('拖动只改变位置且不拉伸窗口',Math.abs(afterDrag.width-beforeDrag.width)<=2&&Math.abs(afterDrag.height-beforeDrag.height)<=2&&afterDrag.x<beforeDrag.x);
  await orb.webContents.executeJavaScript("window.dayhub.presence('enter','partner')");await wait(30);check('拖动结束后的新hover可正常显示',tip.isVisible());await orb.webContents.executeJavaScript("window.dayhub.presence('leave')");
  for(let i=0;i<3;i++){await orb.webContents.executeJavaScript(`window.dayhub.beginDrag(${afterDrag.x+51},${afterDrag.y+51})`);await orb.webContents.executeJavaScript("window.dayhub.presence('enter','me')");await orb.webContents.executeJavaScript("window.dayhub.endDrag()");}
  await wait(30);check('CASE 7/9 快速连续拖动无幽灵tooltip',!tip.isVisible());
  orb.focus();await orb.webContents.executeJavaScript("window.dayhub.presence('enter','me')");await wait(30);panel.show();panel.focus();await wait(60);check('CASE 8 窗口失焦清除tooltip',!tip.isVisible());
  check('CASE 10 样式仅使用等比scale',!fs.readFileSync(path.join(__dirname,'src','ui','presence-orb.css'),'utf8').match(/scale[XY]\s*\(|width\s*:\s*[^;]+keyframe|height\s*:\s*[^;]+keyframe/i));
  await run("window.dayhub.change({type:'settings',pet:{mode:'custom',size:'medium',reduceMotion:true}})");
  await wait(120);
  check('切回专属角色桌宠并尊重“减少动态”',!((await orb.capturePage()).isEmpty())&&await orb.webContents.executeJavaScript("!document.querySelector('.companion-figure.is-breathing')&&document.querySelector('.companion-frame.is-current').getBoundingClientRect().width>60"));
  check('拖动位置落盘',await run("window.dayhub.get().then(s=>!!s.settings.orb)"));
  // Use the normal renderer subscription to assert bubble rendering and hit regions.
  let bubbleRendered=false;for(let i=0;i<5&&!bubbleRendered;i++){bubble.webContents.send('dayhub:live',{...next,bubble:{id:'test',text:'Y开始上课啦，10:35 结束 · Class 2 Literature'}});await wait(30);bubbleRendered=await bubble.webContents.executeJavaScript("document.body.textContent.includes('Y开始上课啦')&&!!document.querySelector('.cloud-close')");}
  check('漫画气泡文案及关闭入口',bubbleRendered);
  fs.writeFileSync(path.join(output,'bubble.png'),(await bubble.webContents.capturePage()).toPNG());
  // Real scheduler, with a real future deadline in the isolated database.
  const due=Math.ceil((Date.now()+3000)/60000)*60000;
  const stamp=new Date(due+8*3600000).toISOString().slice(0,16);
  await run(`window.dayhub.change({type:'save',entity:'tasks',value:{id:'runtime-due',title:'隔离验收到时提醒',notes:'',due:'${stamp}',done:false,checklist:[],reminders:[0]}})`);
  console.log('等待真实到时气泡',Math.ceil((due-Date.now())/1000)+'秒');
  let delivered;
  while(Date.now()<due+7000){const v=await run('window.dayhub.live()');if(v.bubble?.text.includes('隔离验收到时提醒')){delivered=v;break;}await wait(200);}
  check('真实截止时间触发气泡',!!delivered&&bubble.isVisible());
  await bubble.webContents.executeJavaScript("window.dayhub.bubble('hold')");await wait(8500);
  check('悬停保持超过8秒',bubble.isVisible());
  await bubble.webContents.executeJavaScript("window.dayhub.bubble('close')");check('关闭气泡立即收起',!bubble.isVisible());
  check('关闭气泡不完成待办、不确认提醒',await run("window.dayhub.get().then(s=>!s.tasks.find(t=>t.id==='runtime-due').done&&s.reminders.some(r=>r.target==='tasks:runtime-due'&&r.status==='due'))"));
  await wait(150);
  await run("[...document.querySelectorAll('.nav-item')].find(b=>b.textContent==='我的安排').click()");await wait(100);
  check('首页与侧栏未处理提醒均为1',await run("document.querySelector('.attention-panel').textContent.includes('1 个提醒已到时间')&&[...document.querySelectorAll('.nav-item')].some(b=>b.querySelector('.nav-label')?.textContent==='未处理提醒'&&b.querySelector('.nav-badge')?.textContent==='1')"));
  await run("[...document.querySelectorAll('.nav-item')].find(b=>b.textContent.startsWith('未处理提醒')).click()");await wait(100);
  check('提醒页同一集合为1',await run("document.querySelectorAll('.main .entry').length===1&&!document.body.textContent.includes('没有未处理提醒')"));
  await run("[...document.querySelectorAll('.main button')].find(b=>b.textContent==='已处理').click()");await wait(150);
  check('确认后提醒页与侧栏同时归零',await run("document.body.textContent.includes('没有未处理提醒')&&[...document.querySelectorAll('.nav-item')].some(b=>b.textContent==='未处理提醒')"));
  check('确认后悬浮快照归零但待办未完成',await run("Promise.all([window.dayhub.live(),window.dayhub.get()]).then(([l,s])=>l.pending===0&&!s.tasks.find(t=>t.id==='runtime-due').done)"));
  await run("[...document.querySelectorAll('.nav-item')].find(b=>b.textContent==='我的安排').click()");await wait(100);
  // 0.2.14 的“需要处理”按统一 selector 汇总通知、已到时间提醒和逾期待办；
  // 这里提醒已确认，但验收待办的截止时间已过，因此处理区只应保留逾期待办。
  check('返回首页提醒数为0且处理区只保留逾期待办',await run("(()=>{const t=document.querySelector('.attention-panel')?.textContent??'';return t.includes('1 个待办已逾期')&&!t.includes('个提醒已到时间')})()"));
  check('气泡去重记录已落盘',await run("window.dayhub.get().then(s=>s.bubbleHistory.some(r=>r.id.includes('runtime-due')))"));
  check('迁移自动备份已保存',fs.existsSync(path.join(output,'backups')));
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:report},null,2));console.log(JSON.stringify({output,passed:report},null,2));app.quit();
 }catch(e){console.error(e);fs.writeFileSync(path.join(output,'failure.txt'),e.stack);app.exit(1);}
});
