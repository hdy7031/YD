import { occurrences, weekday } from '../core.ts';
import { courseTone, emptyScheduleText, openTasks, scheduleDays } from '../selectors.ts';
import type { State } from '../types.ts';
import React,{useEffect,useState} from 'react';
import {addDays,dateOf,epoch} from '../core.ts';
import type {AcademicCalendar,Course,Event,Profile,Task} from '../types.ts';

const h=React.createElement;
const shortDate=(date:string)=>`${Number(date.slice(5,7))}/${Number(date.slice(8,10))}`;
const longDate=(date:string)=>`${Number(date.slice(5,7))} 月 ${Number(date.slice(8,10))} 日`;
const weekNow=(calendar:AcademicCalendar,now:number)=>Math.max(1,Math.min(calendar.weeks,Math.floor((epoch(dateOf(now))-epoch(calendar.startDate))/604800000)+1));

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
  state:State; profile:Profile; /** 学业配置（Phase 5B3：只有学生 / 教师有；缺失时调用方不渲染网格） */ calendar:AcademicCalendar; courses:Course[]; now:number;
  edit:(course:Course)=>void; create:(value:Partial<Course>)=>void;
  mode:'overview'|'edit';
}
export function ScheduleGrid({state,profile,calendar,courses,now,edit,create,mode}:ScheduleGridProps){
  const [week,setWeek]=useState(()=>weekNow(calendar,now));
  useEffect(()=>setWeek(weekNow(calendar,now)),[profile.id,calendar.startDate,calendar.weeks]);
  const monday=addDays(calendar.startDate,(week-1)*7),active=scheduleDays(state,monday,profile.id);
  return h(React.Fragment,null,
    h('div',{className:'schedule-toolbar'},
      h('div',null,h('strong',null,`第 ${week} 教学周`),h('small',null,`${longDate(monday)} – ${longDate(addDays(monday,6))}`)),
      h('div',{className:'week-switch'},h('button',{disabled:week<=1,onClick:()=>setWeek(w=>w-1),'aria-label':'上一教学周'},'‹'),h('select',{'aria-label':'查看教学周',value:week,onChange:(e:React.ChangeEvent<HTMLSelectElement>)=>setWeek(Number(e.target.value))},...Array.from({length:calendar.weeks},(_,i)=>h('option',{value:i+1,key:i+1},`第 ${i+1} 周`))),h('button',{disabled:week>=calendar.weeks,onClick:()=>setWeek(w=>w+1),'aria-label':'下一教学周'},'›'))),
    h('div',{className:`schedule-scroll schedule-${mode}`,'data-schedule-mode':mode},h('div',{className:`schedule-grid schedule-grid-${mode}`,style:{'--period-count':calendar.periods.length} as React.CSSProperties},
      h('div',{className:'schedule-corner'},'节次'),
      ...Array.from({length:7},(_,d)=>h('div',{className:'schedule-day',key:'d'+d},h('strong',null,'周'+'一二三四五六日'[d]),h('small',null,shortDate(addDays(monday,d))))),
      ...calendar.periods.map((p,i)=>h('div',{className:'period-label',key:'p'+i,style:{gridColumn:1,gridRow:i+2}},h('strong',null,i+1),h('small',null,`${p.start}–${p.end}`))),
      ...Array.from({length:calendar.periods.length*7},(_,i)=>{const period=Math.floor(i/7)+1,day=i%7+1;return mode==='edit'
        ?h('button',{className:'schedule-cell',key:`${period}-${day}`,style:{gridColumn:day+1,gridRow:period+1},title:`周${'一二三四五六日'[day-1]}第 ${period} 节添加课程`,onClick:()=>create({weekday:day,first:period,last:period,weeks:[week]})},'＋')
        :h('span',{className:'schedule-cell schedule-cell-readonly','aria-hidden':true,key:`${period}-${day}`,style:{gridColumn:day+1,gridRow:period+1}});}),
      ...active.map(o=>{const c=courses.find(c=>c.id===o.courseId)!;
        const day=o.day,start=o.startClock,end=o.endClock;
        const index=calendar.periods.findIndex(p=>p.end>start),first=index<0?calendar.periods.length-1:index,last=calendar.periods.findLastIndex(p=>p.start<end);
        // 与日常列表同一条规则：可选信息缺失就不占位（没有地点就不显示"地点未填"）。
        const slotText=mode==='overview'?o.place:`${start}—${end}${o.place?` · ${o.place}`:''}`;
        const content=h(React.Fragment,null,h('strong',null,o.title),slotText?h('small',null,slotText):null,state.exceptions.some(e=>e.courseId===o.courseId&&e.date===o.date)?h('em',null,'本次已调课'):null);
        const props={className:`course-block ${courseTone(c)}`,'data-course-id':c.id,key:o.segmentId,style:{gridColumn:weekday(day)+1,gridRow:`${first+2} / ${Math.max(first,last)+3}`},title:mode==='edit'?`编辑课程模板 ${c.title}`:`${o.title} · ${start}—${end}${o.place?` · ${o.place}`:''}`};
        return mode==='edit'?h('button',{...props,onClick:()=>edit(c)},content):h('div',props,content);}),
      !active.length?h('div',{className:'schedule-empty'},h('strong',null,emptyScheduleText(courses.length)),h('small',null,mode==='edit'?'点击空白节次添加安排。':'可以导入课表，或进入编辑后添加课程。')):null)),
    mode==='edit'?h('p',{className:'schedule-hint'},'点击课程进行修改，点击空白节次添加安排。'):null);
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
  // 时间与地点都只显示真实存在的信息：没有结束时间就只报开始时间，没有地点就不占位。
  const eventCard=(e:Event)=>h('article',{className:'entry management-event',key:e.id},h('div',{className:'entry-top'},h('h3',null,e.title),h('div',{className:'entry-flags'},epoch(e.end||e.start)<now?h('span',{className:'tag'},'已结束'):h('span',{className:'tag'},'会议 / 活动'),h('details',{className:'action-menu'},h('summary',{'aria-label':`${e.title}的更多操作`},'⋯'),h('div',{className:'action-menu-pop'},h('button',{className:'ghost',onClick:()=>editEvent(e)},'编辑'),h('button',{className:'text-button',onClick:()=>deleteEvent(e)},'删除'))))),h('p',{className:'time'},e.end?`${e.start.replace('T',' ')} — ${e.end.slice(11)}`:e.start.replace('T',' ')),e.place?h('p',{className:'muted'},e.place):null,e.notes?h('p',{className:'note'},e.notes):null);
  return h(React.Fragment,null,
    h('div',{className:'management-toolbar'},
      h('input',{'aria-label':'搜索事项与会议',placeholder:'搜索待办、会议、地点或备注',value:query,onChange:(e:React.ChangeEvent<HTMLInputElement>)=>setQuery(e.target.value)}),
      h('details',{className:'create-menu',open:creating,onToggle:(e:React.SyntheticEvent<HTMLDetailsElement>)=>setCreating(e.currentTarget.open)},
        h('summary',{className:'primary'},'+ 新建'),
        h('div',{className:'action-menu-pop'},
          createTask?h('button',{className:'ghost',onClick:()=>{setCreating(false);createTask();}},'待办'):null,
          createEvent?h('button',{className:'ghost',onClick:()=>{setCreating(false);createEvent();}},'会议 / 活动'):null))),
    h('div',{className:'management-subbar'},
      h('nav',{className:'text-tabs','aria-label':'事项类型'},...([['all','全部'],['tasks','待办'],['events','会议']] as const).map(([value,label])=>h('button',{key:value,className:kind===value?'active':'','aria-current':kind===value?'page':undefined,onClick:()=>setKind(value)},label))),
      h('div',{className:'management-filters'},
      kind==='tasks'?h(React.Fragment,null,
        FilterSelect({label:'状态',value:status,onChange:setStatus,options:taskStatusOptions}),
        FilterSelect({label:'时间',value:taskTime,onChange:setTaskTime,options:taskTimeOptions})):null,
      kind==='events'?FilterSelect({label:'时间',value:eventTime,onChange:setEventTime,options:eventTimeOptions}):null)),
    h('div',{className:'overview-stats'},h('span',null,h('strong',null,openTasks(tasks).length),' 待处理'),h('span',null,h('strong',null,events.filter(e=>epoch(e.end||e.start)>=now).length),' 场待进行会议')),
    h('div',{className:`management-columns ${kind}`},
      kind!=='events'?h('section',{className:'management-section'},h('div',{className:'section-head'},h('h2',null,'待办事项'),h('small',null,`${shownTasks.length} 项`)),...shownTasks.map(taskCard),!shownTasks.length?h(EmptyState,{compact:true,title:query.trim()?'没有匹配的待办':tasks.length?'没有符合条件的待办':'暂无待办',description:tasks.length?'换个筛选条件或搜索词试试。':'新建待办后可以按时间与状态统一管理。',actions:createTask?h('button',{type:'button',className:'primary',onClick:createTask},'新建待办'):null}):null):null,
      kind!=='tasks'?h('section',{className:'management-section'},h('div',{className:'section-head'},h('h2',null,'会议与活动'),h('small',null,`${shownEvents.length} 项`)),...shownEvents.map(eventCard),!shownEvents.length?h(EmptyState,{compact:true,title:query.trim()?'没有匹配的会议':events.length?'没有符合条件的会议或活动':'暂无会议',description:events.length?'换个筛选条件或搜索词试试。':'新建会议或活动后，会按时间显示在这里。',actions:createEvent?h('button',{type:'button',className:'secondary',onClick:createEvent},'新建会议'):null}):null):null));
}
