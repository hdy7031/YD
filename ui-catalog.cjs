// UI catalog harness: walks every reachable page / overlay / companion surface of
// YD (Your Day) in an isolated data directory and writes screenshots plus a
// machine readable catalog (no judgement, only what is on screen and how to get there).
//
// Run: npx electron ui-catalog.cjs   （放在项目根目录，app.getAppPath() 才指向本项目）
const {app,BrowserWindow,dialog,desktopCapturer,screen,Tray}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');

const root=__dirname;
const outRoot=path.join(root,'deliverables','ui-catalog-0.2.16');
const shotsDir=path.join(outRoot,'shots');
const rawDir=path.join(outRoot,'shots-transparent');
const appData=path.join(root,'test-data','ui-catalog-'+Date.now());
for(const dir of [outRoot,shotsDir,rawDir,appData])fs.mkdirSync(dir,{recursive:true});
process.env.DAYHUB_TEST_DATA=appData;

const scheduleFile=path.join(root,'tests','fixtures','synthetic-schedule.json');
const sourceImage=path.join(root,'test-data','v0213-ocr.png');
let openQueue=[];
dialog.showOpenDialog=async()=>openQueue.shift()??{canceled:true,filePaths:[]};
dialog.showSaveDialog=async()=>({canceled:false,filePath:path.join(appData,'ui-catalog-export.dayhub')});
dialog.showMessageBox=async()=>({response:1});
dialog.showErrorBox=()=>{};
// 捕获托盘菜单时需要拿到 Tray 实例，原生菜单本身无法用窗口截图获取。
let trayInstance=null;
let trayMenu=null;
const originalSetContextMenu=Tray.prototype.setContextMenu;
Tray.prototype.setContextMenu=function(menu){trayInstance=this;trayMenu=menu;return originalSetContextMenu.call(this,menu);};
require(path.join(root,'dist','main.cjs'));

const wait=ms=>new Promise(r=>setTimeout(r,ms));
const shots=[];
let panel,orb,bubble,mini,tip;
const dpr=()=>screen.getPrimaryDisplay().scaleFactor;
const stamp=ms=>new Date(ms+8*3600000).toISOString().slice(0,16);
const dateOf=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);
const clockOf=ms=>new Date(ms+8*3600000).toISOString().slice(11,16);
const addDays=(date,n)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const target=name=>({panel,orb,bubble,mini,tip}[name]);
const run=code=>panel.webContents.executeJavaScript(code);
const pet=code=>orb.webContents.executeJavaScript(code);
const change=cmd=>run(`window.dayhub.change(${JSON.stringify(cmd)}).then(()=>{})`);

async function shot(id,meta){
  const surface=meta.surface??'panel';
  const win=target(surface);
  const image=await win.webContents.capturePage();
  const transparent=surface!=='panel';
  fs.writeFileSync(path.join(transparent?rawDir:shotsDir,id+'.png'),image.toPNG());
  shots.push({id,...meta,file:`shots/${id}.png`,raw:transparent?`shots-transparent/${id}.png`:undefined,size:win.getSize(),dpr:dpr()});
}
const setSize=async(width,height)=>{panel.setSize(width,height);await wait(340);};
async function clickText(selector,text){
  await run(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!el)throw new Error('not found: '+${JSON.stringify(text)});el.click();})()`);
  await wait(280);
}
async function clickContains(selector,text){
  const ok=await run(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.includes(${JSON.stringify(text)}));if(!el)return false;el.click();return true})()`);
  await wait(280);return ok;
}
async function click(selector,index=0){
  await run(`(()=>{const list=document.querySelectorAll(${JSON.stringify(selector)});if(!list[${index}])throw new Error('not found: '+${JSON.stringify(selector)});list[${index}].click();})()`);
  await wait(280);
}
async function hover(selector,index=0,surface='panel'){
  const win=target(surface);
  const box=await (surface==='panel'?run:pet)(`(()=>{const el=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(!el)return null;const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  if(!box)return false;
  win.webContents.sendInputEvent({type:'mouseMove',x:box.x,y:box.y});
  await wait(340);return true;
}
const scrollTo=async y=>{await run(`window.scrollTo(0,${y})`);await wait(300);};
const scrollBottom=async()=>{await run(`window.scrollTo(0,document.body.scrollHeight)`);await wait(320);};
// 通知详情很长：上面是原始通知与字段，下面是确认区，因此再补一张下半部分的图。
async function scrollDetail(selector='.detail-confirm'){
  const found=await run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;el.scrollIntoView({block:'center'});return true})()`);
  await wait(380);return found;
}
// 侧栏「未处理提醒」在有提醒时会带上数量后缀，因此按包含匹配点击。
const nav=async label=>clickContains('.nav-item',label);
async function closeModal(){await run(`(()=>{const b=[...document.querySelectorAll('[role=dialog] button')].find(x=>['关闭','取消'].includes(x.textContent.trim()));b?.click()})()`);await wait(300);}
async function seatSchedule(capture=false){
  openQueue.push({canceled:false,filePaths:[scheduleFile]});
  await clickText('button','导入课表');
  await wait(600);
  if(capture)await shot('09b-course-import-confirm',{title:'课表导入 · 读取文件后的核对确认',surface:'panel',entry:'课表管理 → 导入课表 → 选择 .dayhub-schedule.json 文件',precondition:'选择一个整理好的课表文件',elements:['课表文件已读取','学期名称','课程总数与替换说明','双方学期摘要：起始周、周数、课程数、作息节数','取消 / 确认载入课表']});
  await clickText('button','确认载入课表');
  await wait(800);
}
async function selectNotice(text){
  const ok=await run(`(()=>{const el=[...document.querySelectorAll('.inbox-list-item')].find(e=>e.textContent.includes(${JSON.stringify(text)}));if(!el)return false;el.click();el.scrollIntoView({block:'center'});window.scrollBy(0,-150);return true})()`);
  await wait(360);
  const selected=await run(`(()=>{const el=document.querySelector('.inbox-list-item.selected');return el?el.textContent.includes(${JSON.stringify(text)}):false})()`);
  if(!selected)console.log('[catalog] 选中项与预期不一致：'+text);
  return ok;
}
const pathToFileUrl=file=>'file:///'+file.replace(/\\/g,'/').replace(/^\/+/,'');
async function pressButton(label){await clickContains('button',label);}
async function screenCapture(label,rect){
  const display=screen.getPrimaryDisplay();
  const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(display.size.width*dpr()),height:Math.round(display.size.height*dpr())}});
  const source=sources.find(s=>String(s.display_id)===String(display.id))??sources[0];
  let image=source.thumbnail;
  if(rect){
    const scale=dpr();
    const x=Math.max(0,Math.round((rect.x-display.bounds.x)*scale));
    const y=Math.max(0,Math.round((rect.y-display.bounds.y)*scale));
    const width=Math.min(image.getSize().width-x,Math.round(rect.width*scale));
    const height=Math.min(image.getSize().height-y,Math.round(rect.height*scale));
    if(width>40&&height>40)image=image.crop({x,y,width,height});
  }
  const file=path.join(shotsDir,label+'.png');
  fs.writeFileSync(file,image.toPNG());
  return file;
}
function moveCursor(x,y){
  execFileSync('powershell.exe',['-NoProfile','-Command',`Add-Type -AssemblyName System.Windows.Forms;Add-Type -AssemblyName System.Drawing;[System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point(${Math.round(x)},${Math.round(y)})`],{windowsHide:true});
}
// 原生菜单是独立窗口，无法用 capturePage 截取；这里用系统光标定位 + 整屏截图裁剪。
function sendEscape(){try{execFileSync('powershell.exe',['-NoProfile','-Command','Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait("{ESC}")'],{windowsHide:true});}catch{}}

const draft=(over={})=>({schemaVersion:1,type:'UNKNOWN',title:'',date:'',startTime:'',endTime:'',location:'',note:'',reminderMinutes:null,confidence:0.8,warnings:[],missingFields:[],courseId:'',operation:'CANCEL',newDate:'',first:null,last:null,correction:false,...over});

app.whenReady().then(async()=>{
  try{
    for(let i=0;i<120;i++){const ws=BrowserWindow.getAllWindows();panel=ws.find(w=>!w.webContents.getURL().includes('#')&&w.webContents.getURL().includes('index.html'));orb=ws.find(w=>w.webContents.getURL().endsWith('#orb'));bubble=ws.find(w=>w.webContents.getURL().endsWith('#bubble'));mini=ws.find(w=>w.webContents.getURL().endsWith('#mini'));tip=ws.find(w=>w.webContents.getURL().endsWith('#tip'));if(panel&&orb&&bubble&&mini&&tip&&!panel.webContents.isLoading()&&!orb.webContents.isLoading())break;await wait(100);}
    if(!panel||!orb)throw new Error('窗口未就绪');
    await wait(800);
    const now=Date.now(),today=dateOf(now),tomorrow=dateOf(now+86400000),nextWeek=dateOf(now+7*86400000);
    const weekdayToday=((new Date(today+'T00:00:00Z').getUTCDay()+6)%7)+1;

    // ============ 一、首次使用（空数据） ============
    await setSize(1320,880);
    await shot('01-today-first-run',{title:'我的安排 · 空数据（首次使用）',surface:'panel',entry:'启动应用后默认停留在「我的安排」',precondition:'全新数据库：没有课表、事项与通知',elements:['顶部标题栏：日期与北京时间','首次使用提示卡：先核对双方的学校作息','双方状态行：状态点为离线、文案为尚未录入课表','接下来卡：今天没有后续安排','当日日程卡 + 空状态','侧栏七个入口']});
    await nav('Ta的课表');
    await shot('02-partner-first-run',{title:'Ta 的课表 · 空数据',surface:'panel',entry:'侧栏 → Ta的课表',precondition:'没有导入任何课表',elements:['当前状态卡：尚未录入课表','日期选择','空状态：导入或录入 Ta 的课表后显示每天安排','前往课表管理按钮']});
    await nav('课表管理');
    await shot('03-courses-first-run',{title:'课表管理 · 空数据',surface:'panel',entry:'侧栏 → 课表管理',precondition:'没有课程记录',elements:['工具栏：课表所属人 + 添加课程；学校作息与导入课表降级为一行','学期与更新时间摘要行','空周课表网格（7 天 × 节次）','单次调课与停课面板 + 空状态']});
    await nav('事项与会议');
    await shot('04-tasks-first-run',{title:'事项与会议 · 空数据',surface:'panel',entry:'侧栏 → 事项与会议',precondition:'没有待办与会议',elements:['搜索框 + 一级分段筛选（全部 / 待办 / 会议）+ 新建入口','统计行','待办事项空状态（含新建待办）','会议与活动空状态（含新建会议）']});
    await nav('通知收件箱');
    await shot('05-inbox-first-run',{title:'通知收件箱 · 空数据与统一录入区',surface:'panel',entry:'侧栏 → 通知收件箱',precondition:'没有通知',elements:['统一 Capture Composer：粘贴通知、截图，或拖入图片…','Ctrl + V 粘贴提示 / 截图 / + 更多 / 整理通知','四个状态筛选（全部 / 待处理 / 已确认 / 已忽略）带数量','列表区：暂无通知','右侧说明占位：选择一条通知查看详情']});
    await nav('未处理提醒');
    await shot('06-reminders-first-run',{title:'未处理提醒 · 空数据',surface:'panel',entry:'侧栏 → 未处理提醒',precondition:'没有到时间的提醒',elements:['说明文字：只计入已到提醒时间、尚未处理的提醒','空状态：没有未处理提醒']});
    await nav('设置与备份');
    // 设置页按默认值截图：夜间自动休息是默认开启的。
    await change({type:'settings',pet:{nightRest:true}});await wait(360);
    await shot('07-settings-top',{title:'设置与备份 · 顶部（桌面陪伴）',surface:'panel',entry:'侧栏 → 设置与备份',precondition:'默认设置',elements:['桌面陪伴：显示模式 / 大小 / 气泡提醒 / 动态效果 / 窗口与启动','显示模式当前为专属角色桌宠','素材状态说明：专属角色桌宠已接入 · 6 个状态']});
    await scrollBottom();
    await shot('08-settings-bottom',{title:'设置与备份 · 底部（运行与备份）',surface:'panel',entry:'设置与备份 → 向下滚动',precondition:'默认设置',elements:['学校作息入口','运行与提醒：发送测试通知','本地备份：导出完整备份 / 从备份恢复','第一版范围说明']});
    await scrollTo(0);
    await clickContains('button','的作息');
    await shot('09-editor-profile',{title:'编辑器 · 学校作息与学期',surface:'panel',entry:'设置与备份 → 学校作息 → 设置…的作息',precondition:'默认作息',elements:['显示名称 / 状态短代号','第一教学周的周一 / 教学周数 / 暂定','各节起止时间（每行一节）','核对并保存']});
    await closeModal();

    // ============ 二、灌入真实数据 ============
    await nav('课表管理');
    await seatSchedule(true);
    const state=await run('window.dayhub.get()');
    const partnerCourses=state.courses.filter(c=>c.person==='partner');
    const partner=state.profiles.find(p=>p.id==='partner');
    const exceptionCourse=partnerCourses[0],cancelCourse=partnerCourses[1];
    const weekOf=course=>course.weeks.includes(1)?1:Math.min(...course.weeks);
    const dateOfCourse=(course,week)=>addDays(partner.startDate,(week-1)*7+course.weekday-1);
    const exceptionDate=dateOfCourse(exceptionCourse,weekOf(exceptionCourse));
    const cancelDate=dateOfCourse(cancelCourse,weekOf(cancelCourse));

    await change({type:'save',entity:'tasks',value:{id:'cat-task-plain',title:'准备下周家长会材料',notes:'打印名单、准备发言提纲。',due:'',done:false,checklist:[],reminders:[]}});
    await change({type:'save',entity:'tasks',value:{id:'cat-task-checklist',title:'整理本单元测验卷',notes:'',due:`${tomorrow}T17:00`,done:false,checklist:[{id:'c1',text:'收齐两个班试卷',done:true},{id:'c2',text:'登记分数',done:false},{id:'c3',text:'讲评错题',done:false}],reminders:[120]}});
    await change({type:'save',entity:'tasks',value:{id:'cat-task-overdue',title:'提交开题报告',notes:'导师邮箱提交。',due:`${dateOf(now-2*86400000)}T09:00`,done:false,checklist:[],reminders:[]}});
    await change({type:'save',entity:'tasks',value:{id:'cat-task-done',title:'预定教研会议室',notes:'',due:'',done:true,checklist:[],reminders:[]}});
    await change({type:'save',entity:'events',value:{id:'cat-event-current',title:'教研组例会',start:stamp(now-30*60000),end:stamp(now+40*60000),place:'办公楼 302',notes:'带上本周听课记录。',reminders:[],checklist:[{id:'e1',text:'打印听课记录',done:false}]}});
    await change({type:'save',entity:'events',value:{id:'cat-event-clash',title:'临时年级组会',start:stamp(now-10*60000),end:stamp(now+30*60000),place:'年级办公室',notes:'与教研组例会时间重叠。',reminders:[],checklist:[]}});
    await change({type:'save',entity:'events',value:{id:'cat-event-future',title:'家长开放日',start:`${tomorrow}T15:00`,end:`${tomorrow}T17:00`,place:'信息楼报告厅',notes:'需要提前布置座位。',reminders:[60],checklist:[{id:'f1',text:'确认场地',done:true},{id:'f2',text:'准备签到表',done:false}]}});
    // 与「新生大会（待核对）」草稿完全一致的已有事项，用于触发相似事项提示。
    await change({type:'save',entity:'events',value:{id:'cat-event-duplicate',title:'新生大会（待核对）',start:`${tomorrow}T15:00`,end:`${tomorrow}T17:00`,place:'信息楼报告厅',notes:'',reminders:[],checklist:[]}});
    await change({type:'save',entity:'exceptions',value:{id:'cat-ex-move',courseId:exceptionCourse.id,date:exceptionDate,cancelled:false,start:`${exceptionDate}T10:00`,end:`${exceptionDate}T10:45`,place:'实验楼 501'}});
    await change({type:'save',entity:'exceptions',value:{id:'cat-ex-cancel',courseId:cancelCourse.id,date:cancelDate,cancelled:true}});

    const imageName=crypto.createHash('sha256').update(fs.readFileSync(sourceImage)).digest('hex')+'.png';
    fs.copyFileSync(sourceImage,path.join(appData,'attachments',imageName));
    const notice=(id,over)=>change({type:'save',entity:'notices',value:{id,title:'',text:'',state:'inbox',updatedAt:Date.now(),createdAt:Date.now(),originalText:'',sourceType:'MANUAL',...over}});
    await notice('cat-notice-event',{title:'年级组通知',text:'明天下午3点在信息楼报告厅进行新生大会，请提前10分钟到场。',originalText:'明天下午3点在信息楼报告厅进行新生大会，请提前10分钟到场。',parseStatus:'NEEDS_REVIEW',detectedType:'EVENT',confidence:.82,parsedData:draft({type:'EVENT',title:'新生大会（待核对）',date:tomorrow,startTime:'15:00',endTime:'17:00',location:'信息楼报告厅',note:'提前 10 分钟到场',reminderMinutes:30,confidence:.82,warnings:['结束时间来自正文推断，请核对']})});
    await notice('cat-notice-todo',{title:'教研通知',text:'本周五前把开题报告交给导师。',originalText:'本周五前把开题报告交给导师。',parseStatus:'NEEDS_REVIEW',detectedType:'TODO',confidence:.9,parsedData:draft({type:'TODO',title:'提交开题报告（待核对）',date:tomorrow,startTime:'09:00',reminderMinutes:1440,confidence:.9})});
    await notice('cat-notice-course',{title:'调课通知',text:`${exceptionDate} 的课与另一节对调，地点改为实验楼 501。`,originalText:`${exceptionDate} 的课与另一节对调，地点改为实验楼 501。`,parseStatus:'NEEDS_REVIEW',detectedType:'COURSE_CHANGE',confidence:.68,parsedData:draft({type:'COURSE_CHANGE',title:'课程调整（待核对）',date:exceptionDate,courseId:exceptionCourse.id,operation:'RESCHEDULE',newDate:exceptionDate,startTime:'10:00',endTime:'10:45',location:'实验楼 501',confidence:.68,warnings:['关联课程与节次需要人工核对']})});
    await notice('cat-notice-confirmed',{title:'校历通知',text:'国庆假期调整已发布，请查阅办公群文件。',originalText:'国庆假期调整已发布，请查阅办公群文件。',parseStatus:'CONFIRMED',detectedType:'GENERAL_NOTICE',confidence:.95,processedAt:Date.now(),targetEntityType:'notice',parsedData:draft({type:'GENERAL_NOTICE',title:'国庆假期调整（已处理）',confidence:.95})});
    await notice('cat-notice-ignored',{title:'无关消息',text:'转发一条与教学无关的活动广告。',originalText:'转发一条与教学无关的活动广告。',parseStatus:'IGNORED',detectedType:'GENERAL_NOTICE',confidence:.4});
    await notice('cat-notice-unparsed',{title:'原始通知',text:'下周三上午的公开课需要准备教具。',originalText:'下周三上午的公开课需要准备教具。',parseStatus:'UNPARSED'});
    await notice('cat-notice-image',{title:'图片通知',text:'',originalText:'',image:imageName,sourceType:'IMAGE_IMPORT',ocrText:'明天下午3点在信息楼报告厅进行新生大会，请提前10分钟到场。',parseStatus:'NEEDS_REVIEW',detectedType:'EVENT',confidence:.7,parsedData:draft({type:'EVENT',title:'新生大会（图片通知）',date:tomorrow,startTime:'15:00',endTime:'17:00',location:'信息楼报告厅',confidence:.7,warnings:['图片文字为本地识别结果，请核对']})});
    await notice('cat-notice-failed',{title:'待整理通知',text:'……（内容格式异常，自动整理未完成）',originalText:'……（内容格式异常，自动整理未完成）',parseStatus:'FAILED',parseError:'自动整理未完成：正文里没有可识别的日期与时间。'});
    await notice('cat-notice-correction',{title:'修改通知',text:'家长开放日的时间调整为明天下午3点到5点。',originalText:'家长开放日的时间调整为明天下午3点到5点。',parseStatus:'NEEDS_REVIEW',detectedType:'EVENT',confidence:.75,parsedData:draft({type:'EVENT',title:'家长开放日',date:tomorrow,startTime:'15:00',endTime:'17:00',location:'信息楼报告厅',correction:true,confidence:.75,warnings:['这可能是在修改已有事项，请核对']})});
    // 必须在“写入任务”的这一刻计算目标时刻：脚本前段耗时可能已经越过整分钟边界，
    // 用启动时间算出来的时间点会变成过去时刻，状态引擎就会直接跳过这条提醒。
    const reminderFire=Math.ceil((Date.now()+20000)/60000)*60000;
    await change({type:'save',entity:'tasks',value:{id:'cat-task-reminder',title:'交家长会报名表',notes:'',due:stamp(reminderFire+24*3600000),done:false,checklist:[],reminders:[1440]}});
    await change({type:'settings',setup:true});
    await wait(400);

    // ============ 三、我的安排 ============
    await nav('我的安排');
    await shot('10-today-top',{title:'我的安排 · 有数据（顶部）',surface:'panel',entry:'侧栏 → 我的安排',precondition:'已导入双方课表，存在进行中的会议、冲突会议、逾期待办与待核对通知',elements:['双方状态行：D / Y 状态、当前项或下一项','需要处理摘要：通知待核对 / 提醒已到时间 / 待办已逾期','接下来卡：下一个日程与剩余时间','正在进行中提示']});
    await scrollTo(560);
    await shot('11-today-schedule',{title:'我的安排 · 当日日程',surface:'panel',entry:'我的安排 → 向下滚动到当日日程',precondition:'当天有会议与课程',elements:['当日日程卡与日期选择','条目：时间、进行中标记、时间冲突标记','条目右下角 ⋯ 更多操作']});
    await click('.action-menu summary',0);
    await shot('12-today-card-menu',{title:'我的安排 · 日程卡 ⋯ 菜单展开',surface:'panel',entry:'我的安排 → 当日日程 → 点击「⋯」',precondition:'日程条目存在',elements:['更多操作弹层：编辑 / 本次调课·停课 / 删除会议 / 查看来源']});
    await click('.action-menu summary',0);
    await scrollTo(0);
    await clickText('button','新建会议');
    await shot('13-editor-event',{title:'编辑器 · 会议 / 活动',surface:'panel',entry:'我的安排 → 新建会议',precondition:'—',elements:['标题 / 开始时间 / 结束时间 / 地点','备注、准备清单、提前提醒分钟数','核对并保存']});
    await closeModal();
    await clickText('button','新建待办');
    await shot('14-editor-task',{title:'编辑器 · 待办',surface:'panel',entry:'我的安排 → 新建待办',precondition:'—',elements:['标题 / 截止时间（可不填）/ 状态','备注与准备清单','提前提醒分钟数']});
    await closeModal();
    const firstDate=await run("(()=>{const el=document.querySelector('input[type=date]');return el?el.value:''})()");
    await run(`(()=>{const el=[...document.querySelectorAll('input[type=date]')].pop();const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(el,'${nextWeek}');el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait(340);
    await shot('15-today-other-day',{title:'我的安排 · 切换到其它日期',surface:'panel',entry:'我的安排 → 当日日程 → 日期选择 → 选择其它日期',precondition:'该日期有课程或无安排',elements:['日期选择控件','该日期的日程列表或空状态']});
    await run(`(()=>{const el=[...document.querySelectorAll('input[type=date]')].pop();const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(el,'${firstDate}');el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait(340);

    // ============ 四、Ta 的课表 ============
    await nav('Ta的课表');
    await shot('16-partner-today',{title:'Ta 的课表 · 当前状态与当日安排',surface:'panel',entry:'侧栏 → Ta的课表',precondition:'已导入 Ta 的课表，存在调课与停课记录',elements:['当前状态卡：状态、当前或下一节、课表更新时间','日期选择','日程行：进行中 / 已结束 / 已调课 / 已停课标记','每行操作：编辑 / 调课·停课']});
    await clickContains('button','调课');
    await shot('17-editor-exception',{title:'编辑器 · 仅修改这一次课程',surface:'panel',entry:'Ta 的课表 → 某课程行 → 调课 / 停课',precondition:'该课程存在',elements:['原课程：标题 / 日期 / 时间 / 节次 / 地点 / 课表','本次处理：调课 或 停课','新的开始时间 / 结束时间 / 本次地点','仅影响原日期这一次课程说明']});
    await closeModal();

    // ============ 五、课表管理 ============
    await nav('课表管理');
    await shot('18-courses-week',{title:'课表管理 · 周课表（我的）',surface:'panel',entry:'侧栏 → 课表管理',precondition:'已导入课表',elements:['工具栏：课表所属人 + 添加课程；学校作息与导入课表在同一行','学期起点 / 周数 / 每日节数 / 课表更新时间','教学周切换与周课表网格','课程块（同一课程在各周颜色一致）']});
    await run(`(()=>{const s=document.querySelector('[aria-label=\"课表所属人\"]');const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,'partner');s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait(420);
    await shot('19-courses-partner-week',{title:'课表管理 · 周课表（Ta 的课表）',surface:'panel',entry:'课表管理 → 课表所属人 → Ta的课表',precondition:'已导入 Ta 的课表',elements:['周课表网格与课程块','课程块上的调课或停课标记']});
    await scrollTo(780);
    await shot('20-courses-exceptions',{title:'课表管理 · 单次调课与停课列表',surface:'panel',entry:'课表管理 → 向下滚动到「单次调课与停课」',precondition:'存在一条调课与一条停课记录',elements:['记录数量','调课卡：原日期 / 原时间 / 地点 / 调整后 / 最近修改','停课卡：停课标记','编辑 / 恢复原课']});
    await clickText('button','编辑');
    await shot('21-editor-exception-edit',{title:'编辑器 · 编辑已有单次调课',surface:'panel',entry:'单次调课与停课 → 编辑',precondition:'已存在调课记录',elements:['原课程信息','本次处理与调整后的时间地点','核对并保存']});
    await closeModal();
    await scrollTo(0);
    await clickText('button','添加课程');
    await shot('22-editor-course',{title:'编辑器 · 课程',surface:'panel',entry:'课表管理 → 添加课程',precondition:'—',elements:['标题 / 所属课表 / 活动类型（授课·教研）/ 星期 / 开始节次 / 结束节次','教学周与快捷选择（每周 / 单周 / 双周）','地点 / 备注 / 准备清单 / 提前提醒分钟数','删除课程 / 复制课程 / 核对并保存']});
    await closeModal();

    // ============ 六、事项与会议 ============
    await nav('事项与会议');
    await shot('23-tasks-all',{title:'事项与会议 · 全部',surface:'panel',entry:'侧栏 → 事项与会议',precondition:'存在待办与会议',elements:['搜索框 + 一级分段筛选（全部 / 待办 / 会议）+ 新建入口','统计行：待处理与待进行会议数','待办事项列与会议与活动列','逾期、已完成标记','卡片操作：⋯ 菜单（编辑 / 删除 / 单独提醒）']});
    for(const [index,file,name] of [[1,'todo','待办'],[2,'events','会议与活动']]){
      await run(`document.querySelectorAll('.management-toolbar .segmented button')[${index}]?.click()`);
      await wait(320);
      await shot(`24-tasks-filter-${file}`,{title:`事项与会议 · 分段筛选「${name}」`,surface:'panel',entry:`事项与会议 → 分段筛选 → ${name}`,precondition:'存在对应类型的记录',elements:['当前筛选高亮','仅显示所选类型的卡片列表']});
    }
    await run(`document.querySelectorAll('.management-toolbar .segmented button')[0]?.click()`);await wait(300);
    // 0.2.16 的两级筛选：先选类型，再在该类型内选状态与时间。
    await run(`document.querySelectorAll('.management-toolbar .segmented button')[1]?.click()`);await wait(320);
    await shot('25-tasks-filter-todo-ia',{title:'事项与会议 · 待办类型的两级筛选',surface:'panel',entry:'事项与会议 → 待办',precondition:'存在待办',elements:['状态：待处理 / 已完成','时间：全部 / 今天 / 未来七天 / 已逾期 / 无截止时间','按所选条件过滤后的待办列表']});
    await run(`(()=>{const s=document.querySelectorAll('.management-toolbar .inline-filter select')[1];const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,'overdue');s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait(320);
    await shot('25b-tasks-filter-overdue',{title:'事项与会议 · 待办时间「已逾期」',surface:'panel',entry:'事项与会议 → 待办 → 时间 → 已逾期',precondition:'存在已逾期待办',elements:['时间筛选＝已逾期','筛选后的待办列表']});
    await run(`(()=>{const s=document.querySelectorAll('.management-toolbar .inline-filter select')[1];const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,'all');s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait(200);
    await run(`document.querySelectorAll('.management-toolbar .segmented button')[2]?.click()`);await wait(320);
    await shot('25c-tasks-filter-meeting-ia',{title:'事项与会议 · 会议类型的时间筛选',surface:'panel',entry:'事项与会议 → 会议',precondition:'存在会议或活动',elements:['时间：全部 / 即将开始 / 已结束','按时间过滤后的会议列表']});
    await run(`document.querySelectorAll('.management-toolbar .segmented button')[0]?.click()`);await wait(300);
    await click('.action-menu summary',0);
    await shot('26-tasks-card-menu',{title:'事项与会议 · 卡片 ⋯ 菜单',surface:'panel',entry:'事项与会议 → 卡片右下角「⋯」',precondition:'卡片存在',elements:['编辑','查看来源（来自通知时）','删除']});
    await click('.action-menu summary',0);

    // ============ 七、通知收件箱 ============
    await nav('通知收件箱');
    await selectNotice('新生大会（待核对）');
    await shot('27-inbox-wide-detail',{title:'通知收件箱 · 列表 + 详情（宽窗）',surface:'panel',entry:'侧栏 → 通知收件箱 → 点击列表中的通知',precondition:'存在多种状态的通知',elements:['左侧列表：标题、摘要、来源 · 时间、状态、类型色条、选中高亮','右侧详情头部：标题 + 来源时间 + 状态，无返回箭头与面包屑','原始通知 / 识别与校对 / 整理结果 分节（用分隔线而非卡片套卡片）','底部固定操作条：忽略 / 保存草稿 / 确认并加入日程']});
    if(await scrollDetail())await shot('27b-inbox-detail-confirm',{title:'通知详情 · 固定操作条与相似事项',surface:'panel',entry:'通知收件箱 → 详情 → 向下滚动',precondition:'该通知等待人工确认',elements:['备注字段','提醒建议','相似事项提示（只有警告类内容才套容器）','固定操作条始终贴在详情底部：忽略 / 保存草稿 / 确认并加入日程']});
    await scrollTo(0);
    await selectNotice('提交开题报告（待核对）');
    await shot('28-inbox-detail-todo',{title:'通知详情 · 待办类待核对',surface:'panel',entry:'通知收件箱 → 列表中的待办通知',precondition:'该通知已自动整理为待办',elements:['类型 / 标题 / 截止日期与时间','提醒建议：确认事务时才创建','忽略 / 保存草稿 / 确认并创建待办']});
    if(await scrollDetail())await shot('28b-inbox-confirm-todo',{title:'通知详情 · 待办确认区',surface:'panel',entry:'待办通知详情 → 向下滚动',precondition:'—',elements:['备注','提醒建议（提前 1440 分钟）','保存草稿 / 确认并创建待办']});
    await scrollTo(0);
    await selectNotice('课程调整（待核对）');
    await shot('29-inbox-detail-course-change',{title:'通知详情 · 课程调整类',surface:'panel',entry:'通知收件箱 → 列表中的调课通知',precondition:'该通知已整理为课程调整',elements:['关联课程下拉（含所属人、周次、节次与地点）','调整方式：停课 / 调课·补课 / 换教室·地点','新日期与新起止时间','确认课程调整']});
    if(await scrollDetail())await shot('29b-inbox-confirm-course-change',{title:'通知详情 · 课程调整确认区',surface:'panel',entry:'课程调整详情 → 向下滚动',precondition:'—',elements:['调整方式与新时间地点','仅调整原日期这一次课程说明','忽略 / 保存草稿 / 确认课程调整']});
    await scrollTo(0);
    await selectNotice('新生大会（待核对）');
    await shot('30-inbox-detail-duplicate',{title:'通知详情 · 相似事项提示',surface:'panel',entry:'通知收件箱 → 详情 → 存在同名同时间的已有事项',precondition:'草稿与已有会议标题、时间、地点一致',elements:['提示：可能已经存在相似事项','查看已有','仍然创建新事项勾选','确认按钮在勾选前不可用']});
    if(await scrollDetail('.detail-confirm .source-box'))await shot('30b-inbox-duplicate-block',{title:'通知详情 · 相似事项提示（局部）',surface:'panel',entry:'相似事项提示区',precondition:'—',elements:['已有事项：标题 · 时间 · 地点','查看已有按钮','仍然创建新事项勾选']});
    await scrollTo(0);
    await selectNotice('家长开放日');
    await shot('30c-inbox-detail-correction',{title:'通知详情 · 疑似修改已有事项',surface:'panel',entry:'通知收件箱 → 详情 → 草稿被识别为修改已有事项',precondition:'草稿 correction 为真且当天存在已有会议',elements:['提示：这可能是在修改已有事项','查看已有 / 更新已有事项','确认按钮文案变为「确认更新已有事项」']});
    await scrollDetail('.detail-confirm .source-box');
    await shot('30d-inbox-correction-block',{title:'通知详情 · 更新已有事项按钮',surface:'panel',entry:'疑似修改详情 → 相似事项区',precondition:'—',elements:['提示：这可能是在修改已有事项','查看已有 / 更新已有事项按钮']});
    await scrollTo(0);
    await selectNotice('新生大会（图片通知）');
    await shot('31-inbox-detail-image',{title:'通知详情 · 图片通知（原图 + OCR）',surface:'panel',entry:'通知收件箱 → 列表中的图片通知',precondition:'通知带原始图片与本机 OCR 文本',elements:['原始图片预览','本机 OCR 提取原文（可展开）','提取文字 / 补充文字','本机提取图片文字','整理结果字段']});
    if(await scrollDetail())await shot('31b-inbox-confirm-image',{title:'通知详情 · 图片通知确认区',surface:'panel',entry:'图片通知详情 → 向下滚动',precondition:'—',elements:['整理结果字段','提醒建议','忽略 / 保存草稿 / 确认并加入日程']});
    await scrollTo(0);
    await selectNotice('待整理通知');
    await shot('32-inbox-detail-failed',{title:'通知详情 · 自动整理失败',surface:'panel',entry:'通知收件箱 → 列表中的失败通知',precondition:'自动整理失败但保留原文',elements:['警告条：自动整理失败，原始通知已保存','人工填写字段','保存文字并重新整理']});
    if(await scrollDetail())await shot('32b-inbox-confirm-failed',{title:'通知详情 · 失败后的手工确认区',surface:'panel',entry:'失败通知详情 → 向下滚动',precondition:'人工选择类型后才能确认',elements:['类型 / 标题 / 日期等人工填写字段','保存草稿 / 确认按钮的可用状态']});
    await scrollTo(0);
    await selectNotice('国庆假期调整（已处理）');
    await shot('33-inbox-detail-confirmed',{title:'通知详情 · 已确认',surface:'panel',entry:'通知收件箱 → 状态为「已确认」的通知',precondition:'该通知已标记为普通通知处理',elements:['处理结果区块：普通通知 · 已处理','已处理标题与时间','来源与时间元信息']});
    await selectNotice('无关消息');
    await shot('34-inbox-detail-ignored',{title:'通知详情 · 已忽略',surface:'panel',entry:'通知收件箱 → 状态为「已忽略」的通知',precondition:'该通知被忽略',elements:['处理结果：已忽略，原始通知仍然保留','重新处理按钮']});
    await selectNotice('公开课');
    await shot('35-inbox-detail-unparsed',{title:'通知详情 · 未整理',surface:'panel',entry:'通知收件箱 → 列表中的未整理通知',precondition:'通知只有原文',elements:['用于整理的文字（原文保留）','保存文字并重新整理','类型 / 标题等字段','确认按钮当前不可用（未选择类型）']});
    await selectNotice('新生大会（待核对）');
    await click('.inbox-detail .action-menu summary');
    await shot('36a-inbox-detail-menu',{title:'通知详情 · ⋯ 菜单',surface:'panel',entry:'通知收件箱 → 详情 → 右上角 ⋯',precondition:'通知尚未确认',elements:['删除通知（低频与危险操作收进菜单）']});
    await clickText('button','删除通知');
    await shot('36-inbox-delete-confirm',{title:'通知详情 · 删除确认',surface:'panel',entry:'通知收件箱 → 详情 → ⋯ → 删除通知',precondition:'通知尚未确认、没有关联事务',elements:['说明后果：删除后无法恢复，已创建的事务不受影响','取消 / 确认删除']});
    await clickText('button','取消');
    // 0.2.16：唯一录入入口是顶部的统一 Composer。
    await run(`(()=>{const el=document.querySelector('.capture-input');const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(el,'');el.dispatchEvent(new Event('input',{bubbles:true}));el.blur();})()`);
    await wait(260);
    await shot('37-inbox-composer-empty',{title:'通知收件箱 · 统一录入区（空）',surface:'panel',entry:'侧栏 → 通知收件箱',precondition:'—',elements:['输入区提示：粘贴通知、截图，或拖入图片…','辅助操作：截图 / +（导入图片、清空输入）','主操作：整理通知','提示文字：Ctrl + V 粘贴文字或截图']});
    await run(`(()=>{const dt=new DataTransfer();dt.setData('text/plain','【学院通知】9月12日 14:00 在图书馆报告厅召开新生大会，请全体新生提前十分钟到场。');document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));})()`);
    await wait(320);
    await shot('37b-inbox-composer-pasted',{title:'通知收件箱 · Ctrl+V 粘贴后',surface:'panel',entry:'通知收件箱 → Ctrl+V',precondition:'剪贴板中是通知文字',elements:['粘贴的文字直接进入输入区并可继续编辑','提示变为 Ctrl + Enter 整理','主操作：整理通知']});
    await run(`(()=>{const zone=document.querySelector('.capture-composer');const dt=new DataTransfer();dt.items.add(new File([new Uint8Array([137,80,78,71])],'x.png',{type:'image/png'}));zone.dispatchEvent(new DragEvent('dragover',{dataTransfer:dt,bubbles:true,cancelable:true}));})()`);
    await wait(300);
    await shot('37c-inbox-composer-drop',{title:'通知收件箱 · 拖入图片的接收状态',surface:'panel',entry:'通知收件箱 → 把图片拖到录入区上方',precondition:'拖入 PNG / JPG / WEBP 图片',elements:['录入区进入 drag-over 状态（边框与底色变化）','提示文字：松手即可导入图片']});
    await run(`(()=>{const zone=document.querySelector('.capture-composer');zone.dispatchEvent(new DragEvent('dragleave',{bubbles:true}));})()`);
    await run(`(()=>{const el=document.querySelector('.capture-input');const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(el,'');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await wait(260);
    await run(`[...document.querySelectorAll('.inbox-filters button')].find(b=>b.textContent.includes('已确认'))?.click()`);
    await wait(340);
    await shot('38-inbox-filter-confirmed',{title:'通知收件箱 · 筛选「已确认」',surface:'panel',entry:'通知收件箱 → 筛选 → 已确认',precondition:'存在已确认通知',elements:['四个状态筛选：全部 / 待处理 / 已确认 / 已忽略（带数量）','筛选后的列表与右侧详情或占位']});
    await run(`[...document.querySelectorAll('.inbox-filters button')].find(b=>b.textContent.includes('全部'))?.click()`);
    await wait(300);
    await selectNotice('新生大会（待核对）');
    await setSize(920,820);
    await shot('39-inbox-narrow-detail',{title:'通知收件箱 · 窄窗详情',surface:'panel',entry:'通知收件箱（窄窗）→ 点击通知',precondition:'窗口宽度小于 1100px',elements:['列表被替换为单列详情','顶部 ← 返回通知收件箱（窄窗才有页面级返回）','标题 / 来源时间 / 状态','底部固定操作条']});
    await click('.crumb-back');
    await shot('40-inbox-narrow-list',{title:'通知收件箱 · 窄窗列表',surface:'panel',entry:'窄窗详情 → 点击返回箭头',precondition:'—',elements:['单列通知列表','统一录入区与状态筛选','返回后保留原筛选与滚动位置']});
    await setSize(1320,880);

    // ============ 八、未处理提醒与气泡 ============
    let pending={pending:0};
    for(let i=0;i<90;i++){const live=await run('window.dayhub.live()');if(live.pending>0){pending=live;break;}await wait(1000);}
    await nav('未处理提醒');
    await shot('41-reminders-due',{title:'未处理提醒 · 有到时提醒',surface:'panel',entry:'侧栏 → 未处理提醒',precondition:`存在 ${pending.pending} 条已到提醒时间、尚未处理的提醒（未来预约提醒不计入）`,elements:['说明文字：处理提醒不会自动完成待办','提醒卡：标题、到提醒时间、未处理标记','已处理 / 10 分钟后 / 30 分钟后 / 1 小时后 / 打开事项']});
    if(pending.pending>0){
      await shot('42-companion-reminder',{title:'桌宠 · 待处理提醒姿态',surface:'orb',entry:'到时提醒出现后桌宠自动切换（无需点击）',precondition:`待处理提醒 ${pending.pending} 条`,elements:['专属角色：抬手提示姿态与暖金色提示光点','底部状态条：D / Y 状态与待处理数量']});
      await shot('43-bubble',{title:'提醒气泡',surface:'bubble',entry:'到时提醒出现后自动浮现',precondition:'气泡提醒开启',elements:['时间小提醒标题','提醒正文','收起气泡按钮','查看双方状态 →']});
    }else{
      console.log('[catalog] 到时提醒未在等待窗口内出现，跳过桌宠提醒姿态与气泡截图');
    }
    await run(`window.dayhub.window('mini')`);await wait(420);
    await shot('44-mini-panel',{title:'迷你状态面板',surface:'mini',entry:'单击桌宠或底部状态条',precondition:'—',elements:['此刻，我们 + 当前时间','双方状态：别名 · 状态 + 结束时间或下一项','说明：状态依据已录入课表与日程','打开助手（含未处理提醒数）/ 桌宠设置']});
    await run(`window.dayhub.window('mini')`);await wait(320);
    await nav('未处理提醒');
    if(pending.pending>0)await clickContains('button','已处理');
    await wait(450);
    await shot('45-reminders-empty',{title:'未处理提醒 · 处理后的空状态',surface:'panel',entry:'未处理提醒 → 已处理',precondition:'提醒已确认（待办仍未完成）',elements:['空状态：没有未处理提醒','说明：确认提醒不会自动完成待办']});
    await nav('我的安排');
    await shot('46-today-after-reminder',{title:'我的安排 · 处理提醒之后',surface:'panel',entry:'未处理提醒 → 已处理 → 我的安排',precondition:'提醒已确认，逾期待办仍在',elements:['需要处理摘要：提醒数归零，仍保留待核对通知与逾期待办']});

    // ============ 九、桌宠显示态与模式 ============
    // 只保留一个可控的合成课程：先清掉 Ta 的既有课程与我的两个重叠会议，
    // 避免其它课程同时覆盖当前时刻，桌宠姿态才能确定地指向某个显示态。
    // 采集时段可能是夜间窗口：先关掉夜间自动休息，保证 idle / upcoming 等
    // 白天状态仍可被逐一采集，之后单独采集 sleeping。
    await change({type:'settings',pet:{nightRest:false}});await wait(320);
    const beforeStates=await run('window.dayhub.get()');
    for(const course of beforeStates.courses.filter(c=>c.person==='partner'))await change({type:'delete',entity:'courses',id:course.id});
    for(const id of ['cat-event-current','cat-event-clash'])await change({type:'delete',entity:'events',id});
    const stateCourse={id:'cat-course-state',person:'partner',title:'语文',weekday:weekdayToday,first:1,last:1,weeks:[1],place:'教室',notes:'',checklist:[],reminders:[],activity:'teaching'};
    const weekNow=Math.max(1,Math.min(partner.weeks,Math.floor((new Date(today+'T00:00:00Z')-new Date(partner.startDate+'T00:00:00Z'))/604800000)+1));
    const stateDate=addDays(partner.startDate,(weekNow-1)*7+weekdayToday-1);
    await change({type:'save',entity:'courses',value:{...stateCourse,weeks:[weekNow]}});
    const setInstance=(startMs,endMs)=>change({type:'save',entity:'exceptions',value:{id:'cat-ex-state',courseId:'cat-course-state',date:stateDate,cancelled:false,start:stamp(startMs),end:stamp(endMs),place:'教室'}});
    // 采集过程本身要花几分钟，因此这些时间点必须按“此刻”重算，不能用脚本启动时的时间戳。
    const t=()=>Date.now();
    // 状态切换有 160ms 交叉淡入淡出，命中后要再等图片解码与淡入完成再截图。
    const waitState=async wanted=>{for(let i=0;i<40;i++){const live=await run('window.dayhub.live()');if(live.display.state===wanted){await wait(700);return live.display.state;}await wait(250);}await wait(700);return (await run('window.dayhub.live()')).display.state;};
    await setInstance(t()-20*60000,t()+20*60000);
    await waitState('busy_class');
    await shot('47-companion-busy-class',{title:'桌宠 · 上课中姿态',surface:'orb',entry:'Ta 正在上课时自动切换（无需点击）',precondition:'Ta 的课表现在处于上课时段',elements:['专属角色：戴眼镜、执书与教鞭','底部状态条显示双方状态']});
    await setInstance(t()-15*60000,t()-60000);
    const gentle=await waitState('gentle');
    await shot('48-companion-gentle',{title:'桌宠 · 完成姿态（刚下课）',surface:'orb',entry:'课程结束 3 分钟内自动切换',precondition:'Ta 的课程刚刚结束',elements:['专属角色：轻庆祝与星光','底部状态条显示双方状态']});
    await setInstance(t()+20*60000,t()+50*60000);
    const upcoming=await waitState('upcoming');
    await shot('49-companion-upcoming',{title:'桌宠 · 即将开始姿态',surface:'orb',entry:'下一项 30 分钟内开始时自动切换',precondition:'Ta 的下一节课在 30 分钟内',elements:['专属角色：课间伸展姿态','底部状态条显示双方状态']});
    await change({type:'delete',entity:'exceptions',id:'cat-ex-state'});
    await setInstance(t()+2*3600000,t()+2*3600000+45*60000);
    const idle=await waitState('idle');
    await shot('50-companion-idle',{title:'桌宠 · 空闲姿态',surface:'orb',entry:'双方都空闲时自动切换',precondition:'没有进行中的课程、会议与待处理提醒',elements:['专属角色：自然站立','底部状态条显示双方状态']});
    await hover('.pet-handle',0,'orb');
    await shot('51-companion-hover',{title:'桌宠 · 鼠标悬停',surface:'orb',entry:'鼠标移到桌宠身上',precondition:'—',elements:['只有角色本体上浮 2px（状态条不动）','不使用 drop-shadow 等透明窗口滤镜','鼠标移开后恢复原位']});
    // 0.2.16 P0：拖动期间冻结一切视觉动画，只剩窗口位移。
    await shot('50b-companion-rail',{title:'桌宠 · 底部 D / Y 状态条',surface:'orb',entry:'桌宠窗口底部（始终可见）',precondition:'专属角色桌宠',elements:['D / Y 两个字母与状态点（颜色表达状态）','有待处理提醒时右侧出现极简计数徽标','完整信息在点击后的迷你状态面板里']});
    {
      const dragBounds=orb.getBounds();
      const event=(type,button,screenX)=>`document.querySelector('.pet-handle').dispatchEvent(new PointerEvent(${JSON.stringify(type)},{bubbles:true,cancelable:true,pointerId:9,button:${button},buttons:${type==='pointerup'?0:1},clientX:40,clientY:70,screenX:${screenX},screenY:${dragBounds.y+70}}))`;
      await pet(event('pointerdown',0,dragBounds.x+50));
      await pet(event('pointermove',-1,dragBounds.x+10));
      await wait(180);
      const dragging=await pet("document.querySelector('.pet-dock').classList.contains('is-dragging')");
      await shot('50c-companion-dragging',{title:'桌宠 · 拖动中（动画冻结）',surface:'orb',entry:'按住桌宠拖动',precondition:'—',elements:['拖动中角色与状态条都保持静止，没有任何呼吸 / 过渡 / 滤镜','窗口位置只跟随指针，尺寸不变','松手后保存位置并恢复视觉状态']});
      await pet(event('pointerup',0,dragBounds.x+10));
      await wait(200);
      await run(`window.__dragFroze=${dragging}&&true`);
    }
    await change({type:'settings',pet:{size:'small'}});await wait(450);
    await shot('52-companion-small',{title:'桌宠 · 小尺寸',surface:'orb',entry:'设置与备份 → 桌面陪伴 → 大小 → 小',precondition:'专属角色桌宠',elements:['窗口与角色等比缩小，脚底基线不变']});
    await change({type:'settings',pet:{size:'large'}});await wait(450);
    await shot('53-companion-large',{title:'桌宠 · 大尺寸',surface:'orb',entry:'设置与备份 → 桌面陪伴 → 大小 → 大',precondition:'专属角色桌宠',elements:['窗口与角色等比放大，脚底基线不变']});
    // 夜间：把时钟临时拨到 23:45（本进程内虚拟时钟），采集夜间睡觉与夜间状态条。
    {
      const realNow=Date.now,offset=()=>{const t=new Date(realNow()+8*3600000);t.setUTCHours(23,45,0,0);return t.getTime()-8*3600000-realNow();};
      const shift=offset();Date.now=()=>realNow()+shift;
      try{
        await change({type:'settings',pet:{size:'medium',nightRest:true}});await wait(400);
        const state=await waitState('night_sleep');
        console.log('[catalog] 夜间虚拟时钟状态',state);
        await wait(420);
        await shot('53b-companion-night-sleep',{title:'桌宠 · 夜间睡觉（23:30–07:30）',surface:'orb',entry:'夜间没有进行中的安排、也没有到时间的提醒时自动进入',precondition:'本机时间 23:30–07:30，无人忙碌、无待处理提醒',elements:['专属角色：抱着月亮坐在云朵上入睡','底部状态条：D / Y 状态点仍在，整体转为柔和夜间底色','状态点颜色仍表达真实业务语义（同语义同色）']});
      }finally{Date.now=realNow;}
      await change({type:'settings',pet:{nightRest:false}});await wait(400);
    }
    // 0.2.20 新增的三个时间状态：吃饭 / 午睡 / 刚睡醒。素材缺失时自动跳过，
    // 素材补齐后再次运行目录脚本就会自动补上这三张图。
    {
      const bundle=await run('window.dayhub.companionAssets()');
      const realNow=Date.now;
      for(const [key,[hour,minute],title,text] of [
        ['eating',[11,45],'桌宠 · 吃饭（11:30–12:00）','本机时间 11:30–12:00，无人忙碌、无待处理提醒'],
        ['nap',[12,45],'桌宠 · 午睡（12:30–14:00）','本机时间 12:30–14:00，无人忙碌、无待处理提醒'],
        ['wake_up',[7,35],'桌宠 · 刚睡醒（07:30–07:50）','本机时间 07:30–07:50，无人忙碌、无待处理提醒'],
      ]){
        if(bundle.missing?.includes(key)){console.log('[catalog] 跳过时间状态',key,'：素材待接入');continue;}
        const shift=()=>{const d=new Date(realNow()+8*3600000);d.setUTCHours(hour,minute,0,0);return d.getTime()-8*3600000-realNow();};
        Date.now=()=>realNow()+shift();
        try{
          await change({type:'settings',pet:{size:'medium',nightRest:false}});await wait(320);
          const state=await waitState(key);
          console.log('[catalog] 时间状态',key,state);
          await wait(420);
          await shot(`54b-companion-${key}`,{title,surface:'orb',entry:'到点后自动切换，不需要点击',precondition:text,elements:['专属角色：对应时段的动作','底部状态条显示双方状态','交互反馈（点击 / 拖动 / 提醒）优先于时间状态']});
        }finally{Date.now=realNow;}
      }
    }
    await change({type:'settings',pet:{size:'medium',mode:'custom'}});await wait(400);
    await change({type:'settings',pet:{mode:'orb'}});await wait(520);
    await shot('56-companion-orb',{title:'桌宠 · 玻璃悬浮球',surface:'orb',entry:'设置与备份 → 桌面陪伴 → 显示模式 → 玻璃悬浮球',precondition:'—',elements:['左右两个状态区：D 与 Y','每区一个状态点']});
    await pet(`window.dayhub.presence('enter','partner')`);await wait(420);
    await shot('57-companion-tip',{title:'悬浮球 · 悬停短提示',surface:'tip',entry:'鼠标移到悬浮球的左侧或右侧状态区',precondition:'玻璃悬浮球模式',elements:['独立小提示窗：Y · 空闲（或上课中 / 教研中 / 活动中 / 会议中 / 即将有安排）','移开后立即收起']});
    await pet(`window.dayhub.presence('leave')`);await wait(220);
    await change({type:'settings',pet:{mode:'custom',size:'medium',pausedUntil:0}});await wait(420);
    // 恢复正式数据：重新导入课表并把两个进行中的会议加回来，供响应式截图使用。
    await nav('课表管理');
    await seatSchedule(false);
    await change({type:'save',entity:'events',value:{id:'cat-event-current',title:'教研组例会',start:stamp(t()-30*60000),end:stamp(t()+40*60000),place:'办公楼 302',notes:'带上本周听课记录。',reminders:[],checklist:[{id:'e1',text:'打印听课记录',done:false}]}});
    await change({type:'save',entity:'events',value:{id:'cat-event-clash',title:'临时年级组会',start:stamp(t()-10*60000),end:stamp(t()+30*60000),place:'年级办公室',notes:'与教研组例会时间重叠。',reminders:[],checklist:[]}});
    await nav('设置与备份');
    await shot('58-settings-modes',{title:'设置与备份 · 桌面陪伴：外观与作息',surface:'panel',entry:'设置与备份 → 桌面陪伴',precondition:'素材可用',elements:['专属角色桌宠 / 玻璃悬浮球（小猫桌宠已删除）','大小：小 / 中 / 大','说明文案：专属角色 · 会根据当前状态自动切换动作（用户语言，无工程术语）','动态效果：标准 / 减少','作息状态：夜间自动睡觉（23:30–07:30）可开关，并说明 07:30 伸懒腰、11:30 吃饭、12:30 午睡']});
    await change({type:'settings',pet:{bubbles:false}});await wait(320);
    await shot('59-settings-bubbles-off',{title:'设置与备份 · 关闭气泡提醒',surface:'panel',entry:'设置与备份 → 桌面陪伴 → 气泡提醒',precondition:'—',elements:['到时间时用气泡提醒我（未勾选）','气泡停留时长（禁用态）','暂停气泡 1 小时']});
    await change({type:'settings',pet:{bubbles:true,pausedUntil:Date.now()+3600000}});await wait(340);
    await shot('60-settings-bubbles-paused',{title:'设置与备份 · 暂停气泡 1 小时',surface:'panel',entry:'设置与备份 → 桌面陪伴 → 暂停气泡 1 小时',precondition:'—',elements:['暂停状态文案与自动恢复时间','恢复气泡按钮']});
    await change({type:'settings',pet:{pausedUntil:0,reduceMotion:true}});await wait(340);
    await shot('61-settings-reduce-motion',{title:'设置与备份 · 动态效果：减少',surface:'panel',entry:'设置与备份 → 桌面陪伴 → 动态效果',precondition:'—',elements:['单一选择：标准 / 减少（不再是两个互相冲突的勾选框）','减少时桌宠几乎静止，只在状态变化时淡入']});
    await change({type:'settings',pet:{reduceMotion:false}});await wait(240);
    await clickText('button','导出完整备份');await wait(700);
    await shot('62-backup-exported',{title:'设置与备份 · 备份导出成功',surface:'panel',entry:'设置与备份 → 本地备份 → 导出完整备份',precondition:'选择保存位置后',elements:['提示条：备份已导出：路径','知道了 / 关闭按钮']});
    openQueue.push({canceled:false,filePaths:[path.join(appData,'ui-catalog-export.dayhub')]});
    await clickText('button','从备份恢复');await wait(900);
    await shot('63-backup-restored',{title:'设置与备份 · 备份恢复完成',surface:'panel',entry:'设置与备份 → 本地备份 → 从备份恢复',precondition:'选择备份文件并确认恢复',elements:['提示条：备份已恢复。恢复前的数据已自动备份在应用数据目录。']});

    // ============ 十、响应式与原生菜单 ============
    // 关掉上一步的提示条，响应式截图只保留页面本身的元素。
    await clickContains('button','知道了');
    await nav('我的安排');
    await setSize(750,760);
    await shot('64-today-narrow',{title:'我的安排 · 窄窗（750px）',surface:'panel',entry:'我的安排 → 将窗口缩小到 750px',precondition:'—',elements:['侧栏压缩','状态行与卡片单列排布','无横向滚动']});
    await nav('课表管理');
    await shot('65-courses-narrow',{title:'课表管理 · 窄窗横向滚动',surface:'panel',entry:'课表管理（窄窗）',precondition:'—',elements:['周课表保持最小列宽并可横向滚动','工具栏与作息摘要换行']});
    await nav('事项与会议');
    await shot('66-tasks-narrow',{title:'事项与会议 · 窄窗',surface:'panel',entry:'事项与会议（窄窗）',precondition:'—',elements:['筛选与搜索堆叠','待办与会议单列显示']});
    await nav('设置与备份');
    await shot('67-settings-narrow',{title:'设置与备份 · 窄窗',surface:'panel',entry:'设置与备份（窄窗）',precondition:'—',elements:['显示模式卡片单列或两列','开关与说明文字换行']});
    await nav('通知收件箱');
    await setSize(1920,900);
    await selectNotice('新生大会（待核对）');
    await shot('68-inbox-wide-1920',{title:'通知收件箱 · 1920px 宽窗',surface:'panel',entry:'通知收件箱（1920px）→ 点击通知',precondition:'—',elements:['列表列宽固定，详情区更宽','原始通知与整理结果分层','页面最大宽度限制']});
    await setSize(1320,880);
    await nav('我的安排');

    // 原生菜单：把光标移到目标位置后弹出，再用整屏截图保存
    const native=[];
    try{
      const bounds=orb.getBounds();
      moveCursor(bounds.x+bounds.width/2,bounds.y+bounds.height*0.7);
      await run(`window.dayhub.window('menu')`);await wait(800);
      await screenCapture('69-companion-context-menu',{x:bounds.x-70,y:bounds.y-70,width:bounds.width+320,height:bounds.height+300});
      await screenCapture('69b-companion-context-menu-full',null);
  native.push({id:'69-companion-context-menu',title:'桌宠右键菜单（原生菜单）',surface:'screen',entry:'在桌宠上点击鼠标右键',precondition:'—',elements:['打开 YD','查看双方状态','暂停气泡 1 小时 / 恢复气泡提醒','桌宠设置','隐藏桌宠','退出 YD'],file:'shots/69-companion-context-menu.png',full:'shots/69b-companion-context-menu-full.png',note:'原生菜单无法用 capturePage 截取：此处用系统光标定位后整屏截图并裁剪到桌宠与菜单区域；另存整屏原图 69b。'});
      sendEscape();await wait(400);
    }catch(error){
  native.push({id:'69-companion-context-menu',title:'桌宠右键菜单（原生菜单）',surface:'screen',entry:'在桌宠上点击鼠标右键',precondition:'—',elements:['打开 YD','暂停气泡 1 小时','桌宠设置','隐藏桌宠','退出（停止提醒）'],file:null,note:'本机屏幕捕获失败：'+(error&&error.message?error.message:String(error))});
    }
    if(trayInstance){
      try{
        const area=screen.getPrimaryDisplay().workArea;
        sendEscape();await wait(300);
        moveCursor(area.x+area.width-120,area.y+area.height-8);
        trayInstance.popUpContextMenu(trayMenu);
        await wait(800);
        await screenCapture('70-tray-menu',{x:area.x+area.width-620,y:area.y+area.height-560,width:620,height:560});
        await screenCapture('70b-tray-menu-full',null);
  native.push({id:'70-tray-menu',title:'托盘菜单（原生菜单）',surface:'screen',entry:'右键系统托盘中的「YD · 本地运行」图标',precondition:'应用已驻留托盘',elements:['显示／隐藏桌宠','打开 YD','暂停气泡提醒 1 小时 / 恢复气泡提醒','设置与备份','退出 YD'],file:'shots/70-tray-menu.png',full:'shots/70b-tray-menu-full.png',note:'原生菜单无法用 capturePage 截取：此处用系统光标定位到托盘区后弹出菜单并整屏截图裁剪；另存整屏原图 70b。'});
        sendEscape();await wait(300);
      }catch(error){
  native.push({id:'70-tray-menu',title:'托盘菜单（原生菜单）',surface:'screen',entry:'右键系统托盘中的「YD · 本地运行」',precondition:'应用驻留托盘',elements:['显示／隐藏悬浮球','打开 YD','退出（停止提醒）'],file:null,note:'本机屏幕捕获失败：'+(error&&error.message?error.message:String(error))});
      }
    }

  const result={generatedAt:new Date().toISOString(),app:{name:'YD',version:require(path.join(root,'package.json')).version,packaged:app.isPackaged},display:{dpr:dpr(),size:screen.getPrimaryDisplay().size,workArea:screen.getPrimaryDisplay().workAreaSize},output:outRoot,data:appData,shots:[...shots,...native]};
    fs.writeFileSync(path.join(outRoot,'catalog.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify({output:outRoot,count:result.shots.length,failed:native.filter(n=>!n.file).map(n=>n.id),observed:{gentle,upcoming,idle,catTeaching,reminderPending:pending.pending},data:appData},null,2));
    app.exit(0);
  }catch(error){
    fs.writeFileSync(path.join(outRoot,'failure.txt'),(error&&error.stack)||String(error));
    console.error(error);
    app.exit(1);
  }
});
