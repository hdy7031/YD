import React,{useState,useEffect,useLayoutEffect,useRef} from 'react';
import type { LiveSnapshot,PersonStatus,PetPreferences,PresenceState } from '../live.ts';
import type { PersonId, Profile, State } from '../types.ts';
import {clockText,personPresentation,petDefaults,presenceStateFor,statusLabel} from '../live.ts';
import {DEFAULT_AVATAR_PACK_ID,getAvatarPack,listAvatarPacks,type AvatarPackManifest} from '../avatar.ts';
import {resolveAvatarPickerSelection} from '../avatar-picker.ts';
import {companionDisplayLabels} from '../companion-display.ts';
import {companionVisualStates,type CompanionDisplayState} from '../companion-visual.ts';
import {companionTone,type CompanionTone} from '../companion-colors.ts';
import {companionDock,companionFrame,companionRail,dockDetail,dockDetailPanel,dockSurfaceMetrics,type DockMeasure} from '../companion-layout.ts';
// Asset 03 语义图标（素材图 4 的七枚原素材）：只在表现层把 CurrentState / 下一项
// 映射到真实图片，找不到准确映射时返回 null —— 不用 emoji、不用第三方图标替代。
import {iconForCurrent,iconForNext,iconSrc} from './state-icons.ts';
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
const h=React.createElement,api=window.dayhub;
export function useLive(){const [live,set]=useState<LiveSnapshot|null>(null);useEffect(()=>{let mounted=true,received=false;const off=api.onLive(v=>{received=true;if(mounted)set(v);});void api.live().then(v=>{if(mounted&&!received)set(v);});return()=>{mounted=false;off();};},[]);return live;}
export function StatusRows({live,compact=false,detailed=false,onSetStatus}:{live:LiveSnapshot|null;compact?:boolean;detailed?:boolean;onSetStatus?:(person:PersonId)=>void}){
  const rows=(live?.people||[]).map(p=>{
    // 称呼来自档案自身的显示名称（「我 / TA / 丹 / 喻老师」都由 Profile 提供）；
    // 紧凑标签仍可用短代号，但不再把本人硬编码成「我的」。
    const identity=compact?p.alias:p.name;
    const view=personPresentation(p);
    // 紧凑形态只有一行上下文；完整形态是"标题 + 两行短辅助"：
    //   称呼（谁）→ 状态（大字）→ 状态注（结束时间 / 来源 / 今天无课）→ 下一件事。
    // 每行只说一件事，不再用「·」把来源、结束时间、下一项、课程名串成一句话。
    const note=compact&&!detailed?view.secondaryLabel:view.statusNote;
    const next=compact&&!detailed?'':view.nextLine;
    return h('div',{className:'person-status',key:p.person},
      h('span',{className:`person-dot tone-${view.dotTone} ${p.person}`}),
      h('div',{className:'person-status-body'},
        h('span',{className:'person-status-label'},identity),
        h('strong',null,view.primaryLabel),
        note?h('small',{className:'person-status-note'},note):null,
        next?h('small',{className:'person-status-next'},next):null),
      // 只给本人开入口：状态由状态主体本人确认（Phase 3C §7）。
      onSetStatus&&p.role==='self'?h('button',{type:'button',className:'text-button person-status-set','data-set-status':p.person,onClick:()=>onSetStatus(p.person)},'设置当前状态'):null
    );
  });
  return h('div',{className:compact?'status-pills':'dual-status'},...rows);
}
export function Titlebar(){return h('header',{className:'titlebar'},h('span',{className:'titlebar-brand'},h(BrandGlyph,{className:'yd-glyph',title:''}),h('b',null,'YD'),h('em',null,'· Your Day')),h('div',{className:'window-controls'},...([['minimize','−','最小化'],['maximize','□','最大化或还原'],['close','×','收起到托盘']] as const).map(([action,label,title])=>h('button',{key:action,title,'aria-label':title,onClick:()=>void api.window(action)},label))));}
function StatusCore({tone}:{tone:CompanionTone}){return h('span',{className:`status-core tone-${tone}`,'aria-hidden':true},h('i',{className:'status-ring'}),h('i',{className:'status-dot'}));}
/**
 * Dual Status Dock 里的一个人：人物首字母（视觉锚点）+ 状态点 + 此刻状态。
 *
 *   .person
 *     .person-letter   D / Y（受控 serif，明显高于状态词）
 *     .person-body
 *       .dock-person-status  ● + .status-text（一组，绝不被省略）
 *       .person-meta    展开时才出现的第二行（还有 1 小时 30 分）
 *
 * 默认态只显示 short status（空闲 / 上课中 / 专注中…）。宽度由内容决定：
 * 文字完整优先，主进程按渲染层测得的宽度定窗口，不靠 ellipsis 兜底。
 * `data-code` 只把日程阶段码透给 CSS / 验证脚本用于断言，不参与状态判断。
 */
function DockPerson({status,hovered,onHover}:{status:PersonStatus;hovered:boolean;onHover?:(person:PersonId)=>void}){
  const person=status.person;
  const view=personPresentation(status);
  const state=presenceStateFor(status);
  const current=status.current;
  return h('div',{className:`person presence-${person} state-${state} kind-${current.kind} source-${current.source}${hovered?' is-hovered':''}`,'data-person':person,'data-state-kind':current.kind,'data-code':status.code,onPointerEnter:()=>onHover?.(person)},
    h('span',{className:'person-letter'},status.alias),
    h('div',{className:'person-body'},
      h('div',{className:'dock-person-status'},
        h(StatusCore,{tone:view.dotTone}),
        h('span',{className:'status-text'},view.primaryLabel)),
      h('span',{className:'person-meta'},view.secondaryLabel)));
}
/**
 * 状态牌本体：person | divider | person（Solo 只有一块 person，没有空槽）。
 * `expanded` 来自渲染层的真实指针状态：点击穿透窗口不会触发 CSS :hover，
 * 因此"整块状态牌一起显露第二行"必须由状态驱动（见 DesktopPet 的 onPointerEnter）。
 */
function CompanionDock({animate,people,hovered,expanded,onHover,nodeRef}:{animate:boolean;people:PersonStatus[];hovered?:PersonId;expanded?:boolean;onHover?:(person:PersonId)=>void;nodeRef?:React.Ref<HTMLDivElement>}){
  // 无障碍文案与 Mini / Tip / Tray 同源（statusLabel），不再有第二套粗粒度状态词。
  const labels=people.map(status=>`${status.name} ${statusLabel(status)}`).join('、');
  return h('div',{ref:nodeRef,className:`dock-surface${people.length<2?' solo':''}${expanded?' is-expanded':''}${animate?' motion':''}`,'role':'status','aria-label':`当前状态：${labels}`},
    ...people.flatMap((status,index)=>index===0
      ? [h(DockPerson,{key:status.person,status,hovered:hovered===status.person,onHover})]
      : [h('span',{key:`divider-${status.person}`,className:'dock-divider','aria-hidden':true}),h(DockPerson,{key:status.person,status,hovered:hovered===status.person,onHover})]));
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
  const live=useLive(),assets=useCompanionAssets(live?.petInstance.avatarPackId,true),drag=useRef<{x:number;y:number;pointerId:number;target:HTMLButtonElement}|null>(null),moved=useRef(false),draggingRef=useRef(false),hoverArmed=useRef(true),clickTimer=useRef<ReturnType<typeof setTimeout>|null>(null),leaveTimer=useRef<ReturnType<typeof setTimeout>|null>(null),[dragging,setDragging]=useState(false),[hovering,setHovering]=useState(false);useSurface('pet-body');
  const p=live?.preferences??petDefaults;
  // 专属角色桌宠是唯一默认形象：素材即使读不到也只用“同一形象的待机帧”，
  // 不会再切换到其它角色。
  const custom=p.mode==='custom';
  // “减少动态”对三种显示模式一视同仁：呼吸、眨眼、徽章脉冲与提醒轻提示都会停。
  const motion={animate:p.animate&&!p.reduceMotion,reduceMotion:p.reduceMotion};
  const people=live?.people??[];
  const peopleKey=people.map(item=>{const view=personPresentation(item);return `${item.person}:${item.alias}:${view.primaryLabel}:${view.secondaryLabel}`;}).join('|');
  const hidePresence=()=>void api.presence('leave');
  /**
   * 牌面宽度由内容决定（"今天下午有课"这类稍长状态不能被省略号吞掉）。
   *
   * 隐藏的量具渲染两块牌面（默认态 / 展开态），测出真实自然宽度后：
   *   * 回报主进程 —— 它按同一份契约（companion-layout）定窗口尺寸；
   *   * 用同一份测量结果设置 CSS 变量 —— 牌面宽度与窗口宽度永远一致。
   * 超过 compactAt 时切到 14.5px 状态字号（第二层降级），只有极端长文本才会 ellipsis。
   */
  const surfaceRef=useRef<HTMLDivElement|null>(null);
  const [measured,setMeasured]=useState<DockMeasure|null>(null);
  const [compact,setCompact]=useState(false);
  const [fontsReady,setFontsReady]=useState(false);
  // 字体加载完成后重量一次：首帧可能用的是 fallback 字形，宽度不同。
  useEffect(()=>{let alive=true;void document.fonts?.ready.then(()=>{if(alive)setFontsReady(true);});return()=>{alive=false;};},[]);
  useLayoutEffect(()=>{
    // 在原位测量（不复制 DOM，避免污染选择器）：临时放开宽度约束，量出真实内容宽度，
    // 量完立刻还原。整个过程在 layout 阶段完成，不会闪一帧。
    const node=surfaceRef.current;if(!node||custom)return;
    const wasExpanded=node.classList.contains('is-expanded'),previousWidth=node.style.width,previousMin=node.style.minWidth,previousTransition=node.style.transition;
    node.style.transition='none';
    node.style.width='max-content';
    node.style.minWidth='0';
    const collapsed=Math.ceil(node.getBoundingClientRect().width);
    node.classList.add('is-expanded');
    const hover=Math.ceil(Math.max(collapsed,node.getBoundingClientRect().width));
    if(!wasExpanded)node.classList.remove('is-expanded');
    node.style.width=previousWidth;node.style.minWidth=previousMin;node.style.transition=previousTransition;
    // 第二层降级带 40px 回滞：避免在阈值附近来回切换字号。
    setCompact(current=>current?collapsed>companionDock.compactAt-40:collapsed>companionDock.compactAt);
    setMeasured(current=>current&&current.collapsed===collapsed&&current.hover===hover?current:{collapsed,hover});
  },[peopleKey,compact,fontsReady,p.mode]);
  useEffect(()=>{if(custom||!measured)return;void api.dockSize(measured);},[measured,custom]);
  /**
   * Dock 的交互状态机（collapsed / hover / detail / dragging）。
   *
   * 以前是零散的 mouseenter / mouseleave / setTimeout + classList 补丁，于是出现
   * "鼠标离开仍保持放大"、"拖动后 tooltip 悬在桌面上"这类残留。现在只有一个状态来源：
   * 窗口内容（是否展开第二行、是否显示 hover 提示、是否允许进入 hover）都只读它。
   */
  const [dockView,setDockView]=useState<'collapsed'|'hover'|'detail'|'dragging'>('collapsed');
  const cancelLeave=()=>{if(leaveTimer.current){clearTimeout(leaveTimer.current);leaveTimer.current=null;}};
  const enterDock=()=>{cancelLeave();if(draggingRef.current)return;setDockView(current=>current==='dragging'?current:'hover');};
  // 指针离开：hovering 立刻置 false（view 立刻回到 collapsed，不依赖任何计时器），
  // 只留一个 90ms 的极短防抖计时器兜住边缘抖动；enter / drag / blur / 卸载都会清掉它。
  const leaveDock=()=>{cancelLeave();setHovering(false);setDockView(current=>current==='dragging'?current:'collapsed');hidePresence();if(draggingRef.current)return;leaveTimer.current=setTimeout(()=>{leaveTimer.current=null;setDockView(current=>current==='dragging'?current:'collapsed');},90);};
  const setView=(next:'collapsed'|'hover'|'detail'|'dragging')=>{cancelLeave();setDockView(next);};
  useEffect(()=>()=>{if(leaveTimer.current)clearTimeout(leaveTimer.current);},[]);
  const finishDrag=(target?:HTMLButtonElement,pointerId?:number)=>{
    const active=drag.current,wasDragging=draggingRef.current;drag.current=null;draggingRef.current=false;setDragging(false);
    if(wasDragging){hidePresence();setView('collapsed');}
    const element=target??active?.target,id=pointerId??active?.pointerId;
    if(element&&id!==undefined&&element.hasPointerCapture(id))element.releasePointerCapture(id);
    if(active)void api.endDrag();
  };
  // window blur / 卸载：清掉所有 transient UI（hover 展开、提示、拖动、点击计时）。
  useEffect(()=>{const clear=()=>{hoverArmed.current=false;setHovering(false);setView('collapsed');finishDrag();if(clickTimer.current)clearTimeout(clickTimer.current);};window.addEventListener('blur',clear);return()=>{window.removeEventListener('blur',clear);if(clickTimer.current)clearTimeout(clickTimer.current);};},[]);
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
  const label=p.mode==='orb'?'拖动状态浮标，单击查看状态':people.length>1?'拖动桌宠，单击查看双方状态':'拖动桌宠，单击查看当前状态';
  // 手势状态机：pointerdown 只是 potential click；移动达到 5px 才进入 dragging。
  // dragging 后只转发 screen 坐标，本次序列不会再触发 click / double click。
  const dragHandlers={
    // CSS :hover 在点击穿透（WS_EX_TRANSPARENT）窗口里不会生效，因此整块状态牌的
    // 二级信息展开由真实指针进入/离开驱动。
    onPointerEnter:()=>{if(!draggingRef.current)setHovering(true);enterDock();},
    onPointerLeave:()=>{hoverArmed.current=true;leaveDock();},
    onContextMenu:(e:React.MouseEvent)=>{e.preventDefault();hoverArmed.current=false;hidePresence();void api.window('menu');},
    onPointerDown:(e:React.PointerEvent<HTMLButtonElement>)=>{
      if(e.button!==0)return;
      moved.current=false;
      cancelLeave();
      drag.current={x:e.screenX,y:e.screenY,pointerId:e.pointerId,target:e.currentTarget};
      void api.beginDrag(e.screenX,e.screenY);
      try{e.currentTarget.setPointerCapture(e.pointerId);}catch{/* 指针不可捕获时仍然可以继续拖动 */}},
    onPointerMove:(e:React.PointerEvent)=>{
      if(!drag.current)return;
      const dx=e.screenX-drag.current.x,dy=e.screenY-drag.current.y;
      if(Math.hypot(dx,dy)>=5||moved.current){if(!moved.current){
        moved.current=true;draggingRef.current=true;hoverArmed.current=false;
        // 进入 dragging：立刻关掉 hover / detail / 提示与所有计时器，拖动期间禁止重新进入 hover。
        if(clickTimer.current){clearTimeout(clickTimer.current);clickTimer.current=null;}
        hidePresence();setHovering(false);setView('dragging');setDragging(true);
      }void api.drag(e.screenX,e.screenY);}},
    onPointerUp:(e:React.PointerEvent<HTMLButtonElement>)=>finishDrag(e.currentTarget,e.pointerId),
    onPointerCancel:(e:React.PointerEvent<HTMLButtonElement>)=>{hoverArmed.current=false;cancelLeave();finishDrag(e.currentTarget,e.pointerId);},
    onLostPointerCapture:()=>{hoverArmed.current=false;finishDrag();},
    // 单击 = 打开详情 / 再点 = 收起详情。意图在点击这一刻定下来（不是靠 220ms 后的
    // 全局状态猜），所以"点 Dock 收起"永远不会变成"重新打开"。
    onClick:()=>{if(moved.current)return;const open=live?.detail!==true;if(clickTimer.current)clearTimeout(clickTimer.current);clickTimer.current=setTimeout(()=>{clickTimer.current=null;if(open)setView('detail');void api.window(open?'mini':'detail-close');},220);},
    onDoubleClick:(e:React.MouseEvent)=>{e.preventDefault();if(clickTimer.current){clearTimeout(clickTimer.current);clickTimer.current=null;}},
  };
  // 详情浮层打开时 Dock 保持默认态：信息在浮层里，状态牌不需要同时展开。
  const view:'collapsed'|'hover'|'detail'|'dragging'=dragging?'dragging':live?.detail?'detail':hovering?dockView:'collapsed';
  // 详情画布（Dock 模式）：状态牌与卡片在同一个窗口里，偏移由主进程按显示器工作区算好。
  const detailFrame=live?.detailFrame;
  const detailOpen=!custom&&view==='detail'&&!!detailFrame;
  // ESC 收起详情：窗口在详情期间是真正获得焦点的，所以键盘路径可靠。
  useEffect(()=>{
    if(view!=='detail')return;
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape')void api.window('detail-close');};
    window.addEventListener('keydown',key);
    return()=>window.removeEventListener('keydown',key);
  },[view]);
  /**
   * hover 的兜底守卫：状态牌所在窗口是点击穿透窗口，一旦变成 WS_EX_TRANSPARENT，
   * Windows 可能就不再投递 pointerleave，于是出现"鼠标离开仍然保持放大"。
   * 展开期间按 150ms 用系统光标位置确认：只要读到一次"光标在窗口之外"就立刻收起。
   * 这是纠错而不是唯一依据 —— pointerleave / blur / drag 各自也会收起；
   * 详情打开时不参与（详情只由点击外部 / 再点 Dock / ESC / 拖动收起）。
   */
  useEffect(()=>{
    if(view!=='hover')return;
    let alive=true;
    const collapse=()=>{cancelLeave();setHovering(false);setDockView('collapsed');void api.presence('leave');};
    const guard=setInterval(()=>{
      if(!alive)return;
      void api.cursorInside().then(inside=>{if(alive&&!inside)collapse();}).catch(()=>{});
    },150);
    // 指针离开窗口（document 级）也立刻收起，不留任何残留。
    const leaveWindow=()=>{if(alive)collapse();};
    document.addEventListener('mouseleave',leaveWindow);
    return()=>{alive=false;clearInterval(guard);document.removeEventListener('mouseleave',leaveWindow);};
  },[view]);
  // 详情打开时命中区跟着状态牌一起贴到画布的共享边上（命中区 = 牌面 + 4px 阴影画布），
  // 所以牌面在屏幕上的位置与默认态完全一致；卡片则按主进程给的偏移绝对定位。
  const handleStyle=detailOpen&&detailFrame?{
    width:detailFrame.dock.width+'px',
    height:detailFrame.dock.height+'px',
    ...(detailFrame.dock.left!==undefined
      ? {left:(detailFrame.dock.left-dockDetail.pad)+'px',right:'auto'}
      : {right:((detailFrame.dock.right??dockDetail.pad)-dockDetail.pad)+'px',left:'auto'}),
    ...(detailFrame.dock.top!==undefined
      ? {top:(detailFrame.dock.top-dockDetail.pad)+'px',bottom:'auto'}
      : {bottom:((detailFrame.dock.bottom??dockDetail.pad)-dockDetail.pad)+'px',top:'auto'}),
  }as React.CSSProperties:undefined;
  const handle=h('button',{'data-interactive':true,className:`pet-handle${p.mode==='orb'?' dock-handle':''}`,'aria-label':label,'data-dock-view':view,style:handleStyle,...dragHandlers},
    custom
      // 固定画布：stage 只负责角色本体与动作，rail 是它的兄弟节点，
      // 两者的 transform / 动画永远不会互相影响，拖动时也不会被裁掉。
      ?h('div',{className:'sprite-stage'},h('div',{className:'sprite-inner'},h('span',{className:'sprite-shadow','aria-hidden':true}),h(CustomCompanionArt,{assets,display:live?.display,frozen:dragging,...motion})))
      :h(CompanionDock,{animate:motion.animate,people,hovered:live?.hoverTip?.person,expanded:view==='hover',onHover:hover,nodeRef:surfaceRef}));
  const side=custom
    ?h('div',{className:'status-rail'},h('button',{'data-interactive':true,className:'companion-rail-button',title:people.length>1?'查看双方状态':'查看当前状态',onClick:()=>void api.window('mini')},h(CompanionRail,{live})))
    :null;
  // 状态牌契约（默认 / hover 两档牌面 + 窗口尺寸）与排版数值都来自 companion-layout，
  // 宽度取渲染层实测的文字宽度：内容完整优先，不为对称牺牲信息。
  const dockMetrics=dockSurfaceMetrics(p.size,people.length,measured??undefined);
  const dockType=companionDock.type[p.size];
  return h('div',{className:`pet-dock ${p.mode==='orb'?'orb-mode':'custom-mode'}${dragging?' is-dragging':''}`,'data-dock-view':view,style:{
    '--rail-height':companionRail.height+'px',
    '--frame-pad-x':companionFrame.padX+'px',
    '--frame-pad-y':companionFrame.padY+'px',
    '--dock-width':dockMetrics.defaultWidth+'px',
    '--dock-height':dockMetrics.defaultHeight+'px',
    '--dock-width-hover':dockMetrics.hoverWidth+'px',
    '--dock-height-hover':dockMetrics.hoverHeight+'px',
    '--dock-pad':dockDetail.pad+'px',
    '--dock-padding':dockType.padding+'px',
    '--dock-letter':dockType.letter+'px',
    '--dock-status':(compact?companionDock.compactStatus:dockType.status)+'px',
  } as React.CSSProperties},handle,side,
    // 详情卡：与状态牌在同一个窗口里（不是第二个 BrowserWindow），
    // 偏移由主进程按工作区算好；卡片本身是唯一可交互区域。
    detailOpen&&detailFrame?h(Mini,{variant:'dock',frame:{left:detailFrame.panel.left,top:detailFrame.panel.top}}):null);
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
/**
 * 详情卡（轻量桌面状态卡，不是 dashboard）。
 *
 * 两种宿主共用同一份内容与同一份数据投影：
 *   variant='dock'   —— Dock 模式：卡片与状态牌在**同一个** floating 窗口里（0.3 收口）。
 *   variant='window' —— 桌宠模式：卡片仍在独立浮层窗口里（桌宠画布尺寸不能变）。
 *
 * 信息顺序固定为 谁 → 此刻状态 → 还剩多久 → 当前内容 → 下一次变化；
 * 右侧放 Asset 03（素材图 4）里对应语义的原素材插图，不重画、不换 emoji。
 */
export interface MiniProps { variant?:'window'|'dock'; frame?:{left:number;top:number}; }
export function Mini({variant,frame}:MiniProps){
  const live=useLive();
  const dock=variant==='dock';
  // 桌宠模式的浮层窗口比卡片大一圈（8px 阴影画布 + 底部 10px 指示三角，见 style.css）。
  useEffect(()=>{if(dock)return;document.documentElement.classList.add('companion-root');document.body.classList.add('mini-body');return()=>{document.body.classList.remove('mini-body');document.documentElement.classList.remove('companion-root');};},[dock]);
  const people=live?.people??[];
  const solo=people.length<=1;
  const panel=dockDetailPanel(people.length);
  const gear=h('button',{type:'button',className:'mini-gear',title:'设置','aria-label':'设置',onClick:()=>void api.window('settings')},
    h('svg',{viewBox:'0 0 24 24',width:15,height:15,'aria-hidden':true},
      // 标准齿轮轮廓（Material settings 图标路径）。
      h('path',{d:'M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54a7 7 0 0 0-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.49.49 0 0 0 .12.61l2.03 1.58a7 7 0 0 0 0 1.88l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.05.7 1.62.94l.36 2.54c.05.24.25.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54a7 7 0 0 0 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.03-1.58ZM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2Z',fill:'currentColor'})));
  /**
   * 每个人的一张 context card：谁 + 此刻状态 + 还剩多久 → 当前内容 → 下一次变化。
   * 插图来自当前状态（找不到准确映射时退回"下一项"的语义），始终是同一套原素材。
   */
  const person=(status:PersonStatus)=>{
    const view=personPresentation(status),next=view.nextItem;
    const icon=iconForCurrent(status.current)??iconForNext(status.next);
    return h('article',{className:`detail-person state-${presenceStateFor(status)}`,key:status.person,'data-person':status.person,'data-state-kind':status.current.kind,'data-code':status.code},
      h('header',{className:'detail-head'},
        h('span',{className:'detail-alias'},status.alias),
        icon?h('img',{className:'detail-icon',src:iconSrc(icon),alt:'','aria-hidden':true,draggable:false}):null),
      h('strong',{className:'detail-state',title:view.primaryLabel},view.primaryLabel),
      // 上下文只说状态自身（结束时间 / 来源 / 今天的课表阶段）；下一件事在下面那行说，
      // 因此这里不再重复「下一项 …」。
      view.statusNote?h('small',{className:'detail-context',title:view.statusNote},view.statusNote):null,
      next
        ?h('button',{type:'button',className:'detail-next','data-person':status.person,onClick:()=>void api.window('open')},
          h('span',{className:'detail-next-title',title:next.title},next.title),
          h('span',{className:'detail-next-when'},
            h('span',{className:'detail-next-label'},'下一项'),
            h('i',{className:'detail-next-sep','aria-hidden':true}),
            `${next.relativeDay} ${next.time}`),
          solo&&next.place?h('span',{className:'detail-place',title:next.place},next.place):null)
        :h('div',{className:'detail-next is-empty','data-person':status.person},
          h('span',{className:'detail-next-title'},'暂无后续安排')));
  };
  // 底部只放一条真正共享的上下文（>= 2 个人都在进行中才有意义）；没有就留空，
  // 不再每次点开都放一句文案。
  const active=people.filter(item=>item.current.kind!=='idle');
  const foot=!solo&&active.length>=2?`今天 · ${active.length} 个进行中的安排`:null;
  const style=dock&&frame?{position:'absolute',left:frame.left+'px',top:frame.top+'px',width:panel.width+'px',height:panel.height+'px'}as React.CSSProperties:undefined;
  return h(React.Fragment,null,
    h('section',{className:`mini-panel${solo?' solo':''}${dock?' dock':''}`,'data-interactive':dock?true:undefined,style},
      h('header',{className:'mini-head'},
        h('h2',null,solo?'此刻':'我们 · 此刻'),
        // 品牌只做弱化签名：极小 wordmark + 设置入口，绝不是详情的主体。
        h('div',{className:'mini-brand'},h('b',null,'YD'),gear)),
      h('div',{className:'mini-grid'},...people.map(person)),
      foot?h('p',{className:'detail-foot'},h('i',{'aria-hidden':true}),foot):null),
    dock?null:h('span',{className:'mini-tail','aria-hidden':true}));
}
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
