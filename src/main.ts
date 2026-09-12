import { InboxService } from './inbox-service.ts';
import { LocalRuleParser } from './parser.ts';
import { DesktopDelivery } from './delivery.ts';
import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, dialog, Notification, clipboard, powerMonitor, globalShortcut } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import initSqlJs from 'sql.js';
import { Companion } from './companion.ts';
import { resolveCompanionAssets } from './companion-assets.ts';
import { companionGeometry } from './companion-layout.ts';
import { companionToggleShortcut } from './companion-menu.ts';
import { migrateLive, petDefaults, snapshot, statusLabel } from './live.ts';
import { apply, tick, showPanelOnLaunch } from './core.ts';
import { Store } from './store.ts';
import type { DB } from './store.ts';
import { pack, unpack } from './backup.ts';
import { clampToArea, resolveDragStep, type DragAnchor } from './geometry.ts';
import { configureLogging, installStreamGuards, logError, logLine } from './logging.ts';
import type { Command, SchedulePackage } from './types.ts';

const APP_ID='cn.dayhub.desktop';
// 先接管 stdout/stderr：管道断开（EPIPE）时不能变成主进程未捕获异常与错误弹窗。
installStreamGuards();
app.setAppUserModelId(APP_ID);
// Keep the database location independent from the account/build environment
// that created the installer. DAYHUB_TEST_DATA remains the isolated test hook.
// 数据目录名保持 0.2.x 的历史值（事务助手），改名只影响品牌显示：
// 这样 0.2.17 升级后仍读写同一份 dayhub.sqlite，用户数据不迁移、不丢失。
app.setPath('userData',process.env.DAYHUB_TEST_DATA?path.resolve(process.env.DAYHUB_TEST_DATA):path.join(app.getPath('appData'),'事务助手'));
let companion:Companion|undefined;
let companionAssets:ReturnType<typeof resolveCompanionAssets>;
let inboxService:InboxService;
const delivery=new DesktopDelivery(toast);
let quitting=false, orb:BrowserWindow, panel:BrowserWindow, tray:Tray, store:Store, attachments:string, data:string;
let busy=false, ocrBusy=false, lastTick=Date.now(), timer:ReturnType<typeof setInterval>;
// 拖动锚点同时记录窗口原点、渲染层指针与系统光标：真实拖动时以系统光标为准
// （多显示器与 125%/150% 缩放下不会越拖越偏），无光标移动的自动化场景退回
// 渲染层指针增量，两条路径都只改窗口位置，不碰任何 CSS 变换。
let dragAnchor:DragAnchor|undefined;
const notifications=new Set<Notification>();
const windows=()=>[orb,panel,companion?.bubble,companion?.mini,companion?.tip,companion?.sheet].filter((w):w is BrowserWindow=>!!w&&!w.isDestroyed());
// 正式日志先写文件；控制台只在开发环境或控制台仍可用时作为镜像。
function runtimeLog(level:string,message:string){logLine(level,message);}
function changed(){companion?.reset();for(const w of windows())w.webContents.send('dayhub:changed');}
function showPanel(){if(panel.isMinimized())panel.restore();panel.show();panel.focus();}
function errorMessage(error:unknown){return error instanceof Error?error.message:String(error);}
// Leaving through the tray or the companion menu stops desktop reminders, so
// the confirmation says that in plain words instead of just quitting.
function confirmQuit(){
  let choice=1;
  const options={type:'question' as const,buttons:['取消','退出 YD'],defaultId:1,cancelId:0,title:'YD',message:'退出 YD？',detail:'退出后将停止桌面提醒；未处理的提醒会保留，下次启动仍然可见。'};
  // 主窗口可能在托盘中隐藏：此时不要把它当成对话框父窗口，否则确认框会被藏住。
  try{choice=panel&&!panel.isDestroyed()&&panel.isVisible()?dialog.showMessageBoxSync(panel,options):dialog.showMessageBoxSync(options);}
  catch{choice=1;}
  if(choice!==1)return;
  quitting=true;app.quit();
}
function pauseBubbles(minutes:number){
  const until=minutes>0?Date.now()+minutes*60000:0;
  void store.update(s=>{s.settings.pet={...petDefaults,...s.settings.pet,pausedUntil:until};return s;}).then(()=>{changed();refreshTrayMenu();});
}
// 托盘菜单、桌宠右键菜单与全局快捷键共用同一个开关，三处永远不会出现两种行为。
function togglePetWindow(){
  if(!orb||orb.isDestroyed())return;
  if(orb.isVisible()){companion?.hideMenu();orb.hide();}
  else{orb.showInactive();refreshTrayMenu(true);}
}
let trayMenuPaused:boolean|undefined;
function refreshTrayMenu(force=false){
  const paused=(store.state.settings.pet?.pausedUntil??0)>Date.now();
  if(!force&&paused===trayMenuPaused)return;
  trayMenuPaused=paused;
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'显示／隐藏桌宠',click:togglePetWindow},
    {label:'打开 YD',click:showPanel},
    {type:'separator'},
    {label:paused?'恢复气泡提醒':'暂停气泡提醒 1 小时',click:()=>pauseBubbles(paused?0:60)},
    {label:'设置与备份',click:()=>{showPanel();panel.webContents.send('dayhub:settings');}},
    {type:'separator'},
    {label:'退出 YD',click:confirmQuit}]));
}
function toast(title:string,body:string){
  if(!Notification.isSupported())return;
  const notification=new Notification({title,body,silent:true});notifications.add(notification);
  notification.on('click',showPanel);notification.on('close',()=>notifications.delete(notification));notification.on('failed',()=>notifications.delete(notification));notification.show();
}
function clampPosition(x:number,y:number,snap=false){
  const {workArea:a}=screen.getDisplayNearestPoint({x:Math.round(x+38),y:Math.round(y+38)});
  const [width,height]=orb&&!orb.isDestroyed()?orb.getSize():[300,128];
  return clampToArea(x,y,width,height,a,snap);
}
function moveOrb(x:number,y:number,width?:number,height?:number){
  const [currentWidth,currentHeight]=orb.getSize(),wasResizable=orb.isResizable();
  const targetWidth=width??currentWidth,targetHeight=height??currentHeight;
  // 尺寸没变时只移动位置：setBounds 会让 Windows 把透明窗口重新对齐到物理像素，
  // 拖动过程中反复调用就会出现 1px 的尺寸抖动与贴图残影。
  if(targetWidth===currentWidth&&targetHeight===currentHeight){orb.setPosition(Math.round(x),Math.round(y));return;}
  if(!wasResizable)orb.setResizable(true);
  orb.setBounds({x:Math.round(x),y:Math.round(y),width:targetWidth,height:targetHeight},false);
  if(!wasResizable)orb.setResizable(false);
}
async function savePosition(){const [x,y]=orb.getPosition(),[width,height]=orb.getSize(),pos=clampPosition(x,y,true);moveOrb(pos.x,pos.y,width,height);if(store.state.settings.pet?.rememberPosition===false)return;await store.update(s=>{s.settings.orb=pos;return s;});}
async function processReminders(forceSummary=false){
  if(busy)return;busy=true;
  try{
    const now=Date.now(), gap=now-lastTick;lastTick=now;
    let result:ReturnType<typeof tick>={due:[],missed:false,changed:false};
        const needs=store.state.reminders.some(r=>r.status==='scheduled'&&r.due<=now);
    if(needs||now-store.state.lastTick>60000){
      await store.update(s=>{result=tick(s,now);return s;});
      if(result.due.length){for(const w of windows())w.webContents.send('dayhub:changed');delivery.deliver(result.due,forceSummary||gap>90000||result.missed);}
    }
  }catch(error){logError(error,'提醒检查未完成');for(const w of windows())w.webContents.send('dayhub:error','提醒检查未完成：'+errorMessage(error));}
  finally{busy=false;}
}
function windowOptions(){return {webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,backgroundThrottling:false},backgroundColor:'#f7f8fa'};}
function lockWindow(w:BrowserWindow){
  w.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  w.webContents.on('will-navigate',e=>e.preventDefault());
  w.webContents.on('console-message',(details,_level,message,_line,sourceId)=>runtimeLog('renderer',`${(details as any).message||message} · ${(details as any).sourceId||sourceId}`));
  w.webContents.on('did-fail-load',(_event,code,description,url,isMain)=>runtimeLog('error',`页面加载失败 ${code} ${description} ${url} main=${isMain}`));
  w.webContents.on('render-process-gone',(_event,details)=>runtimeLog('error',`渲染进程退出 ${details.reason} code=${details.exitCode}`));
  w.webContents.on('preload-error',(_event,preloadPath,error)=>runtimeLog('error',`预加载失败 ${preloadPath}: ${error.message}`));
  w.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
}
function handler(name:string, fn:(...args:any[])=>unknown){ipcMain.handle('dayhub:'+name, async(event,...args)=>{
  if(!windows().some(w=>w.webContents===event.sender)||event.senderFrame!==event.sender.mainFrame)throw new Error('不允许的窗口');
  const url=new URL(event.sender.getURL());if(url.protocol!=='file:'||path.resolve(fileURLToPath(url)).toLowerCase()!==path.join(__dirname,'index.html').toLowerCase())throw new Error('不允许的来源');
  return fn(...args);
});}
function imagePath(image:unknown){if(typeof image!=='string'||! /^[a-f0-9]{64}\.png$/.test(image))throw new Error('图片编号无效');const file=path.join(attachments,image);if(!fs.existsSync(file))throw new Error('原图不存在，请重新导入');return file;}
function storeImage(image:Electron.NativeImage){
  if(image.isEmpty())throw new Error('没有可读取的图片');const {width,height}=image.getSize();if(width*height>24000000)throw new Error('图片过大，请裁剪到 2400 万像素以内');
  const bytes=image.toPNG();if(bytes.length>20*1024*1024)throw new Error('图片超过 20 MB，请裁剪后重试');
  const name=createHash('sha256').update(bytes).digest('hex')+'.png',file=path.join(attachments,name);if(!fs.existsSync(file))fs.writeFileSync(file,bytes,{flag:'wx'});return {image:name};
}
function setupHandlers(){
  handler('get',()=>store.snapshot());
  handler('parseNotice',(id:string,text?:string,fromOcr?:boolean)=>inboxService.parse(id,text,fromOcr===true));
  handler('clipboardText',()=>clipboard.readText());
  handler('live',()=>companion?.get()??snapshot(store.state,Date.now()));
  handler('companionAssets',()=>companionAssets??resolveCompanionAssets(__dirname));
  handler('pointer',(interactive:boolean)=>{if(typeof interactive!=='boolean')throw new Error('参数无效');});
  // Restrict click-through control to the sending companion window.
  ipcMain.removeHandler('dayhub:pointer');
  // 退出过程中窗口可能已经被销毁：这里先排除 destroyed 的窗口，避免把
  // 正常的关闭流程变成一条主进程错误日志。
  ipcMain.handle('dayhub:pointer',(event,interactive:unknown)=>{
    const w=[orb,companion?.bubble].find(candidate=>candidate&&!candidate.isDestroyed()&&candidate.webContents===event.sender);
    if(!w||event.senderFrame!==event.sender.mainFrame||typeof interactive!=='boolean')throw new Error('不允许的窗口操作');
    w.setIgnoreMouseEvents(!interactive,{forward:true});
  });
  handler('bubble',(action:string)=>{if(!['hold','release','close'].includes(action))throw new Error('无效操作');companion?.action(action);});
  handler('presence',(action:string,person?:'me'|'partner')=>{if(action!=='enter'&&action!=='leave')throw new Error('无效状态操作');companion?.presence(action,person);});
  handler('window',(action:string)=>{
    if(action==='minimize')panel.minimize();else if(action==='maximize'){if(panel.isMaximized())panel.unmaximize();else panel.maximize();}
    else if(action==='close')panel.hide();else if(action==='open')showPanel();else if(action==='mini')companion?.toggleMini();
    else if(action==='settings'){showPanel();panel.webContents.send('dayhub:settings');}
    else if(action==='menu')companion?.openMenu();else throw new Error('无效窗口操作');
  });
  // 自绘右键菜单里的每一行都回到同一个入口；未知 id 直接忽略，不写入任何状态。
  handler('menuAction',(id:string)=>{if(typeof id!=='string'||id.length>40)throw new Error('菜单操作无效');return companion?.menuAction(id);});
  handler('change',async(cmd:Command)=>{
    if(!cmd||Buffer.byteLength(JSON.stringify(cmd))>1024*1024)throw new Error('操作无效或内容过大');
    if(cmd.type==='save'&&cmd.entity==='notices'&&(cmd.value as any)?.image)imagePath((cmd.value as any).image);
    if(cmd.type==='inbound'&&cmd.payload?.image)imagePath(cmd.payload.image);
    const result=cmd.type==='inbound'?await inboxService.receive(cmd.payload,cmd.id):await store.update(s=>migrateLive(apply(s,cmd)));
    if(cmd.type==='settings'&&cmd.launch!==undefined) {
      try{app.setLoginItemSettings({openAtLogin:cmd.launch,path:process.execPath});if(app.getLoginItemSettings().openAtLogin!==cmd.launch)throw new Error('系统未接受开机启动设置');}
      catch(error){await store.update(s=>{s.settings.launch=app.getLoginItemSettings().openAtLogin;return s;});changed();throw error;}
    }
    changed();return result;
  });
  handler('toggle',()=>{if(panel.isVisible())panel.hide();else showPanel();});
  handler('beginDrag',(pointerX:number,pointerY:number)=>{
    if(!Number.isFinite(pointerX)||!Number.isFinite(pointerY))throw new Error('拖动参数无效');
    companion?.dragStart();
    const {x:windowX,y:windowY,width,height}=orb.getBounds(),cursor=screen.getCursorScreenPoint();
    dragAnchor={windowX,windowY,pointerX,pointerY,cursorX:cursor.x,cursorY:cursor.y,width,height,cursorMode:false};
    // 拖动期间不再切换 resizable：在 Windows 上它会改动窗口样式位并触发一次
    // 透明窗口重排，是贴图异常与状态条被裁掉的来源之一。这里只记录锚点，
    // 后面全程只改位置。
  });
  handler('drag',(pointerX:number,pointerY:number)=>{
    if(!dragAnchor||!Number.isFinite(pointerX)||!Number.isFinite(pointerY))throw new Error('拖动参数无效');
    const cursor=screen.getCursorScreenPoint();
    const step=resolveDragStep(dragAnchor,{x:pointerX,y:pointerY},cursor);
    if(step.adoptedCursor){
      // 改用系统光标时按当前位置重新对齐锚点，避免切换瞬间跳一下。
      const now=orb.getBounds();
      dragAnchor={...dragAnchor,cursorMode:true,windowX:now.x,windowY:now.y,cursorX:cursor.x,cursorY:cursor.y,pointerX,pointerY};
    }
    const pos=clampPosition(dragAnchor.windowX+step.delta.x,dragAnchor.windowY+step.delta.y);
    moveOrb(pos.x,pos.y,dragAnchor.width,dragAnchor.height);
  });
  handler('endDrag',async()=>{try{if(dragAnchor)await savePosition();}finally{dragAnchor=undefined;companion?.dragEnd();}});
  handler('importImage',async()=>{const r=await dialog.showOpenDialog(panel,{title:'选择课表或通知图片',properties:['openFile'],filters:[{name:'PNG / JPEG 图片',extensions:['png','jpg','jpeg']}]});if(r.canceled)return null;const file=r.filePaths[0];if(!/\.(png|jpe?g)$/i.test(file)||fs.statSync(file).size>20*1024*1024)throw new Error('请选择不超过 20 MB 的 PNG 或 JPEG 图片');return storeImage(nativeImage.createFromPath(file));});
  handler('chooseSchedule',async()=>{
    const r=await dialog.showOpenDialog(panel,{title:'选择整理后的课表',properties:['openFile'],filters:[{name:'YD 课表',extensions:['dayhub-schedule.json','json']}]});
    if(r.canceled)return null;
    const file=r.filePaths[0];if(fs.statSync(file).size>1024*1024)throw new Error('课表文件超过 1 MB');
    let value:SchedulePackage;try{value=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new Error('无法读取课表文件，请确认文件内容完整');}
    if(value?.format!=='dayhub-schedule'||value.version!==1||!Array.isArray(value.profiles)||!Array.isArray(value.courses))throw new Error('这不是受支持的 YD 课表文件');
    apply(store.snapshot(),{type:'importSchedule',value});
    return value;
  });
  handler('pasteImage',async()=>{
    const items=await clipboard.read();
    for(const item of items){
      const type=item.types.find(value=>value.startsWith('image/'));
      if(!type)continue;
      const blob=await item.getType(type) as Blob;
      const image=nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
      if(!image.isEmpty())return storeImage(image);
    }
    return null;
  });
  // 拖入的图片由渲染层先用 Chromium 解码成 PNG（因此 WEBP 等格式也能导入），
  // 主进程只负责落盘，不猜测来源格式。
  handler('importImageBytes',(bytes:unknown)=>{
    if(!(bytes instanceof Uint8Array))throw new Error('图片数据无效');
    if(!bytes.length||bytes.length>20*1024*1024)throw new Error('请拖入 20 MB 以内的图片');
    const image=nativeImage.createFromBuffer(Buffer.from(bytes));
    if(image.isEmpty())throw new Error('无法读取这张图片，请换一张 PNG、JPG 或 WEBP 图片');
    return storeImage(image);
  });
  handler('image',(image:string)=>'data:image/png;base64,'+fs.readFileSync(imagePath(image)).toString('base64'));
  handler('ocr',async(image:string)=>{
    if(ocrBusy)throw new Error('正在识别另一张图片，请稍后重试');const file=imagePath(image);ocrBusy=true;
    try{return await new Promise<string>((resolve,reject)=>{
      const exe=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
      const script=app.isPackaged?path.join(process.resourcesPath,'app.asar.unpacked','native','ocr.ps1'):path.join(app.getAppPath(),'native','ocr.ps1');
      execFile(exe,['-NoProfile','-NonInteractive','-File',script,'-ImagePath',file],{windowsHide:true,timeout:45000,maxBuffer:2*1024*1024,encoding:'utf8'},(error,stdout)=>{
        try{const result=JSON.parse(stdout.replace(/^\uFEFF/,''));if(result.error)reject(new Error('本机识别未完成：'+result.error+'。可以继续看图手动填写。'));else resolve(String(result.text));}
        catch{reject(new Error(error?'本机识别不可用或超时，请继续看图填写。':'无法读取识别结果，请手动填写。'));}
      });
    });}finally{ocrBusy=false;}
  });
  handler('backup',async()=>{
    const r=await dialog.showSaveDialog(panel,{title:'导出完整备份',defaultPath:`YD备份-${new Date().toISOString().slice(0,10)}.dayhub`,filters:[{name:'YD 备份',extensions:['dayhub']}]});if(r.canceled||!r.filePath)return null;
    await store.flush();fs.writeFileSync(r.filePath,pack(store.snapshot(),attachments));return r.filePath;
  });
  handler('restore',async()=>{
    const r=await dialog.showOpenDialog(panel,{title:'选择备份',properties:['openFile'],filters:[{name:'YD 备份',extensions:['dayhub']}]});if(r.canceled)return null;
    const file=r.filePaths[0];if(fs.statSync(file).size>200*1024*1024)throw new Error('备份超过 200 MB');const restored=unpack(fs.readFileSync(file,'utf8'));
    const confirm=await dialog.showMessageBox(panel,{type:'question',buttons:['取消','恢复备份'],defaultId:0,cancelId:0,message:'恢复将替换当前记录',detail:'将先在应用数据目录保存当前数据的完整备份，再恢复所选文件。'});if(confirm.response!==1)return null;
    const next=await store.update(current=>{
      const dir=path.join(data,'backups');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,`before-restore-${Date.now()}.dayhub`),pack(current,attachments));
      for(const [name,bytes]of restored.images)if(!fs.existsSync(path.join(attachments,name)))fs.writeFileSync(path.join(attachments,name),bytes,{flag:'wx'});
      restored.state.settings.launch=current.settings.launch;restored.state.settings.orb=current.settings.orb;return migrateLive(restored.state);
    });changed();await processReminders(true);return store.snapshot();
  });
  handler('testNotification',()=>{if(!Notification.isSupported())return '当前系统不支持通知，请查看应用内提醒列表。';toast('YD · 测试提醒','这是一次测试，未创建任何待办。');return '已提交给 Windows 通知系统。若未看到，请检查系统通知设置与勿扰模式；这不代表你已收到。';});
}
if(!app.requestSingleInstanceLock())app.quit();
else{
  app.on('second-instance',()=>{
    if(!panel)return;
    try{store.snapshot();}catch(error){runtimeLog('error','再次启动时重新读取数据失败：'+errorMessage(error));}
    changed();showPanel();
  });
  app.on('window-all-closed',()=>{});
  app.on('before-quit',()=>{quitting=true;if(timer)clearInterval(timer);companion?.stop();globalShortcut.unregisterAll();});
  app.whenReady().then(async()=>{
    data=app.getPath('userData');attachments=path.join(data,'attachments');fs.mkdirSync(attachments,{recursive:true});
    configureLogging({file:path.join(data,'dayhub.log'),mirrorConsole:!app.isPackaged});
    runtimeLog('info',`启动 ${app.getVersion()} packaged=${app.isPackaged}`);
    const wasmBinary=Uint8Array.from(fs.readFileSync(path.join(app.getAppPath(),'node_modules','sql.js','dist','sql-wasm.wasm'))).buffer;
    const SQL=await initSqlJs({wasmBinary});
    store=new Store(data,bytes=>new SQL.Database(bytes) as unknown as DB);
    inboxService=new InboxService(store,new LocalRuleParser(),changed);
    await inboxService.recover();
    {const loaded=store.snapshot();runtimeLog('info',`数据源 ${store.file} · 课程=${loaded.courses.length} 待办=${loaded.tasks.length} 提醒=${loaded.reminders.length}`);}
    // liveVersion 之外，旧配置里可能还留着已删除的小猫桌宠（mode='pet'）或缺少
    // 夜间休息字段，先备份再迁移一次。
    if(store.state.settings.liveVersion!==5||store.state.settings.pet?.nightRest===undefined||(store.state.settings.pet?.mode as string|undefined)==='pet'){
      const dir=path.join(data,'backups');fs.mkdirSync(dir,{recursive:true});
      fs.writeFileSync(path.join(dir,`before-v0210-${Date.now()}.dayhub`),pack(store.snapshot(),attachments));
      await store.update(migrateLive);
    }
    // Custom companion assets ship with the app; the manifest is validated once
    // here so every window reads the same resolved frames.
    companionAssets=resolveCompanionAssets(__dirname);
    runtimeLog('info',`桌宠素材 ${companionAssets.reason}`);
    Menu.setApplicationMenu(null);
    const initial=companionGeometry(store.state.settings.pet?.mode??'custom','medium',companionAssets.aspect);
    const area=screen.getPrimaryDisplay().workArea,pos=clampPosition(store.state.settings.orb?.x??area.x+area.width-90,store.state.settings.orb?.y??area.y+area.height-160);
    orb=new BrowserWindow({...windowOptions(),width:initial.width,height:initial.height,thickFrame:false,hasShadow:false,roundedCorners:false,x:pos.x,y:pos.y,frame:false,transparent:true,backgroundColor:'#00000000',resizable:false,alwaysOnTop:true,skipTaskbar:true,show:false});
    panel=new BrowserWindow({...windowOptions(),width:1050,height:780,minWidth:750,minHeight:550,title:'YD · Your Day',icon:path.join(__dirname,'icon.png'),frame:false,show:false});
    lockWindow(orb);lockWindow(panel);
    orb.setTitle('YD · 桌宠');
    companion=new Companion(store,orb,panel,windowOptions(),path.join(__dirname,'index.html'),lockWindow,companionAssets);
    companion.setMenuActions({
      settings:()=>{showPanel();panel.webContents.send('dayhub:settings');},
      quit:confirmQuit,
      toggleVisible:togglePetWindow,
    });
    setupHandlers();
    panel.on('close',e=>{if(quitting)return;if(store.state.settings.trayResident===false){quitting=true;app.quit();return;}e.preventDefault();panel.hide();});
    orb.on('close',e=>{if(!quitting){e.preventDefault();orb.hide();}});
    await Promise.all([orb.loadFile(path.join(__dirname,'index.html'),{hash:'orb'}),panel.loadFile(path.join(__dirname,'index.html'))]);
    await companion.load();
    runtimeLog('info','主界面、桌宠与气泡页面已加载');
    const icon=nativeImage.createFromPath(path.join(__dirname,'tray.png'));
    tray=new Tray(icon);tray.setToolTip('YD · 本地运行');
    refreshTrayMenu(true);tray.on('double-click',showPanel);
    const reposition=()=>{void savePosition().catch(error=>logError(error,'保存桌宠位置失败'));};screen.on('display-removed',reposition);screen.on('display-metrics-changed',reposition);
    const resume=()=>{void processReminders(true).then(()=>companion?.pulse(true));};powerMonitor.on('resume',resume);powerMonitor.on('unlock-screen',resume);
    // 一键隐藏 / 显示桌宠。注册失败（被别的程序占用）时只是不显示提示，
    // 菜单与托盘里的入口仍然可用。
    let shortcutReady=false;
    try{shortcutReady=globalShortcut.register(companionToggleShortcut.accelerator,togglePetWindow);}
    catch(error){logError(error,'注册桌宠快捷键失败');}
    companion.setShortcut({label:companionToggleShortcut.label,ready:shortcutReady});
    runtimeLog(shortcutReady?'info':'warn',`桌宠显示/隐藏快捷键 ${companionToggleShortcut.label} ${shortcutReady?'已注册':'注册失败（可能被其它程序占用）'}`);
    const openedAtLogin=app.getLoginItemSettings().wasOpenedAtLogin;
    orb.showInactive();if(showPanelOnLaunch(openedAtLogin,store.state.settings.setup))showPanel();
    runtimeLog('info',`启动显示 主窗口=${panel.isVisible()} 开机自启=${openedAtLogin}`);
    if(store.recovered)dialog.showMessageBox(panel,{type:'warning',message:'已从上一份本地副本恢复',detail:'原数据库读取失败，损坏文件已保留。请核对最近的修改。'});
    await processReminders(true);await companion.pulse(true);timer=setInterval(()=>{void processReminders();tray.setToolTip(snapshot(store.state,Date.now()).people.map(p=>`${p.alias} · ${statusLabel(p)}`).join('\n'));refreshTrayMenu();},1000);
  }).catch(error=>{dialog.showErrorBox('YD 无法启动',errorMessage(error));app.quit();});
}
