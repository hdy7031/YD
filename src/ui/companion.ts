import React,{useState,useEffect,useRef} from 'react';
import type { LiveSnapshot,PersonStatus,PetPreferences,PresenceState } from '../live.ts';
import type { PersonId, Profile, State } from '../types.ts';
import {clockText,petDefaults,presenceStateFor,statusLabel} from '../live.ts';
import {stateSourceLabel} from '../state/presentation.ts';
import {companionTone} from '../companion-colors.ts';
import {companionFrame,companionRail} from '../companion-layout.ts';
import {petRoutineSummary} from '../companion-display.ts';
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
import {CompanionRail,CustomCompanionArt,useCompanionAssets} from './companion-custom.ts';
import type {CompanionMenuItem} from '../companion-menu.ts';
import {BrandGlyph} from './brand.ts';
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
    // 称呼来自档案：本人是「我的」，同行者用档案显示名称（默认就是当前产品里的 Ta）。
    const identity=compact?p.alias:p.role==='self'?'我的':p.name;
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
function IdentityMark({letter}:{letter:string}){return h('span',{className:'identity-mark','aria-hidden':true},letter);}
function StatusCore({state}:{state:PresenceState}){return h('span',{className:'status-core','aria-hidden':true},h('i',{className:'status-ring'}),h('i',{className:'status-dot'}));}
function PresenceZone({person,status,marker,onHover}:{person:PersonId;status?:PersonStatus;marker:string;onHover?:(person:PersonId)=>void}){
  const state=presenceStateFor(status);
  return h('span',{className:`presence-zone presence-${person} state-${state}`,'data-person':person,onPointerEnter:()=>onHover?.(person)},h(IdentityMark,{letter:marker}),h(StatusCore,{state}));
}
// 悬浮球按实际档案渲染状态区域：2 人时保持左右双方（视觉不变），1 人时只渲染一个居中的区域。
function PresenceOrb({animate,people,onHover}:{animate:boolean;people:PersonStatus[];onHover?:(person:PersonId)=>void}){
  // 无障碍文案与 Mini / Tip / Tray 同源（statusLabel），不再有第二套粗粒度状态词。
  const labels=people.map(status=>statusLabel(status)).join('、');
  return h('div',{className:`presence-orb${animate?' motion':''}`,'aria-label':people.length>1?`双方状态：${labels}`:`当前状态：${labels}`},
    h('div',{className:`presence-surface${people.length<2?' solo':''}`},
      ...people.map(status=>h(PresenceZone,{key:status.person,person:status.person,status,marker:status.alias,onHover}))));
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
  const live=useLive(),assets=useCompanionAssets(live?.petInstance.avatarPackId,true),drag=useRef<{x:number;y:number;pointerId:number;target:HTMLButtonElement}|null>(null),moved=useRef(false),draggingRef=useRef(false),hoverArmed=useRef(true),[dragging,setDragging]=useState(false);useSurface('pet-body');
  const p=live?.preferences??petDefaults;
  // 专属角色桌宠是唯一默认形象：素材即使读不到也只用“同一形象的待机帧”，
  // 不会再切换到其它角色。
  const custom=p.mode==='custom';
  // “减少动态”对三种显示模式一视同仁：呼吸、眨眼、徽章脉冲与提醒轻提示都会停。
  const motion={animate:p.animate&&!p.reduceMotion,reduceMotion:p.reduceMotion};
  const people=live?.people??[];
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
  const hover=(person:PersonId)=>{if(!draggingRef.current&&hoverArmed.current)void api.presence('enter',person);};
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
      :h(PresenceOrb,{animate:motion.animate,people,onHover:hover}));
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
    h('div',{className:'section-head'},h('h2',null,((live?.people.length??0)>1)?'此刻，我们':'此刻'),h('span',{className:'muted'},live?clockText(live.now):'…')),
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
    options.length>1?h('div',{className:'segmented setting-segmented routine-people',role:'radiogroup','aria-label':'选择要编辑的人'},
      ...options.map(option=>h('button',{key:option.id,type:'button',role:'radio','aria-checked':person===option.id,className:person===option.id?'active':'','data-routine-person':option.id,disabled:locked,onClick:()=>setSelected(option.id)},option.label))):null,
    routineNeedsConfirmation(routine)?h('p',{className:'muted setting-note routine-legacy-note'},'这是根据旧版本桌宠时间保留的默认作息，可按你的实际情况调整。'):null,
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

export function PetSettings({live,settings,state}:{live:LiveSnapshot|null;settings?:{launch:boolean;trayResident?:boolean};state?:State}){
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const assets=useCompanionAssets(live?.petInstance.avatarPackId);
  const p=live?.preferences??petDefaults;
  const run=(fn:()=>Promise<unknown>)=>{setBusy(true);return fn().then(()=>setError('')).catch(e=>setError(String(e))).finally(()=>setBusy(false));};
  const save=(pet:Partial<PetPreferences>)=>run(()=>api.change({type:'settings',pet}));
  const saveSetting=(value:{launch?:boolean;trayResident?:boolean})=>run(()=>api.change({type:'settings',...value}));
  const paused=p.pausedUntil>(live?.now??Date.now());
  const check=(label:string,checked:boolean,onChange:(value:boolean)=>void,disabled=false)=>h('label',{className:'check-row'},h('input',{type:'checkbox',checked,disabled:disabled||busy,onChange:(e:React.ChangeEvent<HTMLInputElement>)=>onChange(e.target.checked)}),label);
  const block=(title:string,children:React.ReactNode)=>h('div',{className:'setting-block'},h('h3',null,title),children);
  const motionMode=p.reduceMotion?'reduced':'standard';
  // 这里说的是"桌宠主体"的作息：Together 是同行者，Solo 是本人。
  const schedule=petRoutineSummary(state?resolvePetSubject(state).routine:undefined);
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
      // 时间状态与这段说明都来自桌宠主体自己的作息（profile.routine），不是写死的时间表。
      check(`夜间自动睡觉${schedule.sleep?`（${schedule.sleep}）`:''}`,p.nightRest,value=>save({nightRest:value})),
      h('p',{className:'muted setting-note'},!schedule.sleep
        ?'当前作息里没有睡觉时段，桌宠不会自动进入睡眠姿态；其它时间状态仍按作息生效。'
        :p.nightRest
          ?`${schedule.sleep} 之间，只要没有进行中的安排、也没有到时间的提醒，桌宠就会安静地睡觉${schedule.states?`；${schedule.states}`:''}。`
          :'已关闭夜间自动睡觉：夜间也按平时的状态显示，其它时间状态仍按作息生效。'),
      h('p',{className:'muted setting-note'},'时间状态按作息规则与北京时间判断，不需要联网校准。'))),
    state?block('日常节奏',h(RoutineSettings,{state,busy,onError:setError})):null,
    block('窗口行为',h(React.Fragment,null,
      check('单击桌宠显示双方状态',p.miniPanel,value=>save({miniPanel:value})),
      check('记住桌宠位置',p.rememberPosition,value=>save({rememberPosition:value})),
      check('关闭主窗口后驻留托盘（提醒继续）',settings?.trayResident!==false,value=>saveSetting({trayResident:value})),
      settings?.trayResident===false?h('p',{className:'muted setting-note'},'关闭主窗口将退出 YD，退出后不会触发提醒。'):null,
      check('登录 Windows 后启动 YD',!!settings?.launch,value=>saveSetting({launch:value})))),
    error?h('p',{className:'error',role:'alert'},error):null);
}
