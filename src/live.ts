import { pendingReminders } from './selectors.ts';
import { occurrences, epoch, dateOf, DAY } from './core.ts';
import { companionDisplay, type CompanionDisplay } from './companion-display.ts';
import { defaultAliasFor, effectiveRole, personAlias } from './people.ts';
import { resolvePetInstance, type PetInstance } from './pet-instance.ts';
import { getCurrentState, getRoutineState, STATE_SOURCE_PRIORITY } from './state/engine.ts';
import { stateLabel, stateTone } from './state/presentation.ts';
import type { CurrentState } from './state/types.ts';
import type { State, PersonId, ProfileRole, Occurrence } from './types.ts';

export interface PetPreferences {
  // 0.2.20 起只有两个显示模式：专属角色桌宠（默认形象）与状态浮标 Dual Status Dock。
  // 持久化字段值仍写作 'orb'（历史配置兼容），语义已经是 Dock。
  // 旧配置里的 'pet'（小猫）由 migrateLive 一次性迁移到 'custom'。
  mode:'custom'|'orb';
  size:'small'|'medium'|'large';
  animate:boolean;
  // Stills the pet for low power or low distraction setups.
  reduceMotion:boolean;
  bubbles:boolean;
  duration:number;
  pausedUntil:number;
  // Clicking the pet opens the compact status panel.
  miniPanel:boolean;
  // Keep the dragged position across restarts.
  rememberPosition:boolean;
  // 作息里的 sleep 时段（由每个人的 Routine 决定）没有更高优先级的安排时，
  // 桌宠进入睡觉姿态；关闭它只影响视觉，不改动作息数据。
  nightRest:boolean;
}
export const petDefaults:PetPreferences={mode:'custom',size:'medium',animate:true,reduceMotion:false,bubbles:true,duration:8,pausedUntil:0,miniPanel:true,rememberPosition:true,nightRest:true};
// 日程阶段码：只描述"课表层面现在是什么阶段"，不描述人在做什么。
// BUSY_CLASS / BUSY_EVENT 由统一状态引擎选出的 CurrentState 派生（source = schedule），
// 其余码只在 CurrentState 为 idle 时补充说明（今天无课 / 学期结束 / 尚未录入…）。
export type StatusCode="FREE"|"BUSY_CLASS"|"BUSY_EVENT"|"UPCOMING"|"UNKNOWN"|"TERM_NOT_STARTED"|"NO_SCHEDULE"|"TERM_ENDED"|"DAY_FINISHED"|"NO_CLASS_TODAY";
// 状态短代号的默认值（D / Y）由 people.ts 的身份解析决定：显式 shortAlias 优先。
export const profileAlias=(p:{id:PersonId;role?:ProfileRole;shortAlias?:string},index=0)=>p.shortAlias??defaultAliasFor(p,index);
export interface PersonStatus {
  code:StatusCode;
  alias:string;
  /** 身份语义来自档案角色；界面不再靠 id 猜"这是谁"。 */
  role:ProfileRole;
  /** 档案显示名称（用于「我的 / Alex」这类称呼）。 */
  name:string;
  conflict:boolean;
  person:PersonId;
  /** 唯一的状态真相：统一 StateEngine 的 CurrentState（永远有答案，不会是 null）。 */
  current:CurrentState;
  /** 该人的作息层（不做优先级裁决）：只供显示层记录"业务压过作息"这类分层事实。 */
  routine:CurrentState|null;
  /** 以下都是日程投影（不是状态判断）：下一项、今天、学期等。 */
  next?:Occurrence;
  nextCourse?:Occurrence;
  today:Occurrence[];
  todayCount:number;
  nextChange?:number;
  termStart:string;
  tentative:boolean;
}
export type PresenceState='idle'|'upcoming'|'busy'|'focus'|'dnd'|'offline';
/**
 * 人物状态的完整文案：Home / Mini / Tip / Tray 共用同一份实现。
 * 文案由 CurrentState 决定（经由 state/presentation.ts）；只有"空闲"时才用
 * 日程阶段补充说明，保证"此刻在做什么"永远只有一个来源。
 */
export function statusLabel(status?:Pick<PersonStatus,'code'|'current'|'conflict'>):string {
  if(!status)return '状态暂不可用';
  if(status.conflict)return '安排冲突';
  if(status.current.kind!=='idle')return stateLabel(status.current);
  switch(status.code){
    case 'UPCOMING':return '即将有安排';
    case 'DAY_FINISHED':return '今日课程已结束';
    case 'NO_CLASS_TODAY':return '今天无课';
    case 'TERM_NOT_STARTED':return '课表尚未开始';
    case 'TERM_ENDED':return '本学期课程已结束';
    case 'NO_SCHEDULE':return '尚未录入课表';
    case 'UNKNOWN':return '状态暂不可用';
    default:return '空闲';
  }
}
export function presenceStateFor(status?:PersonStatus):PresenceState {
  if(!status)return 'offline';
  // 颜色语义只由 presentation.stateTone(CurrentState) 决定：
  // 冲突 → 警示，上课/活动 → 忙碌，教研/专注 → 专注色，其余（含作息）→ 平静。
  // 这里只把 tone 翻译成界面用的 presence 词汇，并在"空闲"时补上日程阶段提示。
  // status.conflict 与 current.meta.conflict 同源（都由引擎给出），任一处设立即为警示色。
  if(status.conflict)return 'dnd';
  const tone=stateTone(status.current);
  if(tone==='alert')return 'dnd';
  if(tone==='busy')return 'busy';
  if(tone==='focus')return 'focus';
  if(status.current.kind!=='idle')return 'idle';
  if(['UNKNOWN','NO_SCHEDULE','TERM_ENDED'].includes(status.code))return 'offline';
  if(status.code==='UPCOMING')return 'upcoming';
  return 'idle';
}
export interface LiveSnapshot { now:number; source:string; people:PersonStatus[]; pending:number; preferences:PetPreferences; display:CompanionDisplay; petInstance:PetInstance; /** Compatibility projection of petInstance.subjectId. */ subject:PersonId; bubble?:{id:string;text:string;below?:boolean}; hoverTip?:{person:PersonId;text:string;state:PresenceState}; }
export const clockText=(n:number)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(n);
export function activity(s:State,o:Occurrence){return o.kind==='event'?'会议/活动':s.courses.find(c=>c.id===o.courseId)?.activity==='research'?'教研':'上课';}
export function personStatus(s:State,now:number,person:PersonId):PersonStatus {
  const index=s.profiles.findIndex(p=>p.id===person),p=index<0?undefined:s.profiles[index];
  // 单人工作区（Phase 1A 起合法）没有同行者档案：返回“状态暂不可用”而不是抛错。
  // 双人工作区一定命中档案，行为与之前完全一致。
  if(!p)return {person,code:'UNKNOWN',alias:defaultAliasFor({id:person}),role:'self',name:person,conflict:false,routine:null,current:{personId:person,kind:'idle',label:'空闲',source:'idle',startAt:now,priority:STATE_SOURCE_PRIORITY.idle},today:[],todayCount:0,termStart:'',tentative:false};
  // 唯一的"现在在做什么"来源：统一状态引擎。日程投影（next / today / 学期）另行计算。
  const current=getCurrentState(s,person,now);
  const all=occurrences(s,-Infinity,Infinity,person),ongoing=all.filter(o=>o.start<=now&&now<o.end),next=all.find(o=>o.start>now);
  const nextCourse=all.find(o=>o.kind==='course'&&o.start>now);
  const dayStart=epoch(dateOf(now)),dayEnd=dayStart+DAY;
  const today=all.filter(o=>o.start<dayEnd&&o.end>dayStart);
  const todayCourses=today.filter(o=>o.kind==='course');
  const hasSchedule=s.courses.some(c=>c.person===person);
  const termStart=epoch(p.startDate),termEnd=termStart+p.weeks*7*DAY;
  // BUSY_* 由引擎选出的状态派生（不再各自判断"是不是在上课"）；其余码是日程阶段。
  const code:StatusCode=current.source==='schedule'?(current.meta?.scheduleKind==='course'?'BUSY_CLASS':'BUSY_EVENT'):!hasSchedule?'NO_SCHEDULE':now<termStart?'TERM_NOT_STARTED':now>=termEnd&&!nextCourse?'TERM_ENDED':todayCourses.length&&todayCourses.every(o=>o.end<=now)?'DAY_FINISHED':!todayCourses.length?'NO_CLASS_TODAY':nextCourse&&nextCourse.start-now<=30*60000?'UPCOMING':'FREE';
  const boundaries=[...ongoing.map(o=>o.end),...(next?[next.start]:[]),termStart,termEnd].filter(n=>n>now);
  return {person,code,alias:profileAlias(p,index),role:effectiveRole(p,index),name:p.name,conflict:current.meta?.conflict===true,current,routine:getRoutineState(s,person,now),next,nextCourse,today,todayCount:todayCourses.length,nextChange:boundaries.length?Math.min(...boundaries):undefined,termStart:p.startDate,tentative:!!p.tentative};
}
export function snapshot(s:State,now:number,display?:{reminderSince?:number;nudgeId?:number}):LiveSnapshot{
  // 按工作区实际档案投影：1 人 1 条、2 人 2 条；顺序取 profiles 的显示顺序，
  // 身份语义来自 role，而不是固定的 me / partner。
  const people=s.profiles.map(profile=>personStatus(s,now,profile.id)),pending=pendingReminders(s).length;
  const preferences={...petDefaults,...s.settings.pet};
  const petInstance=resolvePetInstance(s);
  // 桌宠姿态完全由统一状态引擎 + 显示层叠加得出：这里不再有独立的时间表、
  // 也不再有"启动时读一次"的状态缓存——每次投影都直接反映当前状态。
  return {now,source:'北京时间 · Windows 系统时钟（未联网校准）',people,pending,preferences,petInstance,subject:petInstance.subjectId,display:companionDisplay({people,pending,now,subjectId:petInstance.subjectId,nightRest:preferences.nightRest,...display})};
}
export interface BubbleEvent { id:string; at:number; text:string }
export function bubbleEvents(s:State,from:number,to:number):BubbleEvent[]{
  if(to<=from)return [];
  const groups=new Map<number,BubbleEvent[]>();
  const push=(e:BubbleEvent)=>{if(e.at>from&&e.at<=to)groups.set(e.at,[...(groups.get(e.at)||[]),e]);};
  // 同行者的“提前 5 分钟”气泡按角色判定，不再写死 'partner'。
  const companionIds=new Set(s.profiles.filter((profile,index)=>effectiveRole(profile,index)==='companion').map(profile=>profile.id));
  for(const o of occurrences(s,from,to+5*60000+1)){
    const who=personAlias(s,o.person),kind=activity(s,o);
    push({id:`${o.id}:start:${o.start}`,at:o.start,text:`${who}开始${kind}啦，${o.endUnknown?'结束时间未填写':clockText(o.end)+' 结束'} · ${o.title}`});
    // Include end == from/to and independently look up completed events below.
    if(companionIds.has(o.person))push({id:`${o.id}:soon:${o.start}`,at:o.start-5*60000,text:`还有 5 分钟，${who}要${kind}啦 · ${clockText(o.start)} ${o.title}`});
  }
  for(const o of occurrences(s,from-1,to).filter(o=>!o.endUnknown))push({id:`${o.id}:end:${o.end}`,at:o.end,text:`${personAlias(s,o.person)}的${activity(s,o)}结束啦 · ${clockText(o.end)} ${o.title}`});
  for(const r of s.reminders)if(r.status==='scheduled'||r.status==='due')push({id:`reminder:${r.id}`,at:r.due,text:`到提醒时间啦 · ${clockText(r.due)} ${r.title}`});
  return [...groups.entries()].sort(([a],[b])=>a-b).map(([at,events])=>({at,id:events.map(e=>e.id).sort().join('|'),text:events.map(e=>e.text).join('\n')}));
}
export function migrateLive(s:State):State {
  // 课程 activity 的默认值与 v0.2 时代的一次性归一化（旧称呼 / 暂定学期 / 教研课名）
  // 都已移入版本化迁移，见 src/migration.ts 的 LEGACY_V2_RULES 与 personAwareMigrationV3。
  s.settings.pet={...petDefaults,...s.settings.pet};
  // 0.2.20 删除小猫桌宠：旧安装里选过 'pet' 的配置一次性落到默认形象，
  // 明确选过状态浮标的用户保持不动。
  if(!['custom','orb'].includes(s.settings.pet.mode))s.settings.pet.mode=petDefaults.mode;
  // 0.2.16 把“轻微动态 / 降低动态”两个互相矛盾的开关合并成“标准 / 减少”。
  // 旧安装里关闭过轻微动态的用户直接迁移到“减少动态”，不会突然又开始动。
  s.settings.pet.reduceMotion=!!s.settings.pet.reduceMotion||s.settings.pet.animate===false;
  s.settings.pet.animate=true;
  s.settings.pet.miniPanel=s.settings.pet.miniPanel!==false;
  s.settings.pet.rememberPosition=s.settings.pet.rememberPosition!==false;
  // 夜间自动休息默认开启；显式关闭过的用户保持关闭。
  s.settings.pet.nightRest=s.settings.pet.nightRest!==false;
  if(s.settings.trayResident===undefined)s.settings.trayResident=true;
  s.profiles.forEach((p,index)=>{
    p.shortAlias??=profileAlias(p,index);
  });
  s.settings.liveVersion=5;s.bubbleHistory??=[];return s;
}
