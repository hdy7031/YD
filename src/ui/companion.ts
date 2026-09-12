import React,{useState,useEffect,useRef} from 'react';
import type { LiveSnapshot,PersonStatus,PetPreferences,PresenceState } from '../live.ts';
import {clockText,petDefaults,presenceMeta,presenceStateFor,statusLabel} from '../live.ts';
import {companionTone} from '../companion-colors.ts';
import {companionFrame,companionRail} from '../companion-layout.ts';
import {nightRestText} from '../companion-display.ts';
import {CompanionRail,CustomCompanionArt,useCompanionAssets} from './companion-custom.ts';
import type {CompanionMenuItem} from '../companion-menu.ts';
import {BrandGlyph} from './brand.ts';
const h=React.createElement,api=window.dayhub;
export function useLive(){const [live,set]=useState<LiveSnapshot|null>(null);useEffect(()=>{let mounted=true,received=false;const off=api.onLive(v=>{received=true;if(mounted)set(v);});void api.live().then(v=>{if(mounted&&!received)set(v);});return()=>{mounted=false;off();};},[]);return live;}
function detail(p:PersonStatus,now:number){
  if(p.current.length)return p.current.map(o=>`${o.title} · ${clockText(o.end)} 结束（${Math.max(1,Math.ceil((o.end-now)/60000))} 分钟）`).join('；');
  if(p.code==='TERM_NOT_STARTED')return `${p.termStart} 开始${p.next?' · 下一项 '+clockText(p.next.start)+' '+p.next.title:''}`;
  if(p.code==='DAY_FINISHED')return `今天共 ${p.todayCount} 节课${p.next?' · 下一项 '+clockText(p.next.start)+' '+p.next.title:''}`;
  if(p.next)return `下一项 ${new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric'}).format(p.next.start)} ${clockText(p.next.start)} · ${p.next.title}`;
  if(p.code==='NO_SCHEDULE')return '导入课表后显示当前与下一节安排';
  if(p.code==='NO_CLASS_TODAY')return '今天没有已录入课程';
  return '暂无下一项记录';
}
const nextText=(p:PersonStatus)=>p.next?`${new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric'}).format(p.next.start)} ${clockText(p.next.start)} · ${p.next.title}`:'';
export function StatusRows({live,compact=false,detailed=false}:{live:LiveSnapshot|null;compact?:boolean;detailed?:boolean}){
  const rows=(live?.people||[]).map(p=>{
    const identity=compact?p.alias:p.person==='me'?'我的':'Ta';
    // 迷你面板负责“读详情”，因此可以带当前事项与下一项；桌宠旁的小标签
    // 只留最短结论，避免在小窗口里堆字。
    const secondary=!compact?detail(p,live!.now)
      :detailed&&p.current.length?`当前 ${p.current.map(o=>o.title).join('、')} · ${clockText(Math.min(...p.current.map(o=>o.end)))} 结束`
      :detailed&&p.next?`下一项 ${nextText(p)}`
      :p.current.length?`${clockText(Math.min(...p.current.map(o=>o.end)))} 结束`
      :p.code==='TERM_NOT_STARTED'?p.termStart+' 开始'
      :p.next?`${nextText(p)}`:'暂无下一项';
    // 三个层级：称呼（谁）→ 状态（发生了什么）→ 依据（时间与地点），
    // 这样“我的 / Ta”并列时读起来是两块状态，而不是两行普通文字。
    return h('div',{className:'person-status',key:p.person},
      h('span',{className:`person-dot tone-${companionTone(presenceStateFor(p))} ${p.person}`}),
      h('div',{className:'person-status-body'},
        h('span',{className:'person-status-label'},identity),
        h('strong',null,statusLabel(p)),
        h('small',null,secondary))
    );
  });
  return h('div',{className:compact?'status-pills':'dual-status'},...rows);
}
export function Titlebar(){return h('header',{className:'titlebar'},h('span',{className:'titlebar-brand'},h(BrandGlyph,{className:'yd-glyph'}),h('b',null,'YD'),h('em',null,'Your Day')),h('div',{className:'window-controls'},...([['minimize','−','最小化'],['maximize','□','最大化或还原'],['close','×','收起到托盘']] as const).map(([action,label,title])=>h('button',{key:action,title,'aria-label':title,onClick:()=>void api.window(action)},label))));}
function IdentityMark({letter}:{letter:string}){return h('span',{className:'identity-mark','aria-hidden':true},letter);}
function StatusCore({state}:{state:PresenceState}){return h('span',{className:'status-core','aria-hidden':true},h('i',{className:'status-ring'}),h('i',{className:'status-dot'}));}
function PresenceZone({person,status,marker,onHover}:{person:'me'|'partner';status?:PersonStatus;marker:string;onHover?:(person:'me'|'partner')=>void}){
  const state=presenceStateFor(status);
  return h('span',{className:`presence-zone presence-${person} state-${state}`,'data-person':person,onPointerEnter:()=>onHover?.(person)},h(IdentityMark,{letter:marker}),h(StatusCore,{state}));
}
function PresenceOrb({animate,me,partner,onHover}:{animate:boolean;me?:PersonStatus;partner?:PersonStatus;onHover?:(person:'me'|'partner')=>void}){
  return h('div',{className:`presence-orb${animate?' motion':''}`,'aria-label':`双方状态：${presenceMeta[presenceStateFor(me)].label}、${presenceMeta[presenceStateFor(partner)].label}`},h('div',{className:'presence-surface'},h(PresenceZone,{person:'me',status:me,marker:me?.alias??'',onHover}),h(PresenceZone,{person:'partner',status:partner,marker:partner?.alias??'',onHover})));
}
function useSurface(name:string){
  useEffect(()=>{
    document.documentElement.classList.add('companion-root');document.body.classList.add(name);
    // 拖动期间不再切换“点击穿透”：拖动中改动鼠标穿透会让 Windows 重新合成透明窗口，
    // 既可能丢 pointerup，也会让贴图出现残影。
    const dragging=()=>document.querySelector('.pet-dock')?.classList.contains('is-dragging')===true;
    const pointer=(e:MouseEvent)=>{if(dragging())return;void api.pointer(!!(e.target as Element)?.closest('[data-interactive]'));};
    document.addEventListener('mousemove',pointer);
    const leave=()=>{if(dragging())return;void api.pointer(false);};
    document.addEventListener('mouseleave',leave);
    return()=>{document.removeEventListener('mousemove',pointer);document.removeEventListener('mouseleave',leave);};
  },[name]);
}
export function DesktopPet(){
  const live=useLive(),assets=useCompanionAssets(),drag=useRef<{x:number;y:number;pointerId:number;target:HTMLButtonElement}|null>(null),moved=useRef(false),draggingRef=useRef(false),hoverArmed=useRef(true),[dragging,setDragging]=useState(false);useSurface('pet-body');
  const p=live?.preferences??petDefaults;
  // 专属角色桌宠是唯一默认形象：素材即使读不到也只用“同一形象的待机帧”，
  // 不会再切换到其它角色。
  const custom=p.mode==='custom';
  // “减少动态”对三种显示模式一视同仁：呼吸、眨眼、徽章脉冲与提醒轻提示都会停。
  const motion={animate:p.animate&&!p.reduceMotion,reduceMotion:p.reduceMotion};
  const me=live?.people.find(x=>x.person==='me'),partner=live?.people.find(x=>x.person==='partner');
  const hidePresence=()=>void api.presence('leave');
  const finishDrag=(target?:HTMLButtonElement,pointerId?:number)=>{
    const active=drag.current;drag.current=null;draggingRef.current=false;setDragging(false);hidePresence();
    const element=target??active?.target,id=pointerId??active?.pointerId;
    if(element&&id!==undefined&&element.hasPointerCapture(id))element.releasePointerCapture(id);
    if(active)void api.endDrag();
  };
  useEffect(()=>{const clear=()=>{hoverArmed.current=false;finishDrag();};window.addEventListener('blur',clear);return()=>window.removeEventListener('blur',clear);},[]);
  // 兜底：即使指针捕获失败或松手发生在窗口之外，也要结束拖动，避免桌宠
  // 一直停在“拖动中”而看起来像卡住。
  useEffect(()=>{
    if(!dragging)return;
    const stop=()=>{hoverArmed.current=false;finishDrag();};
    window.addEventListener('pointerup',stop,true);
    window.addEventListener('pointercancel',stop,true);
    return()=>{window.removeEventListener('pointerup',stop,true);window.removeEventListener('pointercancel',stop,true);};
  },[dragging]);
  const hover=(person:'me'|'partner')=>{if(!draggingRef.current&&hoverArmed.current)void api.presence('enter',person);};
  const leave=()=>{hidePresence();if(!draggingRef.current)hoverArmed.current=true;};
  const label=p.mode==='orb'?'拖动悬浮球，单击查看状态':'拖动桌宠，单击查看双方状态';
  // 手势：pointerdown 立刻进入 is-dragging 并让主进程接管窗口位置，pointermove
  // 只转发坐标，pointerup / cancel / 失去捕获都会收尾。拖动期间不产生任何 CSS
  // 动画、transform 或滤镜，桌面看到的位移只来自窗口本身。
  const dragHandlers={
    onPointerLeave:leave,
    onContextMenu:(e:React.MouseEvent)=>{e.preventDefault();hoverArmed.current=false;hidePresence();void api.window('menu');},
    onPointerDown:(e:React.PointerEvent<HTMLButtonElement>)=>{
      if(e.button!==0)return;
      hoverArmed.current=false;draggingRef.current=true;hidePresence();moved.current=false;setDragging(true);
      drag.current={x:e.screenX,y:e.screenY,pointerId:e.pointerId,target:e.currentTarget};
      void api.beginDrag(e.screenX,e.screenY);
      try{e.currentTarget.setPointerCapture(e.pointerId);}catch{/* 指针不可捕获时仍然可以继续拖动 */}},
    onPointerMove:(e:React.PointerEvent)=>{
      if(!drag.current)return;hidePresence();
      const dx=e.screenX-drag.current.x,dy=e.screenY-drag.current.y;
      if(Math.abs(dx)+Math.abs(dy)>3||moved.current){moved.current=true;void api.drag(e.screenX,e.screenY);}},
    onPointerUp:(e:React.PointerEvent<HTMLButtonElement>)=>finishDrag(e.currentTarget,e.pointerId),
    onPointerCancel:(e:React.PointerEvent<HTMLButtonElement>)=>{hoverArmed.current=false;finishDrag(e.currentTarget,e.pointerId);},
    onLostPointerCapture:()=>{hoverArmed.current=false;finishDrag();},
    onClick:()=>{if(!moved.current)void api.window('mini');},
  };
  const handle=h('button',{'data-interactive':true,className:'pet-handle','aria-label':label,...dragHandlers},
    custom
      // 固定画布：stage 只负责角色本体与动作，rail 是它的兄弟节点，
      // 两者的 transform / 动画永远不会互相影响，拖动时也不会被裁掉。
      ?h('div',{className:'sprite-stage'},h('div',{className:'sprite-inner'},h('span',{className:'sprite-shadow','aria-hidden':true}),h(CustomCompanionArt,{assets,display:live?.display,frozen:dragging,...motion})))
      :h(PresenceOrb,{animate:motion.animate,me,partner,onHover:hover}));
  const side=custom
    ?h('div',{className:'status-rail'},h('button',{'data-interactive':true,className:'companion-rail-button',title:'查看双方状态',onClick:()=>void api.window('mini')},h(CompanionRail,{live})))
    :null;
  return h('div',{className:`pet-dock ${p.mode==='orb'?'orb-mode':'custom-mode'}${dragging?' is-dragging':''}`,style:{
    '--rail-height':companionRail.height+'px',
    '--frame-pad-x':companionFrame.padX+'px',
    '--frame-pad-y':companionFrame.padY+'px',
  } as React.CSSProperties},handle,side);
}
export function PresenceTip(){const live=useLive();useEffect(()=>{document.documentElement.classList.add('companion-root');document.body.classList.add('tip-body');return()=>document.body.classList.remove('tip-body');},[]);return live?.hoverTip?h('div',{className:`presence-tip tip-${live.hoverTip.state}`,role:'status'},live.hoverTip.text):null;}
// 桌宠右键菜单：内容由主进程按同一份模型投递，形状与产品界面一致（瓷白卡片 +
// 品牌金勾选 + 危险操作用告警色），不再使用系统原生菜单。
export function PetMenu(){
  const [items,setItems]=useState<CompanionMenuItem[]|null>(null);
  useEffect(()=>{
    document.documentElement.classList.add('companion-root');document.body.classList.add('menu-body');
    const off=api.onMenu(value=>setItems(value));
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape')void api.menuAction('dismiss');};
    document.addEventListener('keydown',key);
    return()=>{off();document.removeEventListener('keydown',key);document.body.classList.remove('menu-body');};
  },[]);
  if(!items)return null;
  return h('div',{className:'pet-menu',role:'menu','aria-label':'桌宠菜单'},
    ...items.map((item,index)=>item.kind==='sep'
      ? h('div',{className:'pet-menu-sep',key:`sep-${index}`,role:'separator'})
      : h('button',{
          key:item.id,
          type:'button',
          role:item.kind==='radio'?'menuitemradio':item.kind==='check'?'menuitemcheckbox':'menuitem',
          'aria-checked':item.kind==='item'?undefined:item.checked,
          className:`pet-menu-item${item.kind!=='item'?' is-toggle':''}${item.kind==='item'&&item.tone==='danger'?' is-danger':''}${item.kind!=='item'&&item.checked?' is-checked':''}`,
          onClick:()=>void api.menuAction(item.id),
        },
        h('span',{className:'pet-menu-mark','aria-hidden':true},item.kind!=='item'&&item.checked?'✓':''),
        h('span',{className:'pet-menu-label'},item.label),
        item.kind==='item'&&item.hint?h('span',{className:'pet-menu-hint'},item.hint):null)));
}
export function Bubble(){const live=useLive();useSurface('bubble-body');return live?.bubble?h('section',{'data-interactive':true,className:'speech-cloud'+(live.bubble.below?' cloud-below':''),role:'status',onMouseEnter:()=>void api.bubble('hold'),onMouseLeave:()=>void api.bubble('release')},h('button',{className:'cloud-close',title:'收起气泡',onClick:()=>void api.bubble('close')},'×'),h('small',null,'时间小提醒'),h('div',{className:'cloud-text'},live.bubble.text),h('button',{className:'text-button',onClick:()=>void api.window('mini')},'查看双方状态 →')):null;}
export function Mini(){
  const live=useLive();
  return h('section',{className:'mini-panel'},
    h('div',{className:'section-head'},h('h2',null,'此刻，我们'),h('span',{className:'muted'},live?clockText(live.now):'…')),
    h(StatusRows,{live,compact:true,detailed:true}),
    h('p',{className:'mini-note'},live?.pending?`${live.pending} 条提醒已到时间，等待处理。`:'没有未处理的提醒。'),
    live?.display.nightly?h('p',{className:'mini-note mini-night'},'夜间休息中 · 状态仍按已录入的安排显示。'):null,
    h('div',{className:'mini-actions'},
      h('button',{className:'primary',onClick:()=>void api.window('open')},live?.pending?`打开 YD · 处理 ${live.pending} 条提醒`:'打开 YD'),
      h('button',{className:'ghost',onClick:()=>void api.window('settings')},'桌宠设置')));
}
const modeOptions:[PetPreferences['mode'],string,string][]=[
  ['custom','专属角色桌宠','默认形象，随时段与双方状态切换动作'],
  ['orb','玻璃悬浮球','最克制，只显示两个状态点'],
];

const motionOptions:['standard'|'reduced',string,string][]=[
  ['standard','标准','随状态轻轻呼吸、轻微上浮'],
  ['reduced','减少','几乎静止，只在状态变化时淡入'],
];

export function PetSettings({live,settings}:{live:LiveSnapshot|null;settings?:{launch:boolean;trayResident?:boolean}}){
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const assets=useCompanionAssets();
  const p=live?.preferences??petDefaults;
  const run=(fn:()=>Promise<unknown>)=>{setBusy(true);return fn().then(()=>setError('')).catch(e=>setError(String(e))).finally(()=>setBusy(false));};
  const save=(pet:Partial<PetPreferences>)=>run(()=>api.change({type:'settings',pet}));
  const saveSetting=(value:{launch?:boolean;trayResident?:boolean})=>run(()=>api.change({type:'settings',...value}));
  const paused=p.pausedUntil>(live?.now??Date.now());
  const check=(label:string,checked:boolean,onChange:(value:boolean)=>void,disabled=false)=>h('label',{className:'check-row'},h('input',{type:'checkbox',checked,disabled:disabled||busy,onChange:(e:React.ChangeEvent<HTMLInputElement>)=>onChange(e.target.checked)}),label);
  const block=(title:string,children:React.ReactNode)=>h('div',{className:'setting-block'},h('h3',null,title),children);
  const motionMode=p.reduceMotion?'reduced':'standard';
  const sizeChoices=h('div',{className:'segmented setting-segmented'},...(['small','medium','large'] as const).map((value,index)=>h('button',{key:value,type:'button',className:p.size===value?'active':'',disabled:busy,onClick:()=>save({size:value})},['小','中','大'][index])));
  return h('section',{className:'pet-settings'},h('h2',null,'桌面陪伴'),
    block('外观',h(React.Fragment,null,
      h('div',{className:'mode-choices',role:'radiogroup','aria-label':'桌宠显示模式'},...modeOptions.map(([value,label,note])=>{
        return h('button',{key:value,type:'button',role:'radio','aria-checked':p.mode===value,className:p.mode===value?'mode-choice active':'mode-choice',disabled:busy,onClick:()=>save({mode:value})},
          h('strong',null,label),h('small',null,note));
      })),
      p.mode==='custom'?h('div',{className:'setting-row'},h('span',null,'大小'),sizeChoices):null,
      h('p',{className:'muted setting-note'},assets?assets.reason:'正在读取专属角色素材……'),
      paused?h('p',{className:'muted setting-note'},`气泡已暂停，${clockText(p.pausedUntil)} 自动恢复。`):null)),
    p.mode!=='custom'?block('大小',sizeChoices):null,
    block('动态效果',h('div',{className:'mode-choices',role:'radiogroup','aria-label':'桌宠动态效果'},...motionOptions.map(([value,label,note])=>h('button',{key:value,type:'button',role:'radio','aria-checked':motionMode===value,className:motionMode===value?'mode-choice active':'mode-choice',disabled:busy,onClick:()=>save({animate:true,reduceMotion:value==='reduced'})},h('strong',null,label),h('small',null,note))))),
    block('气泡提醒',h(React.Fragment,null,
      check('到时间时用气泡提醒我',p.bubbles,value=>save({bubbles:value}),paused),
      h('label',{className:'setting-row'},h('span',null,'气泡停留时长'),h('span',{className:'setting-inline'},h('input',{type:'number',min:3,max:30,value:p.duration,disabled:busy||paused,onChange:(e:React.ChangeEvent<HTMLInputElement>)=>{const n=Number(e.target.value);if(n>=3&&n<=30)save({duration:n});}}),'秒')),
      h('div',{className:'actions'},paused?h('button',{type:'button',className:'secondary',disabled:busy,onClick:()=>save({pausedUntil:0})},'恢复气泡提醒'):h('button',{type:'button',className:'secondary',disabled:busy,onClick:()=>save({pausedUntil:Date.now()+3600000})},'暂停气泡 1 小时')))),
    block('作息状态',h(React.Fragment,null,
      check(`夜间自动睡觉（${nightRestText}）`,p.nightRest,value=>save({nightRest:value})),
      h('p',{className:'muted setting-note'},p.nightRest?`${nightRestText} 之间，只要没有进行中的安排、也没有到时间的提醒，桌宠就会安静地睡觉；07:30–07:50 与 14:00–14:20 伸个懒腰，11:30–12:00 吃饭，12:30–14:00 午睡。`:'已关闭夜间自动睡觉：夜间也按平时的状态显示，吃饭、午睡与刚睡醒仍按时间生效。'),
      h('p',{className:'muted setting-note'},'时间状态按本机时间判断，不需要联网校准。'))),
    block('窗口行为',h(React.Fragment,null,
      check('单击桌宠显示双方状态',p.miniPanel,value=>save({miniPanel:value})),
      check('记住桌宠位置',p.rememberPosition,value=>save({rememberPosition:value})),
      check('关闭主窗口后驻留托盘（提醒继续）',settings?.trayResident!==false,value=>saveSetting({trayResident:value})),
      settings?.trayResident===false?h('p',{className:'muted setting-note'},'关闭主窗口将退出 YD，退出后不会触发提醒。'):null,
      check('登录 Windows 后启动 YD',!!settings?.launch,value=>saveSetting({launch:value})))),
    error?h('p',{className:'error',role:'alert'},error):null);
}
