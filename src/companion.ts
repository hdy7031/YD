import { pendingReminders } from './selectors.ts';
import { BrowserWindow, screen } from 'electron';
import { snapshot, bubbleEvents, petDefaults, presenceStateFor, statusLabel, type DockDetailPlacement, type LiveSnapshot, type PresenceState } from './live.ts';
import { CompanionTimeline } from './companion-display.ts';
import { buildCompanionMenu, companionMenuHeight, companionMenuMetrics, companionToggleShortcut } from './companion-menu.ts';
import { companionDock, companionGeometry, detailGeometry, dockDetail, dockDetailFrame, dockSurfaceMetrics } from './companion-layout.ts';
import { DEFAULT_AVATAR_PACK_ID, resolveAvatarPack } from './avatar.ts';
import type { AvatarVisualReady } from './avatar-runtime.ts';
import { resolvePetInstance } from './pet-instance.ts';
import { logError } from './logging.ts';
import type { Store } from './store.ts';
import type { PersonId } from './types.ts';

export class Companion {
  private closing=false; private last=Date.now(); private monotonic=performance.now(); private pulseTimer?:ReturnType<typeof setInterval>; private busy=false;
  private active?:{id:string;text:string};private queue:{id:string;text:string}[]=[];private expires=0;private remaining=0;private held=false;
  private hoverTip?:{person:PersonId;text:string;state:PresenceState;side:number};private dragging=false;private pendingResize=false;private applied='';
  // 启动后第一次"窗口已经在屏幕上"的状态投射：补一次置顶断言（一次性，不是轮询）。
  private topmostAsserted=false;
  // Dock 模式（'orb'）下详情是**同一个** floating 窗口的第三种画布状态，而不是第二个
  // BrowserWindow：这样详情天然继承 Dock 的 topmost 语义，不会再被浏览器盖住。
  private dockDetail=false;private dockDetailFrame?:DockDetailPlacement;
  private timeline=new CompanionTimeline();
  // Geometry follows only a renderer-confirmed visual.  The requested identity
  // may move ahead while its assets decode, in which case the old Pack remains
  // both visible and sized until avatarVisualReady accepts the transaction.
  private activeAvatar:{requestedPackId:string;resolvedPackId:string;version:string};
  private pendingAvatar?:{requestedPackId:string;resolvedPackId:string;version:string};
  readonly bubble:BrowserWindow;readonly mini:BrowserWindow;readonly tip:BrowserWindow;readonly sheet:BrowserWindow;
  private shortcut={label:companionToggleShortcut.label,ready:false};
  private actions:{settings:()=>void;status:()=>void;quit:()=>void;toggleVisible:()=>void}={settings:()=>{},status:()=>{},quit:()=>{},toggleVisible:()=>{}};
  constructor(private store:Store,readonly orb:BrowserWindow,private panel:BrowserWindow,options:Electron.BrowserWindowConstructorOptions,private file:string,lock:(w:BrowserWindow)=>void){
    this.activeAvatar=this.avatarIdentity();
    // Windows 会给"透明窗口"按窗口矩形画一圈原生 DWM 阴影：透明窗口 + CSS 阴影
    // 就会叠成明显的黑框（详情面板与提醒气泡都属于这一层）。这里统一关掉原生阴影，
    // 阴影只由 renderer 的 CSS 在窗口内绘制。
    this.bubble=new BrowserWindow({...options,width:330,height:180,thickFrame:false,frame:false,transparent:true,backgroundColor:'#00000000',resizable:false,alwaysOnTop:true,skipTaskbar:true,show:false,focusable:false,hasShadow:false,roundedCorners:false});
    const soloMini=this.store.state.profiles.length<=1;
    // 详情浮层是 Dock 的 owner window（parent: orb）：它永远跟着 Dock 的 z-order，
    // 不会变成第二个无主透明窗口去和桌面上的浏览器抢层级。
    const detail=detailGeometry(soloMini?1:2);
    this.mini=new BrowserWindow({...options,parent:this.orb,width:detail.width,height:detail.height,thickFrame:false,frame:false,transparent:true,backgroundColor:'#00000000',resizable:false,alwaysOnTop:true,skipTaskbar:true,show:false,hasShadow:false,roundedCorners:false});
    this.tip=new BrowserWindow({...options,width:150,height:32,thickFrame:false,frame:false,transparent:true,backgroundColor:'#00000000',resizable:false,alwaysOnTop:true,skipTaskbar:true,show:false,focusable:false,hasShadow:false,roundedCorners:false});
    // 右键菜单是自绘窗口：原生菜单无法沿用 YD 的字体、间距与品牌层级。
    // 它需要真正的焦点才能“点外面自动收起”，所以不加入点击穿透名单。
    this.sheet=new BrowserWindow({...options,width:companionMenuMetrics.width,height:220,thickFrame:false,frame:false,transparent:true,backgroundColor:'#00000000',resizable:false,alwaysOnTop:true,skipTaskbar:true,show:false,hasShadow:false,roundedCorners:false});
    this.bubble.setTitle('YD · 提醒气泡');this.mini.setTitle('YD · 当前状态');this.tip.setTitle('YD · 状态');this.sheet.setTitle('YD · 桌宠菜单');
    lock(this.bubble);lock(this.mini);lock(this.tip);lock(this.sheet);
    this.mini.on('blur',()=>this.mini.hide());
    this.mini.on('close',e=>{if(!this.closing){e.preventDefault();this.mini.hide();}});
    // 详情浮层的可见性就是 Dock 的 collapsed / detail 状态来源，因此每一条隐藏路径
    // （blur、Dock 收起、外部代码、切换到主窗口）都必须广播一次，渲染层才不会
    // 永远停在 detail 上。
    this.mini.on('hide',()=>this.broadcast());
    // 隐藏 / 失去焦点都必须把详情收干净：Dock 重新出现时窗口必须是状态牌画布，
    // 而不是一个还停留在 detail 尺寸的画布。
    this.orb.on('hide',()=>{this.topmostAsserted=false;this.collapseDetail();this.bubble.hide();this.mini.hide();this.tip.hide();});
    // 点击外部 = 窗口失去焦点：收起详情，但不把焦点抢回来（见 §13）。
    this.orb.on('blur',()=>{this.collapseDetail();this.clearPresence();});
    // Windows 上窗口的 z-order 样式位会被 hide/show、setIgnoreMouseEvents 等路径改写，
    // 而 alwaysOnTop 只在创建时设置过一次。每次窗口重新出现（以及移动 / 缩放之后）
    // 都重新断言一遍，避免 Dock 偶尔被普通窗口盖住。
    this.orb.on('show',()=>this.ensureTopmost());
    // 桌宠移动或收起时，右键菜单不能再悬在原处。
    this.orb.on('move',()=>{this.hideMenu();this.position();});
    this.orb.on('hide',()=>this.hideMenu());
    this.sheet.on('blur',()=>this.hideMenu());
    this.sheet.on('close',e=>{if(!this.closing){e.preventDefault();this.sheet.hide();}});
    this.panel.on('show',()=>void this.pulse());
    for(const w of [this.orb,this.bubble,this.tip])w.setIgnoreMouseEvents(true,{forward:true});
  }
  private avatarIdentity(){
    const requestedPackId=resolvePetInstance(this.store.state).avatarPackId;
    const pack=resolveAvatarPack(requestedPackId);
    return {requestedPackId,resolvedPackId:pack.id,version:pack.version};
  }
  private sameAvatar(a:{requestedPackId:string;resolvedPackId:string;version:string},b:{requestedPackId:string;resolvedPackId:string;version:string}){
    return a.requestedPackId===b.requestedPackId&&a.resolvedPackId===b.resolvedPackId&&a.version===b.version;
  }
  async load(){await Promise.all([this.bubble.loadFile(this.file,{hash:'bubble'}),this.mini.loadFile(this.file,{hash:'mini'}),this.tip.loadFile(this.file,{hash:'tip'}),this.sheet.loadFile(this.file,{hash:'menu'})]);this.resize();await this.pulse(true);this.pulseTimer=setInterval(()=>void this.pulse(),1000);}
  stop(){this.closing=true;if(this.pulseTimer)clearInterval(this.pulseTimer);}
  get():LiveSnapshot{
    // Keep the projection self-consistent: the display state must never lag the
    // pending reminder count by one tick.
    const now=Date.now();
    this.timeline.sync(pendingReminders(this.store.state).length,now);
    // 姿态由统一状态引擎在 snapshot() 内计算；这里只传提醒相关的表现层状态。
    return {...snapshot(this.store.state,now,this.timeline.state()),detail:this.detailOpen(),...(this.dockDetailFrame?{detailFrame:this.dockDetailFrame}:{}),bubble:this.active?{...this.active,below:this.bubble.getBounds().y>this.orb.getBounds().y}:undefined,hoverTip:this.hoverTip};
  }
  broadcast(){
    // 悬停提示只描述仍然存在的档案：档案消失（例如以后移除同行者）时安静收起，
    // 绝不保留或显示一个不存在的人。
    if(this.hoverTip){const status=this.get().people.find(p=>p.person===this.hoverTip!.person);if(status)this.hoverTip={person:status.person,text:`${status.alias} · ${statusLabel(status)}`,state:presenceStateFor(status),side:this.hoverTip.side};else this.hoverTip=undefined;}
    const live=this.get();for(const w of [this.orb,this.panel,this.bubble,this.mini,this.tip])if(!w.isDestroyed())w.webContents.send('dayhub:live',live);
    this.assertTopmostOnce();
  }
  /**
   * 窗口真正出现在屏幕上之后的第一次状态投射：断言一次置顶。
   * 一次性（不是 setInterval 轮询）——透明 / 分层 / 点击穿透这些原生样式改动可能刚好
   * 落在"显示之后"，而 Electron 只会为 JS 侧标志的变化写原生 z-order。
   */
  private assertTopmostOnce(){
    if(this.topmostAsserted||this.orb.isDestroyed()||!this.orb.isVisible())return;
    this.topmostAsserted=true;
    this.ensureTopmost();
  }
  geometry(p:{mode:string;size:'small'|'medium'|'large'}){
    // One fixed rectangle per mode and size. Never derived from the current
    // frame, the business state or the character bounding box.
    const mode=p.mode==='orb'?'orb':'custom';
    const pack=resolveAvatarPack(this.activeAvatar.resolvedPackId);
    const people=this.store.state.profiles.length;
    // Hover/pointer state must never participate in outer-window geometry.
    const {width,height}=companionGeometry(mode,p.size,pack.canvas.width/pack.canvas.height,people,false);
    return {width,height};
  }
  /**
   * 常驻窗口（Dock / 详情浮层 / 气泡 / 提示）都必须在普通桌面窗口之上。
   * 这里只重新断言一次已经丢失 / 从未设置的窗口，不刷新 z-order、不抢焦点，
   * 因此既不会打断用户输入，也不需要 setInterval 强行 bringToFront。
   */
  private ensureTopmost(){
    for(const w of [this.orb,this.mini,this.bubble,this.tip]){
      if(w.isDestroyed()||!w.isVisible())continue;
      if(w.isAlwaysOnTop())continue;
      // 先归零再置顶，强制真正写一次原生 z-order：Electron 在"JS 侧仍记着 true、
      // 原生层级已被透明 / 分层 / 点击穿透这些样式改动打回普通层"时会直接跳过
      // setAlwaysOnTop(true)，只在 JS 侧留下一个说谎的 true。归零只在窗口**已经**
      // 不在置顶层时发生，所以这一步不会带来可见的闪烁。
      w.setAlwaysOnTop(false);
      w.setAlwaysOnTop(true);
    }
  }
  /**
   * 一次性重新断言 Dock 的置顶状态（不是轮询、不刷新 z-order、不抢焦点）。
   * 透明 + 分层 + 点击穿透这些原生样式改动偶尔会把窗口的 z-order 打回普通层，
   * 因此"窗口出现在屏幕上"的每个生命周期节点（show / ready-to-show / 渲染层第一次
   * 取状态 / 详情打开 / 拖动结束）都要重新确认一次。
   */
  assertTopmost(){this.ensureTopmost();}
  /** Dock 模式（'orb'）？详情在 Dock 模式里和状态牌共用一个窗口。 */
  private dockMode(){return (this.store.state.settings.pet?.mode??petDefaults.mode)==='orb';}
  /**
   * 详情是否打开。Dock 模式 = 窗口的画布状态；桌宠模式 = 独立详情浮层的可见性。
   * 两条路径互斥，渲染层不需要知道区别（只读 live.detail）。
   */
  private detailOpen(){return this.dockMode()?this.dockDetail:!this.mini.isDestroyed()&&this.mini.isVisible();}
  private dockPlate(){
    const preferences={...petDefaults,...this.store.state.settings.pet};
    const people=Math.max(1,this.store.state.profiles.length);
    const surface=dockSurfaceMetrics('orb',preferences.size,people);
    return {surface,people,preferences};
  }
  /**
   * 打开合并式详情（Dock 模式）：同一个 floating 窗口从"状态牌画布"变成"详情画布"，
   * 位置与尺寸在同一次 setBounds 里改完，牌面在屏幕上的右下角不动（dockDetailFrame）。
   * 不创建第二个窗口、不动 topmost、不刷新 z-order，只在确实没有焦点时补一次焦点
   * （详情需要真实键盘焦点：ESC 与"点击外部收起"都靠它）。
   */
  private openDockDetail(){
    const {surface,people,preferences}=this.dockPlate();
    const bounds=this.orb.getBounds();
    const area=screen.getDisplayMatching(bounds).workArea;
    const frame=dockDetailFrame({people,size:preferences.size,bounds,area});
    this.dockDetail=true;
    this.dockDetailFrame={
      dock:{...frame.dock},
      panel:{left:frame.panel.left,top:frame.panel.top},
      below:frame.placement==='below',
    };
    this.applied='';
    this.orb.setBounds({x:Math.round(frame.window.x),y:Math.round(frame.window.y),width:Math.round(frame.window.width),height:Math.round(frame.window.height)},false);
    this.ensureTopmost();
    if(!this.orb.isFocused())this.orb.focus();
    this.broadcast();
  }
  /**
   * 收起详情：回到状态牌画布，牌面右下角仍然不动。
   * 返回是否真的改变了状态，供拖动 / 隐藏等路径复用。
   */
  private closeDockDetail(){
    if(!this.dockDetail)return false;
    const frame=this.dockDetailFrame,bounds=this.orb.getBounds(),pad=dockDetail.pad;
    this.dockDetail=false;this.dockDetailFrame=undefined;
    const {surface,preferences}=this.dockPlate();
    const {width,height}=this.geometry(preferences);
    // 牌面右下角（屏幕坐标）：详情画布按 frame 给的贴边偏移反解，普通画布就是窗口右下角 − pad。
    const plateLeft=frame?(frame.dock.left!==undefined?frame.dock.left:bounds.width-(frame.dock.right??pad)-surface.defaultWidth):0;
    const plateTop=frame?(frame.dock.top!==undefined?frame.dock.top:bounds.height-(frame.dock.bottom??pad)-surface.defaultHeight):0;
    const anchorX=frame?bounds.x+plateLeft+surface.defaultWidth:bounds.x+bounds.width-pad;
    const anchorY=frame?bounds.y+plateTop+surface.defaultHeight:bounds.y+bounds.height-pad;
    const x=Math.round(anchorX-width+pad),y=Math.round(anchorY-height+pad);
    if(bounds.x!==x||bounds.y!==y||bounds.width!==width||bounds.height!==height)this.orb.setBounds({x,y,width,height},false);
    this.applied=`${width}x${height}`;
    this.ensureTopmost();
    this.broadcast();
    return true;
  }
  /** 详情收起的统一入口（点击 Dock、点击外部、ESC、拖动、隐藏、几何变化）。 */
  collapseDetail(){
    if(this.closeDockDetail())return;
    if(!this.mini.isDestroyed()&&this.mini.isVisible())this.mini.hide();
  }
  private resizeMini(){
    // 详情浮层是轻量 popover：窗口 = 卡片 + 8px 阴影画布。
    //   Together 316×152 / Solo 276×136（Solo 是独立配比，不是砍掉半边）
    const solo=this.store.state.profiles.length<=1;
    const {width,height}=detailGeometry(solo?1:2);
    if(this.mini.getSize()[0]!==width||this.mini.getSize()[1]!==height){
      this.mini.setResizable(true);
      this.mini.setSize(width,height,false);
      this.mini.setResizable(false);
    }
  }
  resize(){
    // Never resize while the window is being dragged: the move loop owns the
    // bounds, and a resize in the middle of a drag is what used to shift the pet
    // under the cursor. The deferred resize runs when the drag ends.
    if(this.dragging){this.pendingResize=true;return;}
    // 模式 / 尺寸 / 头像变化都属于"外部几何变化"：先把详情收回到状态牌画布，
    // 否则 canonical 尺寸会和当前画布打架。
    this.collapseDetail();
    const p={...petDefaults,...this.store.state.settings.pet},before=this.orb.getBounds();
    const {width,height}=this.geometry(p);
    // 尺寸没变时不再重复 setBounds：Windows 每次都会把透明窗口重新对齐到
    // 物理像素栅格，重复调用会带来 1px 抖动与多余的透明合成。
    const key=`${width}x${height}`;
    if(key===this.applied){this.position();return;}
    // 保持用户停靠的那条边：靠右下角的 Dock 改尺寸时右边缘与底边不动（向左 / 上生长），
    // 靠左上角时相反。以前是"水平居中 + 底边固定"，尺寸变化会让 Dock 从两侧一起长，
    // 视觉上就像桌面上的 Dock 在漂。
    const display=screen.getDisplayMatching(before).workArea;
    const keepRight=before.x+before.width/2>=display.x+display.width/2;
    const keepBottom=before.y+before.height/2>=display.y+display.height/2;
    let x=Math.round(keepRight?before.x+before.width-width:before.x),y=Math.round(keepBottom?before.y+before.height-height:before.y);
    x=Math.max(display.x,Math.min(x,display.x+display.width-width));
    y=Math.max(display.y,Math.min(y,display.y+display.height-height));
    // 不切换 resizable：Windows 会因此改动窗口样式位并让透明窗口重新对齐，
    // 是 Dock 窗口在切换模式时慢慢"长大"1–3px 的来源。这里只改 bounds。
    // Dock 的圆角由 renderer CSS 绘制。Windows 在 fractional DPI 下会在每次
    // setPosition 后重新量化 setShape 的原生 region，造成窗口宽度持续增长，
    // 因此这里不能再对透明 Dock 使用 BrowserWindow.setShape()。
    this.orb.setBounds({x,y,width,height},false);
    this.applied=key;
    this.ensureTopmost();
    this.position();this.broadcast();
  }
  /** Renderer calls this only after new Pack images have loaded and decoded. */
  avatarVisualReady(ready:AvatarVisualReady):boolean{
    if(!ready||typeof ready.requestedPackId!=='string'||typeof ready.resolvedPackId!=='string'||typeof ready.version!=='string')return false;
    const current=this.avatarIdentity();
    if(current.requestedPackId!==ready.requestedPackId)return false;
    if(this.pendingAvatar&&this.pendingAvatar.requestedPackId!==ready.requestedPackId)return false;
    const resolved=resolveAvatarPack(ready.resolvedPackId);
    if(resolved.id!==ready.resolvedPackId||resolved.version!==ready.version)return false;
    // Phase 4A may resolve unavailable requested resources to yd-default. No
    // other cross-Pack substitution is valid here.
    if(ready.resolvedPackId!==current.resolvedPackId&&ready.resolvedPackId!==DEFAULT_AVATAR_PACK_ID)return false;
    this.pendingAvatar=undefined;
    this.activeAvatar={...ready};
    this.resize();
    return true;
  }
  position(){
    const b=this.orb.getBounds(),a=screen.getDisplayMatching(b).workArea;
    const place=(w:BrowserWindow)=>{const [width,height]=w.getSize(),center=b.x+b.width/2,anchor=center<a.x+a.width/2?b.x:b.x+b.width-width;const x=Math.max(a.x,Math.min(anchor,a.x+a.width-width));let y=b.y-height-10;if(y<a.y)y=b.y+b.height+10;w.setPosition(Math.round(x),Math.round(Math.max(a.y,Math.min(y,a.y+a.height-height))));};
    place(this.bubble);
    // 详情面板与状态牌居中对齐：Asset 04 的对话尾巴在面板底部正中，正好指向状态牌。
    // 窗口底部贴着状态牌顶边，尾巴尖（距窗口底 4px）落在状态牌上方几个像素。
    {
      const [width,height]=this.mini.getSize();
      const x=Math.max(a.x,Math.min(Math.round(b.x+b.width/2-width/2),a.x+a.width-width));
      let y=b.y-height;
      if(y<a.y)y=b.y+b.height+10;
      this.mini.setPosition(Math.round(x),Math.round(Math.max(a.y,Math.min(y,a.y+a.height-height))));
    }
    if(this.hoverTip){const [width,height]=this.tip.getSize(),side=this.hoverTip.side;let x=b.x+b.width*side-width/2,y=b.y+b.height+3;if(y+height>a.y+a.height)y=b.y-height-3;x=Math.max(a.x,Math.min(x,a.x+a.width-width));y=Math.max(a.y,Math.min(y,a.y+a.height-height));this.tip.setPosition(Math.round(x),Math.round(y));}
  }
  toggleMini(){
    const p={...petDefaults,...this.store.state.settings.pet};
    // Dock 模式：详情是同一个 floating 窗口的第三种画布状态（不创建第二个窗口）。
    if((p.mode??petDefaults.mode)==='orb'){
      if(this.dockDetail)this.collapseDetail();else this.openDockDetail();
      return;
    }
    if(this.mini.isVisible()){this.mini.hide();this.broadcast();return;}
    this.clearPresence();if(!p.miniPanel){this.panel.show();this.panel.focus();return;}
    this.resizeMini();this.position();this.broadcast();this.mini.show();this.ensureTopmost();this.broadcast();
  }
  // 主进程注册全局快捷键后把结果告诉桌宠：菜单右侧的提示文字与真实可用性一致。
  setShortcut(shortcut:{label:string;ready:boolean}){this.shortcut=shortcut;}
  // 打开设置 / 退出 / 显示隐藏桌宠由 main 负责，这里只负责转达。
  setMenuActions(actions:{settings:()=>void;status:()=>void;quit:()=>void;toggleVisible:()=>void}){this.actions=actions;}
  hideMenu(){if(!this.sheet.isDestroyed()&&this.sheet.isVisible())this.sheet.hide();}
  openMenu(){
    const p={...petDefaults,...this.store.state.settings.pet};
    const items=buildCompanionMenu({
      mode:p.mode==='orb'?'orb':'custom',
      paused:p.pausedUntil>Date.now(),
      visible:this.orb.isVisible(),
      shortcut:this.shortcut.label,
      shortcutReady:this.shortcut.ready,
    });
    const {width}=companionMenuMetrics,height=companionMenuHeight(items);
    // 贴桌宠右侧展开；贴边时翻到左侧，再贴边就压在桌宠上对齐。
    const bounds=this.orb.getBounds(),area=screen.getDisplayMatching(bounds).workArea;
    let x=Math.round(bounds.x+bounds.width+8);
    if(x+width>area.x+area.width)x=Math.round(bounds.x-width-8);
    x=Math.max(area.x,Math.min(x,area.x+area.width-width));
    const y=Math.max(area.y,Math.min(Math.round(bounds.y),area.y+area.height-height));
    this.sheet.setBounds({x,y,width,height});
    this.sheet.webContents.send('dayhub:menu',items);
    this.sheet.show();this.sheet.focus();
  }
  async menuAction(id:string){
    this.hideMenu();
    if(id==='dismiss')return;
    const p={...petDefaults,...this.store.state.settings.pet};
    if(id==='open'){this.panel.show();this.panel.focus();return;}
    if(id==='mini'){this.toggleMini();return;}
    if(id==='mode:custom'||id==='mode:orb'){
      await this.store.update(s=>{s.settings.pet={...petDefaults,...s.settings.pet,mode:id==='mode:orb'?'orb':'custom'};return s;});
      this.resize();this.broadcast();return;
    }
    if(id==='bubbles'){
      const until=p.pausedUntil>Date.now()?0:Date.now()+3600000;
      await this.store.update(s=>{s.settings.pet={...petDefaults,...s.settings.pet,pausedUntil:until};return s;});
      this.reset();return;
    }
    if(id==='settings'){this.actions.settings();return;}
    if(id==='status'){this.actions.status();return;}
    if(id==='toggle'){this.actions.toggleVisible();return;}
    if(id==='quit'){this.actions.quit();return;}
  }
  action(action:string){
    if(action==='hold'&&!this.held){this.remaining=Math.max(0,this.expires-Date.now());this.held=true;}
    if(action==='release'&&this.held){this.held=false;this.expires=Date.now()+this.remaining;}
    if(action==='close'){this.active=undefined;this.held=false;this.bubble.hide();this.next();this.broadcast();}
  }
  presence(action:'enter'|'leave',person?:PersonId){
    if(action==='leave'){this.clearPresence();return;}
    if(this.dragging){this.clearPresence();return;}
    const people=this.get().people,index=people.findIndex(p=>p.person===person),status=people[index];
    if(!status)throw new Error('无效状态区域');
    // 提示条的水平位置由“这个人在当前投影里的位置”决定（单人工作区居中），与身份 id 无关。
    const side=people.length<2?.5:index===0?.29:.71;
    this.hoverTip={person:status.person,text:`${status.alias} · ${statusLabel(status)}`,state:presenceStateFor(status),side};
    const dock=(this.store.state.settings.pet?.mode??petDefaults.mode)==='orb';
    if(dock){this.tip.hide();this.broadcast();return;}
    this.position();this.broadcast();if(this.orb.isVisible())this.tip.showInactive();
  }
  // 拖动开始 = 所有 transient UI（详情 / 悬停提示 / 菜单）立刻收起，拖动期间只剩状态牌。
  dragStart(){this.collapseDetail();this.dragging=true;this.mini.hide();this.hideMenu();this.clearPresence();}
  dragEnd(){
    this.dragging=false;
    this.clearPresence();
    // A normal drag never writes width/height back. Only a real settings change
    // deferred during the drag may apply a new canonical geometry afterwards.
    if(this.pendingResize){this.pendingResize=false;this.applied='';this.resize();}
    this.ensureTopmost();
  }
  private clearPresence(){const changed=!!this.hoverTip||this.tip.isVisible();this.hoverTip=undefined;this.tip.hide();if(changed)this.broadcast();}
  private next(){if(this.active||!this.queue.length)return;this.active=this.queue.shift();this.expires=Date.now()+(this.store.state.settings.pet?.duration??8)*1000;this.position();if(this.orb.isVisible())this.bubble.showInactive();}
  reset(){
    this.collapseDetail();
    this.queue=[];this.active=undefined;this.hoverTip=undefined;this.held=false;this.bubble.hide();this.mini.hide();this.tip.hide();this.hideMenu();this.last=Date.now();this.monotonic=performance.now();
    const requested=this.avatarIdentity();
    // Selection changes wait for renderer decode acknowledgement. All other
    // domain/display changes retain the current geometry behaviour.
    if(!this.sameAvatar(requested,this.activeAvatar))this.pendingAvatar=requested;
    else this.resize();
    this.broadcast();
  }
  async pulse(recover=false){
    if(this.busy)return;this.busy=true;
    try{
      const now=Date.now(),from=this.last,mono=performance.now(),clockJump=Math.abs((now-from)-(mono-this.monotonic))>1500;this.last=now;this.monotonic=mono;
      const gap=now-from,events=bubbleEvents(this.store.state,from,now),history=this.store.state.bubbleHistory||[];
      const fresh=events.filter(e=>!history.some(x=>x.id===e.id));
      const p={...petDefaults,...this.store.state.settings.pet};
      // One projection decides the pet pose and whether a light nudge may play.
      // After a restart the reminder run starts fresh so the pet nudges once.
      if(recover)this.timeline.reset(now);
      this.timeline.sync(pendingReminders(this.store.state).length,now);
      if(fresh.length)await this.store.update(s=>{s.bubbleHistory=[...(s.bubbleHistory||[]),...fresh.map(e=>({id:e.id,at:e.at}))].filter(e=>e.at>=now-120*86400000).slice(-50000);return s;});
      if(recover||gap>10000||gap<0||clockJump){
        this.queue=[];this.active=undefined;this.held=false;this.bubble.hide();
        const pending=pendingReminders(this.store.state).length;
        if(p.bubbles&&p.pausedUntil<=now&&(fresh.length||pending))this.queue.push({id:'recovery:'+now,text:`已经更新到当前时间啦。${pending} 条未处理提醒，点开桌宠查看。`});
      }else if(p.bubbles&&p.pausedUntil<=now&&this.orb.isVisible())this.queue.push(...fresh.map(e=>({id:e.id,text:e.text})));
      if(!p.bubbles||p.pausedUntil>now){this.queue=[];this.active=undefined;this.bubble.hide();}
      if(this.active&&!this.held&&now>=this.expires){this.active=undefined;this.bubble.hide();}
      this.next();this.broadcast();
    }catch(error){logError(error,'实时状态更新失败');}finally{this.busy=false;}
  }
}
