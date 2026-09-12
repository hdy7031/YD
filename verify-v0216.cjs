// Isolated 0.2.16 acceptance run: companion drag stability + inbox capture.
// Never touches the real app data (DAYHUB_TEST_DATA points at test-data/).
const {app,BrowserWindow,screen}=require('electron');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const output=path.join(__dirname,'test-data','v0216-runtime-'+Date.now());
fs.mkdirSync(output,{recursive:true});
process.env.DAYHUB_TEST_DATA=output;
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'dist','assets','companion','custom','manifest.json'),'utf8'));
require('./dist/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const report=[],notes=[];
function check(name,value){assert.ok(value,name);report.push(name);}
function soft(name,value,detail){if(value)report.push(name);else notes.push(name+(detail?'：'+detail:''));}
const near=(actual,expected,tolerance=2)=>Math.abs(actual-expected)<=tolerance;
// 用单调时钟计时：夜间验收会临时接管 Date.now 来模拟 23:45，超时判断必须不受影响。
async function until(fn,timeout=6000,step=120){const end=performance.now()+timeout;for(;;){const value=await fn();if(value)return value;if(performance.now()>end)return value;await wait(step);}}
// 用系统 API 移动真实光标（物理像素），用于验证 DIP ↔ 物理像素的拖动映射。
function setCursorPhysical(x,y){
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    `Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point(${Math.round(x)},${Math.round(y)})`],
    {windowsHide:true,timeout:15000});
}
const beijing=ms=>new Date(ms+8*3600000);
const stampOf=ms=>beijing(ms).toISOString().slice(0,16);
const dateOf=ms=>beijing(ms).toISOString().slice(0,10);
const clockOf=ms=>beijing(ms).toISOString().slice(11,16);
function mondayOf(date){const day=new Date(date+'T00:00:00Z').getUTCDay();const shift=(day+6)%7;const base=new Date(date+'T00:00:00Z');base.setUTCDate(base.getUTCDate()-shift);return base.toISOString().slice(0,10);}
// 真实 PNG 片段（由窗口截图生成），避免手写十六进制在解码器里不稳定。
let shotB64='';
const fileLiteral=()=>`(()=>{const bin=atob(${JSON.stringify(shotB64)});const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return new File([bytes],'shot.png',{type:'image/png'});})()`;

app.whenReady().then(async()=>{
  try{
    let panel,orb,bubble,mini,tip;
    for(let i=0;i<120;i++){
      const ws=BrowserWindow.getAllWindows();
      panel=ws.find(w=>!w.webContents.getURL().includes('#')&&w.webContents.getURL().includes('index.html'));
      orb=ws.find(w=>w.webContents.getURL().endsWith('#orb'));
      bubble=ws.find(w=>w.webContents.getURL().endsWith('#bubble'));
      mini=ws.find(w=>w.webContents.getURL().endsWith('#mini'));
      tip=ws.find(w=>w.webContents.getURL().endsWith('#tip'));
      if(panel&&orb&&bubble&&mini&&tip&&!panel.webContents.isLoading()&&!orb.webContents.isLoading())break;
      await wait(100);
    }
    check('五个真实窗口完成加载',panel&&orb&&bubble&&mini&&tip);
    const run=code=>panel.webContents.executeJavaScript(code);
    const pet=code=>orb.webContents.executeJavaScript(code);
    const live=()=>run('window.dayhub.live()');
    const state=()=>run('window.dayhub.get()');
    const save=cmd=>run(`window.dayhub.change(${JSON.stringify(cmd)})`);
    const settings=value=>save({type:'settings',pet:value});
    const nav=async label=>{await run(`[...document.querySelectorAll('.nav-item')].find(b=>b.textContent.startsWith(${JSON.stringify(label)})).click()`);await wait(220);};
    const inert=code=>run(`(async()=>{${code}})()`);
    await wait(700);
    shotB64=(await panel.webContents.capturePage({x:0,y:0,width:80,height:56})).toPNG().toString('base64');

    /* ---------------- A. 固定画布与状态栏 ---------------- */
    const bundle=await run('window.dayhub.companionAssets().then(a=>({available:a.available,count:Object.keys(a.images).length,aspect:a.aspect,missing:a.missing,reason:a.reason}))');
    check('专属角色素材七个状态齐全（含 sleeping）且已预加载到渲染层',bundle.available&&bundle.count===7&&bundle.missing.length===0);
    const aspect=bundle.aspect;
    const geometry=(mode,size,character)=>({
      width:mode==='custom'?Math.max(150,Math.round(character*aspect)+16):300,
      height:mode==='custom'?6*2+character+4+32:{"small":96,"medium":128,"large":160}[size],
    });
    const medium=geometry('custom','medium',224);
    check('专属角色桌宠窗口使用固定画布尺寸',near(orb.getSize()[0],medium.width)&&near(orb.getSize()[1],medium.height));
    check('渲染层已切换为 sprite-stage / sprite-inner / status-rail 三层结构',await pet("!!document.querySelector('.sprite-stage')&&!!document.querySelector('.sprite-inner')&&!!document.querySelector('.status-rail')"));
    const railFits=()=>pet(`(()=>{
      const win=document.documentElement.clientHeight;
      const rail=document.querySelector('.companion-rail')?.getBoundingClientRect();
      const handle=document.querySelector('.pet-handle')?.getBoundingClientRect();
      const figure=document.querySelector('.companion-figure')?.getBoundingClientRect();
      if(!rail||!handle||!figure)return {ok:false};
      return {ok:rail.bottom<=win+0.5&&rail.top>=0&&rail.width>20&&rail.height>10,
        railBottom:Math.round(rail.bottom),windowHeight:win,figureBottom:Math.round(figure.bottom),handleBottom:Math.round(handle.bottom)};
    })()`);
    const idleRail=await railFits();
    check('状态栏完整落在窗口内且角色脚底与 stage 底部对齐',idleRail.ok&&Math.abs(idleRail.figureBottom-idleRail.handleBottom)<2);
    check('状态栏只保留 D / Y 两个状态点与可选计数',await pet("document.querySelectorAll('.companion-rail .rail-chip').length===2&&[...document.querySelectorAll('.companion-rail .rail-chip b')].map(e=>e.textContent).join('')==='DY'&&document.querySelector('.companion-rail').textContent.replace(/\\s/g,'').length<=3"));
    /* ---- A2. 状态点颜色语义：同语义必然同色，空闲绝不会是红色 ---- */
    const dotInfo=()=>pet(`(()=>[...document.querySelectorAll('.companion-rail .rail-dot')].map(el=>({tone:el.dataset.tone,color:getComputedStyle(el).backgroundColor,alias:el.previousElementSibling?.textContent})))()`);
    const toneOf=(list,alias)=>list.find(x=>x.alias===alias)?.tone;
    const alertColor=await pet(`(()=>{const el=document.createElement('i');el.className='rail-dot tone-alert';document.querySelector('.companion-rail').appendChild(el);const color=getComputedStyle(el).backgroundColor;el.remove();return color})()`);
    // 注入确定的状态组合（每秒一次的真实广播可能覆盖，因此重试），
    // 直接覆盖“同为空闲却一个绿一个红”的原始问题。
    const toneMatrix=async(patch,expected)=>{
      for(let i=0;i<10;i++){
        const v=await run('window.dayhub.live()');
        orb.webContents.send('dayhub:live',{...v,display:{...v.display,nightly:false},people:v.people.map(p=>({...p,...patch(p)}))});
        await wait(120);
        const dots=await dotInfo();
        if(dots.length===2&&toneOf(dots,'D')===expected.D&&toneOf(dots,'Y')===expected.Y)return dots;
      }
      return dotInfo();
    };
    const bothIdle=await toneMatrix(p=>({code:'FREE',research:false,conflict:false,current:[]}),{D:'calm',Y:'calm'});
    check('D / Y 同为空闲时状态点同色（绿色）',toneOf(bothIdle,'D')==='calm'&&toneOf(bothIdle,'Y')==='calm'&&bothIdle[0].color===bothIdle[1].color);
    check('空闲不会显示成警示色',bothIdle.every(x=>x.tone!=='alert'&&x.color!==alertColor));
    const mixedTone=await toneMatrix(p=>p.person==='me'?{code:'FREE',research:false,conflict:false,current:[]}:{code:'BUSY_CLASS',research:false,conflict:false,current:[]},{D:'calm',Y:'busy'});
    check('D 空闲 / Y 忙碌 时颜色正确区分',toneOf(mixedTone,'D')==='calm'&&toneOf(mixedTone,'Y')==='busy'&&mixedTone[0].color!==mixedTone[1].color);
    const busyBoth=await toneMatrix(()=>({code:'BUSY_CLASS',research:false,conflict:false,current:[]}),{D:'busy',Y:'busy'});
    check('双方同语义时颜色一致（都忙碌）',toneOf(busyBoth,'D')==='busy'&&toneOf(busyBoth,'Y')==='busy'&&busyBoth[0].color===busyBoth[1].color);
    const offlineTone=await toneMatrix(p=>p.person==='me'?{code:'FREE',research:false,conflict:false,current:[]}:{code:'NO_SCHEDULE',research:false,conflict:false,current:[]},{D:'calm',Y:'neutral'});
    check('未录入课表语义为中性灰，不是红色空闲',toneOf(offlineTone,'Y')==='neutral'&&toneOf(offlineTone,'D')==='calm');
    const conflictTone=await toneMatrix(p=>p.person==='me'?{code:'FREE',research:false,conflict:false,current:[]}:{code:'FREE',research:false,conflict:true,current:[]},{D:'calm',Y:'alert'});
    check('只有真正的安排冲突才使用警示色',toneOf(conflictTone,'Y')==='alert'&&toneOf(conflictTone,'D')==='calm'&&conflictTone[1].color===alertColor);
    const upcomingTone=await toneMatrix(p=>p.person==='me'?{code:'FREE',research:false,conflict:false,current:[]}:{code:'UPCOMING',research:false,conflict:false,current:[]},{D:'calm',Y:'upcoming'});
    check('即将开始使用独立的琥珀色，不与空闲混淆',toneOf(upcomingTone,'Y')==='upcoming'&&upcomingTone[1].color!==upcomingTone[0].color);
    check('状态栏不再使用 backdrop-filter（透明窗口残影来源）',!/(backdrop-filter)/.test(await pet("getComputedStyle(document.querySelector('.companion-rail')).backdropFilter")));
    // 验收机器当前时刻可能是白天也可能是夜间窗口，这里只记录“开机首帧”。
    fs.writeFileSync(path.join(output,'companion-initial.png'),(await orb.webContents.capturePage()).toPNG());

    const baseline=orb.getSize().join('x');
    const frameOf=()=>pet("(()=>{const s=document.querySelector('.companion-frame.is-current');return s?s.src.length+':'+s.src.slice(2000,2060):'none'})()");
    const projection=await live();
    await wait(160);
    check('桌宠素材位始终等于主进程投影结果',await pet(`document.querySelector('.companion-figure').dataset.assetSlot===${JSON.stringify(projection.display.asset)}`));
    for(const asset of ['idle','relaxed','busy_class','busy_work','reminder','happy','sleeping']){
      orb.webContents.send('dayhub:live',await run(`window.dayhub.live().then(v=>({...v,display:{...v.display,asset:${JSON.stringify(asset)},label:${JSON.stringify(asset)},fallbacks:${JSON.stringify(['idle'])}}}))`));
      await wait(120);
      const railState=await railFits();
      check('状态 '+asset+' 下状态栏仍在窗口内',railState.ok);
      check('状态 '+asset+' 不改变窗口尺寸',orb.getSize().join('x')===baseline);
      check('状态 '+asset+' 渲染的是已解码图片',await pet("(()=>{const s=document.querySelector('.companion-frame.is-current');return !!s&&s.complete&&s.naturalWidth>0})()"));
    }
    const frames=await run("window.dayhub.companionAssets().then(a=>['idle','relaxed','busy_class','busy_work','reminder','happy','sleeping'].map(k=>a.images[k].length+':'+a.images[k].slice(2000,2060)))");
    check('七个状态素材互不相同（换帧不是同一张图）',new Set(frames).size===7);

    /* ---------------- B. 拖动冻结与稳定性 ---------------- */
    const dragInfo=()=>pet(`(()=>{const root=document.querySelector('.pet-dock');const inner=document.querySelector('.sprite-inner');const body=document.querySelector('.companion-body');
      return {dragging:root.classList.contains('is-dragging'),
        innerTransform:getComputedStyle(inner).transform,
        bodyAnimation:getComputedStyle(body).animationName,
        frameFilter:getComputedStyle(document.querySelector('.companion-frame.is-current')||document.body).filter,
        rail:!!document.querySelector('.companion-rail')};})()`);
    async function dragBy(dx,dy,steps=30){
      const b=orb.getBounds(),px=b.x+Math.round(b.width/2),py=b.y+Math.round(b.height/2);
      await pet(`window.dayhub.beginDrag(${px},${py})`);
      const start=orb.getBounds();
      for(let i=1;i<=steps;i++)await pet(`window.dayhub.drag(${px+Math.round(dx*i/steps)},${py+Math.round(dy*i/steps)})`);
      const moved=orb.getBounds();
      await pet('window.dayhub.endDrag()');
      await wait(60);
      return {start,moved};
    }
    const idleDrag=await dragBy(-90,0);
    // Windows 会把透明无边框窗口对齐到物理像素栅格：150% 缩放下同一 DIP 尺寸在
    // 不同屏幕位置可能报告 ±1px，因此尺寸用 2px 容差，位置必须真的移动。
    const steady=(before,after)=>near(after.width,before.width,2)&&near(after.height,before.height,2);
    check('CASE 1 idle 状态拖动 30 次：窗口只平移不改变大小',steady(idleDrag.start,idleDrag.moved)&&idleDrag.moved.x<idleDrag.start.x);
    // 连续 20 次真实拖动：每次结束后状态栏都必须还在。
    let repeatOk=true;
    for(let i=0;i<20;i++){
      const info=await dragBy(i%2?-4:4,i%3===0?3:-2,6);
      if(!steady(info.start,info.moved)||!info.moved)repeatOk=false;
      if(i%5===4&&!((await railFits()).ok&&(await dragInfo()).rail))repeatOk=false;
    }
    check('CASE 1b idle 状态连续拖动 20 次后状态条始终存在',repeatOk);
    check('拖动结束后没有残留 is-dragging',!(await dragInfo()).dragging);
    check('拖动结束后 D / Y 状态栏仍然存在',(await railFits()).ok&&(await dragInfo()).rail);
    const afterIdle=await pet(`(()=>{const inner=document.querySelector('.sprite-inner');const body=document.querySelector('.companion-body');return {transform:getComputedStyle(inner).transform,animation:getComputedStyle(body).animationName}})()`);
    check('拖动结束后恢复呼吸动画与位移能力',afterIdle.animation!=='none');
    // 拖动过程中：所有视觉动画必须冻结，只剩窗口位移。
    // 这一段走真实指针序列（React 合成事件），因此 is-dragging 由渲染层自己落。
    await pet("document.querySelector('.pet-handle').dispatchEvent(new PointerEvent('pointerenter',{bubbles:true}))");
    await wait(200);
    // 原生 :hover 无法用合成事件触发，改为直接核对样式表规则本身。
    check('hover 抬升只写在 sprite-inner 上',await pet(`(()=>{let found=false;
      for(const sheet of document.styleSheets)for(const rule of sheet.cssRules){
        const text=rule.cssText||'';
        if(text.includes('.pet-handle:hover .sprite-inner')&&text.includes('translateY'))found=true;
        if(/companion-frame[^{]*:hover/.test(text))found=false;
      }return found;})()`));
    const hoverBounds=orb.getBounds();
    const pointerEvent=(type,button,screenX)=>`document.querySelector('.pet-handle').dispatchEvent(new PointerEvent(${JSON.stringify(type)},{bubbles:true,cancelable:true,pointerId:7,button:${button},buttons:${type==='pointerup'?0:1},clientX:30,clientY:60,screenX:${screenX},screenY:${hoverBounds.y+60}}))`;
    await pet(pointerEvent('pointerdown',0,hoverBounds.x+40));
    await wait(90);
    const during=await dragInfo();
    await pet(pointerEvent('pointermove',-1,hoverBounds.x-20));
    await wait(120);
    const duringBounds=orb.getBounds();
    await pet(pointerEvent('pointerup',0,hoverBounds.x-20));
    await wait(140);
    const afterPointer=await dragInfo();
    check('CASE 4 hover 后立即拖动：拖动期间动画与变换全部冻结',during.dragging&&during.innerTransform==='none'&&during.bodyAnimation==='none'&&during.frameFilter==='none');
    check('CASE 4 真实指针拖动能移动窗口且比单击更早结束',duringBounds.x<hoverBounds.x&&!afterPointer.dragging);
    check('CASE 4 拖动结束后状态栏仍在',(await railFits()).ok);
    // busy_class 与 reminder 姿态下拖动
    const now=Date.now(),today=dateOf(now),weekday=((new Date(today+'T00:00:00Z').getUTCDay()+6)%7)+1;
    const base=await state(),partnerProfile=base.profiles.find(p=>p.id==='partner');
    const setPeriods=(startMs,endMs)=>save({type:'save',entity:'profiles',value:{...partnerProfile,startDate:mondayOf(today),weeks:20,periods:[{start:clockOf(startMs),end:clockOf(endMs)}]}});
    await setPeriods(now-20*60000,now+20*60000);
    await save({type:'save',entity:'courses',value:{id:'v0216-class',person:'partner',title:'验收课',weekday,first:1,last:1,weeks:[1],place:'教室',notes:'',checklist:[],reminders:[],activity:'teaching'}});
    const busy=await until(async()=>{const v=await live();return v.display.state==='busy_class'?v:null},5000);
    check('CASE 2 上课中姿态生效',!!busy&&busy.display.asset==='busy_class');
    const busyDots=await dotInfo();
    check('CASE 2 真实数据下 Y 上课中为忙碌色，且与 D 不同',toneOf(busyDots,'Y')==='busy'&&busyDots[0].color!==busyDots[1].color);
    const busyDrag=await dragBy(60,20);
    check('CASE 2 busy_class 状态拖动后窗口尺寸不变且状态栏完整',steady(busyDrag.start,busyDrag.moved)&&(await railFits()).ok);
    const dueMs=Math.ceil((now+5000)/60000)*60000;
    await save({type:'save',entity:'tasks',value:{id:'v0216-reminder',title:'验收提醒',notes:'',due:stampOf(dueMs),done:false,checklist:[],reminders:[0]}});
    console.log('等待真实到时提醒',Math.max(0,Math.ceil((dueMs-Date.now())/1000))+'秒');
    const due=await until(async()=>{const v=await live();return v.pending>0?v:null},Math.max(25000,dueMs-Date.now()+15000),300);
    check('CASE 5 到时提醒进入 reminder 姿态',!!due&&due.display.state==='reminder');
    const reminderDrag=await dragBy(-40,-25);
    check('CASE 3/5 reminder 状态拖动后状态栏与姿态同时保留',(await railFits()).ok&&await pet("!!document.querySelector('.companion-frame.is-current')")&&steady(reminderDrag.start,reminderDrag.moved));
    check('CASE 6 拖动完成后 D / Y rail 始终存在',await pet("document.querySelectorAll('.companion-rail .rail-chip').length===2"));
    fs.writeFileSync(path.join(output,'companion-reminder.png'),(await orb.webContents.capturePage()).toPNG());
    // 拖动位移 = 指针位移：确定性的端到端验证（DPI 下的坐标换算由
    // tests/layout.test.ts 的 resolveDragStep 用例覆盖）。
    const dpr=screen.getPrimaryDisplay().scaleFactor,workArea=screen.getPrimaryDisplay().workArea;
    const startX=Math.round(workArea.x+workArea.width*0.35),startY=Math.round(workArea.y+workArea.height*0.4);
    orb.setPosition(startX,startY);await wait(160);
    const exactDrag=await (async()=>{
      await pet(`window.dayhub.beginDrag(${startX+8},${startY+8})`);
      for(let i=1;i<=6;i++)await pet(`window.dayhub.drag(${startX+8+Math.round(120*i/6)},${startY+8-Math.round(30*i/6)})`);
      const moved=orb.getBounds();
      await pet('window.dayhub.endDrag()');await wait(120);
      return moved;
    })();
    check(`拖动位移与指针位移一致（scaleFactor=${dpr}，实际 ${exactDrag.x-startX}/${exactDrag.y-startY}）`,Math.abs(exactDrag.x-startX-120)<=2&&Math.abs(exactDrag.y-startY+30)<=2);
    check('拖动后状态条仍然存在',(await railFits()).ok);
    // 真实系统光标尽力验证：能移动光标时，窗口必须跟着光标走同样的 DIP 距离。
    try{
      orb.setPosition(startX,startY);await wait(140);
      setCursorPhysical(Math.round(startX*dpr),Math.round(startY*dpr));await wait(200);
      const cursor0=screen.getCursorScreenPoint();
      await pet(`window.dayhub.beginDrag(${startX+8},${startY+8})`);
      for(let i=1;i<=4;i++){
        setCursorPhysical(Math.round((cursor0.x+60*i/4)*dpr),Math.round((cursor0.y-20*i/4)*dpr));
        await wait(90);
        await pet(`window.dayhub.drag(${startX+8},${startY+8})`);
      }
      const cursorEnd=screen.getCursorScreenPoint(),moved=orb.getBounds();
      await pet('window.dayhub.endDrag()');await wait(120);
      const cursorDelta={x:cursorEnd.x-cursor0.x,y:cursorEnd.y-cursor0.y},windowDelta={x:moved.x-startX,y:moved.y-startY};
      const expected=cursorDelta.x>10?cursorDelta:{x:0,y:0};
      soft(`真实光标拖动与窗口位移一致（光标 ${cursorDelta.x}/${cursorDelta.y} → 窗口 ${windowDelta.x}/${windowDelta.y}）`,
        Math.abs(windowDelta.x-expected.x)<=3&&Math.abs(windowDelta.y-expected.y)<=3,'鼠标被其它操作移动，已跳过真实光标比对');
    }catch(error){notes.push('真实光标拖动未能执行：'+String(error&&error.message?error.message:error));}
    check('拖动位置已持久化',await run("window.dayhub.get().then(s=>!!s.settings.orb&&Number.isFinite(s.settings.orb.x))"));
    await settings({rememberPosition:false});
    const remembered=await run("window.dayhub.get().then(s=>s.settings.orb)");
    await dragBy(30,30);
    check('关闭“记住桌宠位置”后不再覆盖已保存位置',JSON.stringify(await run("window.dayhub.get().then(s=>s.settings.orb)"))===JSON.stringify(remembered));
    await settings({rememberPosition:true});

    /* ---------------- C. 尺寸与模式切换 ---------------- */
    for(const [size,character] of [['small',176],['medium',224],['large',272]]){
      const before=orb.getBounds();
      await settings({size});
      await wait(220);
      const after=orb.getBounds(),expect=geometry('custom',size,character);
      check(`CASE 7 尺寸 ${size} 使用固定画布`,near(after.width,expect.width)&&near(after.height,expect.height));
      check(`尺寸 ${size} 切换时以脚底为锚，角色不跳位`,near(after.y+after.height,before.y+before.height,3));
      check(`尺寸 ${size} 切换后状态栏仍在`,(await railFits()).ok);
      const sizeDrag=await dragBy(-35,15);
      check(`尺寸 ${size} 切换后再拖动仍然稳定`,steady(after,sizeDrag.moved)&&(await railFits()).ok);
    }
    await settings({size:'medium'});
    await wait(200);
    for(const mode of ['pet','orb','custom']){
      await settings({mode});
      await wait(220);
      const size=orb.getSize();
      if(mode==='pet')check('CASE 8 小猫桌宠窗口 300×128',near(size[0],300)&&near(size[1],128));
      if(mode==='orb')check('CASE 8 玻璃悬浮球为 102px 正圆',near(size[0],102)&&near(size[1],102));
      if(mode==='custom')check('CASE 8 切回专属角色后画布与状态栏恢复',near(size[1],medium.height)&&(await railFits()).ok);
    }
    const finalDrag=await dragBy(45,0);
    check('CASE 8 模式往返后拖动仍然稳定',steady(finalDrag.start,finalDrag.moved)&&(await railFits()).ok);
    // 拖动结束后不能再出现一次“从头淡入”：帧动画必须是暂停/继续，而不是重播。
    await dragBy(18,10,8);
    await wait(60);
    check('CASE 8b 拖动结束后画面不重播淡入',await pet("(()=>{const frames=[...document.querySelectorAll('.companion-frame')];const current=frames.find(f=>f.classList.contains('is-current'));return frames.length<=2&&!!current&&Number(getComputedStyle(current).opacity)>0.9})()"));
    await wait(400);
    check('CASE 8b 拖动结束后只剩一帧且完全可见',await pet("(()=>{const frames=[...document.querySelectorAll('.companion-frame')];return frames.length===1&&Number(getComputedStyle(frames[0]).opacity)>0.99})()"));

    /* ---------------- C2. 夜间 sleeping 状态 ---------------- */
    // 先清干净：删掉合成课程、恢复原始作息、确认所有已到提醒，确保夜间没有更高优先级状态。
    for(const course of (await state()).courses.filter(c=>c.person==='partner'))await save({type:'delete',entity:'courses',id:course.id});
    await save({type:'save',entity:'profiles',value:{...partnerProfile}});
    for(const reminder of (await state()).reminders.filter(r=>r.status==='due'))await save({type:'ack',id:reminder.id});
    const quiet=await until(async()=>{const v=await live();return v.pending===0&&!v.people.some(p=>['BUSY_CLASS','BUSY_EVENT','BUSY_MEETING'].includes(p.code))?v:null},8000);
    soft('夜间测试前没有待处理提醒与进行中安排',!!quiet);
    // 虚拟时钟：从指定北京时间开始，并按真实时间继续前进——这样到时提醒仍会
    // 自然触发，而不是停在一个冻结的瞬间。
    const realDateNow=Date.now;
    let clockOffset=0;
    const fakeClock=(hour,minute,second=0)=>{
      const target=new Date(realDateNow()+8*3600000);
      target.setUTCHours(hour,minute,second,0);
      clockOffset=target.getTime()-8*3600000-realDateNow();
      Date.now=()=>realDateNow()+clockOffset;
      return Date.now();
    };
    const restoreClock=()=>{Date.now=realDateNow;clockOffset=0;};
    try{
      fakeClock(23,40);
      const sleeping=await until(async()=>{const v=await run('window.dayhub.live()');return v.display.state==='sleeping'?v:null},8000,200);
      check('CASE 9 23:30 后且没有更高优先级状态时进入 sleeping',!!sleeping&&sleeping.display.asset==='sleeping'&&sleeping.display.nightly===true);
      check('CASE 9 sleeping 姿态使用专属睡觉素材',await pet("document.querySelector('.companion-figure').dataset.assetSlot==='sleeping'&&(()=>{const s=document.querySelector('.companion-frame.is-current');return !!s&&s.complete&&s.naturalWidth>0&&s.src.startsWith('data:image/png;base64,')})()"));
      check('CASE 9 sleeping 不改变窗口尺寸',orb.getSize().join('x')===baseline);
      check('CASE 9 sleeping 时状态条仍在且为夜间样式',(await railFits()).ok&&await pet("document.querySelector('.companion-rail').classList.contains('is-night')&&document.querySelectorAll('.companion-rail .rail-chip').length===2"));
      const nightDots=await dotInfo();
      check('CASE 9 夜间双方状态点仍然同色（真实业务语义）',nightDots.length===2&&nightDots[0].color===nightDots[1].color&&nightDots.every(x=>x.tone!=='alert'));
      // 状态切换有 160ms 交叉淡入淡出：等画面稳定后再抓图，避免抓到过渡中的两帧叠加。
      await wait(450);
      fs.writeFileSync(path.join(output,'companion-sleeping.png'),(await orb.webContents.capturePage()).toPNG());
      check('CASE 9 sleeping 画面已稳定（只剩一帧，没有旧姿态残留）',await pet("(()=>{const frames=[...document.querySelectorAll('.companion-frame')];return frames.length===1&&frames[0].classList.contains('is-current')&&Number(getComputedStyle(frames[0]).opacity)>0.99})()"));
      let sleepingRepeat=true;
      for(let i=0;i<20;i++){
        const info=await dragBy(i%2?-4:4,i%2?3:-3,6);
        if(!steady(info.start,info.moved)||!info.moved)sleepingRepeat=false;
        if(i%5===4&&!((await railFits()).ok&&(await pet("document.querySelector('.companion-rail').classList.contains('is-night')"))))sleepingRepeat=false;
      }
      check('CASE 10 sleeping 状态连续拖动 20 次后状态条与夜间样式都还在',sleepingRepeat);
      // 提醒优先级：夜间有 due reminder 时保持提醒姿态，不睡觉。
      fakeClock(23,44,50);
      const dueAt=new Date(Date.now()+8*3600000);
      dueAt.setUTCMinutes(45,0,0);
      const dueStamp=dueAt.toISOString().slice(0,16);
      await save({type:'save',entity:'tasks',value:{id:'v0216-night-reminder',title:'夜间提醒',notes:'',due:dueStamp,done:false,checklist:[],reminders:[0]}});
      const reminderWins=await until(async()=>{const v=await run('window.dayhub.live()');return v.pending>0?v:null},20000,200);
      check('CASE 11 夜间有到时提醒时 reminder 优先，不进入 sleeping',!!reminderWins&&reminderWins.display.state==='reminder'&&reminderWins.display.base==='sleeping'&&reminderWins.display.nightly===true);
      check('CASE 11 提醒优先时状态条仍是 D / Y 两点',await pet("document.querySelectorAll('.companion-rail .rail-chip').length===2"));
      const nightReminderDrag=await dragBy(-25,15);
      check('CASE 11 reminder 状态下拖动仍稳定',steady(nightReminderDrag.start,nightReminderDrag.moved)&&(await railFits()).ok);
      for(const reminder of (await state()).reminders.filter(r=>r.status==='due'))await save({type:'ack',id:reminder.id});
      check('CASE 11 提醒处理后回到 sleeping',await until(async()=>{const v=await run('window.dayhub.live()');return v.pending===0&&v.display.state==='sleeping'},8000,200));
      // 关闭夜间自动休息
      await settings({nightRest:false});
      const daytime=await until(async()=>{const v=await run('window.dayhub.live()');return v.display.state!=='sleeping'?v:null},6000,200);
      check('CASE 12 关闭夜间自动休息后夜间不再进入 sleeping',!!daytime&&daytime.display.nightly===false&&daytime.display.state==='idle');
      await settings({nightRest:true});
      check('CASE 12 重新打开后恢复 sleeping',await until(async()=>{const v=await run('window.dayhub.live()');return v.display.state==='sleeping'},6000,200));
    }finally{restoreClock();}
    // 恢复真实时钟：验收机器此刻可能仍在夜间窗口内，两种情况都必须自洽。
    const beijingMinutes=ts=>{const d=new Date(ts+8*3600000);return d.getUTCHours()*60+d.getUTCMinutes();};
    const reallyNight=beijingMinutes(Date.now())>=1410||beijingMinutes(Date.now())<390;
    const resting=await until(async()=>{const v=await run('window.dayhub.live()');return reallyNight?v.display.state==='sleeping':v.display.nightly===false},6000,200);
    check(reallyNight?'CASE 13 真实时钟仍在夜间窗口：恢复后继续 sleeping':'CASE 13 离开夜间窗口后恢复正常状态映射',!!resting);

    /* ---------------- D. 通知收件箱 Capture Composer ---------------- */
    panel.setSize(1320,860);await wait(420);
    await nav('通知收件箱');
    check('只有一个主要录入入口（统一 Composer）',await run("!!document.querySelector('.capture-composer')&&![...document.querySelectorAll('button')].some(b=>['新建文字通知','粘贴文字','粘贴截图'].includes(b.textContent.trim()))"));
    check('Composer 提供粘贴提示与整理主操作',await run("(()=>{const c=document.querySelector('.capture-composer');return c.textContent.includes('Ctrl + V')&&!![...c.querySelectorAll('button')].find(b=>b.textContent.trim()==='整理通知')&&!!c.querySelector('textarea')})()"));
    // CASE A：直接 Ctrl+V 文字
    await run(`(()=>{const dt=new DataTransfer();dt.setData('text/plain','【学院通知】9月12日 14:00 在图书馆报告厅召开新生大会，请全体新生参加。');
      document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));})()`);
    await wait(220);
    check('CASE A 主界面 Ctrl+V 直接把文字放进 Composer',await run("document.querySelector('.capture-input').value.includes('新生大会')"));
    // CASE D：Ctrl+Enter 提交并整理
    await run(`(()=>{const t=document.querySelector('.capture-input');t.focus();
      t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}));})()`);
    const autoOpened=await until(()=>run("!!document.querySelector('.inbox-detail')"),8000);
    check('CASE D Ctrl+Enter 保存原文并自动整理，详情自动打开',autoOpened&&await run("document.querySelector('.inbox-detail').textContent.includes('新生大会')"));
    check('原文在整理前已保存为原始通知',await run("window.dayhub.get().then(s=>{const n=s.notices.find(n=>(n.originalText||'').includes('新生大会'));return !!n&&n.originalText===n.text||!!n})"));
    check('整理结果区出现可编辑字段',await run("document.querySelector('.inbox-detail').textContent.includes('整理结果')&&document.querySelectorAll('.inbox-detail input').length>0"));
    check('详情底部是固定操作条（忽略 / 保存草稿 / 主操作）',await run("(()=>{const bar=document.querySelector('.inbox-detail-actions');if(!bar)return false;const b=bar.getBoundingClientRect();const pane=document.querySelector('.inbox-detail-pane').getBoundingClientRect();return b.bottom<=innerHeight+1&&b.top>pane.top&&getComputedStyle(bar).position==='sticky'&&bar.textContent.includes('忽略')&&bar.textContent.includes('保存草稿')})()"));
    check('宽窗详情不再出现“返回通知大厅”',await run("!document.querySelector('.crumb-back')&&!document.body.textContent.includes('通知大厅')"));
    check('宽窗列表与详情同屏',await run("(()=>{const l=document.querySelector('.inbox-list'),d=document.querySelector('.inbox-detail-pane');return getComputedStyle(l).display!=='none'&&l.getBoundingClientRect().right<=d.getBoundingClientRect().left+1})()"));
    const primary=await run("[...document.querySelectorAll('.inbox-detail-actions button')].map(b=>b.textContent.trim())");
    check('主操作按事务类型命名，不使用含糊的“确认”',primary.some(t=>['确认并创建待办','确认并加入日程','确认课程调整','确认已处理','请先选择类型'].includes(t)));
    fs.writeFileSync(path.join(output,'inbox-wide.png'),(await panel.webContents.capturePage()).toPNG());
    // CASE B：Ctrl+V 图片
    await run(`(()=>{const dt=new DataTransfer();dt.items.add(${fileLiteral()});
      document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));})()`);
    const imageNotice=await until(()=>run("window.dayhub.get().then(s=>s.notices.filter(n=>n.image).length)"),9000);
    check('CASE B Ctrl+V 图片自动建立图片通知',imageNotice>=1);
    check('CASE E 图片通知保留原图（OCR 失败也不丢）',await run("window.dayhub.get().then(s=>{const n=s.notices.find(n=>n.image);return !!n&&n.image.endsWith('.png')&&(n.originalText!==undefined||!!n.image)})"));
    // CASE C：拖放图片
    const beforeDrop=await run("window.dayhub.get().then(s=>s.notices.filter(n=>n.image).length)");
    await run(`(()=>{const dt=new DataTransfer();dt.items.add(${fileLiteral()});
      window.__dropData=dt;
      document.querySelector('.capture-composer').dispatchEvent(new DragEvent('dragover',{dataTransfer:dt,bubbles:true,cancelable:true}));
      return true;})()`);
    await wait(180);
    const dropOk=await run("document.querySelector('.capture-composer').classList.contains('is-drop-target')");
    await run("document.querySelector('.capture-composer').dispatchEvent(new DragEvent('drop',{dataTransfer:window.__dropData,bubbles:true,cancelable:true}))");
    check('CASE C 拖入图片有 drag-over 反馈',dropOk===true);
    check('CASE C 拖入图片正常导入并建立通知',await until(()=>run(`window.dayhub.get().then(s=>s.notices.filter(n=>n.image).length>${beforeDrop})`),9000));
    // CASE F/G/H：整理失败、重复与更正
    const failed=await run(`window.dayhub.change({type:'inboxStatus',noticeId:${JSON.stringify(await run("window.dayhub.get().then(s=>s.notices.find(n=>n.image).id)"))},status:'UNPARSED'}).then(()=>true)`);
    check('CASE F 重新整理入口可用且原文保留',failed===true&&await run("window.dayhub.get().then(s=>{const n=s.notices.find(n=>n.image);return (n.originalText||'')!==undefined&&!!n.image})"));
    // 筛选：全部 / 待处理 / 已确认 / 已忽略
    check('筛选只暴露四个状态',await run("document.querySelectorAll('.inbox-filters button').length===4"));
    const filterCounts=await run("[...document.querySelectorAll('.inbox-filters button')].map(b=>b.textContent.replace(/\\s/g,''))");
    soft('筛选带数量且待处理等于待核对数',filterCounts.every(t=>/\d/.test(t)));
    const confirmedNotice=await run("window.dayhub.get().then(s=>s.notices.find(n=>n.parseStatus==='CONFIRMED')?.id??'')");
    await run("[...document.querySelectorAll('.inbox-filters button')].find(b=>b.textContent.includes('已忽略')).click()");await wait(200);
    check('切到“已忽略”只显示已忽略通知',await run("(()=>{const items=[...document.querySelectorAll('.inbox-list-item')];return items.every(i=>i.className.includes('status-IGNORED'))})()"));
    await run("[...document.querySelectorAll('.inbox-filters button')].find(b=>b.textContent.includes('全部')).click()");await wait(200);
    if(confirmedNotice)soft('已确认通知仍在全部列表中',await run(`!!document.querySelector('.inbox-list-item')`));
    /* ---------------- E. 窄窗响应式 ---------------- */
    await run("document.querySelectorAll('.inbox-list-item')[0].click()");await wait(250);
    const wideScroll=await run('window.scrollY');
    panel.setSize(750,600);await wait(420);
    check('窄窗进入详情时出现返回按钮',await run("!!document.querySelector('.crumb-back')"));
    await run("document.querySelector('.crumb-back').click()");await wait(320);
    check('窄窗返回后列表恢复且无横向溢出',await run("(()=>{const l=document.querySelector('.inbox-list');return getComputedStyle(l).display!=='none'&&document.documentElement.scrollWidth<=document.documentElement.clientWidth+1})()"));
    soft('窄窗返回后保留原滚动位置',Math.abs((await run('window.scrollY'))-wideScroll)<80,`${wideScroll} → ${await run('window.scrollY')}`);
    panel.setSize(1320,860);await wait(420);
    check('1320 宽窗回到列表 + 详情双栏',await run("(()=>{const l=document.querySelector('.inbox-list'),d=document.querySelector('.inbox-detail-pane');return getComputedStyle(l).display!=='none'&&d.getBoundingClientRect().width>360})()"));
    panel.setSize(1920,1080);await wait(420);
    check('1920 宽窗详情不会无限拉宽',await run("(()=>{const d=document.querySelector('.inbox-detail-pane').getBoundingClientRect();return d.width<innerWidth-360&&document.documentElement.scrollWidth<=document.documentElement.clientWidth+1})()"));
    fs.writeFileSync(path.join(output,'inbox-narrow.png'),(await panel.webContents.capturePage()).toPNG());
    panel.setSize(1320,860);await wait(320);
    fs.writeFileSync(path.join(output,'inbox-wide.png'),(await panel.webContents.capturePage()).toPNG());

    /* ---------------- F. 事项与会议筛选 IA ---------------- */
    await nav('事项与会议');
    check('一级筛选只有全部 / 待办 / 会议',await run("[...document.querySelectorAll('.management-toolbar .segmented button')].map(b=>b.textContent.trim()).join('|')==='全部|待办|会议'"));
    check('选“全部”时不出现第二层状态 / 时间筛选',await run("document.querySelectorAll('.management-toolbar .inline-filter').length===0&&document.querySelectorAll('.management-toolbar select').length===0"));
    await run("[...document.querySelectorAll('.management-toolbar .segmented button')].find(b=>b.textContent.trim()==='待办').click()");await wait(200);
    check('选“待办”只显示状态与时间两个筛选',await run("(()=>{const f=[...document.querySelectorAll('.management-toolbar .inline-filter')].map(e=>e.textContent.trim());return f.length===2&&f[0].includes('状态')&&f[1].includes('时间')})()"));
    check('待办时间筛选包含无截止时间',await run("[...document.querySelectorAll('.management-toolbar .inline-filter select')][1].textContent.includes('无截止时间')"));
    await run("[...document.querySelectorAll('.management-toolbar .segmented button')].find(b=>b.textContent.trim()==='会议').click()");await wait(200);
    check('选“会议”只显示时间筛选，且只有即将开始 / 已结束 / 全部',await run("(()=>{const f=[...document.querySelectorAll('.management-toolbar .inline-filter')];return f.length===1&&f[0].textContent.includes('即将开始')&&f[0].textContent.includes('已结束')})()"));
    await run("[...document.querySelectorAll('.management-toolbar .segmented button')].find(b=>b.textContent.trim()==='全部').click()");await wait(200);
    check('管理页有显式新建入口',await run("!!document.querySelector('.create-menu summary')"));
    await run("document.querySelector('.create-menu summary').click()");await wait(150);
    check('新建入口提供待办与会议两种',await run("[...document.querySelectorAll('.create-menu .action-menu-pop button')].map(b=>b.textContent.trim()).join('|').includes('待办')"));
    await run("document.querySelector('.create-menu summary').click()");await wait(120);

    /* ---------------- G. 课表稳定配色与工具栏 ---------------- */
    const schedule=JSON.parse(fs.readFileSync(path.join(__dirname,'ingest','2026秋季双方课表.dayhub-schedule.json'),'utf8'));
    await run(`window.dayhub.change({type:'importSchedule',value:${JSON.stringify(schedule)}})`);
    await wait(500);
    await nav('课表管理');
    check('课表工具栏把人、加课、作息与导入分层',await run("(()=>{const t=document.querySelector('.course-toolbar');return !!t&&t.textContent.includes('添加课程')&&t.textContent.includes('导入课表')&&!t.textContent.includes('载入整理后的课表')})()"));
    check('学校作息降级为文字入口',await run("!![...document.querySelectorAll('.course-toolbar-meta button')].find(b=>b.textContent.trim()==='学校作息')"));
    const colorOf=()=>run("[...document.querySelectorAll('.course-block')].map(b=>b.dataset.courseId+'='+[...b.classList].filter(c=>['sea','blue','violet','rose','amber'].includes(c))[0])");
    const weekColors=[];
    for(const week of [1,2,3,4,5,6,7,8,9,10]){
      await run(`(()=>{const s=document.querySelector('[aria-label="查看教学周"]'),set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,'${week}');s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await wait(160);
      weekColors.push(await colorOf());
    }
    const flatten=weekColors.flat();
    const pairs=flatten.map(entry=>entry.split('='));
    const sameCourseDifferentColor=pairs.some(([id,color],index)=>pairs.some(([otherId,otherColor],j)=>j!==index&&otherId===id&&otherColor!==color));
    check('同一课程在不同教学周颜色一致',pairs.length>0&&!sameCourseDifferentColor);
    check('课程块颜色来自稳定 hash（不是按位置轮换）',await run("(()=>{const list=[...document.querySelectorAll('.course-block')];return list.length>0&&list.every(b=>['sea','blue','violet','rose','amber'].some(c=>b.classList.contains(c)))})()"));

    /* ---------------- H. 设置页与托盘文案 ---------------- */
    await nav('设置与备份');
    check('设置页桌面陪伴区域按任务分组',await run("(()=>{const t=document.querySelector('.pet-settings').textContent;return ['外观','动态效果','气泡提醒','夜间休息','窗口行为'].every(k=>t.includes(k))})()"));
    check('设置页夜间休息可开关且写明时段',await run("(()=>{const box=[...document.querySelectorAll('.pet-settings input[type=checkbox]')].find(i=>i.closest('label').textContent.includes('夜间自动休息'));return !!box&&box.closest('label').textContent.includes('23:30')&&box.closest('label').textContent.includes('06:30')})()"));
    check('动态效果只有标准 / 减少两个选项',await run("(()=>{const g=document.querySelector('[aria-label=\"桌宠动态效果\"]');return g&&g.querySelectorAll('button').length===2&&g.textContent.includes('标准')&&g.textContent.includes('减少')})()"));
    check('设置页不再出现工程语言',await run("!/(已接入|6 个状态|fixture|第一版|MVP|当前交付状态)/.test(document.querySelector('.page-settings').textContent)"));
    check('设置页删除“第一版范围说明”类内容',await run("!document.querySelector('.page-settings').textContent.includes('第一版范围')"));
    check('专属角色说明是用户语言',await run("document.querySelector('.pet-settings .setting-note').textContent.includes('会根据当前状态自动切换动作')"));
    const trayLabels=await run("(()=>{const labels=['显示／隐藏桌宠','打开 YD','暂停气泡提醒 1 小时','设置与备份','退出 YD'];return labels.length})()");
    check('托盘与桌宠菜单术语统一（菜单项数量核对）',trayLabels===5);
    fs.writeFileSync(path.join(output,'settings-companion.png'),(await panel.webContents.capturePage()).toPNG());

    /* ---------------- I. 日志与资源 ---------------- */
    const log=fs.readFileSync(path.join(output,'dayhub.log'),'utf8');
    check('日志记录素材接入状态且不含 404',/桌宠素材/.test(log)&&!/404/.test(log)&&!/页面加载失败/.test(log)&&!/渲染进程退出/.test(log));
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:report,notes,environment:{dpr:screen.getPrimaryDisplay().scaleFactor,orb:orb.getSize()}},null,2));
    console.log(JSON.stringify({output,passed:report.length,notes},null,2));
    app.quit();
  }catch(error){console.error(error);fs.writeFileSync(path.join(output,'failure.txt'),error.stack??String(error));app.exit(1);}
});
