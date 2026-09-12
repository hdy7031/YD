import { occurrences, weekday } from '../core.ts';
import { courseTone, emptyScheduleText, openTasks, scheduleDays } from '../selectors.ts';
import type { State } from '../types.ts';
import React,{useEffect,useState} from 'react';
import {addDays,dateOf,epoch} from '../core.ts';
import type {Course,Event,Profile,Task} from '../types.ts';

const h=React.createElement;
const shortDate=(date:string)=>`${Number(date.slice(5,7))}/${Number(date.slice(8,10))}`;
const weekNow=(profile:Profile,now:number)=>Math.max(1,Math.min(profile.weeks,Math.floor((epoch(dateOf(now))-epoch(profile.startDate))/604800000)+1));

interface EmptyStateProps {
  title:string;
  description?:string;
  actions?:React.ReactNode;
  compact?:boolean;
  /** 可选品牌插图（assets/gen 下的图）。给了就替代默认的线性图标。 */
  illustration?:string;
}
// Shared empty-state surface: stable container, short explanation and optional actions.
export function EmptyState({title,description,actions,compact=false,illustration}:EmptyStateProps){
  return h('div',{className:'empty-state'+(compact?' compact':'')},
    illustration
      ? h('img',{className:'empty-state-art',src:illustration,alt:'','aria-hidden':true,draggable:false})
      : h('span',{className:'empty-state-icon','aria-hidden':true},
        h('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.6,strokeLinecap:'round',strokeLinejoin:'round'},
          h('rect',{x:3.5,y:4.5,width:17,height:15,rx:3.2}),
          h('path',{d:'M7.6 9.6h8.8M7.6 13h5.6'}))),
    h('div',{className:'empty-state-copy'},h('strong',null,title),description?h('p',null,description):null),
    actions?h('div',{className:'empty-state-actions'},actions):null);
}

interface ScheduleGridProps {
  state:State; profile:Profile; courses:Course[]; now:number;
  edit:(course:Course)=>void; create:(value:Partial<Course>)=>void;
}
export function ScheduleGrid({state,profile,courses,now,edit,create}:ScheduleGridProps){
  const [week,setWeek]=useState(()=>weekNow(profile,now));
  useEffect(()=>setWeek(weekNow(profile,now)),[profile.id,profile.startDate,profile.weeks]);
  const monday=addDays(profile.startDate,(week-1)*7),active=scheduleDays(state,monday,profile.id);
  return h(React.Fragment,null,
    h('div',{className:'schedule-toolbar'},
      h('div',null,h('strong',null,`${profile.name}的第 ${week} 教学周`),h('small',null,`${shortDate(monday)}—${shortDate(addDays(monday,6))}`)),
      h('div',{className:'week-switch'},h('button',{disabled:week<=1,onClick:()=>setWeek(w=>w-1),'aria-label':'上一教学周'},'‹'),h('select',{'aria-label':'查看教学周',value:week,onChange:(e:React.ChangeEvent<HTMLSelectElement>)=>setWeek(Number(e.target.value))},...Array.from({length:profile.weeks},(_,i)=>h('option',{value:i+1,key:i+1},`第 ${i+1} 周`))),h('button',{disabled:week>=profile.weeks,onClick:()=>setWeek(w=>w+1),'aria-label':'下一教学周'},'›'))),
    h('div',{className:'schedule-scroll'},h('div',{className:'schedule-grid',style:{'--period-count':profile.periods.length} as React.CSSProperties},
      h('div',{className:'schedule-corner'},'节次'),
      ...Array.from({length:7},(_,d)=>h('div',{className:'schedule-day',key:'d'+d},h('strong',null,'周'+'一二三四五六日'[d]),h('small',null,shortDate(addDays(monday,d))))),
      ...profile.periods.map((p,i)=>h('div',{className:'period-label',key:'p'+i,style:{gridColumn:1,gridRow:i+2}},h('strong',null,i+1),h('small',null,`${p.start}\n${p.end}`))),
      ...Array.from({length:profile.periods.length*7},(_,i)=>{const period=Math.floor(i/7)+1,day=i%7+1;return h('button',{className:'schedule-cell',key:`${period}-${day}`,style:{gridColumn:day+1,gridRow:period+1},title:`周${'一二三四五六日'[day-1]}第 ${period} 节添加课程`,onClick:()=>create({weekday:day,first:period,last:period,weeks:[week]})},'＋');}),
      ...active.map(o=>{const c=courses.find(c=>c.id===o.courseId)!;
        const day=o.day,start=o.startClock,end=o.endClock;
        const index=profile.periods.findIndex(p=>p.end>start),first=index<0?profile.periods.length-1:index,last=profile.periods.findLastIndex(p=>p.start<end);
        return h('button',{className:`course-block ${courseTone(c)}`,'data-course-id':c.id,key:o.segmentId,style:{gridColumn:weekday(day)+1,gridRow:`${first+2} / ${Math.max(first,last)+3}`},onClick:()=>edit(c),title:`编辑课程模板 ${c.title}`},h('strong',null,o.title),h('small',null,`${start}—${end} · ${o.place||'未填地点'}`),state.exceptions.some(e=>e.courseId===o.courseId&&e.date===o.date)?h('em',null,'本次已调课'):null);}),
      !active.length?h('div',{className:'schedule-empty'},h('strong',null,emptyScheduleText(courses.length)),h('small',null,'点击空白格可按星期与节次添加课程，也可以导入课表文件。')):null)),
    h('p',{className:'schedule-hint'},'点击课程编辑；点击空白格可按该星期、节次和当前周新增课程。'));
}

interface OverviewProps {
  tasks:Task[]; events:Event[]; now:number; query:string; setQuery:(value:string)=>void;
  taskCard:(task:Task)=>React.ReactNode; editEvent:(event:Event)=>void; deleteEvent:(event:Event)=>void;
  createTask?:()=>void; createEvent?:()=>void;
}
// 筛选只按一个维度展开：先选“待办 / 会议”，再在该类型内选状态与时间。
// 选“全部”时只保留搜索与时间排序，不再出现“全部待办”这种混在一起的第二层。
const taskStatusOptions=[['open','待处理'],['done','已完成']] as const;
const taskTimeOptions=[['all','全部'],['today','今天'],['week','未来七天'],['overdue','已逾期'],['nodue','无截止时间']] as const;
const eventTimeOptions=[['all','全部'],['upcoming','即将开始'],['past','已结束']] as const;
function FilterSelect<T extends string>({label,value,onChange,options}:{label:string;value:T;onChange:(value:T)=>void;options:readonly (readonly [T,string])[]}){
  return h('label',{className:'inline-filter'},h('span',null,label),
    h('select',{value,onChange:(e:React.ChangeEvent<HTMLSelectElement>)=>onChange(e.target.value as T)},...options.map(([v,t])=>h('option',{key:v,value:v},t))));
}
export function ManagementOverview({tasks,events,now,query,setQuery,taskCard,editEvent,deleteEvent,createTask,createEvent}:OverviewProps){
  const [kind,setKind]=useState<'all'|'tasks'|'events'>('all');
  const [status,setStatus]=useState<'open'|'done'>('open');
  const [taskTime,setTaskTime]=useState<'all'|'today'|'week'|'overdue'|'nodue'>('all');
  const [eventTime,setEventTime]=useState<'all'|'upcoming'|'past'>('upcoming');
  const [creating,setCreating]=useState(false);
  const q=query.trim().toLowerCase(),today=dateOf(now),weekEnd=epoch(addDays(today,7));
  const matchesTask=(t:Task)=>taskTime==='all'
    ||taskTime==='today'&&!!t.due&&t.due.startsWith(today)
    ||taskTime==='week'&&!!t.due&&epoch(t.due)>=epoch(today)&&epoch(t.due)<weekEnd
    ||taskTime==='overdue'&&!!t.due&&epoch(t.due)<now
    ||taskTime==='nodue'&&!t.due;
  const shownTasks=tasks.filter(t=>(t.title+' '+t.notes).toLowerCase().includes(q))
    .filter(t=>status==='open'?!t.done:t.done)
    .filter(matchesTask);
  const shownEvents=events.filter(e=>(e.title+' '+e.notes+' '+e.place).toLowerCase().includes(q))
    .filter(e=>eventTime==='all'||eventTime==='upcoming'&&epoch(e.end||e.start)>=now||eventTime==='past'&&epoch(e.end||e.start)<now)
    .sort((a,b)=>epoch(a.start)-epoch(b.start));
  const eventCard=(e:Event)=>h('article',{className:'entry management-event',key:e.id},h('div',{className:'entry-top'},h('h3',null,e.title),h('div',{className:'entry-flags'},epoch(e.end||e.start)<now?h('span',{className:'tag'},'已结束'):h('span',{className:'tag'},'会议 / 活动'),h('details',{className:'action-menu'},h('summary',{'aria-label':`${e.title}的更多操作`},'⋯'),h('div',{className:'action-menu-pop'},h('button',{className:'ghost',onClick:()=>editEvent(e)},'编辑'),h('button',{className:'text-button',onClick:()=>deleteEvent(e)},'删除'))))),h('p',{className:'time'},`${e.start.replace('T',' ')} — ${(e.end?e.end.slice(11):'结束时间 · 未填写')}`),h('p',{className:'muted'},e.place||'未填地点'),e.notes?h('p',{className:'note'},e.notes):null);
  return h(React.Fragment,null,
    h('div',{className:'management-toolbar'},
      h('input',{'aria-label':'搜索事项与会议',placeholder:'搜索待办、会议、地点或备注',value:query,onChange:(e:React.ChangeEvent<HTMLInputElement>)=>setQuery(e.target.value)}),
      kind==='tasks'?h(React.Fragment,null,
        FilterSelect({label:'状态',value:status,onChange:setStatus,options:taskStatusOptions}),
        FilterSelect({label:'时间',value:taskTime,onChange:setTaskTime,options:taskTimeOptions})):null,
      kind==='events'?FilterSelect({label:'时间',value:eventTime,onChange:setEventTime,options:eventTimeOptions}):null,
      h('div',{className:'segmented'},...([['all','全部'],['tasks','待办'],['events','会议']] as const).map(([value,label])=>h('button',{key:value,className:kind===value?'active':'',onClick:()=>setKind(value)},label))),
      h('details',{className:'create-menu',open:creating,onToggle:(e:React.SyntheticEvent<HTMLDetailsElement>)=>setCreating(e.currentTarget.open)},
        h('summary',{className:'primary'},'+ 新建'),
        h('div',{className:'action-menu-pop'},
          createTask?h('button',{className:'ghost',onClick:()=>{setCreating(false);createTask();}},'待办'):null,
          createEvent?h('button',{className:'ghost',onClick:()=>{setCreating(false);createEvent();}},'会议 / 活动'):null))),
    h('div',{className:'overview-stats'},h('span',null,h('strong',null,openTasks(tasks).length),' 待处理'),h('span',null,h('strong',null,events.filter(e=>epoch(e.end||e.start)>=now).length),' 场待进行会议')),
    h('div',{className:`management-columns ${kind}`},
      kind!=='events'?h('section',{className:'management-section'},h('div',{className:'section-head'},h('h2',null,'待办事项'),h('small',null,`${shownTasks.length} 项`)),...shownTasks.map(taskCard),!shownTasks.length?h(EmptyState,{compact:true,title:query.trim()?'没有匹配的待办':tasks.length?'没有符合条件的待办':'暂无待办',description:tasks.length?'换个筛选条件或搜索词试试。':'新建待办后可以按时间与状态统一管理。',actions:createTask?h('button',{type:'button',className:'primary',onClick:createTask},'新建待办'):null}):null):null,
      kind!=='tasks'?h('section',{className:'management-section'},h('div',{className:'section-head'},h('h2',null,'会议与活动'),h('small',null,`${shownEvents.length} 项`)),...shownEvents.map(eventCard),!shownEvents.length?h(EmptyState,{compact:true,title:query.trim()?'没有匹配的会议':events.length?'没有符合条件的会议或活动':'暂无会议',description:events.length?'换个筛选条件或搜索词试试。':'新建会议或活动后，会按时间显示在这里。',actions:createEvent?h('button',{type:'button',className:'secondary',onClick:createEvent},'新建会议'):null}):null):null));
}
