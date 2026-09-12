import { pendingReminders } from './selectors.ts';
import { BrowserWindow, screen } from 'electron';
import { snapshot, bubbleEvents, petDefaults, presenceMeta, presenceStateFor, statusLabel, type LiveSnapshot, type PresenceState } from './live.ts';
import { CompanionTimeline, PetScheduleClock } from './companion-display.ts';
import { buildCompanionMenu, companionMenuHeight, companionMenuMetrics, companionToggleShortcut } from './companion-menu.ts';
import { companionGeometry } from './companion-layout.ts';
import type { CompanionAssets } from './companion-assets.ts';
import { logError } from './logging.ts';
import type { Store } from './store.ts';
import type { PersonId } from './types.ts';

function circleShape(size:number,inset=0){
  const diameter=size-inset*2,radius=diameter/2,center=inset+radius,rects:Electron.Rectangle[]=[];
  for(let y=inset;y<inset+diameter;y++){
    const dy=(y+.5-center)/radius,half=radius*Math.sqrt(Math.max(0,1-dy*dy));
    const left=Math.max(inset,Math.ceil(center-half)),right=Math.min(inset+diameter,Math.floor(center+half));
    if(right>left)rects.push({x:left,y,width:right-left,height:1});
  }
  return rects;
}

export class Companion {
  private closing=false; private last=Date.now(); private monotonic=performance.now(); private pulseTimer?:ReturnType<typeof setInterval>; private busy=false;
  private active?:{id:string;text:string};private queue:{id:string;text:string}[]=[];private expires=0;private remaining=0;private held=false;
  private hoverTip?:{person:PersonId;text:string;state:PresenceState;side:number};private dragging=false;private pendingResize=false;private applied='';
  private timeline=new CompanionTimeline();
  // 时间状态缓存：启动立即算一次，之后只在跨边界 / 时钟跳变 / 系统恢复时重算。
  private clock=new PetScheduleClock();
  readonly bubble:BrowserWindow;readonly mini:BrowserWindow;readonly tip:BrowserWindow;readonly sheet:BrowserWindow;
  private shortcut={label:companionToggleShortcut.label,ready:false};
  private actions:{settings:()=>void;quit:()=>void;toggleVisible:()=>void}={settings:()=>{},quit:()=>{},toggleVisible:()=>{}};
  constructor(private store:Store,readonly orb:BrowserWindow,private panel:BrowserWindow,options:Electron.BrowserWindowConstructorOptions,private file:string,lock:(w:BrowserWindow)=>void,readonly assets:CompanionAssets){
    this.bubble=new BrowserWindow({...options,width:330,height:180,thickFrame:false,frame:false,transparent:true,backgroundColor:'#00000000',resizable:false,alwaysOnTop:true,skipTaskbar:true,show:false,focusable:false});
    this.mini=new BrowserWindow({...options,width:326,height:270,thickFrame:false,frame:false,transparent:true,backgroundColor:'#00000000',resizable:false,alwaysOnTop:true,skipTaskbar:true,show:false});
    this.tip=new BrowserWindow({...options,width:150,height:32,thickFrame:false,frame:false,transparent:true,backgroundColor:'#00000000',resizable:false,alwaysOnTop:true,skipTaskbar:true,show:false,focusable:false,hasShadow:false,roundedCorners:false});
    // 右键菜单是自绘窗口：原生菜单无法沿用 YD 的字体、间距与金色点缀。
    // 它需要真正的焦点才能“点外面自动收起”，所以不加入点击穿透名单。
    this.sheet=new BrowserWindow({...options,width:companionMenuMetrics.width,height:220,thickFrame:false,frame:false,transparent:true,backgroundColor:'#00000000',resizable:false,alwaysOnTop:true,skipTaskbar:true,show:false,hasShadow:false,roundedCorners:false});
    this.bubble.setTitle('YD · 提醒气泡');this.mini.setTitle('YD · 双方状态');this.tip.setTitle('YD · 状态');this.sheet.setTitle('YD · 桌宠菜单');
    lock(this.bubble);lock(this.mini);lock(this.tip);lock(this.sheet);
    this.mini.on('blur',()=>this.mini.hide());
    this.mini.on('close',e=>{if(!this.closing){e.preventDefault();this.mini.hide();}});
    this.orb.on('hide',()=>{this.bubble.hide();this.mini.hide();this.tip.hide();});
    this.orb.on('blur',()=>this.clearPresence());
    // 桌宠移动或收起时，右键菜单不能再悬在原处。
    this.orb.on('move',()=>{this.hideMenu();this.position();});
    this.orb.on('hide',()=>this.hideMenu());
    this.sheet.on('blur',()=>this.hideMenu());
    this.sheet.on('close',e=>{if(!this.closing){e.preventDefault();this.sheet.hide();}});
    this.panel.on('show',()=>void this.pulse());
    for(const w of [this.orb,this.bubble,this.tip])w.setIgnoreMouseEvents(true,{forward:true});
  }
  async load(){await Promise.all([this.bubble.loadFile(this.file,{hash:'bubble'}),this.mini.loadFile(this.file,{hash:'mini'}),this.tip.loadFile(this.file,{hash:'tip'}),this.sheet.loadFile(this.file,{hash:'menu'})]);this.resize();await this.pulse(true);this.pulseTimer=setInterval(()=>void this.pulse(),1000);}
  stop(){this.closing=true;if(this.pulseTimer)clearInterval(this.pulseTimer);}
  get():LiveSnapshot{
    // Keep the projection self-consistent: the display state must never lag the
    // pending reminder count by one tick.
    const now=Date.now();
    this.timeline.sync(pendingReminders(this.store.state).length,now);
    return {...snapshot(this.store.state,now,{...this.timeline.state(),scheduled:this.clock.read(now)}),bubble:this.active?{...this.active,below:this.bubble.getBounds().y>this.orb.getBounds().y}:undefined,hoverTip:this.hoverTip};
  }
  broadcast(){
    // 悬停提示只描述仍然存在的档案：档案消失（例如以后移除同行者）时安静收起，
    // 绝不保留或显示一个不存在的人。
    if(this.hoverTip){const status=this.get().people.find(p=>p.person===this.hoverTip!.person);if(status)this.hoverTip={person:status.person,text:`${status.alias} · ${statusLabel(status)}`,state:presenceStateFor(status),side:this.hoverTip.side};else this.hoverTip=undefined;}
    const live=this.get();for(const w of [this.orb,this.panel,this.bubble,this.mini,this.tip])if(!w.isDestroyed())w.webContents.send('dayhub:live',live);
  }
  geometry(p:{mode:string;size:'small'|'medium'|'large'}){
    // One fixed rectangle per mode and size. Never derived from the current
    // frame, the business state or the character bounding box.
    const mode=p.mode==='orb'?'orb':'custom';
    const {width,height}=companionGeometry(mode,p.size,this.assets.aspect);
    return {width,height,shape:mode==='orb'?circleShape(width):undefined};
  }
  resize(){
    // Never resize while the window is being dragged: the move loop owns the
    // bounds, and a resize in the middle of a drag is what used to shift the pet
    // under the cursor. The deferred resize runs when the drag ends.
    if(this.dragging){this.pendingResize=true;return;}
    const p={...petDefaults,...this.store.state.settings.pet},before=this.orb.getBounds();
    const {width,height,shape}=this.geometry(p);
    // 尺寸与形状没变时不再重复 setBounds：Windows 每次都会把透明窗口重新对齐到
    // 物理像素栅格，重复调用会带来 1px 抖动与多余的透明合成。
    const key=`${width}x${height}:${shape?'circle':'rect'}`;
    if(key===this.applied){this.position();return;}
    // Keep the character's feet on the same spot: the bottom edge stays put and
    // the window is re-centred horizontally, so switching size or mode never
    // makes the pet jump to another corner of the screen.
    let x=Math.round(before.x+(before.width-width)/2),y=Math.round(before.y+before.height-height);
    const display=screen.getDisplayMatching(before).workArea;
    x=Math.max(display.x,Math.min(x,display.x+display.width-width));
    y=Math.max(display.y,Math.min(y,display.y+display.height-height));
    this.orb.setResizable(true);this.orb.setMinimumSize(1,1);
    this.orb.setBounds({x,y,width,height},false);
    this.orb.setShape(shape??[{x:0,y:0,width,height}]);
    this.orb.setResizable(false);
    this.applied=key;
    this.position();this.broadcast();
  }
  position(){
    const b=this.orb.getBounds(),a=screen.getDisplayMatching(b).workArea;
    const place=(w:BrowserWindow)=>{const [width,height]=w.getSize(),center=b.x+b.width/2,anchor=center<a.x+a.width/2?b.x:b.x+b.width-width;const x=Math.max(a.x,Math.min(anchor,a.x+a.width-width));let y=b.y-height-10;if(y<a.y)y=b.y+b.height+10;w.setPosition(Math.round(x),Math.round(Math.max(a.y,Math.min(y,a.y+a.height-height))));};
    place(this.bubble);place(this.mini);
    if(this.hoverTip){const [width,height]=this.tip.getSize(),side=this.hoverTip.side;let x=b.x+b.width*side-width/2,y=b.y+b.height+3;if(y+height>a.y+a.height)y=b.y-height-3;x=Math.max(a.x,Math.min(x,a.x+a.width-width));y=Math.max(a.y,Math.min(y,a.y+a.height-height));this.tip.setPosition(Math.round(x),Math.round(y));}
  }
  toggleMini(){const p={...petDefaults,...this.store.state.settings.pet};if(this.mini.isVisible()){this.mini.hide();return;}if(!p.miniPanel){this.panel.show();this.panel.focus();return;}this.position();this.broadcast();this.mini.show();}
  // 主进程注册全局快捷键后把结果告诉桌宠：菜单右侧的提示文字与真实可用性一致。
  setShortcut(shortcut:{label:string;ready:boolean}){this.shortcut=shortcut;}
  // 打开设置 / 退出 / 显示隐藏桌宠由 main 负责，这里只负责转达。
  setMenuActions(actions:{settings:()=>void;quit:()=>void;toggleVisible:()=>void}){this.actions=actions;}
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
    this.position();this.broadcast();if(this.orb.isVisible())this.tip.showInactive();
  }
  dragStart(){this.dragging=true;this.clearPresence();}
  dragEnd(){this.dragging=false;this.clearPresence();if(this.pendingResize){this.pendingResize=false;this.resize();}}
  private clearPresence(){const changed=!!this.hoverTip||this.tip.isVisible();this.hoverTip=undefined;this.tip.hide();if(changed)this.broadcast();}
  private next(){if(this.active||!this.queue.length)return;this.active=this.queue.shift();this.expires=Date.now()+(this.store.state.settings.pet?.duration??8)*1000;this.position();if(this.orb.isVisible())this.bubble.showInactive();}
  reset(){this.queue=[];this.active=undefined;this.hoverTip=undefined;this.held=false;this.bubble.hide();this.tip.hide();this.clock.reset();this.last=Date.now();this.monotonic=performance.now();this.resize();this.broadcast();}
  async pulse(recover=false){
    if(this.busy)return;this.busy=true;
    try{
      const now=Date.now(),from=this.last,mono=performance.now(),clockJump=Math.abs((now-from)-(mono-this.monotonic))>1500;this.last=now;this.monotonic=mono;
      const gap=now-from,events=bubbleEvents(this.store.state,from,now),history=this.store.state.bubbleHistory||[];
      const fresh=events.filter(e=>!history.some(x=>x.id===e.id));
      const p={...petDefaults,...this.store.state.settings.pet};
      // 时间状态：跨过边界的下一次 tick 就会重算；睡眠恢复 / 时钟跳变直接强制。
      this.clock.read(now,{force:recover||clockJump||gap<0||gap>10000});
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
