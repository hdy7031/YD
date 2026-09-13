/**
 * @deprecated
 *
 * Historical verification for the pre-v0.3 desk-pet asset contract (0.2.15
 * era): seven companion states with `upcoming → relaxed`.
 *
 * Phase 4A re-cut that contract into ten `CompanionDisplayState` values owned by
 * the Avatar Pack registry, so this script is intentionally excluded from
 * current release acceptance.
 *
 * Do not modify current production behavior merely to make this verifier pass.
 *
 * Superseded by:
 * - verify-v0220.cjs (current ten-pose companion contract and schedule states)
 * - verify-v030-avatar-pack.cjs (Pack manifest / ten-state registry contract)
 * - verify-v030-avatar-person.cjs (Person ↔ AvatarSelection ↔ PetInstance)
 * - verify-v030-avatar-runtime.cjs (hot switch, cache, fallback, last-known-good)
 *
 * Kept only for historical regression archaeology.
 */
// Isolated 0.2.15 acceptance run: dedicated companion + inbox workspace.
// Never touches the real app data (DAYHUB_TEST_DATA points at test-data/).
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const output=path.join(__dirname,'test-data','v0215-runtime-'+Date.now());
fs.mkdirSync(output,{recursive:true});
process.env.DAYHUB_TEST_DATA=output;
const assetDir=path.join(__dirname,'dist','assets','companion','custom');
const manifest=JSON.parse(fs.readFileSync(path.join(assetDir,'manifest.json'),'utf8'));
require('./dist/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const report=[],notes=[];
function check(name,value){assert.ok(value,name);report.push(name);}
function soft(name,value,detail){if(value)report.push(name);else notes.push(name+(detail?'：'+detail:''));}
// Windows rounds transparent frameless windows to the physical pixel grid
// (150% DPI here), so window sizes are compared with a 2px tolerance while the
// "size must not change between states" checks stay exact.
const near=(actual,expected,tolerance=2)=>Math.abs(actual-expected)<=tolerance;
async function until(fn,timeout=6000,step=120){const end=Date.now()+timeout;for(;;){const value=await fn();if(value)return value;if(Date.now()>end)return value;await wait(step);}}
const beijing=ms=>new Date(ms+8*3600000);
const clockOf=ms=>beijing(ms).toISOString().slice(11,16);
const dateOf=ms=>beijing(ms).toISOString().slice(0,10);
const stampOf=ms=>beijing(ms).toISOString().slice(0,16);
function mondayOf(date){const day=new Date(date+'T00:00:00Z').getUTCDay();const shift=(day+6)%7;const base=new Date(date+'T00:00:00Z');base.setUTCDate(base.getUTCDate()-shift);return base.toISOString().slice(0,10);}
app.whenReady().then(async()=>{
  try{
    let panel,orb,bubble,mini,tip;
    for(let i=0;i<120;i++){const ws=BrowserWindow.getAllWindows();panel=ws.find(w=>!w.webContents.getURL().includes('#')&&w.webContents.getURL().includes('index.html'));orb=ws.find(w=>w.webContents.getURL().endsWith('#orb'));bubble=ws.find(w=>w.webContents.getURL().endsWith('#bubble'));mini=ws.find(w=>w.webContents.getURL().endsWith('#mini'));tip=ws.find(w=>w.webContents.getURL().endsWith('#tip'));if(panel&&orb&&bubble&&mini&&tip&&!panel.webContents.isLoading()&&!orb.webContents.isLoading())break;await wait(100);}
    check('五个真实窗口完成加载',panel&&orb&&bubble&&mini&&tip);
    const run=code=>panel.webContents.executeJavaScript(code);
    const pet=code=>orb.webContents.executeJavaScript(code);
    const live=()=>run('window.dayhub.live()');
    const state=()=>run('window.dayhub.get()');
    const save=cmd=>run(`window.dayhub.change(${JSON.stringify(cmd)})`);
    const petSettings=value=>save({type:'settings',pet:value});
    await wait(600);

    // ---- A. asset manifest, packaged path, default handover -----------------
    const bundle=await run('window.dayhub.companionAssets().then(a=>({available:a.available,reason:a.reason,count:Object.keys(a.images).length,missing:a.missing,aspect:a.aspect,source:a.source}))');
    // 0.2.16 起新增 sleeping，共七个状态。
    check('专属角色桌宠素材可读取且七个状态齐全',bundle.available&&bundle.count===7&&bundle.missing.length===0);
    check('素材来源指向打包目录 assets/companion/custom',/assets[\\/]companion[\\/]custom$/.test(bundle.source));
    check('清单画布比例与素材一致',Math.abs(bundle.aspect-manifest.canvas.width/manifest.canvas.height)<1e-9);
    const character=224,paddingX=8,paddingY=6,gap=4,rail=32;
    const expectedWidth=Math.max(150,Math.round(character*bundle.aspect)+paddingX*2);
    const expectedHeight=paddingY*2+character+gap+rail;
    check('默认显示模式为专属角色桌宠',(await live()).preferences.mode==='custom');
    console.log('geometry',{expected:[expectedWidth,expectedHeight],actual:orb.getSize()});
    check('专属角色桌宠窗口按画布比例定尺寸',near(orb.getSize()[0],expectedWidth)&&near(orb.getSize()[1],expectedHeight));
    check('专属角色桌宠用图片渲染且保持透明窗口',await pet("(()=>{const i=document.querySelector('.companion-frame.is-current');return !!i&&i.src.startsWith('data:image/png;base64,')&&document.querySelectorAll('.companion-figure').length===1})()"));
    check('D / Y 轻量状态条只有两个状态点',await pet("document.querySelectorAll('.companion-rail .rail-chip').length===2&&[...document.querySelectorAll('.companion-rail .rail-chip b')].map(e=>e.textContent).join('')==='DY'"));
    fs.writeFileSync(path.join(output,'companion-idle.png'),(await orb.webContents.capturePage()).toPNG());

    // ---- B. business states drive the display state and stable geometry -----
    const now=Date.now(),today=dateOf(now),weekday=((new Date(today+'T00:00:00Z').getUTCDay()+6)%7)+1;
    const base=await state();
    const partnerProfile=base.profiles.find(p=>p.id==='partner');
    const periodsOff=partnerProfile.periods.map(p=>({...p}));
    const baseline=orb.getSize().join('x');
    // PNG data URLs share a long prefix, so fingerprint length plus a middle slice.
    const frameOf=()=>pet("(()=>{const s=document.querySelector('.companion-frame.is-current').src;return s.length+':'+s.slice(2000,2060)})()");
    const setPeriods=(startMs,endMs)=>save({type:'save',entity:'profiles',value:{...partnerProfile,startDate:mondayOf(today),weeks:20,periods:[{start:clockOf(startMs),end:clockOf(endMs)}]}});

    // A real reminder needs a future due time (the state engine only schedules
    // reminders that are still ahead), so arm the next minute boundary now and
    // keep working while it approaches.
    const dueMs=Math.ceil((now+5000)/60000)*60000;
    await save({type:'save',entity:'tasks',value:{id:'companion-reminder',title:'验收提醒待办',notes:'',due:stampOf(dueMs),done:false,checklist:[],reminders:[0]}});
    await pet("(()=>{window.__nudgeSeen=false;window.__nudgeWatcher=new MutationObserver(()=>{if(document.querySelector('.companion-figure.is-nudging'))window.__nudgeSeen=true;});window.__nudgeWatcher.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});return true})()");
    soft('到时提醒已排入日程',await run("window.dayhub.get().then(s=>s.reminders.some(r=>r.target==='tasks:companion-reminder'&&r.status==='scheduled'))"));

    // 这套姿态切换依赖“当前时刻前后还有节次空间”。北京时间接近午夜时，节次会
    // 跨过 00:00 而无法表示成同一天的起止时间，因此只在白天运行这一段，
    // 夜晚由 verify-v0216 的投影断言覆盖同样的六个显示态。
    // 0.2.16 起 23:30–06:30 是夜间休息窗口：这套真实课表姿态切换只在白天运行，
    // 夜间由 verify-v0216 的投影断言与 sleeping 专项覆盖。
    const beijingHour=Number(clockOf(now).slice(0,2)),beijingMinute=Number(clockOf(now).slice(3));
    const minutesToMidnight=(24-beijingHour)*60-beijingMinute;
    const inNightWindow=beijingHour*60+beijingMinute>=1410||beijingHour*60+beijingMinute<390;
    const dayTime=minutesToMidnight>240&&!inNightWindow;
    if(dayTime)await setPeriods(now-20*60000,now+20*60000);else notes.push('夜间窗口或临近午夜：真实课表姿态切换改由 verify-v0216 的投影断言与 sleeping 专项覆盖');
    await save({type:'save',entity:'courses',value:{id:'companion-class',person:'partner',title:'验收课',weekday,first:1,last:1,weeks:[1],place:'教室',notes:'',checklist:[],reminders:[],activity:'teaching'}});
    const busy=await until(async()=>{const v=await live();return v.display.state==='busy_class'?v:null},5000);
    const busyFrame=busy?await frameOf():'';
    if(dayTime||busy){
      check('上课中映射到 busy_class 姿态',!!busy&&busy.display.asset==='busy_class');
      check('角色本身不推断状态，全部来自主进程投影',!!busy&&typeof busy.display.base==='string'&&busy.display.holdingReminder===false);
    }

    if(dayTime)await setPeriods(now+18*60000,now+48*60000);
    const upcoming=await until(async()=>{const v=await live();return v.display.state==='upcoming'?v:null},5000);
    if(dayTime)check('即将开始映射到 upcoming 姿态（课间素材）',!!upcoming&&upcoming.display.asset==='relaxed');

    if(dayTime)await setPeriods(now+3*3600000,now+4*3600000);
    const free=await until(async()=>{const v=await live();return v.display.state==='idle'?v:null},5000);
    if(dayTime)check('空闲映射到 idle 姿态',!!free&&free.display.asset==='idle');

    await save({type:'save',entity:'events',value:{id:'companion-meeting',title:'验收会议',start:stampOf(now-10*60000),end:stampOf(now+40*60000),notes:'',place:'',reminders:[],checklist:[]}});
    const work=await until(async()=>{const v=await live();return v.display.state==='busy_work'?v:null},5000);
    if(!work)console.log('debug work',JSON.stringify({display:(await live()).display,people:(await live()).people.map(p=>({person:p.person,code:p.code,current:p.current.map(o=>o.title)}))}));
    check('忙碌事务映射到 busy_work 姿态',!!work&&work.display.asset==='busy_work');
    check('状态切换不改变窗口尺寸',orb.getSize().join('x')===baseline);
    if(dayTime)check('状态切换真的换帧',!!busyFrame&&await frameOf()!==busyFrame);
    check('脚底锚点固定：角色容器贴底对齐',await pet("(()=>{const f=document.querySelector('.companion-figure').getBoundingClientRect(),h=document.querySelector('.pet-handle').getBoundingClientRect();return Math.abs(f.bottom-h.bottom)<1.5})()"));

    console.log('等待真实到时提醒',Math.max(0,Math.ceil((dueMs-Date.now())/1000))+'秒');
    const due=await until(async()=>{const v=await live();return v.pending>0?v:null},Math.max(20000,dueMs-Date.now()+15000),300);
    check('到时提醒进入待处理集合',!!due&&due.pending===1);
    check('待处理提醒映射到 reminder 姿态并只触发一次轻提示',!!due&&due.display.state==='reminder'&&due.display.holdingReminder&&due.display.nudgeId>=1);
    const nudged=await until(()=>pet("window.__nudgeSeen===true"),3000);
    check('轻提示动画真实播放且只触发一次',!!nudged&&await pet("window.__nudgeWatcher.disconnect()||true")===true);
    await wait(2000);
    check('轻提示自动结束，不持续抖动',await pet("!document.querySelector('.companion-figure.is-nudging')"));
    check('提醒不自动完成待办、不自动确认提醒',await run("window.dayhub.get().then(s=>!s.tasks.find(t=>t.id==='companion-reminder').done&&s.reminders.some(r=>r.target==='tasks:companion-reminder'&&r.status==='due'))"));
    check('待处理期间窗口尺寸不变',orb.getSize().join('x')===baseline);
    fs.writeFileSync(path.join(output,'companion-reminder.png'),(await orb.webContents.capturePage()).toPNG());

    // 气泡与迷你状态面板不互相抢占
    const bubbleShown=await until(()=>run('window.dayhub.live()').then(v=>!!v.bubble),8000);
    soft('到时提醒同时弹出轻气泡',!!bubbleShown);
    await run("window.dayhub.window('mini')");await wait(200);
    check('桌宠可展开迷你状态面板',mini.isVisible());
    check('迷你面板同时显示双方状态与提醒数',await mini.webContents.executeJavaScript("document.querySelectorAll('.person-status').length===2&&/1 条提醒/.test(document.body.textContent)"));
    if(bubble.isVisible())await bubble.webContents.executeJavaScript("window.dayhub.bubble('close')");
    await wait(120);
    check('关闭气泡后桌宠姿态与状态条仍然一致',await pet("!!document.querySelector('.companion-frame.is-current')&&document.querySelectorAll('.companion-rail .rail-chip').length===2"));
    await run("window.dayhub.window('mini')");await wait(120);
    check('迷你面板可收起',!mini.isVisible());
    await save({type:'ack',id:(await run("window.dayhub.get().then(s=>s.reminders.find(r=>r.target==='tasks:companion-reminder'&&r.status==='due').id)"))});
    const cleared=await until(async()=>{const v=await live();return v.pending===0?v:null},6000);
    check('确认提醒后待处理计数归零且姿态回到业务状态',!!cleared&&cleared.display.state==='busy_work'&&cleared.display.nudgeId===0);

    // ---- C. three display modes stay interchangeable ------------------------
    await petSettings({mode:'pet'});
    await until(()=>run("window.dayhub.live().then(v=>v.preferences.mode==='pet')"),3000);await wait(200);
    check('切到小猫桌宠后使用内置形象',await pet("!!document.querySelector('.pet-art')&&!document.querySelector('.companion-frame')&&document.querySelectorAll('.status-pills .person-status').length===2"));
    check('小猫桌宠窗口回到 300x128',near(orb.getSize()[0],300)&&near(orb.getSize()[1],128));
    await petSettings({mode:'orb'});
    await until(()=>run("window.dayhub.live().then(v=>v.preferences.mode==='orb')"),3000);await wait(200);
    check('切到玻璃悬浮球后为 102px 正圆',near(orb.getSize()[0],102)&&near(orb.getSize()[1],102)&&await pet("document.querySelectorAll('.presence-zone').length===2"));
    await petSettings({mode:'custom'});
    await until(()=>run("window.dayhub.live().then(v=>v.preferences.mode==='custom')"),3000);await wait(250);
    check('切回专属角色桌宠后尺寸与状态条恢复',near(orb.getSize()[0],expectedWidth)&&near(orb.getSize()[1],expectedHeight)&&await pet("!!document.querySelector('.companion-frame.is-current')&&document.querySelectorAll('.companion-rail .rail-chip').length===2"));
    check('三种模式切换后业务状态未漂移',await run("window.dayhub.live().then(v=>v.display.state==='busy_work'&&v.pending===0)"));
    await petSettings({reduceMotion:true});
    await wait(250);
    check('降低动态效果后桌宠保持静止',await pet("!document.querySelector('.companion-figure.is-breathing')&&!document.querySelector('.companion-figure.is-nudging')"));
    await petSettings({reduceMotion:false,miniPanel:false});
    await wait(200);
    await run("window.dayhub.window('mini')");await wait(200);
    check('关闭迷你面板后单击桌宠打开主窗口',!mini.isVisible()&&panel.isVisible());
    await petSettings({miniPanel:true});
    await run("window.dayhub.window('settings')");await wait(400);
    const settingsText=await run("(document.querySelector('.pet-settings')?.textContent)??''");
    console.log('settings text',settingsText.slice(0,240));
    // 0.2.16：桌面陪伴分为外观 / 动态效果 / 气泡提醒 / 窗口行为四组。
    check('设置页把桌宠相关项整理成桌面陪伴区域',await run("(()=>{const s=document.querySelector('.pet-settings');if(!s)return false;return ['专属角色桌宠','小猫桌宠','玻璃悬浮球'].every(t=>s.textContent.includes(t))&&['外观','动态效果','气泡提醒','窗口行为','气泡停留时长','记住桌宠位置','驻留托盘','登录 Windows 后启动 YD'].every(t=>s.textContent.includes(t))})()"));
    fs.writeFileSync(path.join(output,'settings-companion.png'),(await panel.webContents.capturePage()).toPNG());

    // ---- D. inbox master / detail workspace ---------------------------------
    await run("document.querySelectorAll('.inbox-hub').length");await wait(50);
    for(let i=1;i<=6;i++)await save({type:'inbound',id:'v0215-notice-'+i,payload:{text:`验收通知 ${i}：明天下午 ${i+1} 点在教学楼三楼开家长会，请提前十分钟到。`,sourceType:'MANUAL'}});
    await wait(300);
    await run("[...document.querySelectorAll('.nav-item')].find(b=>b.textContent==='通知收件箱').click()");
    await until(()=>run("!!document.querySelector('.inbox-hub')"),4000);
    check('通知大厅列表与详情在同一工作区',await run("!!document.querySelector('.inbox-list')&&!!document.querySelector('.inbox-detail-pane')"));

    panel.setSize(1320,860);await wait(300);
    check('宽窗下未选中时保留列表并给出详情占位',await run("(()=>{const h=document.querySelector('.inbox-hub'),l=document.querySelector('.inbox-list'),p=document.querySelector('.inbox-placeholder');return getComputedStyle(l).display!=='none'&&!!p&&h.getBoundingClientRect().width>900})()"));
    await run("document.querySelectorAll('.inbox-list-item')[0].click()");
    await until(()=>run("!!document.querySelector('.inbox-detail .inbox-original')"),4000);
    check('宽窗下选中通知时列表仍在、右侧打开详情',await run("(()=>{const l=document.querySelector('.inbox-list'),d=document.querySelector('.inbox-detail-pane'),r=l.getBoundingClientRect(),q=d.getBoundingClientRect();return getComputedStyle(l).display!=='none'&&r.right<=q.left+1&&document.querySelectorAll('.inbox-list-item.selected').length===1})()"));
    // 0.2.16：宽窗列表还在旁边，详情头部改为标题 + 来源时间 + 状态，不再有返回与面包屑。
    check('宽窗详情头部不再出现页面级返回与面包屑',await run("!document.querySelector('.crumb-back')&&!document.querySelector('.crumb-trail')"));
    check('详情头部固定显示标题、来源时间与状态',await run("(()=>{const h=document.querySelector('.inbox-detail-head');return !!h.querySelector('.inbox-head-title')&&/\\d{2}:\\d{2}/.test(h.textContent)&&!!h.querySelector('.inbox-status-chip')})()"));
    check('详情按原始证据与整理结果分层',await run("!!document.querySelector('.detail-evidence')&&!!document.querySelector('.detail-section')&&document.querySelectorAll('.detail-section').length>=3"));
    const firstTitle=await run("document.querySelector('.inbox-head-title').textContent");
    const firstBody=await run("document.querySelector('.inbox-original').textContent.slice(0,40)");
    await run("[...document.querySelectorAll('.inbox-list-item')].find(b=>!b.classList.contains('selected')).click()");
    await wait(300);
    const secondTitle=await run("document.querySelector('.inbox-head-title').textContent");
    const secondBody=await run("document.querySelector('.inbox-original').textContent.slice(0,40)");
    console.log('notice titles',{firstTitle,secondTitle});
    check('切换通知时详情内容平滑更新',!!secondBody&&secondBody!==firstBody&&await run("document.querySelectorAll('.inbox-list-item.selected').length===1"));
    const wideShot=path.join(output,'inbox-wide.png');fs.writeFileSync(wideShot,(await panel.webContents.capturePage()).toPNG());

    panel.setSize(920,780);await wait(320);
    check('窄窗下进入详情后隐藏列表，避免整页跳转',await run("(()=>{const l=document.querySelector('.inbox-list'),d=document.querySelector('.inbox-detail-pane');return getComputedStyle(l).display==='none'&&getComputedStyle(d).display!=='none'&&!!document.querySelector('.crumb-back')})()"));
    fs.writeFileSync(path.join(output,'inbox-narrow.png'),(await panel.webContents.capturePage()).toPNG());
    await run("[...document.querySelectorAll('.nav-item')].find(b=>b.textContent==='通知收件箱').click()");await wait(150);
    // 0.2.16：筛选是四个状态按钮（全部 / 待处理 / 已确认 / 已忽略），不再是下拉框。
    await run("[...document.querySelectorAll('.inbox-filters button')].find(b=>b.textContent.includes('待处理')).click()");
    await wait(200);
    await run("window.scrollTo(0,140)");await wait(120);
    const before=await run("window.scrollY");
    await run("document.querySelectorAll('.inbox-list-item')[0].click()");
    await until(()=>run("!!document.querySelector('.inbox-detail')"),4000);
    await run("document.querySelector('.crumb-back').click()");await wait(400);
    const after=await run("window.scrollY");
    check('返回大厅恢复原来的筛选状态',await run("[...document.querySelectorAll('.inbox-filters button')].find(b=>b.textContent.includes('待处理')).classList.contains('active')"));
    check('返回大厅恢复原来的滚动位置',Math.abs(after-before)<60);
    check('返回大厅后列表重新可见且无残留选中',await run("(()=>{const l=document.querySelector('.inbox-list');return getComputedStyle(l).display!=='none'&&document.querySelectorAll('.inbox-list-item.selected').length===0})()"));

    // ---- E. logs: no 404, no renderer crash --------------------------------
    await wait(400);
    const log=fs.readFileSync(path.join(output,'dayhub.log'),'utf8');
    check('启动日志确认专属角色素材接入',/桌宠素材 专属角色/.test(log));
    check('无资源 404、无页面加载失败、无渲染进程退出',!/404/.test(log)&&!/页面加载失败|预加载失败|渲染进程退出/.test(log));
    check('控制台无渲染错误',!/renderer .*Error|renderer .*error/i.test(log));

    const result={output,passed:report,notes};
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
    app.quit();
  }catch(e){console.error(e);fs.writeFileSync(path.join(output,'failure.txt'),e.stack||String(e));app.exit(1);}
});
