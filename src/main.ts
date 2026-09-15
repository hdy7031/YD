import { InboxService } from './inbox-service.ts';
import { LocalRuleParser } from './parser.ts';
import { DesktopDelivery } from './delivery.ts';
import { app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme, ipcMain, screen, dialog, Notification, clipboard, powerMonitor, globalShortcut } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import initSqlJs from 'sql.js';
import { Companion } from './companion.ts';
import { resolveCompanionAssets } from './companion-assets.ts';
import { resolvePetInstance } from './pet-instance.ts';
import { activeProfiles } from './people.ts';
import { companionGeometry } from './companion-layout.ts';
import { companionToggleShortcut } from './companion-menu.ts';
import { migrateLive, petDefaults, snapshot, statusLabel } from './live.ts';
import { apply, tick, showPanelOnLaunch } from './core.ts';
import { Store } from './store.ts';
import type { DB } from './store.ts';
import { pack, unpack } from './backup.ts';
import { clampToArea, resolveDragStep, type DragAnchor } from './geometry.ts';
import { PANEL_ICON_FILE, TRAY_ICON_FILES, PRODUCT_VERSION } from './brand-assets.ts';
import { configureLogging, installStreamGuards, logError, logLine } from './logging.ts';
import { DOMAIN_VERSION, domainVersion, migrationSteps, runMigrations } from './migration.ts';
import type { Command, PersonId, SchedulePackage } from './types.ts';

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
let inboxService:InboxService;
const delivery=new DesktopDelivery(toast);
let quitting=false, orb:BrowserWindow, panel:BrowserWindow, tray:Tray, store:Store, attachments:string, data:string;
let busy=false, ocrBusy=false, lastTick=Date.now(), timer:ReturnType<typeof setInterval>, pointerTimer:ReturnType<typeof setInterval>|undefined;
// 拖动锚点同时记录窗口原点、渲染层指针与系统光标：真实拖动时以系统光标为准
// （多显示器与 125%/150% 缩放下不会越拖越偏），无光标移动的自动化场景退回
// 渲染层指针增量，两条路径都只改窗口位置，不碰任何 CSS 变换。
let dragAnchor:DragAnchor|undefined,dragActive=false;
const notifications=new Set<Notification>();
const windows=()=>[orb,panel,companion?.bubble,companion?.mini,companion?.tip,companion?.sheet].filter((w):w is BrowserWindow=>!!w&&!w.isDestroyed());
// 正式日志先写文件；控制台只在开发环境或控制台仍可用时作为镜像。
function runtimeLog(level:string,message:string){logLine(level,message);}
function changed(){
  companion?.reset();
  // 桌宠开关是设置的一部分：任何一次状态提交之后都按当前值对齐窗口可见性。
  applyPetVisibility();
  for(const w of windows())w.webContents.send('dayhub:changed');
}
function showPanel(){if(panel.isMinimized())panel.restore();panel.show();panel.focus();void syncPanelViewport('showPanel');}
function errorMessage(error:unknown){return error instanceof Error?error.message:String(error);}
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
// ---------------------------------------------------------------------------
// Bug 1 · 主窗口 viewport 不变量（Phase 5B1 P0）
//
// 症状：窗口尺寸正常，但内容只占左侧一部分、右侧露出窗口底色，文档 scrollbar
// 落在窗口中间 —— 也就是渲染层 viewport 停留在旧宽度，比窗口客户区窄。
//
// 取证（test-data/layout-probe.cjs，隔离 userData）：
//   1. 正常 resize：window 1701 / viewport 1700 / shell 1694（差 1px 是 frameless 取整）；
//   2. 最大化：window bounds 1722 / viewport 1707 / workArea 1707 —— BrowserWindow
//      bounds 与渲染层客户区本来就相差 15px（thickFrame 边框），所以"窗口尺寸正常"
//      不等于"内容宽度正确"，两者从来没有被任何代码核对过；
//   3. 跨窗口污染已排除：dockSize → Companion.setDockMeasure 只写 orb 的 setBounds，
//      主进程没有任何一处会把 Dock 的尺寸写进主窗口。
//
// 因此这里把不变量显式化：渲染层 CSS viewport 必须等于窗口客户区（除以缩放）。
// 每条几何路径（resize / maximize / restore / 显示设置变化 / 从托盘恢复）之后核对一次，
// 不一致时才强制重排：先让渲染层做一次样式 / 布局失效，必要时再用 1px 真实 resize
// 让 Chromium 重发 resize（最大化状态下 setSize 不会退出最大化，已实测）。
// ---------------------------------------------------------------------------
const PANEL_VIEWPORT_TOLERANCE=1;
let panelViewportBusy=false;
async function syncPanelViewport(reason:string){
  if(panelViewportBusy||!panel||panel.isDestroyed()||!panel.isVisible())return;
  panelViewportBusy=true;
  try{
    // 用 window.innerWidth / innerHeight：documentElement.clientWidth 会扣掉经典滚动条
    // 宽度，和窗口客户区本来就差 6px，拿它比较会误判成"viewport 落后"。
    const read=()=>panel.webContents.executeJavaScript('({w:window.innerWidth,h:window.innerHeight})',true) as Promise<{w:number;h:number}>;
    const expected=()=>{const area=panel.getContentBounds(),zoom=panel.webContents.getZoomFactor()||1;return {w:Math.round(area.width/zoom),h:Math.round(area.height/zoom)};};
    // 宽度是本次 Bug 的判据（严格 1px）；高度在 frameless 窗口上允许 4px 的取整差异。
    const agree=(got:{w:number;h:number}|null,want:{w:number;h:number})=>!!got&&Math.abs(got.w-want.w)<=PANEL_VIEWPORT_TOLERANCE&&Math.abs(got.h-want.h)<=4;
    let want=expected();
    let got=await read().catch(()=>null);
    if(!got||agree(got,want))return;
    runtimeLog('warn',`主窗口 viewport 与客户区不一致（${reason}）：renderer=${got.w}×${got.h} 期望=${want.w}×${want.h}，强制重排`);
    await panel.webContents.executeJavaScript('(()=>{const root=document.documentElement;root.classList.remove("yd-relayout");void root.offsetWidth;root.classList.add("yd-relayout");return true;})()',true).catch(()=>{});
    got=await read().catch(()=>null);want=expected();
    if(agree(got,want)){runtimeLog('info','主窗口 viewport 重排后已与客户区一致');return;}
    const [width,height]=panel.getSize();
    panel.setSize(width+1,height,false);panel.setSize(width,height,false);
    await delay(80);
    const fixed=await read().catch(()=>null);want=expected();
    runtimeLog(agree(fixed,want)?'info':'error',fixed?`主窗口 viewport 重排后=${fixed.w}×${fixed.h}（期望 ${want.w}×${want.h}）`:'主窗口 viewport 重排后无法读取渲染层宽度');
  }finally{panelViewportBusy=false;}
}
/**
 * 页面缩放锁：CSS 像素必须等于窗口客户区 DIP。缩放会让"窗口宽度"与"内容宽度"
 * 永远对不上，也是唯一能让两者合法分离的用户路径（Ctrl+滚轮 / Ctrl+加号）。
 */
function lockZoom(w:BrowserWindow){
  w.webContents.setVisualZoomLevelLimits(1,1).catch(()=>{});
  const reset=()=>{if(w.isDestroyed())return;if(w.webContents.getZoomFactor()!==1)w.webContents.setZoomFactor(1);};
  w.webContents.on('zoom-changed',reset);
  reset();
}
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
/**
 * 桌面桌宠是可选能力（Phase 5B1）：`settings.petEnabled === false` 时只隐藏桌宠窗口，
 * 不碰 Profile / Avatar / Routine / CurrentState —— YD Core 完全不依赖桌宠。
 * 这里从不创建或重建窗口，因此「开 → 关 → 开」不会 race 出第二个桌宠。
 */
function applyPetVisibility(){
  if(!orb||orb.isDestroyed())return;
  if(store.state.settings.petEnabled===false){
    companion?.reset();
    if(orb.isVisible())orb.hide();
    return;
  }
  if(!orb.isVisible()){orb.showInactive();assertDockTopmost();}
  refreshTrayMenu(true);
}
function togglePetWindow(){
  if(!orb||orb.isDestroyed())return;
  // 设置里关掉桌宠之后，托盘 / 快捷键 / 右键菜单都不能把它偷偷叫回来。
  if(store.state.settings.petEnabled===false){showPanel();panel.webContents.send('dayhub:settings');return;}
  if(orb.isVisible()){companion?.hideMenu();orb.hide();}
  else{orb.showInactive();assertDockTopmost();refreshTrayMenu(true);}
}
let trayMenuPaused:boolean|undefined;
let trayMenuPetEnabled:boolean|undefined;
// 托盘图标 = Asset 06 / 07（同一枚字标的深灰青 / 近白两版）。
// 主题只换图标、绝不重建 Tray：菜单、事件监听与句柄都保持不变。
let trayTheme:'light'|'dark'|undefined;
function trayImage(theme:'light'|'dark'){
  const files=TRAY_ICON_FILES[theme];
  const image=nativeImage.createFromPath(path.join(__dirname,files[0].file));
  for(const entry of files.slice(1))image.addRepresentation({scaleFactor:entry.scaleFactor,buffer:fs.readFileSync(path.join(__dirname,entry.file))});
  return image;
}
function applyTrayTheme(){
  if(!tray||tray.isDestroyed())return;
  const theme:'light'|'dark'=nativeTheme.shouldUseDarkColors?'dark':'light';
  if(theme===trayTheme)return;
  const previous=trayTheme;trayTheme=theme;
  tray.setImage(trayImage(theme));
  if(previous!==undefined)runtimeLog('info',`系统主题切换：托盘图标（${theme==='dark'?'深色任务栏 → 近白字标':'浅色任务栏 → 深灰青字标'}）`);
}
function refreshTrayMenu(force=false){
  const paused=(store.state.settings.pet?.pausedUntil??0)>Date.now();
  const petEnabled=store.state.settings.petEnabled!==false;
  if(!force&&paused===trayMenuPaused&&petEnabled===trayMenuPetEnabled)return;
  trayMenuPaused=paused;
  trayMenuPetEnabled=petEnabled;
  tray.setContextMenu(Menu.buildFromTemplate([
    store.state.settings.petEnabled===false
      ?{label:'桌宠已在设置中关闭',click:togglePetWindow}
      :{label:'显示／隐藏桌宠',click:togglePetWindow},
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
function clampPosition(x:number,y:number,snap=false,size?:{width:number;height:number}){
  const {workArea:a}=screen.getDisplayNearestPoint({x:Math.round(x+38),y:Math.round(y+38)});
  // 启动时窗口还没创建，必须用即将使用的真实画布尺寸回收；
  // 否则会把一个本来合法的保存位置按占位尺寸（300×128）挤到屏幕另一侧。
  const [width,height]=size?[size.width,size.height]:orb&&!orb.isDestroyed()?orb.getSize():[300,128];
  return clampToArea(x,y,width,height,a,snap);
}
function moveOrb(x:number,y:number,width?:number,height?:number){
  const [currentWidth,currentHeight]=orb.getSize();
  const targetWidth=width??currentWidth,targetHeight=height??currentHeight;
  // 尺寸没变时只移动位置：setBounds 会让 Windows 把透明窗口重新对齐到物理像素，
  // 拖动过程中反复调用就会出现 1px 的尺寸抖动与贴图残影。
  if(targetWidth===currentWidth&&targetHeight===currentHeight){orb.setPosition(Math.round(x),Math.round(y));assertDockTopmost();return;}
  orb.setBounds({x:Math.round(x),y:Math.round(y),width:targetWidth,height:targetHeight},false);
  assertDockTopmost();
}
/**
 * Dock 必须始终在普通桌面窗口之上。alwaysOnTop 是窗口的扩展样式位，
 * Windows 会在 hide/show、setIgnoreMouseEvents、DPI 重新对齐等路径后丢掉它，
 * 而它以前只在创建时设置过一次。这里在每条状态切换路径后重新断言：
 * 只在真的丢了的时候调用一次 setAlwaysOnTop，不刷新 z-order、不抢焦点。
 */
function assertDockTopmost(){
  if(!orb||orb.isDestroyed()||!orb.isVisible()||orb.isAlwaysOnTop())return;
  // 同样先归零再置顶：Electron 只在 JS 侧标志变化时才写原生 z-order，
  // 而透明 / 分层 / 点击穿透会绕过它把窗口打回普通层。窗口此刻已经不在置顶层，
  // 所以归零不会造成可见闪烁，只是把原生样式真正写回去。
  orb.setAlwaysOnTop(false);
  orb.setAlwaysOnTop(true);
}
function canonicalOrbSize(){
  const p={...petDefaults,...store.state.settings.pet};
  const {width,height}=companion?.geometry(p)??{width:orb.getBounds().width,height:orb.getBounds().height};
  return {width,height};
}
// 位置落盘时连窗口尺寸一起记下：Dock 宽度随内容变化，还原时要用"牌面右下角"
// 这个视觉锚点（见 types.ts 的说明），否则状态词变长会让 Dock 横向漂。
async function savePosition(){const [x,y]=orb.getPosition(),size=canonicalOrbSize(),pos=clampPosition(x,y,true,size);moveOrb(pos.x,pos.y,size.width,size.height);if(store.state.settings.pet?.rememberPosition===false)return;await store.update(s=>{s.settings.orb={...pos,w:size.width,h:size.height};return s;});}
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
  // 渲染层第一次（也是每次重新）要求状态投射，说明 Dock 已经在屏幕上：顺手确认一次置顶。
  handler('live',()=>{assertDockTopmost();return companion?.get()??snapshot(store.state,Date.now());});
  // Dock 的宽度由渲染层按真实文字宽度测量后回报（内容完整优先，不默认省略）。
  // 主进程只校验范围并按契约改窗口尺寸，几何规则仍然只有 companion-layout 一份。
  handler('dockSize',(measure:unknown)=>{
    if(!measure||typeof measure!=='object')throw new Error('Dock 尺寸无效');
    const {collapsed,hover}=measure as {collapsed?:unknown;hover?:unknown};
    if(typeof collapsed!=='number'||typeof hover!=='number'||!Number.isFinite(collapsed)||!Number.isFinite(hover)||collapsed<0||hover<0||collapsed>4000||hover>4000)throw new Error('Dock 尺寸无效');
    companion?.setDockMeasure({collapsed,hover});
  });
  handler('companionAssets',(packId?:unknown)=>{
    if(packId!==undefined&&typeof packId!=='string')throw new Error('Avatar Pack 编号无效');
    return resolveCompanionAssets(__dirname,packId as string|undefined);
  });
  // Only the desktop-pet renderer may acknowledge decoded Avatar resources.
  // Companion revalidates the current PetInstance, so a late B acknowledgement
  // cannot resize the window after the selection has already moved on to C.
  ipcMain.removeHandler('dayhub:avatarVisualReady');
  ipcMain.handle('dayhub:avatarVisualReady',(event,ready:unknown)=>{
    if(!orb||orb.isDestroyed()||event.sender!==orb.webContents||event.senderFrame!==event.sender.mainFrame)return false;
    if(!ready||typeof ready!=='object')throw new Error('Avatar 资源确认无效');
    return companion?.avatarVisualReady(ready as import('./avatar-runtime.ts').AvatarVisualReady)??false;
  });
  handler('pointer',(interactive:boolean)=>{if(typeof interactive!=='boolean')throw new Error('参数无效');});
  // hover 收起的兜底真相来源：点击穿透窗口在变成 WS_EX_TRANSPARENT 之后可能不再
  // 收到 pointerleave，因此渲染层在展开期间会用系统光标位置做一次兜底确认。
  // 这里只读光标与窗口 bounds，不改变任何状态、不抢焦点。
  handler('cursorInside',()=>{
    if(!orb||orb.isDestroyed())return false;
    const b=orb.getBounds(),c=screen.getCursorScreenPoint();
    return c.x>=b.x&&c.x<b.x+b.width&&c.y>=b.y&&c.y<b.y+b.height;
  });
  // Restrict click-through control to the sending companion window.
  ipcMain.removeHandler('dayhub:pointer');
  // 退出过程中窗口可能已经被销毁：这里先排除 destroyed 的窗口，避免把
  // 正常的关闭流程变成一条主进程错误日志。
  // 鼠标穿透状态只在真的变化时才写一次：以前每次 mousemove 都调用
  // setIgnoreMouseEvents，Windows 会跟着重新合成透明窗口，hover / pointerenter
  // 就在这条链路上被丢掉（Dock 与桌宠 status rail 的 hover 失效根因）。
  const clickThrough=new WeakMap<Electron.BrowserWindow,boolean>();
  ipcMain.handle('dayhub:pointer',(event,interactive:unknown)=>{
    const w=[orb,companion?.bubble].find(candidate=>candidate&&!candidate.isDestroyed()&&candidate.webContents===event.sender);
    if(!w||event.senderFrame!==event.sender.mainFrame||typeof interactive!=='boolean')throw new Error('不允许的窗口操作');
    if(clickThrough.get(w)===!interactive)return;
    clickThrough.set(w,!interactive);
    w.setIgnoreMouseEvents(!interactive,{forward:true});
    // 点击穿透会改写窗口的扩展样式位，改完立刻确认 Dock 仍然置顶。
    assertDockTopmost();
  });
  // ---------------------------------------------------------------------------
  // Phase 5B1 P0 · 命中区（hit region）驱动的点击穿透
  //
  // 实测（test-data/hover-probe.cjs）：`setIgnoreMouseEvents(true,{forward:true})` 在这个
  // Electron / Windows 组合下**不会**把真实鼠标移动交给渲染层 —— 窗口点击穿透期间
  // 渲染层收到 0 个 mousemove / pointerenter；一旦 setIgnoreMouseEvents(false)，
  // 事件立刻恢复（move/enter/over 全部出现）。于是：
  //   * 旧实现把整块透明画布当交互区，任何让它"接收鼠标"的路径都会挡住桌面点击（Bug 3）；
  //   * 而常驻点击穿透又让依赖 DOM 指针事件的 hover 完全失效（Bug 2）。
  //
  // 所以命中判定必须挪到主进程：渲染层只上报"人物本体 / 状态小框 / 状态牌面 / 气泡"
  // 的真实矩形，主进程按**真实系统光标位置**决定此刻是否接收鼠标，并把结果推回渲染层
  // （渲染层据此展开 / 收起 hover，因为离开命中区时它收不到 pointerleave）。
  // ---------------------------------------------------------------------------
  const HIT_PADDING=4;
  interface HitRect{x:number;y:number;w:number;h:number;hover:boolean}
  const hitRegions=new WeakMap<Electron.BrowserWindow,HitRect[]>();
  const pointerInside=new WeakMap<Electron.BrowserWindow,boolean>();
  const pointerHover=new WeakMap<Electron.BrowserWindow,boolean>();
  const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value);
  const sanitizeHitRegions=(value:unknown):HitRect[]=>{
    if(!Array.isArray(value))throw new Error('命中区无效');
    if(value.length>8)throw new Error('命中区过多');
    return value.map(entry=>{
      const item=entry as {x?:unknown;y?:unknown;w?:unknown;h?:unknown;hover?:unknown};
      if(!item||!finite(item.x)||!finite(item.y)||!finite(item.w)||!finite(item.h))throw new Error('命中区无效');
      const rect={x:Math.round(item.x as number),y:Math.round(item.y as number),w:Math.round(item.w as number),h:Math.round(item.h as number),hover:item.hover===true};
      if(rect.w<0||rect.h<0||rect.w>4000||rect.h>4000)throw new Error('命中区无效');
      return rect;
    });
  };
  ipcMain.removeHandler('dayhub:hitRegions');
  ipcMain.handle('dayhub:hitRegions',(event,regions:unknown)=>{
    const w=[orb,companion?.bubble].find(candidate=>candidate&&!candidate.isDestroyed()&&candidate.webContents===event.sender);
    if(!w||event.senderFrame!==event.sender.mainFrame)throw new Error('不允许的窗口操作');
    hitRegions.set(w,sanitizeHitRegions(regions));
  });
  // 拖动期间不动穿透状态：拖动中改鼠标穿透会重新合成透明窗口，丢 pointerup 并留下残影。
  const petDragging=()=>Boolean(dragAnchor);
  const applyPointerState=(w:Electron.BrowserWindow,inside:boolean,hover:boolean)=>{
    const changed=pointerInside.get(w)!==inside;
    const hoverChanged=pointerHover.get(w)!==hover;
    if(!changed&&!hoverChanged)return;
    pointerInside.set(w,inside);pointerHover.set(w,hover);
    if(changed){
      clickThrough.set(w,!inside);
      w.setIgnoreMouseEvents(!inside,{forward:true});
      if(w===orb)assertDockTopmost();
    }
    // 只在真的切换时记一行：命中区 / 穿透状态是桌面交互问题最需要的第一手证据。
    runtimeLog('info',`命中区 ${w===orb?'桌宠':'气泡'} ${inside?'进入':'离开'}（接收鼠标=${inside}）`);
    if(!w.isDestroyed())w.webContents.send('dayhub:pointerState',{inside,hover});
  };
  pointerTimer=setInterval(()=>{
    if(quitting)return;
    const cursor=screen.getCursorScreenPoint();
    for(const w of [orb,companion?.bubble]){
      if(!w||w.isDestroyed())continue;
      const rects=hitRegions.get(w);
      if(!rects||!rects.length)continue;
      if(!w.isVisible()){applyPointerState(w,false,false);continue;}
      // 拖动进行中：保持当前状态直到拖动结束（见 petDragging 的说明）。
      if(w===orb&&petDragging())continue;
      const bounds=w.getBounds();
      const x=cursor.x-bounds.x,y=cursor.y-bounds.y;
      let inside=false,hover=false;
      for(const rect of rects){
        if(x<rect.x-HIT_PADDING||x>rect.x+rect.w+HIT_PADDING||y<rect.y-HIT_PADDING||y>rect.y+rect.h+HIT_PADDING)continue;
        inside=true;
        if(rect.hover)hover=true;
      }
      applyPointerState(w,inside,hover);
    }
  },60);
  handler('bubble',(action:string)=>{if(!['hold','release','close'].includes(action))throw new Error('无效操作');companion?.action(action);});
  // 悬停区域可以是任意存在的档案 id（单人工作区只有一个人），由 Companion 自己校验存在性。
  handler('presence',(action:string,person?:PersonId)=>{if(action!=='enter'&&action!=='leave')throw new Error('无效状态操作');companion?.presence(action,person);});
  handler('window',(action:string)=>{
    if(action==='minimize')panel.minimize();else if(action==='maximize'){if(panel.isMaximized())panel.unmaximize();else panel.maximize();}
    else if(action==='close')panel.hide();else if(action==='open')showPanel();else if(action==='mini')companion?.toggleMini();
    else if(action==='detail-close')companion?.collapseDetail();
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
  // 版本来自构建时注入的产品版本（scripts/build.mjs 的 define），
  // 开发态与打包态一致；缺失时回退到 Electron 的 app.getVersion()。
  handler('version',()=>PRODUCT_VERSION||app.getVersion());
  handler('beginDrag',(pointerX:number,pointerY:number)=>{
    if(!Number.isFinite(pointerX)||!Number.isFinite(pointerY))throw new Error('拖动参数无效');
    const {x:windowX,y:windowY}=orb.getBounds(),{width,height}=canonicalOrbSize(),cursor=screen.getCursorScreenPoint();
    dragAnchor={windowX,windowY,pointerX,pointerY,cursorX:cursor.x,cursorY:cursor.y,width,height,cursorMode:false};
    dragActive=false;
    // pointer down 只保存初始光标与窗口 bounds；超过阈值后的第一帧才进入 drag。
    // 这样 click / double click 不会触发透明窗口重排或任何几何清理。
  });
  handler('drag',(pointerX:number,pointerY:number)=>{
    if(!dragAnchor||!Number.isFinite(pointerX)||!Number.isFinite(pointerY))throw new Error('拖动参数无效');
    const cursor=screen.getCursorScreenPoint();
    if(!dragActive){
      dragActive=true;
      const before=orb.getBounds();
      companion?.dragStart();
      const after=orb.getBounds();
      // 拖动开始时收起详情会把窗口从"详情画布"还原成"状态牌画布"（牌面在屏幕上
      // 并没有移动，但窗口原点变了）。这里按新的原点重新对齐锚点，避免第一帧跳一下。
      if(after.x!==before.x||after.y!==before.y||after.width!==before.width||after.height!==before.height){
        dragAnchor={...dragAnchor,windowX:after.x,windowY:after.y,cursorX:cursor.x,cursorY:cursor.y,pointerX,pointerY,cursorMode:false};
      }
    }
    const step=resolveDragStep(dragAnchor,{x:pointerX,y:pointerY},cursor);
    if(step.adoptedCursor){
      // 改用系统光标时按当前位置重新对齐锚点，避免切换瞬间跳一下。
      const now=orb.getBounds();
      dragAnchor={...dragAnchor,cursorMode:true,windowX:now.x,windowY:now.y,cursorX:cursor.x,cursorY:cursor.y,pointerX,pointerY};
    }
    const pos=clampPosition(dragAnchor.windowX+step.delta.x,dragAnchor.windowY+step.delta.y);
    // 拖动只移动位置。把 getBounds() 经过 DPI 物理像素取整后的宽高再写回
    // setBounds，会在每次拖动后把透明 Dock 累积放大 1–2px。
    // Always write the canonical DIP size together with the new position. On
    // Windows fractional DPI, setPosition() alone can preserve a re-quantized
    // native width and then grow the transparent window again on the next move.
    moveOrb(pos.x,pos.y,dragAnchor.width,dragAnchor.height);
  });
  handler('endDrag',async()=>{try{if(dragActive){companion?.dragEnd();await savePosition();}}finally{dragAnchor=undefined;dragActive=false;}});
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
  app.on('before-quit',()=>{quitting=true;if(timer)clearInterval(timer);if(pointerTimer)clearInterval(pointerTimer);companion?.stop();globalShortcut.unregisterAll();});
  app.whenReady().then(async()=>{
    data=app.getPath('userData');attachments=path.join(data,'attachments');fs.mkdirSync(attachments,{recursive:true});
    configureLogging({file:path.join(data,'dayhub.log'),mirrorConsole:!app.isPackaged});
    runtimeLog('info',`启动 ${PRODUCT_VERSION||app.getVersion()} packaged=${app.isPackaged}`);
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
    // v0.3 领域迁移闸门：任何 schema / 语义迁移都先写 before-v030 备份，
    // 失败时还原迁移前的数据库字节（见 src/migration.ts 的回滚模型说明）。
    // Phase 0 没有注册任何迁移步骤，所以这里不写盘、不改变任何行为。
    {
      const run=await runMigrations(store,{target:DOMAIN_VERSION,version:domainVersion,steps:migrationSteps,backupDirectory:path.join(data,'backups'),attachments,log:message=>runtimeLog('info',message)});
      if(run.migrated)runtimeLog('info',`领域迁移 v${run.from}→v${run.to} 完成 · ${run.steps.join('、')} · 备份 ${run.backup?.dayhub??''}`);
    }
    // Validate and log the current subject's Pack before the windows appear.
    // Renderer requests later use LiveSnapshot.petInstance.avatarPackId.
    const initialPet=resolvePetInstance(store.state);
    const companionAssets=resolveCompanionAssets(__dirname,initialPet.avatarPackId);
    runtimeLog('info',`桌宠素材 ${companionAssets.reason}`);
    Menu.setApplicationMenu(null);
    // 首帧画布按**当前活跃人物**算：Solo 下保留的 companion 不影响 Dock / 桌宠尺寸。
    const initial=companionGeometry(store.state.settings.pet?.mode??'custom','medium',companionAssets.aspect,activeProfiles(store.state).length,false);
    // 首次启动（没有保存位置）落在右下角：用当前模式的真实画布尺寸留 24px 边距，
    // 这样 Dock（很扁）与桌宠（较高）都不会把窗口放在工作区之外。
    // 位置还原：新数据带窗口尺寸 → 按牌面右下角锚点换算成当前尺寸下的左上角，
    // 内容长度变化不会让 Dock 横向漂；老数据没有尺寸 → 维持原来的左上角语义。
    const area=screen.getPrimaryDisplay().workArea,saved=store.state.settings.orb;
    const anchored=saved&&Number.isFinite(saved.w)&&Number.isFinite(saved.h)
      ?{x:saved.x+(saved.w as number)-initial.width,y:saved.y+(saved.h as number)-initial.height}
      :saved;
    const pos=clampPosition(anchored?.x??area.x+area.width-initial.width-24,anchored?.y??area.y+area.height-initial.height-24,false,initial);
    orb=new BrowserWindow({...windowOptions(),width:initial.width,height:initial.height,thickFrame:false,hasShadow:false,roundedCorners:false,x:pos.x,y:pos.y,frame:false,transparent:true,backgroundColor:'#00000000',resizable:false,alwaysOnTop:true,skipTaskbar:true,show:false});
    panel=new BrowserWindow({...windowOptions(),width:1050,height:780,minWidth:750,minHeight:550,title:'YD · Your Day',icon:path.join(__dirname,PANEL_ICON_FILE),frame:false,show:false});
    lockWindow(orb);lockWindow(panel);
    // Bug 1：主窗口 viewport 不变量 + 页面缩放锁（两者都必须成立，否则内容宽度会
    // 与窗口客户区分离）。
    lockZoom(panel);lockZoom(orb);
    for(const event of ['resize','maximize','unmaximize','restore','show'] as const)panel.on(event as 'resize',()=>void syncPanelViewport(`panel.${event}`));
    panel.webContents.on('did-finish-load',()=>void syncPanelViewport('panel.did-finish-load'));
    orb.setTitle('YD · 桌宠');
    companion=new Companion(store,orb,panel,windowOptions(),path.join(__dirname,'index.html'),lockWindow);
    companion.setMenuActions({
      settings:()=>{showPanel();panel.webContents.send('dayhub:settings');},
      // 临时状态的入口在桌宠菜单里，但对话框在主窗口：先拉起主窗口再投递事件。
      status:()=>{showPanel();panel.webContents.send('dayhub:status');},
      quit:confirmQuit,
      toggleVisible:togglePetWindow,
    });
    setupHandlers();
    panel.on('close',e=>{if(quitting)return;if(store.state.settings.trayResident===false){quitting=true;app.quit();return;}e.preventDefault();panel.hide();});
    orb.on('close',e=>{if(!quitting){e.preventDefault();orb.hide();}});
    // 首帧绘制完成 = 窗口真正出现在桌面上：这时再断言一次置顶，
    // 避免"创建时设置过、显示之后被原生样式改动打回普通层"的启动竞态。
    orb.on('ready-to-show',()=>assertDockTopmost());
    await Promise.all([orb.loadFile(path.join(__dirname,'index.html'),{hash:'orb'}),panel.loadFile(path.join(__dirname,'index.html'))]);
    // 渲染层加载 index.html 时会把窗口标题改写成文档标题（与主窗口同名）。
    // Dock 是"被浏览器压到下层"这类线上问题的第一个排查对象，必须能按标题认出来，
    // 因此在加载完成后重新设置一次，和主窗口区分开。
    orb.setTitle('YD · 状态 Dock');
    await companion.load();
    runtimeLog('info','主界面、桌宠与气泡页面已加载');
    // 托盘图标是独立资源（Asset 06 / 07 字标），不继承 app icon：
    // 首次启动就按当前系统主题选正确的一版，之后跟随 nativeTheme 变化更新。
    // 来源 brand/exports/tray/，见 docs/brand-assets.md。
    trayTheme=nativeTheme.shouldUseDarkColors?'dark':'light';
    tray=new Tray(trayImage(trayTheme));tray.setToolTip('YD · 本地运行');
    nativeTheme.on('updated',applyTrayTheme);
    refreshTrayMenu(true);tray.on('double-click',showPanel);
    const reposition=()=>{void savePosition().catch(error=>logError(error,'保存桌宠位置失败'));};screen.on('display-removed',reposition);screen.on('display-metrics-changed',reposition);
    // 显示设置 / DPI 变化是"渲染层 viewport 落后于窗口"的另一条真实路径（Bug 1）。
    screen.on('display-metrics-changed',()=>void syncPanelViewport('display-metrics-changed'));
    const resume=()=>{void processReminders(true).then(()=>companion?.pulse(true));};powerMonitor.on('resume',resume);powerMonitor.on('unlock-screen',resume);
    // 一键隐藏 / 显示桌宠。注册失败（被别的程序占用）时只是不显示提示，
    // 菜单与托盘里的入口仍然可用。
    let shortcutReady=false;
    try{shortcutReady=globalShortcut.register(companionToggleShortcut.accelerator,togglePetWindow);}
    catch(error){logError(error,'注册桌宠快捷键失败');}
    companion.setShortcut({label:companionToggleShortcut.label,ready:shortcutReady});
    runtimeLog(shortcutReady?'info':'warn',`桌宠显示/隐藏快捷键 ${companionToggleShortcut.label} ${shortcutReady?'已注册':'注册失败（可能被其它程序占用）'}`);
    const openedAtLogin=app.getLoginItemSettings().wasOpenedAtLogin;
    // 桌宠是否出现在桌面上由 settings.petEnabled 决定（fresh install 默认关闭）。
    applyPetVisibility();
    if(showPanelOnLaunch(openedAtLogin,store.state.settings.setup))showPanel();
    void syncPanelViewport('startup');
    runtimeLog('info',`启动显示 主窗口=${panel.isVisible()} 开机自启=${openedAtLogin}`);
    if(store.recovered)dialog.showMessageBox(panel,{type:'warning',message:'已从上一份本地副本恢复',detail:'原数据库读取失败，损坏文件已保留。请核对最近的修改。'});
    await processReminders(true);await companion.pulse(true);timer=setInterval(()=>{void processReminders();tray.setToolTip(snapshot(store.state,Date.now()).people.map(p=>`${p.alias} · ${statusLabel(p)}`).join('\n'));refreshTrayMenu();},1000);
  }).catch(error=>{dialog.showErrorBox('YD 无法启动',errorMessage(error));app.quit();});
}
