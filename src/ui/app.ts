import { InboxHub } from './inbox.ts';
import { snapshot, profileAlias, statusLabel, clockText } from '../live.ts';
import type { PersonStatus } from '../live.ts';
import type { ManualStateKind } from '../state/manual.ts';
import { manualDurationOptions, manualKindOptions, manualLabelFor, manualStatusProblem } from './manual-status.ts';
import { pendingReminders as selectPendingReminders, attentionSummary } from '../selectors.ts';
import { useLive, Titlebar, DesktopPet, Bubble, Mini, PresenceTip, PetMenu, StatusRows, PetSettings } from './companion.ts';
import { BrandMark } from './brand.ts';
import { ScheduleGrid, ManagementOverview, EmptyState } from './views.ts';
import { getCompanionProfile, requireSelfProfile, resolvePetSubject } from '../people.ts';
import { personOptions, profileLabelFor, shellTabs, tabShortcuts, tabWidthPolicy } from './shell.ts';
import type { ShellTab } from './shell.ts';
import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { BellRing, CalendarClock, CalendarDays, Clock3, Inbox, ListTodo, Settings, Table2 } from 'lucide-react';
import { initial, id, occurrences, conflicts, epoch, dateOf, addDays, weekday, DAY } from '../core.ts';
import type { DesktopAPI, State, Entity, Command, Course, Exception, Task, Event, Notice, Occurrence, ChecklistItem, PersonId, SchedulePackage } from '../types.ts';
declare global { interface Window { dayhub: DesktopAPI } }
const api=window.dayhub;
const h=(type:any,props:any,...children:any[]):React.ReactElement=>React.createElement(type,props,...children);
const b=(label:string,fn:()=>unknown,cls='',disabled=false)=>h('button',{type:'button',onClick:fn,className:cls,disabled},label);
const navIcons={today:CalendarDays,person:CalendarClock,courses:Table2,tasks:ListTodo,inbox:Inbox,reminders:BellRing,settings:Settings} as const;
const uiIcon=(Icon:any,className='ui-icon')=>h(Icon,{className,'aria-hidden':true,strokeWidth:1.75});
const fmt=(t:number,full=false)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',...(full?{month:'2-digit',day:'2-digit'}:{}),hour:'2-digit',minute:'2-digit',hour12:false}).format(t);
const localStamp=(t:number)=>new Date(t+8*3600000).toISOString().slice(0,16);
const until=(from:number,to:number)=>{const minutes=Math.max(0,Math.round((to-from)/60000));if(minutes<60)return `还有 ${minutes} 分钟`;const hours=Math.floor(minutes/60),rest=minutes%60;return rest?`还有 ${hours} 小时 ${rest} 分钟`:`还有 ${hours} 小时`;};
const msg=(e:unknown)=>e instanceof Error?e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''):String(e);
const base=()=>({id:id(),title:'',notes:'',reminders:[1440,120,0],checklist:[],updatedAt:Date.now()});
function newValue(entity:Entity,person:PersonId,selfId:PersonId):any {
  if(entity==='tasks')return {...base(),due:'',done:false};
  if(entity==='events')return {...base(),start:localStamp(Date.now()+3600000),end:localStamp(Date.now()+7200000),place:'',reminders:[30]};
  if(entity==='courses')return {...base(),activity:'teaching',person,weekday:1,first:1,last:1,weeks:[],place:'',reminders:person===selfId?[10]:[]};
  if(entity==='notices')return {id:id(),title:'',text:'',state:'inbox',updatedAt:Date.now()};
}
function useClock(){return useLive()?.now??Date.now();}
function useData(){
  const [state,setState]=useState<State|null>(null),[error,err]=useState(''),request=useRef(0);
  const set=(s:State)=>{request.current++;setState(s);};
  useEffect(()=>{
  if(!api){err('应用接口没有加载完成，请退出后重新打开 YD。');return;}
    let active=true;
    const load=()=>{const token=++request.current;return api.get().then(s=>{if(active&&token===request.current)setState(s);}).catch(e=>{if(active&&token===request.current)err(msg(e));});};
    const off=api.subscribe(load),offError=api.onError(err);void load();
    return()=>{active=false;off();offError();};
  },[]);
  return {state,set,error,err};
}
function Field({label,children}:any){return h('label',{className:'field'},h('span',null,label),children);}
const weekdayText='一二三四五六日';
const shortDate=(date:string)=>`${Number(date.slice(5,7))}/${Number(date.slice(8,10))}`;
const dateWithWeekday=(date:string)=>`${date}（周${weekdayText[weekday(date)-1]}）`;
// Resolve the original occurrence timing from the course template and its term profile.
function courseTiming(state:State,course?:Course){
  if(!course)return null;
  const profile=state.profiles.find(p=>p.id===course.person);
  if(!profile)return null;
  const start=profile.periods[course.first-1]?.start??'';
  const end=profile.periods[course.last-1]?.end??'';
  const periodText=course.first===course.last?`第 ${course.first} 节`:`第 ${course.first}—${course.last} 节`;
  return {profile,start,end,periodText};
}
function nextCourseText(course:Occurrence,now:number){
  const date=dateOf(course.start),today=dateOf(now),offset=Math.round((epoch(date)-epoch(today))/DAY);
  const clock=fmt(course.start);
  if(offset===0)return `${clock} · ${course.title}`;
  if(offset===1)return `明天 ${clock} · ${course.title}`;
  if(offset>1&&offset<7)return `周${weekdayText[weekday(date)-1]} ${clock} · ${course.title}`;
  return `${shortDate(date)} ${clock} · ${course.title}`;
}
function PartnerStatusCard({status,updatedAt,now}:{status:PersonStatus;updatedAt:number;now:number}){
  // 当前状态来自统一状态引擎（日程或作息）；文案与 Home / Mini / Tip / Tray 完全同源。
  const current=status.current,next=status.nextCourse,active=current.kind!=='idle';
  // 只有"空闲"时才用日程阶段补充说明这一天的课表情况。
  const summary:Record<string,string>={DAY_FINISHED:`今天共 ${status.todayCount} 节课`,NO_CLASS_TODAY:'今天没有已录入课程',NO_SCHEDULE:'导入课表后，这里会显示当前和下一节安排。',TERM_ENDED:'当前学期已结束，没有下一节已录入课程。'};
  return h('section',{className:'partner-status-card'},
    h('div',{className:'partner-status-main'},
      h('div',{className:'partner-status-kicker'},'当前状态'),
      h('h2',{className:'partner-status-headline'},statusLabel(status)),
      active?h(React.Fragment,null,h('p',{className:'partner-current-title'},current.label),h('p',{className:'partner-current-time'},`${fmt(current.startAt)} — ${fmt(current.endAt??current.startAt)}`)):null,
      !active&&summary[status.code]?h('p',{className:'partner-status-summary'},summary[status.code]):null,
      next?h('p',{className:'partner-next-course'},h('span',null,status.code==='TERM_NOT_STARTED'?'首节 · ':'下一节 · '),nextCourseText(next,now)):null),
    h('small',{className:'partner-status-meta'},`课表更新 · ${fmt(updatedAt,true)}`));
}
// Phase 3C：设置当前状态（临时手动状态）。
//
// 第一版只给本人开入口：状态由状态主体本人确认，本机用户不能替同行者声明
// "你现在在做什么"。写入仍然走同一条命令链：api.change → core.apply → Store。
function ManualStatusDialog({live,state,close,change,pending}:{live:ReturnType<typeof snapshot>|null;state:State;close:()=>void;change:(cmd:Command)=>Promise<State|null>;pending:boolean}){
  const self=requireSelfProfile(state);
  const now=live?.now??Date.now();
  const current=live?.people.find(p=>p.person===self.id)?.current;
  const active=current?.source==='manual'?current:null;
  const [kind,setKind]=useState<ManualStateKind>('focus');
  const [minutes,setMinutes]=useState<number|null|'custom'>(60);
  const [custom,setCustom]=useState('');
  const [until,setUntil]=useState(localStamp(now+3600000));
  const [error,setError]=useState('');
  const resolved=minutes==='custom'?(until?epoch(until):Number.NaN):minutes===null?null:now+minutes*60000;
  const option=manualKindOptions.find(item=>item.kind===kind);
  const save=async()=>{
    const problem=manualStatusProblem(kind,custom,resolved,now);
    if(problem){setError(problem);return;}
    setError('');
    const result=await change({type:'manual',kind,label:manualLabelFor(kind,custom),endAt:resolved as number|null});
    if(result)close();
  };
  const cancel=async()=>{
    if(!active)return;
    setError('');
    const result=await change({type:'manualCancel',id:active.sourceId});
    if(result)close();
  };
  return h('div',{className:'modal-backdrop'},h('section',{className:'modal small manual-status',role:'dialog','aria-modal':true,'aria-label':'设置当前状态'},
    h('div',{className:'modal-head'},h('h2',null,'设置当前状态')),
    h('p',{className:'muted'},'告诉 YD 你现在实际上在做什么。到期后会自动恢复成课表 / 作息推导的状态，不需要手动改回。'),
    active?h('p',{className:'setting-note','data-manual-active':'true'},`当前：${active.label} · 本人设置${active.endAt?` · 至 ${clockText(active.endAt)}`:' · 直至取消'}`):null,
    h('div',{className:'field full'},h('span',null,'状态'),
      h('div',{className:'manual-kind-choices',role:'radiogroup','aria-label':'临时状态类型'},
        ...manualKindOptions.map(item=>h('button',{key:item.kind,type:'button',role:'radio','aria-checked':kind===item.kind,className:kind===item.kind?'active':'','data-manual-kind':item.kind,disabled:pending,onClick:()=>setKind(item.kind)},item.label)))),
    kind==='custom'?h('label',{className:'field'},h('span',null,'名称'),h('input',{type:'text',value:custom,maxLength:40,'aria-label':'自定义状态名称',onChange:(e:React.ChangeEvent<HTMLInputElement>)=>setCustom(e.target.value)})):null,
    h('div',{className:'field full'},h('span',null,'持续到'),
      h('div',{className:'manual-duration-choices',role:'radiogroup','aria-label':'持续时间'},
        ...manualDurationOptions.map(item=>h('button',{key:String(item.minutes),type:'button',role:'radio','aria-checked':minutes===item.minutes,className:minutes===item.minutes?'active':'','data-manual-duration':item.minutes===null?'until-cancel':String(item.minutes),disabled:pending,onClick:()=>setMinutes(item.minutes)},item.label)),
        h('button',{type:'button',role:'radio','aria-checked':minutes==='custom',className:minutes==='custom'?'active':'','data-manual-duration':'custom',disabled:pending,onClick:()=>setMinutes('custom')},'自定义结束时间'))),
    minutes==='custom'?h('label',{className:'field'},h('span',null,'结束时间（北京时间）'),h('input',{type:'datetime-local',value:until,'aria-label':'结束时间',onChange:(e:React.ChangeEvent<HTMLInputElement>)=>setUntil(e.target.value)})):null,
    option?.hint?h('p',{className:'muted setting-note'},option.hint):null,
    active?h('p',{className:'muted setting-note'},'保存会替换当前这一条临时状态。'):null,
    error?h('p',{className:'error',role:'alert'},error):null,
    h('div',{className:'modal-foot'},
      active?h('button',{type:'button',className:'ghost','data-manual-action':'cancel',disabled:pending,onClick:cancel},'取消当前状态'):null,
      h('span',{className:'modal-spacer'}),
      h('button',{type:'button',className:'ghost',onClick:close,disabled:pending},'关闭'),
      h('button',{type:'button',className:'primary','data-manual-action':'save',disabled:pending,onClick:save},'保存'))));
}
function ImageView({image}: {image?:string}){
  const [url,set]=useState(''),[error,err]=useState('');useEffect(()=>{set('');err('');let active=true;if(image)api.image(image).then(x=>{if(active)set(x);}).catch(e=>{if(active)err(msg(e));});return()=>{active=false;};},[image]);
  return error?h('p',{className:'error'},error):url?h('a',{href:url,onClick:(e:any)=>e.preventDefault(),className:'image-preview','aria-label':'原始图片'},h('img',{src:url,alt:'导入的原始课表或通知图片'})):null;
}
interface EditorProps { sourceOpen?:(id:string)=>void; entity:Entity; value:any; state:State; close:()=>void; saved:(s:State)=>void; convert?:string; duplicate?:(value:any)=>void; remove?:(entity:Entity,id:string)=>void }
function Editor({entity,value,state,close,saved,convert,duplicate,remove,sourceOpen}:EditorProps){
  const [d,set]=useState<any>(structuredClone(entity==='profiles'?{...value,shortAlias:profileAlias(value)}:value)),[error,err]=useState(''),[saving,busy]=useState(false),[recognizing,ocrBusy]=useState(false),[source,showSource]=useState(false);
  const [weeks,setWeeks]=useState(Array.isArray(value.weeks)?value.weeks.join(','):''),[reminders,setReminders]=useState(Array.isArray(value.reminders)?value.reminders.join(','):''),[checks,setChecks]=useState((value.checklist||[]).map((x:ChecklistItem)=>(x.done?'[x] ':'')+x.text).join('\n'));
  const [periods,setPeriods]=useState((value.periods||[]).map((p:any)=>`${p.start}-${p.end}`).join('\n'));
  const update=(key:string,v:any)=>set((old:any)=>({...old,[key]:v}));
  const input=(key:string,type='text',required=false)=>h('input',{type,value:d[key]??'',required,onChange:(e:any)=>update(key,type==='number'?Number(e.target.value):e.target.value)});
  const area=(key:string,rows=4)=>h('textarea',{value:d[key]??'',rows,onChange:(e:any)=>update(key,e.target.value)});
  const select=(key:string,options:{v:any;t:string}[])=>h('select',{value:d[key],onChange:(e:any)=>update(key,typeof options[0].v==='number'?Number(e.target.value):e.target.value)},...options.map(x=>h('option',{key:x.v,value:x.v},x.t)));
  const field=(label:string,child:any)=>h(Field,{label},child);
  const p=state.profiles.find(p=>p.id===d.person)??requireSelfProfile(state);
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!saving&&!recognizing)close();};document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey);},[close,saving,recognizing]);
  const title=({profiles:'学校作息与学期',courses:'课程',events:'会议 / 活动',tasks:convert?'核对并转为待办':'待办',notices:'原始通知 / 课表图片',exceptions:'仅修改这一次课程'} as any)[entity];
  async function save(e:any){
    e.preventDefault();busy(true);err('');try{
      const next={...d};
      if(['tasks','events','courses'].includes(entity)){
        next.title=next.title.trim();next.reminders=reminders.trim()?reminders.split(/[,，\s]+/).map(Number):[];
        next.checklist=checks.split('\n').filter((line:string)=>line.trim()).map((line:string,i:number)=>({id:value.checklist?.[i]?.id||id(),text:line.replace(/^\[x\]\s*/i,'').trim(),done:/^\[x\]/i.test(line)}));
      }
      if(entity==='courses')next.weeks=weeks.trim()?weeks.split(/[,，\s]+/).map(Number):[];
      if(entity==='profiles')next.periods=periods.split('\n').filter((line:string)=>line.trim()).map((line:string)=>{const [start,end]=line.trim().split(/[-—～~]/);return {start:start?.trim(),end:end?.trim()};});
      if(entity==='notices')next.originalText=next.originalText??next.text;
      const result=await api.change(convert?{type:'convert',noticeId:convert,task:next}:{type:'save',entity,value:next});saved(result);close();
    }catch(e){err(msg(e));}finally{busy(false);}
  }
  async function recognize(){ocrBusy(true);err('');try{const text=await api.ocr(d.image);set((old:any)=>({...old,text,originalText:old.originalText??text}));if(!text.trim())err('没有识别到文字，可继续看图填写。');}catch(e){err(msg(e));}finally{ocrBusy(false);}}
  return h('div',{className:'modal-backdrop'},h('section',{className:'modal',role:'dialog','aria-modal':true,'aria-label':title},
    h('header',{className:'modal-head'},h('h2',null,title),b('关闭',close,'ghost',saving)),
    h('form',{onSubmit:save},
      entity==='profiles'?h('div',{className:'form-grid'},field('显示名称',input('name','text',true)),field('状态短代号',input('shortAlias','text',true)),field('第一教学周的周一',input('startDate','date',true)),field('教学周数',input('weeks','number',true)),field('结束周数',h('label',null,h('input',{type:'checkbox',checked:!!d.tentative,onChange:(e:any)=>update('tentative',e.target.checked)}),' 暂定（待校历确认）')),h('div',{className:'full'},field('各节起止时间（每行一节，例如 08:00-08:45）',h('textarea',{rows:9,value:periods,onChange:(e:any)=>setPeriods(e.target.value)})),h('p',{className:'muted'},'这里只设置作息，不会自动生成课程。请分别核对两所学校的时间。'))):null,
      ['courses','events','tasks'].includes(entity)?h(React.Fragment,null,field('标题',input('title','text',true)),
        entity==='courses'?h('div',{className:'form-grid'},field('所属课表',select('person',personOptions(state).map(o=>({v:o.value,t:o.label})))),field('活动类型',select('activity',[{v:'teaching',t:'授课'},{v:'research',t:'教研'}])),field('星期',select('weekday',Array.from({length:7},(_,i)=>({v:i+1,t:'星期'+'一二三四五六日'[i]})))),field('开始节次',select('first',p.periods.map((t,i)=>({v:i+1,t:`第 ${i+1} 节 · ${t.start}`})))),field('结束节次',select('last',p.periods.map((t,i)=>({v:i+1,t:`第 ${i+1} 节 · ${t.end}`})))),h('div',{className:'full'},field('教学周（用逗号分隔）',h('input',{value:weeks,onChange:(e:any)=>setWeeks(e.target.value),placeholder:'例如 1,3,5,7'})),h('div',{className:'actions'},...['每周','单周','双周'].map((label,i)=>b(label,()=>setWeeks(Array.from({length:p.weeks},(_,w)=>w+1).filter(w=>i===0||w%2===(i===1?1:0)).join(',')))))),field('地点',input('place'))):null,
        entity==='events'?h('div',{className:'form-grid'},field('开始时间（北京时间）',input('start','datetime-local',true)),field('结束时间（北京时间）',input('end','datetime-local')),field('地点',input('place'))):null,
        entity==='tasks'?h('div',{className:'form-grid'},field('截止时间（可不填，北京时间）',input('due','datetime-local')),field('状态',h('select',{value:d.done?'done':'todo',onChange:(e:any)=>update('done',e.target.value==='done')},h('option',{value:'todo'},'待处理'),h('option',{value:'done'},'已完成')))):null,
        field('备注',area('notes')),
        field('准备清单（每行一项，已完成项以 [x] 开头）',h('textarea',{rows:4,value:checks,onChange:(e:any)=>setChecks(e.target.value)})),
        field('提前提醒分钟数（逗号分隔，0 为到时，留空关闭）',h('input',{value:reminders,onChange:(e:any)=>setReminders(e.target.value),placeholder:'例如 1440,120,0'})),
        entity==='courses'&&d.person!==requireSelfProfile(state).id?h('p',{className:'muted'},'该课表用于状态展示，不发送上课提醒。'):null,
        d.sourceId?h('div',{className:'source-box'},b('来源 · 通知收件箱 · '+fmt(state.notices.find(n=>n.id===d.sourceId)?.createdAt??state.notices.find(n=>n.id===d.sourceId)?.updatedAt??Date.now(),true),()=>sourceOpen?.(d.sourceId),'ghost'),source?h('div',null,h(ImageView,{image:state.notices.find(n=>n.id===d.sourceId)?.image}),h('pre',null,state.notices.find(n=>n.id===d.sourceId)?.originalText??state.notices.find(n=>n.id===d.sourceId)?.text)):null):null):null,
      entity==='notices'?h(React.Fragment,null,field('标题 / 群名称（便于查找）',input('title')),d.image?h('div',{className:'image-layout'},h(ImageView,{image:d.image}),h('div',null,b(recognizing?'正在本机识别…':'提取图片文字',recognize,'secondary',recognizing||saving),h('p',{className:'muted'},'只在本机处理。识别后仍需核对日期、节次与要求。'))):null,field('文字（可粘贴或校对，不自动创建日程）',area('text',9)),d.originalText!==undefined?h('details',null,h('summary',null,'最初保存的文字'),h('pre',null,d.originalText)):null,field('收件箱状态',select('state',[{v:'inbox',t:'待处理'},{v:'later',t:'稍后处理'},{v:'archived',t:'已归档'}]))):null,
      entity==='exceptions'?(()=>{
        const course=state.courses.find(c=>c.id===d.courseId),timing=courseTiming(state,course);
        return h(React.Fragment,null,
          h('section',{className:'original-course'},
            h('div',{className:'original-course-label'},'原课程'),
            h('strong',{className:'original-course-title'},course?.title??'课程记录已不存在'),
            h('div',{className:'original-course-grid'},
              h('div',null,h('span',null,'日期'),h('b',null,dateWithWeekday(d.date))),
              h('div',null,h('span',null,'时间'),h('b',null,timing?`${timing.start} — ${timing.end}`:'未配置')),
              h('div',null,h('span',null,'节次'),h('b',null,timing?.periodText??'未配置')),
              h('div',null,h('span',null,'地点'),h('b',null,course?.place||'未填写')),
              h('div',null,h('span',null,'课表'),h('b',null,course?profileLabelFor(state,course.person):'未选择')))),
          h('div',{className:'form-section'},
            h('div',{className:'form-section-head'},h('h3',null,'本次处理')),
            field('处理方式',h('select',{value:d.cancelled?'cancel':'move',onChange:(e:any)=>{
              const cancelled=e.target.value==='cancel';
              set((old:any)=>({...old,cancelled,...(!cancelled&&!old.start&&timing?{start:`${d.date}T${timing.start}`,end:`${d.date}T${timing.end}`}:{})}));
            }},h('option',{value:'move'},'调课'),h('option',{value:'cancel'},'停课'))),
            !d.cancelled?h('div',{className:'form-grid'},field('新的开始时间',input('start','datetime-local',true)),field('新的结束时间',input('end','datetime-local',true)),field('本次地点',input('place'))):null,
            h('p',{className:'form-note'},'仅影响原日期对应的这一次课程，其余周保持原安排。')));
      })():null,
      entity==='exceptions'&&d.sourceInboxItemId?h('div',{className:'source-box'},b('来源 · 通知收件箱',()=>sourceOpen?.(d.sourceInboxItemId),'ghost'),h('pre',null,state.notices.find(n=>n.id===d.sourceInboxItemId)?.originalText||state.notices.find(n=>n.id===d.sourceInboxItemId)?.text),h(ImageView,{image:state.notices.find(n=>n.id===d.sourceInboxItemId)?.image})):null,
      error?h('p',{className:'error',role:'alert'},error):null,
      h('footer',{className:'modal-foot'},entity==='courses'&&state.courses.some(c=>c.id===d.id)?h('div',{className:'modal-manage'},b('删除课程',()=>remove?.('courses',d.id),'text-button',saving),b('复制课程',()=>duplicate?.(d),'ghost',saving)):null,h('span',{className:'modal-spacer'}),b('取消',close,'ghost',saving),h('button',{type:'submit',className:'primary',disabled:saving||recognizing},saving?'正在保存…':'核对并保存'))
    )));
}
function App(){
  const clock=useLive();
 const {state,set,error,err}=useData(),now=clock?.now??Date.now(),[tab,setTab]=useState('today'),[editor,edit]=useState<any>(null),[message,say]=useState(''),[query,search]=useState(''),[filter,setFilter]=useState('all'),[selectedDate,setDate]=useState(dateOf(Date.now())),[person,setPerson]=useState<PersonId|null>(null),[selectedNotice,setSelectedNotice]=useState<string|null>(null),[pending,setPending]=useState(false),[importing,setImporting]=useState(false),[schedule,setSchedule]=useState<SchedulePackage|null>(null),[deletion,setDeletion]=useState<{entity:Entity;id:string}|null>(null);
  // Phase 3C：临时手动状态的对话框（首页状态行与桌宠菜单都能打开它）。
  const [manualOpen,setManualOpen]=useState(false);
  useEffect(()=>{document.body.classList.add('main-body');return()=>document.body.classList.remove('main-body');},[]);
  // 全局粘贴截图：不在收件箱、也不在输入框里时，截图直接进通知收件箱。
  useEffect(()=>{
    const listener=(e:ClipboardEvent)=>{
      if(tab==='inbox')return;
      const tag=(e.target as HTMLElement|null)?.tagName??'';
      if(tag==='INPUT'||tag==='TEXTAREA')return;
      if(Array.from(e.clipboardData?.items||[]).some(x=>x.type.startsWith('image/'))){e.preventDefault();void importImage(true);}
    };
    document.addEventListener('paste',listener);return()=>document.removeEventListener('paste',listener);
  },[tab]);
  // 快捷键只做导航与新建，不引入可配置的快捷键系统。
  const shortcuts=useRef({open,setTab,search}),tabsRef=useRef<ShellTab[]>([]);
  shortcuts.current={open,setTab,search};
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      if(!(e.ctrlKey||e.metaKey)||e.altKey)return;
      const tag=(e.target as HTMLElement|null)?.tagName??'';
      if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
      const key=e.key.toLowerCase();
      if(key==='n'){e.preventDefault();shortcuts.current.open(e.shiftKey?'events':'tasks');return;}
      if(key===','){e.preventDefault();shortcuts.current.setTab('settings');return;}
      if(key==='k'){e.preventDefault();shortcuts.current.setTab('tasks');shortcuts.current.search('');window.requestAnimationFrame(()=>{(document.querySelector('[aria-label="搜索事项与会议"]') as HTMLInputElement|null)?.focus();});return;}
      const nav:Record<string,string>=tabShortcuts(tabsRef.current);
      const target=nav[e.key];
      if(target){e.preventDefault();shortcuts.current.setTab(target);}
    };
    document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey);
  },[]);
  const previousDay=useRef(dateOf(now));
  useEffect(()=>{const day=dateOf(now);if(day!==previousDay.current){setDate(d=>d===previousDay.current?day:d);previousDay.current=day;}},[now]);
  useEffect(()=>api.onSettings(()=>setTab('settings')),[]);
  // 桌宠右键菜单的「设置当前状态」：主进程拉起主窗口后投递这个事件。
  useEffect(()=>api.onStatus(()=>{setTab('today');setManualOpen(true);}),[]);
  async function change(cmd:Command){setPending(true);err('');try{const s=await api.change(cmd);set(s);return s;}catch(e){err(msg(e));return null;}finally{setPending(false);}}
  function open(entity:Entity,value?:any,convert?:string){if(entity==='notices'){setTab('inbox');setSelectedNotice(value?.id||null);return;}edit({entity,value:value||newValue(entity,activePerson,selfId),convert});err('');}
  async function importImage(paste=false){setImporting(true);err('');try{const result=await(paste?api.pasteImage():api.importImage());if(result){const noticeId=id();set(await api.change({type:'inbound',id:noticeId,payload:{image:result.image,sourceType:paste?'SCREENSHOT':'IMAGE_IMPORT'}}));setTab('inbox');setSelectedNotice(noticeId);try{const text=await api.ocr(result.image);if(text.trim())set(await api.parseNotice(noticeId,text,true));}catch(e){err(msg(e));}}else if(paste)say('剪贴板中没有图片，可使用粘贴文字。');}catch(e){err(msg(e));}finally{setImporting(false);}}
  async function chooseSchedule(){setImporting(true);err('');try{const value=await api.chooseSchedule();if(value)setSchedule(value);}catch(e){err(msg(e));}finally{setImporting(false);}}
  if(!state)return h('main',{className:'loading'},h('h1',null,'YD'),h('p',null,error||'正在打开本地记录…'));
  const s=state,live=snapshot(s,now),all=occurrences(s,epoch(selectedDate),epoch(addDays(selectedDate,1))),conflictIds=conflicts(all);
  const pendingReminders=selectPendingReminders(s);
  // 身份与导航都从实际档案派生：Solo 只有本人页，Together 才有同行者页。
  const selfId=requireSelfProfile(s).id,companion=getCompanionProfile(s),tabs=shellTabs(s);
  const tabSpec=tabs.find(t=>t.key===tab)??tabs[0],kind=tabSpec.kind;
  const activePerson=person&&s.profiles.some(p=>p.id===person)?person:selfId;
  const companionStatus=companion?live.people.find(p=>p.person===companion.id):undefined;
  const companionRows=companion?occurrences(s,epoch(selectedDate),epoch(addDays(selectedDate,1)),companion.id,{includeCancelled:true}):[];
  const hasCompanionSchedule=!!companion&&s.courses.some(c=>c.person===companion.id),selectedIsToday=selectedDate===dateOf(now);
  const selectedDateText=`${shortDate(selectedDate)} 周${weekdayText[weekday(selectedDate)-1]}`;
  const companionEmptyText=!hasCompanionSchedule?'尚未录入课表':selectedIsToday?'今天无课':'这一天没有课程安排';
  const labels:Record<string,string>=Object.fromEntries(tabs.map(t=>[t.key,t.label])),widthPolicy=tabWidthPolicy;
  const profile=s.profiles.find(p=>p.id===activePerson)??requireSelfProfile(s);
  tabsRef.current=tabs;
  function cardSource(sourceId?:string){return sourceId?b('查看来源',()=>{const n=s.notices.find(n=>n.id===sourceId);if(n)open('notices',n);},'text-button'):null;}
  function checklist(entity:Entity,item:any){return item.checklist?.length?h('div',{className:'checklist'},...item.checklist.map((c:ChecklistItem)=>h('div',{key:c.id,className:'check-row'},h('label',null,h('input',{type:'checkbox',checked:c.done,disabled:pending,onChange:()=>change({type:'save',entity,value:{...item,checklist:item.checklist.map((x:ChecklistItem)=>x.id===c.id?{...x,done:!x.done}:x)}})}),h('span',{className:c.done?'done':''},c.text)),b('单独提醒',()=>open('tasks',{...newValue('tasks',activePerson,selfId),title:c.text,notes:`准备事项，来自：${item.title}`,sourceId:item.sourceId}),'text-button')))):null;}
  function occurrenceCard(o:Occurrence){const item=o.kind==='course'?s.courses.find(c=>c.id===o.courseId)!:s.events.find(e=>`events:${e.id}`===o.target)!;const entity=o.kind==='course'?'courses':'events';return h('article',{key:o.id,className:'entry compact-entry'+(o.start<=now&&o.end>now?' current':'')},h('div',{className:'entry-top'},h('span',{className:'time'},`${fmt(o.start)} — ${o.endUnknown?'结束时间未填写':fmt(o.end)}`),h('div',{className:'entry-flags'},conflictIds.has(o.id)?h('span',{className:'warning'},'时间冲突'):null,h('details',{className:'action-menu'},h('summary',{'aria-label':`${o.title}的更多操作`},'⋯'),h('div',{className:'action-menu-pop'},b('编辑',()=>open(entity,item),'ghost'),o.kind==='course'?b('本次调课 / 停课',()=>open('exceptions',s.exceptions.find(e=>e.courseId===o.courseId&&e.date===o.date)||{id:id(),courseId:o.courseId,date:o.date,cancelled:false,start:localStamp(o.start),end:localStamp(o.end),place:o.place,updatedAt:now}),'ghost'):b('删除会议',()=>setDeletion({entity:'events',id:item.id}),'text-button'),cardSource(o.sourceInboxItemId||o.sourceId))))),h('h3',null,o.title),h('p',{className:'muted'},o.place||'未填地点'),o.notes?h('p',{className:'note'},o.notes):null,checklist(entity,item));}
  // 课程条配色：与课表网格里的五种课块色一致，用 id 稳定映射，刷新不会变色。
  const COURSE_TONES=['sea','blue','violet','rose','amber'];
  function courseTone(key:string){let n=0;for(let i=0;i<key.length;i++)n=(n*31+key.charCodeAt(i))>>>0;return COURSE_TONES[n%COURSE_TONES.length];}
  function partnerRow(o:Occurrence,index?:number){
    const item=s.courses.find(c=>c.id===o.courseId)!;
    const isCurrent=!o.cancelled&&selectedIsToday&&o.start<=now&&now<o.end;
    const isPast=!o.cancelled&&selectedIsToday&&o.end<=now;
    const exception=s.exceptions.find(e=>e.courseId===o.courseId&&e.date===o.date);
    const state=o.cancelled?'已停课':o.rescheduled?'已调课':isCurrent?'上课中':isPast?'已结束':null;
    // 一节课一张卡：左侧时间轴 + 课程色条，标题是行内主角，低频操作收进 ⋯。
    // 当天概览跟着第一张卡一起进列表，保证在宽屏下也贴近内容而不是浮在顶部。
    return h(React.Fragment,{key:o.id},index===0?partnerDayRail(companionRows):null,
      h('article',{className:`partner-row tone-${courseTone(o.courseId??o.id)}${isCurrent?' current':''}${isPast?' past':''}${o.cancelled?' cancelled':''}`},
      h('div',{className:'partner-row-time'},h('strong',null,fmt(o.start)),h('span',{className:'partner-row-bar','aria-hidden':true}),h('small',null,o.endUnknown?'—':fmt(o.end))),
      h('div',{className:'partner-row-main'},h('h3',null,o.title),
        h('div',{className:'partner-row-meta'},h('span',{className:'partner-row-place'},o.place||'地点未填写'),item?.activity?h('span',{className:'partner-row-kind'},item.activity==='research'?'教研':'授课'):null)),
      h('div',{className:'partner-row-actions'},state?h('span',{className:'partner-row-state'},state):null,
        h('details',{className:'action-menu'},h('summary',{'aria-label':`${o.title}的更多操作`},'⋯'),
          h('div',{className:'action-menu-pop'},b('编辑课程',()=>open('courses',item),'ghost'),b('本次调课 / 停课',()=>open('exceptions',exception||{id:id(),courseId:o.courseId,date:o.date,cancelled:false,start:localStamp(o.start),end:localStamp(o.end),place:o.place,updatedAt:now}),'ghost'))))));
  }
  function taskCard(t:Task){return h('article',{key:t.id,className:'entry'},h('div',{className:'entry-top'},h('h3',{className:t.done?'done':''},t.title),h('div',{className:'entry-flags'},t.done?h('span',{className:'tag'},'已完成'):t.due&&epoch(t.due)<now?h('span',{className:'warning'},'已逾期'):null,h('details',{className:'action-menu'},h('summary',{'aria-label':`${t.title}的更多操作`},'⋯'),h('div',{className:'action-menu-pop'},b('编辑',()=>open('tasks',t),'ghost'),cardSource(t.sourceId),b('删除',()=>setDeletion({entity:'tasks',id:t.id}),'text-button'))))),h('p',{className:'muted'},t.due?`${t.due.replace('T',' ')} 截止`:'未设置截止时间'),t.notes?h('p',{className:'note'},t.notes):null,checklist('tasks',t),h('div',{className:'actions'},b(t.done?'恢复待处理':'标记完成',()=>change({type:'save',entity:'tasks',value:{...t,done:!t.done}}),'secondary',pending)));} 
  // 当天概览：一句"今天几节课" + 一条按真实时段排布的时间轨，宽屏下补上横向节奏感。
  function partnerDayRail(rows:Occurrence[]){
    const active=rows.filter(r=>!r.cancelled);
    const basis=active.length?active:rows;
    const from=Math.min(...basis.map(r=>r.start));
    const to=Math.max(...rows.map(r=>r.end));
    const span=Math.max(1,to-from);
    return h('div',{className:'partner-day-summary'},
      h('span',{className:'partner-day-count'},`${selectedIsToday?'今天':'这天'} ${active.length} 节课`),
      h('div',{className:'day-rail','aria-hidden':true},...rows.map(o=>h('span',{key:o.id,className:`day-rail-seg tone-${courseTone(o.courseId??o.id)}${o.cancelled?' cancelled':''}`,style:{left:`${((o.start-from)/span*100).toFixed(2)}%`,width:`${Math.max(1.2,(o.end-o.start)/span*100).toFixed(2)}%`}}))),
      h('span',{className:'partner-day-span'},`${fmt(from)} — ${fmt(to)}`));
  }
  // 本人状态投影：当前状态来自统一 StateEngine（page/焦点条/状态行共用），next 仍是独立的日程信息。
  const active=s.courses.filter(c=>c.person===activePerson),selfStatus=live?.people.find(p=>p.person===selfId),current=selfStatus?.current,next=selfStatus?.next,attention=attentionSummary(s,now);
  const visibleTasks=s.tasks.filter(t=>(t.title+' '+t.notes).toLowerCase().includes(query.toLowerCase())).filter(t=>filter==='all'||filter==='done'&&t.done||filter==='overdue'&&!t.done&&!!t.due&&epoch(t.due)<now||filter==='today'&&!t.done&&!!t.due&&t.due.startsWith(dateOf(now))||filter==='week'&&!t.done&&!!t.due&&epoch(t.due)>=epoch(dateOf(now))&&epoch(t.due)<epoch(addDays(dateOf(now),7))).sort((a,b)=>Number(a.done)-Number(b.done)||(a.due?epoch(a.due):Infinity)-(b.due?epoch(b.due):Infinity));
  const myDay=all.filter(o=>o.person===selfId);
  const activeIds=new Set(active.map(c=>c.id));
  const exceptionList=s.exceptions.filter(e=>activeIds.has(e.courseId)).sort((a,b)=>b.date.localeCompare(a.date)||b.updatedAt-a.updatedAt);
  const focusSchedule=()=>{const el=document.querySelector('.schedule-scroll');if(!el)return;el.scrollIntoView({behavior:'smooth',block:'center'});el.classList.add('schedule-highlight');window.setTimeout(()=>el.classList.remove('schedule-highlight'),1600);};
  function exceptionCard(e:Exception){
    const course=s.courses.find(c=>c.id===e.courseId),timing=courseTiming(s,course);
    const movedStart=e.start?epoch(e.start):null,movedEnd=e.end?epoch(e.end):null;
    return h('article',{className:`exception-card${e.cancelled?' cancelled':''}`,key:e.id},
      h('div',{className:'exception-head'},
        h('div',{className:'exception-title'},h('strong',null,course?.title??'课程记录已不存在'),h('span',{className:`type-badge ${e.cancelled?'cancel':'move'}`},e.cancelled?'停课':'调课')),
        h('div',{className:'exception-actions'},b('编辑',()=>open('exceptions',e),'ghost'),b('恢复原课',()=>setDeletion({entity:'exceptions',id:e.id}),'ghost'))),
      h('dl',{className:'exception-meta'},
        h('div',null,h('dt',null,'原日期'),h('dd',null,dateWithWeekday(e.date))),
        h('div',null,h('dt',null,'原时间'),h('dd',null,timing?`${timing.start} — ${timing.end} · ${timing.periodText}`:'未配置')),
        h('div',null,h('dt',null,'地点'),h('dd',null,course?.place||'未填写')),
        !e.cancelled&&movedStart!==null&&movedEnd!==null?h('div',null,h('dt',null,'调整后'),h('dd',null,`${dateWithWeekday(dateOf(movedStart))} ${fmt(movedStart)} — ${fmt(movedEnd)}`)):null,
        !e.cancelled&&e.place!==undefined?h('div',null,h('dt',null,'新地点'),h('dd',null,e.place||'未填写')):null,
        h('div',null,h('dt',null,'最近修改'),h('dd',null,fmt(e.updatedAt,true)))));
  }
  return h('div',{className:'shell'},h(Titlebar,null),
    h('aside',{className:'sidebar'},
      h('nav',{'aria-label':'主导航'},...tabs.map(t=>h('button',{key:t.key,type:'button',className:tab===t.key?'nav-item active':'nav-item','data-tab':t.key,'data-kind':t.kind,'aria-current':tab===t.key?'page':undefined,onClick:()=>{setTab(t.key);search('');}},
        uiIcon(navIcons[t.kind],'nav-icon'),h('span',{className:'nav-label'},t.label),t.kind==='reminders'&&pendingReminders.length?h('span',{className:'nav-badge','aria-label':`${pendingReminders.length} 个未处理提醒`},pendingReminders.length):null))),
      h('div',{className:'sidebar-bottom'},h('span',{className:'sidebar-note',title:'数据保存在本机，可离线使用'},h('span',{className:'online-dot'}),'本地模式'))),
    h('main',{className:'main'},
      h('span',{className:'page-atmosphere','aria-hidden':true}),
      h('div',{className:`page-frame page-${kind} ${widthPolicy[kind]}`},
      h('header',{className:'page-head'},h('div',null,h('div',{className:'eyebrow'},h('span',null,`${dateOf(now)} · ${fmt(now)}`),h('em',{className:'eyebrow-zone'},'北京时间')),h('h1',null,labels[tabSpec.key]),kind==='today'?h('p',{className:'page-tagline'},'让每一天，更从容。'):null),kind==='today'?h('div',{className:'actions'},b('新建待办',()=>open('tasks'),'primary'),b('新建会议',()=>open('events'),'secondary')):null),
      error?h('div',{className:'error banner',role:'alert'},error,b('关闭',()=>err(''),'ghost')):null,
      message?h('div',{className:'banner',role:'status'},message,b('知道了',()=>say(''),'ghost')):null,
      !s.settings.setup?h('section',{className:'setup-banner'},h('h2',null,'先核对双方的学校作息'),h('p',null,'请核对双方第一教学周和节次时间；已有记录会保留。'),h('div',{className:'actions'},...s.profiles.map(p=>b(`设置${p.name}的作息`,()=>open('profiles',p),'secondary')),b('已核对，开始使用',()=>change({type:'settings',setup:true}),'primary',pending))):null,
      kind==='today'?h(React.Fragment,null,
        h(StatusRows,{live,onSetStatus:()=>setManualOpen(true)}),
        attention.total?h('section',{className:'attention-panel'},h('div',{className:'attention-title'},h('div',null,h('div',{className:'eyebrow'},'需要处理'),h('h2',null,`需要处理 ${attention.total}`))),h('div',{className:'attention-items'},attention.notices?b(`${attention.notices} 条通知待核对`,()=>setTab('inbox'),'attention-link'):null,attention.reminders?b(`${attention.reminders} 个提醒已到时间`,()=>setTab('reminders'),'attention-link'):null,attention.overdue?b(`${attention.overdue} 个待办已逾期`,()=>setTab('tasks'),'attention-link'):null)):null,
        h('div',{className:'home-grid'},
          h('div',{className:'home-primary'},
            h('section',{className:'focus-strip'},h('div',{className:'focus-copy'},h('div',{className:'eyebrow icon-eyebrow'},uiIcon(Clock3),'接下来'),h('h2',null,next?.title||'今天没有后续安排'),h('p',null,next?`${fmt(next.start,true)} · ${next.place||'地点未填写'}`:'当前没有即将发生的课程或会议')),h('div',{className:'focus-detail'},next?h('span',null,until(now,next.start)):h('span',null,'可以安心安排其他事情'),current&&current.kind!=='idle'?h('small',null,`正在进行：${current.label}${current.endAt?` · ${fmt(current.endAt)} 结束`:''}`):null)),
            h('section',{className:'panel'},
              h('div',{className:'section-head'},h('div',{className:'section-heading'},uiIcon(CalendarDays,'section-icon'),h('div',null,h('h2',null,selectedIsToday?'今日日程':'当日日程'),h('small',{className:'section-subtitle'},selectedDateText))),h('input',{'aria-label':'查看日期',type:'date',value:selectedDate,onChange:(e:any)=>{if(e.target.value)setDate(e.target.value);}})),
              myDay.length?h('div',{className:'entry-list'},...myDay.map(occurrenceCard)):h(EmptyState,{title:selectedIsToday?'今天没有安排':'这一天没有安排',description:'课程、会议与活动会显示在这里。',illustration:'assets/gen/empty-schedule.png',actions:h(React.Fragment,null,selectedIsToday?b('新建会议',()=>open('events'),'secondary'):null,b('管理课表',()=>setTab('courses'),'ghost'))}))))):null,
      kind==='person'&&companion&&companionStatus?h(React.Fragment,null,h(PartnerStatusCard,{status:companionStatus,updatedAt:companion.updatedAt,now}),h('div',{className:'partner-reading'},h('div',{className:'section-head partner-schedule-head'},h('div',null,h('h2',null,`${companion.name} 的日程`),h('small',{className:'section-subtitle'},selectedDateText)),h('input',{'aria-label':`查看 ${companion.name} 的日期`,type:'date',value:selectedDate,onChange:(e:any)=>{if(e.target.value)setDate(e.target.value);}})),companionRows.length?h('div',{className:'partner-list'},...companionRows.map(partnerRow)):h('div',{className:'empty-stage'},h(EmptyState,{title:companionEmptyText,description:!hasCompanionSchedule?`导入或录入 ${companion.name} 的课表后，这里会显示每天的课程安排。`:selectedIsToday?'今天没有已录入的课程，单次调课与停课会同步更新。':'这一天没有课程安排，可以切换日期查看。',actions:!hasCompanionSchedule?b('前往课表管理',()=>setTab('courses'),'secondary'):null})))):null,
      kind==='tasks'?h(ManagementOverview,{tasks:[...s.tasks].sort((a,b)=>Number(a.done)-Number(b.done)||(a.due?epoch(a.due):Infinity)-(b.due?epoch(b.due):Infinity)),events:s.events,now,query,setQuery:search,taskCard,editEvent:(event:Event)=>open('events',event),deleteEvent:(event:Event)=>setDeletion({entity:'events',id:event.id}),createTask:()=>open('tasks'),createEvent:()=>open('events')}):null,
      kind==='courses'?h(React.Fragment,null,
        // 课表管理页：先选课表，再加课程；学校作息是配置，降级为一行文字入口。
        h('div',{className:'course-toolbar'},
          h('div',{className:'course-toolbar-main'},
            h('select',{'aria-label':'课表所属人',value:activePerson,onChange:(e:any)=>setPerson(e.target.value)},...personOptions(s).map(o=>h('option',{key:o.value,value:o.value},o.label))),
            b('添加课程',()=>open('courses'),'primary')),
          h('div',{className:'course-toolbar-meta'},
            h('span',null,`${profile.startDate} 起 · 共 ${profile.weeks} 周 · 每日 ${profile.periods.length} 节`),
            h('span',{className:'course-toolbar-dot'},'·'),
            h('span',null,`课表更新 ${fmt(profile.updatedAt,true)}`),
            b('学校作息',()=>open('profiles',profile),'text-button'),
            b(importing?'正在读取…':'导入课表',chooseSchedule,'ghost',importing||pending))),
        h(ScheduleGrid,{state:s,profile,courses:active,now,edit:(course:Course)=>open('courses',course),create:(value:Partial<Course>)=>open('courses',{...newValue('courses',activePerson,selfId),...value})}),
        h('section',{className:'panel exceptions-panel'},
          h('div',{className:'section-head'},h('div',null,h('h2',null,'单次调课与停课'),h('small',{className:'section-subtitle'},exceptionList.length?`${exceptionList.length} 条记录`:'暂无记录'))),
          exceptionList.length?h('div',{className:'exception-list'},...exceptionList.map(exceptionCard)):h(EmptyState,{title:'还没有单次调课或停课',description:'你可以在上方课程项中点击“本次调课 / 停课”，仅修改某一天的这一次课程。添加后，记录会显示在这里，并影响当日课表与状态展示。',actions:b('查看可修改课程',focusSchedule,'secondary')}))):null,
      kind==='inbox'?h(InboxHub,{state:s,saved:set,selected:selectedNotice,select:setSelectedNotice,open}):null,
      kind==='reminders'?h(React.Fragment,null,h('p',{className:'muted page-intro'},'这里只计入已到提醒时间、尚未处理的提醒；未来预约提醒不计入。处理提醒不会将待办自动标记完成。'),...pendingReminders.map(r=>h('article',{className:'entry',key:r.id},h('h3',null,r.title),h('p',{className:'muted'},`${fmt(r.due,true)} 到提醒时间 · 未处理`),h('div',{className:'actions'},b('已处理',()=>change({type:'ack',id:r.id}),'primary',pending),...([10,30,60] as const).map(minutes=>b(minutes===60?'1 小时后':`${minutes} 分钟后`,()=>change({type:'snooze',id:r.id,minutes}),'secondary',pending)),b('打开事项',()=>{const [entity,i]=r.target.split(':');const item=(s[entity as Entity] as any[]).find(v=>v.id===i);if(item)open(entity as Entity,item);},'ghost')))),!pendingReminders.length?h('div',{className:'page-empty-stage'},h(EmptyState,{title:'没有未处理提醒',description:'已到提醒时间且尚未处理的提醒会显示在这里。未来预约提醒不计入，确认提醒也不会自动完成待办。',illustration:'assets/gen/empty-reminders.png'})):null):null,
      kind==='settings'?h('div',{className:'settings-stack'},
        h(PetSettings,{live,settings:s.settings,state:s}),
        h('section',{className:'entry'},h('h2',null,'学校作息'),h('div',{className:'actions'},...s.profiles.map(p=>b(`${p.name}的学期与节次`,()=>open('profiles',p),'secondary')))),
        h('section',{className:'entry'},h('h2',null,'运行与提醒'),h('p',{className:'muted'},'退出应用、关机或休眠时暂停提醒，恢复后汇总遗漏事项。系统通知是否可见受 Windows 通知设置影响。'),b('发送测试通知',async()=>{try{say(await api.testNotification());}catch(e){err(msg(e));}},'secondary')),
        h('section',{className:'entry'},h('h2',null,'本地备份'),h('p',{className:'muted'},'备份包含双方课表、日程、待办、原始通知图片和提醒状态。请妥善保存备份文件。'),h('div',{className:'actions'},b('导出完整备份',async()=>{try{const file=await api.backup();if(file)say('备份已导出：'+file);}catch(e){err(msg(e));}},'primary'),b('从备份恢复',async()=>{try{const result=await api.restore();if(result){set(result);say('备份已恢复。恢复前的数据已自动备份在应用数据目录。');}}catch(e){err(msg(e));}},'secondary'))),
        h('section',{className:'entry about-brand'},h('div',{className:'about-brand-visual'},h(BrandMark,{className:'about-brand-logo'})),h('div',{className:'about-brand-copy'},h('h2',null,'YD'),h('p',{className:'about-brand-line'},'Your Day · 个人事务中枢'),h('p',{className:'muted'},'所有记录都保存在本机，不联网也能使用；北京时间 · 离线可用。')))):null
      )
    ),
    editor?h(Editor,{key:editor.entity+editor.value.id,entity:editor.entity,value:editor.value,convert:editor.convert,state:s,close:()=>edit(null),sourceOpen:(id:string)=>{edit(null);setTab('inbox');setSelectedNotice(id);},saved:(next:State)=>{set(next);say('已保存到本机。');},remove:(entity:Entity,id:string)=>{edit(null);setDeletion({entity,id});},duplicate:(course:Course)=>edit({entity:'courses',value:{...course,id:id(),title:course.title+'（副本）',checklist:course.checklist.map(x=>({...x,id:id(),done:false}))}})}):null,
    manualOpen?h(ManualStatusDialog,{live,state:s,close:()=>setManualOpen(false),change,pending}):null,
    schedule?h('div',{className:'modal-backdrop'},h('section',{className:'modal small',role:'dialog','aria-modal':true,'aria-label':'核对课表导入'},h('div',{className:'import-kicker'},'课表文件已读取'),h('h2',null,schedule.termName),h('p',{className:'muted'},`共 ${schedule.courses.length} 门课程。载入后会替换下列人员当前已有的课程与临时调课，待办、会议和通知不受影响。`),h('div',{className:'import-summary'},...schedule.profiles.map(p=>h('div',{key:p.id},h('strong',null,p.name),h('span',null,`${p.startDate} 起 · ${p.weeks} 周`),h('small',null,`${schedule.courses.filter(c=>c.person===p.id).length} 门课程 · ${p.periods.length} 节作息`)))),h('div',{className:'modal-foot'},b('取消',()=>setSchedule(null),'ghost',pending),b(pending?'正在载入…':'确认载入课表',async()=>{if(await change({type:'importSchedule',value:schedule})){setSchedule(null);say(`${schedule.termName}课表已载入。`);}},'primary',pending)))):null,
    deletion?h('div',{className:'modal-backdrop'},h('section',{className:'modal small',role:'dialog','aria-modal':true,'aria-label':'确认删除'},h('h2',null,deletion.entity==='exceptions'?'恢复原课程？':deletion.entity==='courses'?'删除整门课程？':deletion.entity==='tasks'?'删除待办？':'删除会议或活动？'),h('p',null,deletion.entity==='courses'?'删除后，这门课程的单次调课、停课记录和未触发提醒也会一并移除。':deletion.entity==='exceptions'?'恢复后，本次课程会重新使用课表模板中的原时间和地点，提醒也会重新计算。':deletion.entity==='tasks'?'删除后，这条待办及其未触发提醒会被移除；此操作无法撤销。':'删除后，这场会议或活动及其未触发提醒会被移除；此操作无法撤销。'),h('div',{className:'actions'},b('取消',()=>setDeletion(null),'ghost'),b(deletion.entity==='exceptions'?'恢复原课':'确认删除',async()=>{if(await change({type:'delete',...deletion}))setDeletion(null);},'danger',pending)))):null
  );
}
createRoot(document.getElementById('root')!).render(location.hash==='#orb'?h(DesktopPet,null):location.hash==='#bubble'?h(Bubble,null):location.hash==='#mini'?h(Mini,null):location.hash==='#tip'?h(PresenceTip,null):location.hash==='#menu'?h(PetMenu,null):h(App,null));
