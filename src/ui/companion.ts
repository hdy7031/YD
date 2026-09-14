import React,{useState,useEffect,useRef} from 'react';
import type { LiveSnapshot,PersonStatus,PetPreferences,PresenceState } from '../live.ts';
import type { PersonId, Profile, State } from '../types.ts';
import {clockText,petDefaults,presenceStateFor,statusLabel} from '../live.ts';
import {DEFAULT_AVATAR_PACK_ID,getAvatarPack,listAvatarPacks,type AvatarPackManifest} from '../avatar.ts';
import {resolveAvatarPickerSelection} from '../avatar-picker.ts';
import {companionDisplayLabels} from '../companion-display.ts';
import {companionVisualStates,type CompanionDisplayState} from '../companion-visual.ts';
import {stateSourceLabel} from '../state/presentation.ts';
import {companionTone} from '../companion-colors.ts';
import {companionFrame,companionRail,dockSurfaceMetrics} from '../companion-layout.ts';
import {petRoutineSummary,type CompanionDisplay} from '../companion-display.ts';
import {createDefaultRoutine,routineKindPriority,type RoutineRule} from '../routine.ts';
import {EmptyState} from './views.ts';
import {getProfileById,resolvePetSubject} from '../people.ts';
import {id} from '../core.ts';
import {
  routineDaysText,routineDefaultLabelFor,routineDraft,routineDraftError,routineForRules,routineIsEmpty,
  routineKindHint,routineKindHasPetState,routineKindLabels,routineNeedsConfirmation,routinePersonOptions,
  routineRuleFromDraft,routineRulesToggled,routineRulesWith,routineRulesWithout,routineWeekdayLabels,
  routineWindowText,type RoutineRuleDraft,
} from './routine-settings.ts';
import {CompanionRail,CustomCompanionArt,useAvatarPreviewAssets,useCompanionAssets} from './companion-custom.ts';
import type {CompanionMenuItem} from '../companion-menu.ts';
import {BrandGlyph} from './brand.ts';
// Asset 03 语义图标（presentation-only）：状态 → 图标，找不到映射就不显示。
import {iconForCurrent,iconForNext,iconSrc} from './state-icons.ts';
const h=React.createElement,api=window.dayhub;
export function useLive(){const [live,set]=useState<LiveSnapshot|null>(null);useEffect(()=>{let mounted=true,received=false;const off=api.onLive(v=>{received=true;if(mounted)set(v);});void api.live().then(v=>{if(mounted&&!received)set(v);});return()=>{mounted=false;off();};},[]);return live;}
function detail(p:PersonStatus,now:number){
  // 人物状态（手动 / 日程 / 作息）优先——它只来自统一状态引擎；这里只负责排版。
  // 来源说明（本人设置 / 按课表推测 / 按作息推测）是 Phase 3C 的信任信号。
  const current=p.current;
  if(current.kind!=='idle'){
    const source=stateSourceLabel(current);
    const window=current.endAt?`${clockText(current.endAt)} 结束（${Math.max(1,Math.ceil((current.endAt-now)/60000))} 分钟）`:'进行中';
    return [current.label,source,window].filter(Boolean).join(' · ');
  }
  if(p.code==='TERM_NOT_STARTED')return `${p.termStart} 开始${p.next?' · 下一项 '+clockText(p.next.start)+' '+p.next.title:''}`;
  if(p.code==='DAY_FINISHED')return `今天共 ${p.todayCount} 节课${p.next?' · 下一项 '+clockText(p.next.start)+' '+p.next.title:''}`;
  if(p.next)return `下一项 ${new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric'}).format(p.next.start)} ${clockText(p.next.start)} · ${p.next.title}`;
  if(p.code==='NO_SCHEDULE')return '导入课表后显示当前与下一节安排';
  if(p.code==='NO_CLASS_TODAY')return '今天没有已录入课程';
  return '暂无下一项记录';
}
const nextText=(p:PersonStatus)=>p.next?`${new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric'}).format(p.next.start)} ${clockText(p.next.start)} · ${p.next.title}`:'';
export function StatusRows({live,compact=false,detailed=false,onSetStatus}:{live:LiveSnapshot|null;compact?:boolean;detailed?:boolean;onSetStatus?:(person:PersonId)=>void}){
  const rows=(live?.people||[]).map(p=>{
    // 称呼来自档案自身的显示名称（「我 / TA / 丹 / 喻老师」都由 Profile 提供）；
    // 紧凑标签仍可用短代号，但不再把本人硬编码成「我的」。
    const identity=compact?p.alias:p.name;
    // 迷你面板负责“读详情”，因此可以带当前事项与下一项；桌宠旁的小标签
    // 只留最短结论，避免在小窗口里堆字。
    const current=p.current;
    const source=stateSourceLabel(current);
    const secondary=!compact?detail(p,live!.now)
      :detailed&&current.kind!=='idle'?`当前 ${current.label}${source?` · ${source}`:''}${current.endAt?` · ${clockText(current.endAt)} 结束`:''}`
      :detailed&&p.next?`下一项 ${nextText(p)}`
      :current.kind!=='idle'?(current.endAt?`${source?source+' · ':''}${clockText(current.endAt)} 结束`:(source||'进行中'))
      :p.code==='TERM_NOT_STARTED'?p.termStart+' 开始'
      :p.next?`${nextText(p)}`:'暂无下一项';
    // 三个层级：称呼（谁）→ 状态（发生了什么）→ 依据（时间与地点），
    // 这样“我的 / Ta”并列时读起来是两块状态，而不是两行普通文字。
    return h('div',{className:'person-status',key:p.person},
      h('span',{className:`person-dot tone-${companionTone(presenceStateFor(p))} ${p.person}`}),
      h('div',{className:'person-status-body'},
        h('span',{className:'person-status-label'},identity),
        h('strong',null,statusLabel(p)),
        h('small',null,secondary)),
      // 只给本人开入口：状态由状态主体本人确认（Phase 3C §7）。
      onSetStatus&&p.role==='self'?h('button',{type:'button',className:'text-button person-status-set','data-set-status':p.person,onClick:()=>onSetStatus(p.person)},'设置当前状态'):null
    );
  });
  return h('div',{className:compact?'status-pills':'dual-status'},...rows);
}
export function Titlebar(){return h('header',{className:'titlebar'},h('span',{className:'titlebar-brand'},h(BrandGlyph,{className:'yd-glyph',title:''}),h('b',null,'YD'),h('em',null,'· Your Day')),h('div',{className:'window-controls'},...([['minimize','−','最小化'],['maximize','□','最大化或还原'],['close','×','收起到托盘']] as const).map(([action,label,title])=>h('button',{key:action,title,'aria-label':title,onClick:()=>void api.window(action)},label))));}
function StatusCore({state}:{state:PresenceState}){return h('span',{className:'status-core','aria-hidden':true},h('i',{className:'status-ring'}),h('i',{className:'status-dot'}));}
function dockStatusLabel(status:PersonStatus){
  const byKind:Record<string,string>={class:'上课中',research:'教研中',meeting:'会议中',sleep:'睡眠中',wake:'已起床',meal:'用餐中',nap:'午休中',commute:'通勤中',focus:'专注中',custom:'自定义',busy:'忙碌中',rest:'休息中'};
  if(status.current.kind!=='idle')return byKind[status.current.kind]??statusLabel(status);
  const idle:Partial<Record<PersonStatus['code'],string>>={TERM_NOT_STARTED:'未开课',DAY_FINISHED:'今日结束',NO_SCHEDULE:'无课表',NO_CLASS_TODAY:'今天无课',TERM_ENDED:'学期结束',UPCOMING:'即将开始',UNKNOWN:'暂不可用'};
  return idle[status.code]??'空闲';
}
function dockExtra(status:PersonStatus,now:number){
  const end=status.current.endAt;
  if(status.current.kind!=='idle'&&end&&end>now){const minutes=Math.max(1,Math.ceil((end-now)/60000));return minutes<60?`还有 ${minutes} 分钟`:`还有 ${Math.ceil(minutes/60)} 小时`;}
  if(status.next)return `${clockText(status.next.start)} 开始`;
  return status.code==='DAY_FINISHED'?'今天已结束':'随时可聊';
}
/**
 * Dual Status Dock 的一行：人物 label（来自档案，不硬编码）+ 状态点 + 状态。
 * 文字过长时由 CSS 省略号接管；状态永远来自 CurrentState（见 live.statusLabel）。
 * `data-code` 只把日程阶段码透给 CSS，用于"今日结束"这类已完成语义的灰阶分化。
 */
function DockRow({status,now,hovered,onHover}:{status:PersonStatus;now:number;hovered:boolean;onHover?:(person:PersonId)=>void}){
  const person=status.person;
  const state=presenceStateFor(status);
  const current=status.current;
  return h('div',{className:`dock-row presence-${person} state-${state} kind-${current.kind} source-${current.source}${hovered?' is-hovered':''}`,'data-person':person,'data-state-kind':current.kind,'data-code':status.code,onPointerEnter:()=>onHover?.(person)},
    h('span',{className:'dock-alias'},status.alias),
    h(StatusCore,{state}),
    h('span',{className:'dock-status'},dockStatusLabel(status)),
    h('span',{className:'dock-extra'},dockExtra(status,now)));
}
// Dock 按实际档案渲染平级 person item：2 人双项，1 人重排为独立 Solo，不保留空槽。
// `expanded` 来自渲染层的真实指针状态：点击穿透窗口不会触发 CSS :hover，
// 因此"整块状态牌一起显露第二行"必须由状态驱动（见 DesktopPet 的 onPointerEnter）。
function CompanionDock({animate,people,now,hovered,expanded,onHover}:{animate:boolean;people:PersonStatus[];now:number;hovered?:PersonId;expanded?:boolean;onHover?:(person:PersonId)=>void}){
  // 无障碍文案与 Mini / Tip / Tray 同源（statusLabel），不再有第二套粗粒度状态词。
  const labels=people.map(status=>`${status.name} ${statusLabel(status)}`).join('、');
  return h('div',{className:`dock-surface${people.length<2?' solo':''}${expanded?' is-expanded':''}${animate?' motion':''}`,'role':'status','aria-label':people.length>1?`当前状态：${labels}`:`当前状态：${labels}`},
    ...people.map(status=>h(DockRow,{key:status.person,status,now,hovered:hovered===status.person,onHover})));
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
  const live=useLive(),assets=useCompanionAssets(live?.petInstance.avatarPackId,true),drag=useRef<{x:number;y:number;pointerId:number;target:HTMLButtonElement}|null>(null),moved=useRef(false),draggingRef=useRef(false),hoverArmed=useRef(true),clickTimer=useRef<ReturnType<typeof setTimeout>|null>(null),[dragging,setDragging]=useState(false),[hovering,setHovering]=useState(false);useSurface('pet-body');
  const p=live?.preferences??petDefaults;
  // 专属角色桌宠是唯一默认形象：素材即使读不到也只用“同一形象的待机帧”，
  // 不会再切换到其它角色。
  const custom=p.mode==='custom';
  // “减少动态”对三种显示模式一视同仁：呼吸、眨眼、徽章脉冲与提醒轻提示都会停。
  const motion={animate:p.animate&&!p.reduceMotion,reduceMotion:p.reduceMotion};
  const people=live?.people??[];
  const hidePresence=()=>void api.presence('leave');
  const finishDrag=(target?:HTMLButtonElement,pointerId?:number)=>{
    const active=drag.current,wasDragging=draggingRef.current;drag.current=null;draggingRef.current=false;setDragging(false);if(wasDragging)hidePresence();
    const element=target??active?.target,id=pointerId??active?.pointerId;
    if(element&&id!==undefined&&element.hasPointerCapture(id))element.releasePointerCapture(id);
    if(active)void api.endDrag();
  };
  useEffect(()=>{const clear=()=>{hoverArmed.current=false;setHovering(false);finishDrag();if(clickTimer.current)clearTimeout(clickTimer.current);};window.addEventListener('blur',clear);return()=>{window.removeEventListener('blur',clear);if(clickTimer.current)clearTimeout(clickTimer.current);};},[]);
  // 兜底：即使指针捕获失败或松手发生在窗口之外，也要结束拖动，避免桌宠
  // 一直停在“拖动中”而看起来像卡住。
  useEffect(()=>{
    if(!dragging)return;
    const stop=()=>{hoverArmed.current=false;finishDrag();};
    window.addEventListener('pointerup',stop,true);
    window.addEventListener('pointercancel',stop,true);
    return()=>{window.removeEventListener('pointerup',stop,true);window.removeEventListener('pointercancel',stop,true);};
  },[dragging]);
  const hover=(person:PersonId)=>{if(!draggingRef.current&&hoverArmed.current)void api.presence('enter',person);};
  // leave：离开状态牌 → 收起第二行；拖动中不切换（拖动有自己的收尾逻辑）。
  const leave=()=>{setHovering(false);hidePresence();if(!draggingRef.current)hoverArmed.current=true;};
  const label=p.mode==='orb'?'拖动状态浮标，单击查看状态':people.length>1?'拖动桌宠，单击查看双方状态':'拖动桌宠，单击查看当前状态';
  // 手势状态机：pointerdown 只是 potential click；移动达到 5px 才进入 dragging。
  // dragging 后只转发 screen 坐标，本次序列不会再触发 click / double click。
  const dragHandlers={
    // CSS :hover 在点击穿透（WS_EX_TRANSPARENT）窗口里不会生效，因此整块状态牌的
    // 二级信息展开由真实指针进入/离开驱动。
    onPointerEnter:()=>{if(!draggingRef.current)setHovering(true);},
    onPointerLeave:leave,
    onContextMenu:(e:React.MouseEvent)=>{e.preventDefault();hoverArmed.current=false;hidePresence();void api.window('menu');},
    onPointerDown:(e:React.PointerEvent<HTMLButtonElement>)=>{
      if(e.button!==0)return;
      moved.current=false;
      drag.current={x:e.screenX,y:e.screenY,pointerId:e.pointerId,target:e.currentTarget};
      void api.beginDrag(e.screenX,e.screenY);
      try{e.currentTarget.setPointerCapture(e.pointerId);}catch{/* 指针不可捕获时仍然可以继续拖动 */}},
    onPointerMove:(e:React.PointerEvent)=>{
      if(!drag.current)return;
      const dx=e.screenX-drag.current.x,dy=e.screenY-drag.current.y;
      if(Math.hypot(dx,dy)>=5||moved.current){if(!moved.current){moved.current=true;draggingRef.current=true;hoverArmed.current=false;hidePresence();setDragging(true);}void api.drag(e.screenX,e.screenY);}},
    onPointerUp:(e:React.PointerEvent<HTMLButtonElement>)=>finishDrag(e.currentTarget,e.pointerId),
    onPointerCancel:(e:React.PointerEvent<HTMLButtonElement>)=>{hoverArmed.current=false;finishDrag(e.currentTarget,e.pointerId);},
    onLostPointerCapture:()=>{hoverArmed.current=false;finishDrag();},
    onClick:()=>{if(moved.current)return;if(clickTimer.current)clearTimeout(clickTimer.current);clickTimer.current=setTimeout(()=>{clickTimer.current=null;void api.window('mini');},220);},
    onDoubleClick:(e:React.MouseEvent)=>{e.preventDefault();if(clickTimer.current){clearTimeout(clickTimer.current);clickTimer.current=null;}},
  };
  const handle=h('button',{'data-interactive':true,className:`pet-handle${p.mode==='orb'?' dock-handle':''}`,'aria-label':label,...dragHandlers},
    custom
      // 固定画布：stage 只负责角色本体与动作，rail 是它的兄弟节点，
      // 两者的 transform / 动画永远不会互相影响，拖动时也不会被裁掉。
      ?h('div',{className:'sprite-stage'},h('div',{className:'sprite-inner'},h('span',{className:'sprite-shadow','aria-hidden':true}),h(CustomCompanionArt,{assets,display:live?.display,frozen:dragging,...motion})))
      :h(CompanionDock,{animate:motion.animate,people,now:live?.now??Date.now(),hovered:live?.hoverTip?.person,expanded:hovering&&!dragging,onHover:hover}));
  const side=custom
    ?h('div',{className:'status-rail'},h('button',{'data-interactive':true,className:'companion-rail-button',title:people.length>1?'查看双方状态':'查看当前状态',onClick:()=>void api.window('mini')},h(CompanionRail,{live})))
    :null;
  // 状态牌的可见高度契约来自 companion-layout（默认 / hover 两档），窗口尺寸固定不变。
  const dockMetrics=dockSurfaceMetrics(p.mode==='orb'?'orb':'custom',p.size,people.length);
  return h('div',{className:`pet-dock ${p.mode==='orb'?'orb-mode':'custom-mode'}${dragging?' is-dragging':''}`,style:{
    '--rail-height':companionRail.height+'px',
    '--frame-pad-x':companionFrame.padX+'px',
    '--frame-pad-y':companionFrame.padY+'px',
    '--dock-height':dockMetrics.defaultHeight+'px',
    '--dock-height-hover':dockMetrics.hoverHeight+'px',
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
export function Bubble(){const live=useLive();useSurface('bubble-body');return live?.bubble?h('section',{'data-interactive':true,className:'speech-cloud'+(live.bubble.below?' cloud-below':''),role:'status',onMouseEnter:()=>void api.bubble('hold'),onMouseLeave:()=>void api.bubble('release')},h('button',{className:'cloud-close',title:'收起气泡',onClick:()=>void api.bubble('close')},'×'),h('small',null,'时间小提醒'),h('div',{className:'cloud-text'},live.bubble.text),h('button',{className:'text-button',onClick:()=>void api.window('mini')},'查看状态 →')):null;}
export function Mini(){
  const live=useLive();
  // 详情面板的窗口比卡片大 8px 一圈，这圈透明画布留给 CSS 阴影（见 style.css）。
  useEffect(()=>{document.documentElement.classList.add('companion-root');document.body.classList.add('mini-body');return()=>{document.body.classList.remove('mini-body');document.documentElement.classList.remove('companion-root');};},[]);
  const solo=(live?.people.length??1)<=1;
  // Asset 04 的详情面板：标题区（衬线标题 + 说明 + 右侧品牌块）→ 两块 person 区域
  // （首字母 + 状态点 + 状态 → 当前）→ 贯通的分隔线 → 下一个（时间 + 标题 + 地点 + 箭头）。
  // 层级只由间距、字号与极淡分隔线建立，不做卡片套卡片。
  const people=live?.people??[];
  const iconSlot=(name:ReturnType<typeof iconForCurrent>)=>h('span',{className:'mini-icon-slot'},name?h('img',{className:'mini-icon',src:iconSrc(name),alt:'',draggable:false}):null);
  const currentText=(status:PersonStatus)=>status.current.kind==='idle'?'暂无安排':status.current.label||dockStatusLabel(status);
  const today=live?(()=>{
    const parts=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',weekday:'short'}).formatToParts(live.now);
    const pick=(type:string)=>parts.find(part=>part.type===type)?.value??'';
    return `${pick('month')}月${pick('day')}日 · ${pick('weekday')}`;
  })():'';
  const subtitle=[today,live?.pending?`${live.pending} 条提醒待处理`:'',live?.display.nightly?'夜间休息中':''].filter(Boolean).join(' · ');
  const head=(status:PersonStatus)=>h('div',{className:'mini-person-head'},
    h('span',{className:'mini-alias'},status.alias),
    h(StatusCore,{state:presenceStateFor(status)}),
    // 面板头部用短状态词（与状态牌同源），长文案交给下方「当前」行，避免在窄列里被截断。
    h('strong',{className:'mini-person-state'},dockStatusLabel(status)));
  const currentRow=(status:PersonStatus)=>h('div',{className:'mini-row'},
    iconSlot(iconForCurrent(status.current)),
    h('div',{className:'mini-row-body'},
      h('span',{className:'mini-row-label'},'当前'),
      h('b',{title:currentText(status)},currentText(status))));
  const nextRow=(status:PersonStatus)=>{
    const next=status.next;
    const text=next?`${clockText(next.start)} · ${next.title}`:status.code==='DAY_FINISHED'?'今天的安排已经结束':'暂无下一项安排';
    // 地点与标题同一行（Asset 04 的「下一个」是一行：时间 + 标题），必要时标题占两行。
    const body=h('div',{className:'mini-row-body'},
      h('span',{className:'mini-row-label'},'下一个'),
      h('strong',{title:next?.place?`${text} · ${next.place}`:text},text,next?.place?h('small',{className:'mini-place'},` · ${next.place}`):null));
    const chevron=next?h('span',{className:'mini-chevron','aria-hidden':true},'›'):null;
    // 有下一项时整行可点：打开 YD 主窗口（箭头因此是真实的可点击提示，不是装饰）。
    return next
      ?h('button',{type:'button',key:status.person,className:'mini-next','data-person':status.person,onClick:()=>void api.window('open')},iconSlot(iconForNext(next)),body,chevron)
      :h('div',{key:status.person,className:'mini-next','data-person':status.person},iconSlot(iconForNext(next)),body);
  };
  /* ---------- Solo：单人参照图形态（我的 · 此刻 + 两块圆角块 + 页脚） ---------- */
  if(solo){
    const status=people[0];
    const current=status?.current;
    const next=status?.next??null;
    const state=status?presenceStateFor(status):'offline';
    const dayText=next?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric'}).format(next.start):'';
    const today=next&&new Date(next.start).toDateString()===new Date(live?.now??Date.now()).toDateString();
    return h(React.Fragment,null,
      h('section',{className:'mini-panel solo'},
        h('header',{className:'mini-head'},
          h('h2',null,'我的 · 此刻'),
          h('div',{className:'mini-solo-brand'},
            h('b',null,'YD'),
            h('button',{type:'button',className:'mini-gear',title:'设置', 'aria-label':'设置',onClick:()=>void api.window('settings')},
              h('svg',{viewBox:'0 0 24 24',width:26,height:26,'aria-hidden':true},
                // 标准齿轮轮廓（Material settings 图标路径），与参考图右上角的设置入口一致。
                h('path',{d:'M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54a7 7 0 0 0-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.49.49 0 0 0 .12.61l2.03 1.58a7 7 0 0 0 0 1.88l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.05.7 1.62.94l.36 2.54c.05.24.25.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54a7 7 0 0 0 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.03-1.58ZM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2Z',fill:'currentColor'}))))),
        status?h('article',{className:`mini-status-card solo-block solo-state state-${state}`,'data-person':status.person,'data-state-kind':current?.kind??'idle','data-code':status.code},
          h(StatusCore,{state}),
          h('div',{className:'solo-state-body'},
            h('strong',null,dockStatusLabel(status)),
            h('small',null,dockExtra(status,live?.now??Date.now())))):null,
        status?h('article',{className:'mini-next solo-block solo-next','data-person':status.person},
          iconSlot(iconForNext(next)),
          h('div',{className:'solo-next-body'},
            h('span',{className:'mini-row-label'},'下一项安排'),
            h('strong',{title:next?`${next.title}${next.place?` · ${next.place}`:''}`:''},next?next.title:'暂无下一项安排'),
            next?h('small',null,`${today?'今天':dayText} ${clockText(next.start)}${next.place?` · ${next.place}`:''}`):null),
          h('button',{type:'button',className:'solo-open',onClick:()=>void api.window('open')},
            h('span',null,'打开 YD'),
            h('svg',{viewBox:'0 0 24 24',width:22,height:22,'aria-hidden':true},
              h('path',{d:'M5 12h12M13 6l6 6-6 6',fill:'none',stroke:'currentColor','stroke-width':1.8,'stroke-linecap':'round','stroke-linejoin':'round'})))):null,
        h('p',{className:'solo-foot'},h('i',{'aria-hidden':true}),'专注当下，就是更好的自己。')),
      h('span',{className:'mini-tail','aria-hidden':true}));
  }
  return h(React.Fragment,null,
    h('section',{className:`mini-panel${solo?' solo':''}`},
      h('header',{className:'mini-head'},
        h('div',{className:'mini-title'},
          h('h2',null,solo?'此刻':'我们 · 此刻'),
          h('p',{className:'mini-subtitle'},subtitle)),
        h('div',{className:'mini-brand-block'},
          h(BrandGlyph,{className:'mini-brand-glyph',title:''}),
          h('div',{className:'mini-brand-words'},
            h('b',null,'YD'),
            h('i',{'aria-hidden':true}),
            h('small',null,'your day, quietly organized.')))),
      h('div',{className:'mini-status-grid'},...people.map(status=>h('article',{className:`mini-status-card state-${presenceStateFor(status)}`,key:status.person,'data-person':status.person,'data-state-kind':status.current.kind,'data-code':status.code},head(status),currentRow(status)))),
      h('div',{className:'mini-divider','aria-hidden':true}),
      h('div',{className:'mini-next-grid'},...people.map(nextRow)),
      h('div',{className:'mini-actions'},
        h('button',{className:'primary',onClick:()=>void api.window('open')},live?.pending?`打开 YD · ${live.pending} 条待处理`:'打开 YD'),
        h('button',{className:'ghost',onClick:()=>void api.window('settings')},'设置'))),
    h('span',{className:'mini-tail','aria-hidden':true}));
};
const modeOptions:[PetPreferences['mode'],string,string][]=[
  ['custom','角色陪伴','使用当前角色素材，并随状态切换动作'],
  ['orb','状态 Dock','轻量显示当前状态，适合随时扫一眼'],
];

const motionOptions:['standard'|'reduced',string,string][]=[
  ['standard','标准','随状态轻轻呼吸、轻微上浮'],
  ['reduced','减少','几乎静止，只在状态变化时淡入'],
];

const errorText=(e:unknown)=>e instanceof Error?e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''):String(e);

// 日常节奏（每个档案自己的 Routine）。所有写入都走 Command → core apply → validate → Store：
// 这里只准备"下一份规则数组"，绝不直接改 State。
function RoutineSettings({state,busy,onError}:{state:State;busy:boolean;onError:(message:string)=>void}){
  const options=routinePersonOptions(state.profiles);
  const subject=resolvePetSubject(state);
  const [selected,setSelected]=useState<PersonId|undefined>(undefined);
  const person=options.some(option=>option.id===selected)?selected!:subject.id;
  const profile:Profile|undefined=getProfileById(state,person)??state.profiles[0];
  const routine=profile?.routine;
  const rules=routine?.rules??[];
  const [draft,setDraft]=useState<RoutineRuleDraft|null>(null);
  const [draftError,setDraftError]=useState('');
  const [pending,setPending]=useState<{kind:'template'}|{kind:'clear'}|{kind:'delete';id:string}|null>(null);
  const [working,setWorking]=useState(false);
  if(!profile)return null;
  const locked=busy||working;

  const commit=(next:RoutineRule[],done?:()=>void)=>{
    setWorking(true);
    return api.change({type:'save',entity:'profiles',value:{...profile,routine:routineForRules(next,Date.now())}})
      .then(()=>{onError('');done?.();})
      .catch(e=>onError(errorText(e)))
      .finally(()=>setWorking(false));
  };
  const open=(rule?:RoutineRule)=>{setDraftError('');setPending(null);setDraft(routineDraft(rule));};
  const updateDraft=(patch:Partial<RoutineRuleDraft>)=>setDraft(old=>old?{...old,...patch}:old);
  const toggleDay=(day:number)=>setDraft(old=>old?{...old,days:old.days.includes(day)?old.days.filter(value=>value!==day):[...old.days,day].sort((a,b)=>a-b)}:old);
  const changeKind=(kind:RoutineRuleDraft['kind'])=>setDraft(old=>old?{...old,kind,label:old.label===routineDefaultLabelFor(old.kind)?routineDefaultLabelFor(kind):old.label,priority:routineKindPriority[kind]}:old);
  const saveDraft=()=>{
    if(!draft)return;
    const problem=routineDraftError(draft);
    if(problem){setDraftError(problem);return;}
    setDraftError('');
    void commit(routineRulesWith(rules,routineRuleFromDraft(draft,id())),()=>setDraft(null));
  };
  const applyPending=()=>{
    if(!pending)return;
    const next=pending.kind==='template'?createDefaultRoutine(Date.now()).rules
      :pending.kind==='clear'?[]
      :routineRulesWithout(rules,pending.id);
    void commit(next,()=>setPending(null));
  };

  const field=(label:string,child:any)=>h('label',{className:'field'},h('span',null,label),child);
  const ruleRow=(rule:RoutineRule)=>h('div',{key:rule.id,className:`routine-row${rule.enabled?'':' is-off'}`,'data-rule-id':rule.id},
    h('div',{className:'routine-row-main'},h('strong',null,rule.label),h('small',null,routineKindLabels[rule.kind])),
    h('span',{className:'routine-row-time'},routineWindowText(rule)),
    h('span',{className:'routine-row-days'},routineDaysText(rule.days)),
    h('label',{className:'routine-row-toggle',title:rule.enabled?'停用（保留记录）':'启用'},
      h('input',{type:'checkbox',checked:rule.enabled,disabled:locked,'aria-label':`${rule.enabled?'停用':'启用'}${rule.label}`,onChange:(e:React.ChangeEvent<HTMLInputElement>)=>void commit(routineRulesToggled(rules,rule.id,e.target.checked))})),
    h('div',{className:'routine-row-actions'},
      h('button',{type:'button',className:'text-button','data-routine-action':'edit',disabled:locked,onClick:()=>open(rule)},'编辑'),
      h('button',{type:'button',className:'text-button','data-routine-action':'delete',disabled:locked,onClick:()=>setPending({kind:'delete',id:rule.id})},'删除')));

  const actionButton=(action:string,label:string,className:string,onClick:()=>void)=>h('button',{key:action,type:'button',className,'data-routine-action':action,disabled:locked,onClick},label);
  const actions=h('div',{className:'actions routine-actions'},
    actionButton('add','添加一条','secondary',()=>open()),
    actionButton('template','使用默认作息','ghost',()=>setPending({kind:'template'})),
    actionButton('clear','清空作息','ghost',()=>setPending({kind:'clear'})));

  const confirmRow=!pending?null:h('div',{className:'routine-confirm',role:'alertdialog','aria-label':'确认作息修改'},
    h('span',null,pending.kind==='template'?'用默认作息覆盖当前规则？':pending.kind==='clear'?'清空后这套作息不再影响桌宠，之后可以重新添加。':'删除这段日常节奏？'),
    h('div',{className:'actions'},
      h('button',{type:'button',className:pending.kind==='template'?'secondary':'danger','data-routine-action':`confirm-${pending.kind}`,disabled:locked,onClick:applyPending},
        pending.kind==='template'?'使用默认作息':pending.kind==='clear'?'确认清空':'确认删除'),
      h('button',{type:'button',className:'ghost','data-routine-action':'cancel-pending',disabled:locked,onClick:()=>setPending(null)},'取消')));

  const editor=!draft?null:h('div',{className:'modal-backdrop'},h('section',{className:'modal small routine-editor',role:'dialog','aria-modal':true,'aria-label':'编辑日常节奏'},
    h('div',{className:'modal-head'},h('h2',null,draft.id?'编辑日常节奏':'添加日常节奏')),
    h('div',{className:'form-grid'},
      field('名称',h('input',{type:'text',value:draft.label,maxLength:40,'aria-label':'作息名称',onChange:(e:React.ChangeEvent<HTMLInputElement>)=>updateDraft({label:e.target.value})})),
      field('类型',h('select',{value:draft.kind,'aria-label':'作息类型',onChange:(e:React.ChangeEvent<HTMLSelectElement>)=>changeKind(e.target.value as RoutineRuleDraft['kind'])},
        ...(Object.keys(routineKindLabels) as RoutineRuleDraft['kind'][]).map(kind=>h('option',{key:kind,value:kind},routineKindLabels[kind])))),
      field('开始（北京时间）',h('input',{type:'time',value:draft.start,'aria-label':'开始时间',onChange:(e:React.ChangeEvent<HTMLInputElement>)=>updateDraft({start:e.target.value})})),
      field('结束（北京时间）',h('input',{type:'time',value:draft.end,'aria-label':'结束时间',onChange:(e:React.ChangeEvent<HTMLInputElement>)=>updateDraft({end:e.target.value})})),
      h('div',{className:'field full'},h('span',null,'适用星期'),
        h('div',{className:'routine-days-picker',role:'group','aria-label':'适用星期'},...routineWeekdayLabels.map((label,index)=>h('button',{key:label,type:'button',className:draft.days.includes(index+1)?'active':'','aria-pressed':draft.days.includes(index+1),'data-routine-day':index+1,disabled:locked,onClick:()=>toggleDay(index+1)},label)))),
      h('div',{className:'field full'},h('label',{className:'check-row'},h('input',{type:'checkbox',checked:draft.enabled,'aria-label':'启用这条作息',disabled:locked,onChange:(e:React.ChangeEvent<HTMLInputElement>)=>updateDraft({enabled:e.target.checked})}),'启用（停用会保留这条记录）')),
      draft.end<=draft.start?h('p',{className:'muted full'},`跨过午夜：${draft.start} → 次日 ${draft.end}`):null,
      !routineKindHasPetState(draft.kind)?h('p',{className:'muted full'},`${routineKindLabels[draft.kind]}：${routineKindHint}`):null),
    draftError?h('p',{className:'error',role:'alert'},draftError):null,
    h('div',{className:'modal-foot'},
      h('button',{type:'button',className:'ghost','data-routine-action':'cancel-edit',disabled:locked,onClick:()=>setDraft(null)},'取消'),
      h('button',{type:'button',className:'primary','data-routine-action':'save-rule',disabled:locked,onClick:saveDraft},'保存'))));

  return h('div',{className:'routine-settings'},
    options.length>1?h('nav',{className:'text-tabs routine-people',role:'radiogroup','aria-label':'选择要编辑的人'},
      ...options.map(option=>h('button',{key:option.id,type:'button',role:'radio','aria-checked':person===option.id,className:person===option.id?'active':'','data-routine-person':option.id,disabled:locked,onClick:()=>setSelected(option.id)},option.label))):null,
    routineNeedsConfirmation(routine)?h('p',{className:'muted setting-note routine-legacy-note'},'用于补充课程之外的日常状态，可随时调整。'):null,
    routineIsEmpty(routine)
      ? h(React.Fragment,null,
          h(EmptyState,{compact:true,title:'还没有设置日常节奏',description:'设置后，YD 可以让桌宠的吃饭、午休和睡眠状态与你的实际作息一致。',actions:[
            h('button',{key:'template',type:'button',className:'secondary','data-routine-action':'template',disabled:locked,onClick:()=>setPending({kind:'template'})},'使用默认作息'),
            h('button',{key:'add',type:'button',className:'primary','data-routine-action':'add',disabled:locked,onClick:()=>open()},'添加第一条'),
          ]}),
          confirmRow)
      : h(React.Fragment,null,h('div',{className:'routine-list'},...rules.map(ruleRow)),confirmRow,actions),
    editor);
}

const avatarPreviewDisplay=(state:CompanionDisplayState):CompanionDisplay=>({
  state,base:state,label:companionDisplayLabels[state],pending:0,nightly:state==='night_sleep',
  nudgeId:0,reminderSince:0,holdingReminder:false,
  scheduled:state==='night_sleep'||state==='wake_up'||state==='eating'||state==='nap'?state:null,
});

function AvatarPackCard({pack,active,selected,busy,onPreview}:{pack:AvatarPackManifest;active:boolean;selected:boolean;busy:boolean;onPreview:()=>void}){
  const assets=useAvatarPreviewAssets(pack.id);
  return h('button',{type:'button',className:`avatar-pack-card${active?' is-previewing':''}${selected?' is-selected':''}`,'data-avatar-pack-option':pack.id,'aria-pressed':active,disabled:busy,onClick:onPreview},
    h('span',{className:'avatar-pack-card-art'},h(CustomCompanionArt,{assets,display:avatarPreviewDisplay(pack.previewState),animate:false,reduceMotion:true})),
    h('span',{className:'avatar-pack-card-copy'},h('strong',null,pack.name),h('small',null,selected?'当前使用':'点击预览')));
}

function AvatarPersonPicker({profile,busy,run}:{profile:Profile;busy:boolean;run:(fn:()=>Promise<unknown>)=>Promise<unknown>}){
  const selection=resolveAvatarPickerSelection(profile);
  const persistedId=selection.persistedPackId;
  const persistedPack=getAvatarPack(persistedId);
  const [candidate,setCandidate]=useState(selection.previewPackId);
  const pack=getAvatarPack(candidate)??getAvatarPack(DEFAULT_AVATAR_PACK_ID)!;
  const [previewState,setPreviewState]=useState<CompanionDisplayState>(pack.previewState);
  const assets=useAvatarPreviewAssets(pack.id);
  useEffect(()=>{const current=getAvatarPack(persistedId);setCandidate(current?.id??DEFAULT_AVATAR_PACK_ID);},[profile.id,persistedId]);
  useEffect(()=>setPreviewState(pack.previewState),[pack.id]);
  const selectedAvailable=!!persistedPack;
  const title=profile.role==='self'?'当前角色':`${profile.name}的角色`;
  return h('section',{className:'avatar-person-picker','data-avatar-person':profile.id},
    h('div',{className:'avatar-picker-head'},h('div',null,h('h4',null,title),h('p',{className:'muted'},profile.role==='self'?'单人或双人模式下的本人角色':'添加陪伴对象后显示的同行者角色')),
      !selectedAvailable?h('span',{className:'avatar-unavailable','data-avatar-unavailable':'true'},'当前选择不可用'):null),
    h('div',{className:'avatar-picker-layout'},
      h('div',{className:'avatar-pack-grid'},...listAvatarPacks().map(option=>h(AvatarPackCard,{key:option.id,pack:option,active:option.id===pack.id,selected:selectedAvailable&&option.id===persistedId,busy,onPreview:()=>setCandidate(option.id)}))),
      h('div',{className:'avatar-preview','data-avatar-preview-pack':pack.id,'data-avatar-preview-state':previewState},
        h('div',{className:'avatar-preview-stage'},h(CustomCompanionArt,{assets,display:avatarPreviewDisplay(previewState),animate:false,reduceMotion:true})),
        h('div',{className:'avatar-preview-meta'},h('strong',null,pack.name),h('span',null,companionDisplayLabels[previewState])),
        h('div',{className:'avatar-state-picker',role:'group','aria-label':`${title}预览状态`},...companionVisualStates.map(state=>h('button',{key:state,type:'button',className:state===previewState?'active':'','data-avatar-preview-state-option':state,disabled:busy,onClick:()=>setPreviewState(state)},companionDisplayLabels[state]))))),
    !selectedAvailable?h('p',{className:'muted setting-note'},`此前选择 ${persistedId} 已不可用；设置未被自动修改，桌宠会安全显示默认形象。`):null,
    h('div',{className:'actions avatar-picker-actions'},
      h('button',{type:'button',className:'primary','data-avatar-apply':pack.id,disabled:busy||(persistedId===pack.id&&profile.avatar?.source==='user'),onClick:()=>void run(()=>api.change({type:'avatarSet',personId:profile.id,packId:pack.id}))},'使用此形象'),
      h('button',{type:'button',className:'ghost','data-avatar-reset':'true',disabled:busy||(persistedId===DEFAULT_AVATAR_PACK_ID&&profile.avatar?.source==='default'),onClick:()=>void run(()=>api.change({type:'avatarReset',personId:profile.id}))},'恢复默认')));
}

function AvatarSettings({state,busy,run}:{state:State;busy:boolean;run:(fn:()=>Promise<unknown>)=>Promise<unknown>}){
  return h('div',{className:'avatar-settings'},...state.profiles.map(profile=>h(AvatarPersonPicker,{key:profile.id,profile,busy,run})));
}

export type PetSettingsSection='companionship'|'rhythm'|'runtime';
export function PetSettings({live,settings,state,section='companionship'}:{live:LiveSnapshot|null;settings?:{launch:boolean;trayResident?:boolean};state?:State;section?:PetSettingsSection}){
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const assets=useCompanionAssets(live?.petInstance.avatarPackId);
  const p=live?.preferences??petDefaults;
  const run=(fn:()=>Promise<unknown>)=>{setBusy(true);return fn().then(()=>setError('')).catch(e=>setError(String(e))).finally(()=>setBusy(false));};
  const save=(pet:Partial<PetPreferences>)=>run(()=>api.change({type:'settings',pet}));
  const saveSetting=(value:{launch?:boolean;trayResident?:boolean})=>run(()=>api.change({type:'settings',...value}));
  const paused=p.pausedUntil>(live?.now??Date.now());
  const settingRow=(label:string,description:string,control:React.ReactNode)=>h('div',{className:'setting-row'},h('div',{className:'setting-row-copy'},h('strong',null,label),h('small',null,description)),h('div',{className:'setting-row-control'},control));
  const check=(label:string,description:string,checked:boolean,onChange:(value:boolean)=>void,disabled=false)=>settingRow(label,description,h('label',{className:'setting-switch'},h('input',{type:'checkbox',checked,disabled:disabled||busy,'aria-label':label,onChange:(e:React.ChangeEvent<HTMLInputElement>)=>onChange(e.target.checked)}),h('span',{'aria-hidden':true})));
  const block=(title:string,children:React.ReactNode)=>h('div',{className:'setting-block'},h('h3',null,title),children);
  const motionMode=p.reduceMotion?'reduced':'standard';
  // 这里说的是"桌宠主体"的作息：Together 是同行者，Solo 是本人。
  const schedule=petRoutineSummary(state?resolvePetSubject(state).routine:undefined);
  const sizeChoices=h('div',{className:'segmented setting-segmented'},...(['small','medium','large'] as const).map((value,index)=>h('button',{key:value,type:'button',className:p.size===value?'active':'',disabled:busy,onClick:()=>save({size:value})},['小','中','大'][index])));
  const together=(state?.profiles.length??1)>1;
  return h('section',{className:'pet-settings'},h('h2',null,section==='companionship'?'桌面陪伴':section==='rhythm'?'节奏与状态':'运行与提醒'),
    section==='companionship'&&state?block('角色',h(AvatarSettings,{state,busy,run})):null,
    section==='companionship'?block('呈现方式',h(React.Fragment,null,
      h('div',{className:'mode-choices',role:'radiogroup','aria-label':'桌宠显示模式'},...modeOptions.map(([value,label,note])=>{
        return h('button',{key:value,type:'button',role:'radio','aria-checked':p.mode===value,className:p.mode===value?'mode-choice active':'mode-choice',disabled:busy,onClick:()=>save({mode:value})},
          h('strong',null,label),h('small',null,note));
      })),
      settingRow(p.mode==='custom'?'角色大小':'Dock 大小',p.mode==='custom'?'调整桌面角色的显示尺寸':'调整状态 Dock 的显示尺寸',sizeChoices),
      h('p',{className:'muted setting-note'},assets?assets.reason:'正在读取专属角色素材……'),
      paused?h('p',{className:'muted setting-note'},`气泡已暂停，${clockText(p.pausedUntil)} 自动恢复。`):null)):null,
    section==='rhythm'?block('动态效果',h('div',{className:'mode-choices',role:'radiogroup','aria-label':'桌宠动态效果'},...motionOptions.map(([value,label,note])=>h('button',{key:value,type:'button',role:'radio','aria-checked':motionMode===value,className:motionMode===value?'mode-choice active':'mode-choice',disabled:busy,onClick:()=>save({animate:true,reduceMotion:value==='reduced'})},h('strong',null,label),h('small',null,note))))):null,
    section==='rhythm'?block('气泡提醒',h(React.Fragment,null,
      check('气泡提醒','到时间时在桌面陪伴旁显示提醒',p.bubbles,value=>save({bubbles:value}),paused),
      settingRow('停留时长','控制提醒气泡在桌面停留的时间',h('span',{className:'setting-inline'},h('input',{type:'number',min:3,max:30,value:p.duration,disabled:busy||paused,onChange:(e:React.ChangeEvent<HTMLInputElement>)=>{const n=Number(e.target.value);if(n>=3&&n<=30)save({duration:n});}}),'秒')),
      h('div',{className:'actions'},paused?h('button',{type:'button',className:'secondary',disabled:busy,onClick:()=>save({pausedUntil:0})},'恢复气泡提醒'):h('button',{type:'button',className:'secondary',disabled:busy,onClick:()=>save({pausedUntil:Date.now()+3600000})},'暂停气泡 1 小时')))):null,
    section==='rhythm'?block('作息状态',h(React.Fragment,null,
      // 时间状态与这段说明都来自桌宠主体自己的作息（profile.routine），不是写死的时间表。
      check('夜间睡眠',schedule.sleep||'根据日常节奏补充夜间状态',p.nightRest,value=>save({nightRest:value})),
      h('p',{className:'muted setting-note'},!schedule.sleep
        ?'当前作息里没有睡觉时段，桌宠不会自动进入睡眠姿态；其它时间状态仍按作息生效。'
        :p.nightRest
          ?`${schedule.sleep} 之间，只要没有进行中的安排、也没有到时间的提醒，桌宠就会安静地睡觉${schedule.states?`；${schedule.states}`:''}。`
          :'已关闭夜间自动睡觉：夜间也按平时的状态显示，其它时间状态仍按作息生效。'),
      h('p',{className:'muted setting-note'},'时间状态按作息规则与北京时间判断，不需要联网校准。'))):null,
    section==='rhythm'&&state?block('日常节奏',h(RoutineSettings,{state,busy,onError:setError})):null,
    section==='runtime'?block('窗口行为',h(React.Fragment,null,
      check('单击查看状态',together?'显示双方当前状态与下一项安排':'显示当前状态与下一项安排',p.miniPanel,value=>save({miniPanel:value})),
      check('记住桌面位置','下次启动时恢复桌面陪伴的位置',p.rememberPosition,value=>save({rememberPosition:value})),
      check('关闭后驻留托盘','主窗口关闭后继续处理提醒',settings?.trayResident!==false,value=>saveSetting({trayResident:value})),
      settings?.trayResident===false?h('p',{className:'muted setting-note'},'关闭主窗口将退出 YD，退出后不会触发提醒。'):null,
      check('登录 Windows 后启动','进入桌面后自动运行 YD',!!settings?.launch,value=>saveSetting({launch:value})))):null,
    error?h('p',{className:'error',role:'alert'},error):null);
}
