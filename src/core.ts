import { migrateInbox, receive, confirmDraft } from './inbox.ts';
import { validDraft } from './inbox-types.ts';
import { DOMAIN_VERSION, stateDomainVersion } from './domain.ts';
import { getCompanionProfile, isPetSubjectRole, isProfileRole, isSelfId, isUsageMode, requireSelfProfile, roleCounts, usageModeOf } from './people.ts';
import { assertRoutineProfile, emptyRoutine } from './routine.ts';
import { MANUAL_LABEL_LIMIT, MANUAL_OVERRIDE_LIMIT, assertManualOverride, isManualStateKind, pruneManualOverrides } from './state/manual.ts';
import { assertAvatarSelection, resetAvatarPack, setAvatarPack } from './avatar-selection.ts';
import { DEFAULT_AVATAR_PACK_ID } from './avatar.ts';
import { completeSetup } from './setup.ts';
import { switchUsageMode, updateProfileIdentity } from './profile-lifecycle.ts';
import { academicOf, academicPresence } from './academic.ts';
import type { State, Profile, PersonId, ProfileRole, Course, Task, Event, Notice, Exception, Occurrence, Reminder, Command, Entity, SchedulePackage, ImportProvenance, ImportSourceKind } from './types.ts';
import type { RoutineProfile } from './routine.ts';
export const DAY = 86400000;
export function showPanelOnLaunch(openedAtLogin:boolean, setupComplete:boolean){return !openedAtLogin||!setupComplete;}
export const id = () => globalThis.crypto.randomUUID();
export function dateOf(time: number): string { return new Date(time + 8 * 3600000).toISOString().slice(0, 10); }
export function epoch(value: string|null): number { if(value===null)return NaN; return Date.parse(value.length === 10 ? value + 'T00:00:00+08:00' : (/[zZ]$|[+-]\d{2}:\d{2}$/.test(value) ? value : value + (value.length===16 ? ':00' : '') + '+08:00')); }
export function addDays(date: string, days: number): string { return dateOf(epoch(date) + days * DAY); }
export function weekday(date: string): number { return new Date(date + 'T12:00:00Z').getUTCDay() || 7; }
// ---------------------------------------------------------------------------
// Fresh Install Contract（Phase 5A）
//
// 全新安装（本地没有任何现存数据库）只由 createFreshState 生成：
//   * 默认 Solo：只有 1 个 self 档案，**绝不**预建 companion；
//   * PersonId 用正式生成器（crypto.randomUUID），不写死 legacy 'me' / 'partner'；
//   * 课表 / 单次调停课 / 会议 / 待办 / 通知 / 提醒 / 临时状态全部为空；
//   * 作息为空：不替新用户决定几点睡觉、几点吃饭。设置页的「使用默认作息」
//     （routine.ts 的 createDefaultRoutine）仍然是用户主动选择的 preset；
//   * Avatar 用官方 default Pack（产品默认视觉资源，不是私人数据）。
//
// Phase 5B3（Academic Decoupling）：学业语义（学期 / 教学周 / 节次）是**可选能力**，
// 因此 fresh install **不再**写入任何 startDate / weeks / periods —— 普通用户不需要
// 为了"让 Profile 合法"而背一个假学期。学生与教师在「课表与学校」里显式配置
// （src/academic.ts 的 preset 只做表单初值）。settings.setup=false 是"首次使用还没完成"
// 的产品信号：主窗口会显示 onboarding（src/setup.ts），完成后才进入正常 Home。
export const NEUTRAL_SELF_NAME = '我';
export const NEUTRAL_COMPANION_NAME = 'TA';
/** 全新安装的唯一状态工厂：纯函数，不读 UI / DOM / 网络 / fixture / 真实用户文件。 */
export function createFreshState(now = Date.now()): State {
  const self: Profile = {
    id: id(),
    role: 'self',
    name: NEUTRAL_SELF_NAME,
    routine: emptyRoutine(now),
    avatar: { packId: DEFAULT_AVATAR_PACK_ID, source: 'default' },
    updatedAt: now,
  };
  return {
    version: 1,
    profiles: [self],
    courses: [], exceptions: [], events: [], tasks: [], notices: [], reminders: [], manualOverrides: [],
    // Phase 5B1：fresh install 不静默创建桌面悬浮物 —— 桌宠要用户显式选择才出现；
    // petSubjectRole 只是合法默认值（Solo 没有歧义，恒为本人）。
    // Phase 5B2 的使用方式同理：没有 companion 的工作区天生就是 Solo，
    // 只有用户真的做过 Together→Solo 切换时才需要写 settings.usageMode。
    settings: { domainVersion: DOMAIN_VERSION, launch: false, setup: false, petEnabled: false, petSubjectRole: 'self' },
    lastTick: now,
  };
}
/**
 * 用户第一次打开双人模式时（Phase 5B2 的「我和另一位」）由领域层调用的工厂。
 *
 * 它只是模板：真实写入仍然走 `usageMode` 命令 → validateState；
 * 名称由用户在同一个流程里填写，代号继续由显示规则派生。
 *
 * Phase 5B3：新同伴是一个**普通合法 Person** —— 不再从本人档案复制学期 / 教学周 /
 * 节次（旧实现会把 self 的学业配置顺手复制成"第二个假学期"）。需要学业语义时由
 * 用户在「课表与学校」里显式配置；`self` 参数保留只是调用签名的一部分。
 */
export function createCompanionProfile(now: number, self: Profile): Profile {
  return {
    id: id(),
    role: 'companion',
    name: NEUTRAL_COMPANION_NAME,
    routine: emptyRoutine(now),
    avatar: { packId: DEFAULT_AVATAR_PACK_ID, source: 'default' },
    updatedAt: now,
  };
}
function assert(v: unknown, message: string): asserts v { if (!v) throw new Error(message); }
function text(v: unknown, max = 20000): v is string { return typeof v === 'string' && v.length <= max; }
function date(v: unknown): v is string { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(epoch(v)) && dateOf(epoch(v)) === v; }
function time(v: unknown): v is string { return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v); }
function stamp(v: unknown): v is string { return typeof v === 'string' && date(v.slice(0,10)) && v[10]==='T' && time(v.slice(11)); }
function base(v: any) { assert(v && text(v.id, 100) && /^[\w-]+$/.test(v.id), '记录编号无效'); }
const importSourceKinds: ImportSourceKind[]=['file','text','image','structured-file'];
function jsonValue(v: unknown, max = 500000): boolean { try { const serialized=JSON.stringify(v); return typeof serialized==='string'&&serialized.length<=max; } catch { return false; } }
function importMetadata(v: unknown): boolean {
  if(v===undefined)return true;
  if(!v||typeof v!=='object'||Array.isArray(v))return false;
  const entries=Object.entries(v as Record<string,unknown>);
  return entries.length<=50&&entries.every(([key,value])=>text(key,100)&&!/[\\/]path|path[\\/]|filepath|file-path/i.test(key)&&(
    value===null||(typeof value==='string'&&text(value,2000)&&!(/^[A-Za-z]:[\\/]/.test(value)||value.startsWith('\\\\')))||
    (typeof value==='number'&&Number.isFinite(value))||typeof value==='boolean'));
}
function importSource(v: any): asserts v is { id:string; kind:ImportSourceKind; label?:string; originalName?:string; createdAt:number; fingerprint?:string; metadata?:Record<string,string|number|boolean|null> } {
  assert(v&&text(v.id,100)&&/^[\w-]+$/.test(v.id),'导入来源编号无效');
  assert(importSourceKinds.includes(v.kind),'导入来源类型无效');
  assert(Number.isFinite(v.createdAt),'导入来源时间无效');
  assert(v.label===undefined||text(v.label,200),'导入来源标签无效');
  assert(v.originalName===undefined||text(v.originalName,260),'导入来源名称无效');
  assert(v.fingerprint===undefined||text(v.fingerprint,200)&&!/[\\/]/.test(v.fingerprint),'导入来源指纹无效');
  assert(importMetadata(v.metadata),'导入来源元数据无效');
}
function importProvenance(v: unknown): asserts v is ImportProvenance {
  if(v===undefined)return;
  const p=v as any;
  assert(p&&text(p.sessionId,100)&&/^[\w-]+$/.test(p.sessionId),'导入会话编号无效');
  importSource(p.source);
  assert(text(p.importer,100)&&/^[\w-]+$/.test(p.importer),'导入器编号无效');
  assert(p.sourceRecordId===undefined || text(p.sourceRecordId,500) && p.sourceRecordId.trim().length>0,'来源记录编号无效');
  assert(Number.isFinite(p.importedAt),'导入时间无效');
  assert(typeof p.userEdited==='boolean','导入修改标记无效');
  assert(Object.prototype.hasOwnProperty.call(p,'originalValue')&&jsonValue(p.originalValue),'原始导入值无效');
  assert(Object.prototype.hasOwnProperty.call(p,'reviewedValue')&&jsonValue(p.reviewedValue),'确认导入值无效');
}
function common(v: any) {
  assert(text(v.title,200) && v.title.trim(), '请填写标题（最多 200 字）'); assert(text(v.notes), '备注无效');
  assert(Array.isArray(v.reminders) && v.reminders.length <= 10 && v.reminders.every((n: unknown)=>Number.isInteger(n) && Number(n)>=0 && Number(n)<=525600), '提醒提前量应为 0—525600 分钟');
  assert(Array.isArray(v.checklist) && v.checklist.length<=100 && v.checklist.every((c:any)=>c && text(c.id,100) && text(c.text,1000) && typeof c.done==='boolean'), '准备清单无效');
  assert(v.sourceId===undefined || (text(v.sourceId,100) && /^[\w-]+$/.test(v.sourceId)), '来源无效');
  if(v.provenance!==undefined) importProvenance(v.provenance);
}
export function validate(entity: Entity, v: any, state: State) {
  base(v);
  assert(v.createdAt===undefined||Number.isFinite(v.createdAt),'创建时间无效');
  assert(v.sourceInboxItemId===undefined||state.notices.some(n=>n.id===v.sourceInboxItemId),'来源通知不存在');
  if(entity==='profiles') {
    assert(text(v.name,40) && v.name.trim(), '姓名无效');
    assert(v.role===undefined || isProfileRole(v.role), '个人角色无效');
    assert(v.shortAlias===undefined || (text(v.shortAlias,8)&&v.shortAlias.trim()), '短代号应为 1—8 字');
    // 作息规则随档案一起保存；缺省表示"这次保存不带 routine"（由合并语义保留旧值），
    // 整个 State 的"每个档案都必须有合法 RoutineProfile"不变式见 validateState。
    if(v.routine!==undefined)assertRoutineProfile(v.routine,'个人作息');
    if(v.avatar!==undefined)assertAvatarSelection(v.avatar,'个人 Avatar 选择');
    // Phase 5B3：学业配置（学期起始日 / 教学周数 / 节次）是可选能力，因此
    //   * 完全没有 → 合法（普通上班族 / 自由职业者 / 退休人员…）；
    //   * 只有一部分 → 坏数据，明确拒绝（optional ≠ unvalidated）；
    //   * 三样都在 → 必须满足原有的内部约束（下面逐项校验，规则一字未松）。
    const presence = academicPresence(v);
    assert(presence!=='partial', '学期起始日、教学周数与节次必须一起设置（或都不设置）');
    if(presence==='complete'){
      assert(date(v.startDate) && weekday(v.startDate)===1, '学期起始日必须是第一教学周的周一');
      assert(Number.isInteger(v.weeks) && v.weeks>=1 && v.weeks<=60, '教学周数应为 1—60');
      assert(Array.isArray(v.periods) && v.periods.length>0 && v.periods.length<=24, '请配置 1—24 节作息');
      v.periods.forEach((p:any,i:number)=>assert(time(p.start) && time(p.end) && p.start<p.end && (!i || v.periods[i-1].end<=p.start), '节次时间无效、重叠或未按顺序排列'));
    }
    for(const c of state.courses.filter(c=>c.person===v.id)){
      assert(presence==='complete', '该档案还有课程，不能移除学期与节次');
      assert(c.last<=v.periods.length && c.weeks.every(w=>w<=v.weeks), '现有课程超出新作息或教学周范围，请先编辑课程');
    }
  } else if(entity==='courses') {
    assert(v.activity===undefined||['teaching','research'].includes(v.activity),'课程活动类型无效'); common(v); const p=state.profiles.find(p=>p.id===v.person); assert(p, '请选择课表所属人');
    // 课程是学业语义的载体：按教学周与节次展开，因此必须有人替它提供学期与节次。
    const calendar=academicOf(p); assert(calendar,'该档案还没有学期与节次，请先在「课表与学校」里设置');
    assert(Number.isInteger(v.weekday) && v.weekday>=1 && v.weekday<=7, '星期无效');
    assert(Number.isInteger(v.first) && Number.isInteger(v.last) && v.first>=1 && v.last>=v.first && v.last<=calendar.periods.length, '课程节次超出作息范围');
    assert(Array.isArray(v.weeks) && v.weeks.length>0 && v.weeks.length<=60 && new Set(v.weeks).size===v.weeks.length && v.weeks.every((w:any)=>Number.isInteger(w)&&w>=1&&w<=calendar.weeks), '教学周次无效或重复');
    assert(text(v.place,300), '地点无效');
  } else if(entity==='events') { common(v); assert(stamp(v.start)&&(v.end===null||v.end===''||stamp(v.end)&&epoch(v.end)>epoch(v.start)), '结束时间必须晚于开始时间'); assert(text(v.place,300), '地点无效'); assert(v.person===undefined||state.profiles.some(p=>p.id===v.person), '会议所属人不存在'); }
  else if(entity==='tasks') { common(v); assert(v.due==='' || stamp(v.due), '截止时间无效'); assert(typeof v.done==='boolean', '完成状态无效'); }
  else if(entity==='notices') { assert(v.parseStatus===undefined||['UNPARSED','PARSING','NEEDS_REVIEW','CONFIRMED','FAILED','IGNORED'].includes(v.parseStatus),'解析状态无效');assert(v.parsedData===undefined||validDraft(v.parsedData),'草稿格式无效'); assert(text(v.title,200)&&text(v.text,200000), '通知内容过长或无效'); assert(v.originalText===undefined || text(v.originalText,200000),'原文无效');assert(['inbox','later','archived'].includes(v.state), '收件箱状态无效'); assert(v.image===undefined || /^[a-f0-9]{64}\.png$/.test(v.image), '图片编号无效'); }
  else if(entity==='exceptions') {
    const c=state.courses.find(c=>c.id===v.courseId); assert(c && date(v.date), '课程或原日期无效');
    const profile=state.profiles.find(p=>p.id===c.person); const calendar=academicOf(profile); assert(calendar,'该课程所属人缺少学期与节次');
    const week=Math.floor((epoch(v.date)-epoch(calendar.startDate))/DAY/7)+1;
    assert(weekday(v.date)===c.weekday && c.weeks.includes(week), '原日期不属于该课程的教学周');
    assert(typeof v.cancelled==='boolean', '停课状态无效');
    assert(v.cancelled || (stamp(v.start)&&stamp(v.end)&&epoch(v.end)>epoch(v.start)), '调课起止时间无效');
    assert(v.place===undefined || text(v.place,300), '地点无效');
    if(v.provenance!==undefined) importProvenance(v.provenance);
  } else throw new Error('未知记录类型');
}
export function occurrences(state: State, from: number, to: number, person?: string, options: {includeCancelled?:boolean} = {}): Occurrence[] {
  const result: Occurrence[]=[];
  for(const c of state.courses) {
    if(person && c.person!==person) continue;
    const p=state.profiles.find(p=>p.id===c.person);
    // 课程按"教学周 + 节次"展开，因此只有具备学业配置的档案才能产生 occurrence。
    // 合法状态里课程必然有学期与节次（见 validate）；这里只是防御性跳过，
    // 绝不为缺失学业配置的人发明一个学期。
    const calendar=academicOf(p);
    if(!p || !calendar) continue;
    for(const w of c.weeks) {
      const d=addDays(calendar.startDate,(w-1)*7+c.weekday-1), ex=state.exceptions.find(e=>e.courseId===c.id&&e.date===d);
      if(ex?.cancelled && !options.includeCancelled) continue;
      const start=epoch(ex?.start || `${d}T${calendar.periods[c.first-1].start}`), end=epoch(ex?.end || `${d}T${calendar.periods[c.last-1].end}`);
      if(start<to && end>from) result.push({id:`c:${c.id}:${d}`,target:`courses:${c.id}`,title:c.title,start,end,place:ex?.place??c.place,notes:c.notes,person:c.person,kind:'course',courseId:c.id,date:d,checklist:c.checklist,sourceId:ex?.sourceInboxItemId||c.sourceId,sourceInboxItemId:ex?.sourceInboxItemId,provenance:ex?.provenance??c.provenance,createdAt:c.createdAt??c.updatedAt,updatedAt:ex?.updatedAt??c.updatedAt,cancelled:!!ex?.cancelled,rescheduled:!!ex&&!ex.cancelled&&(ex.start!==undefined||ex.end!==undefined||ex.place!==undefined)});
    }
  }
  for(const e of state.events) {
    const owner=eventPerson(state,e);
    if(person&&owner!==person)continue;
    const start=epoch(e.start),end=e.end?epoch(e.end):start;
    if(start<to&&(e.end?end>from:start>=from)) result.push({id:`e:${e.id}`,target:`events:${e.id}`,title:e.title,start,end,place:e.place,notes:e.notes,person:owner,kind:'event',checklist:e.checklist,sourceId:e.sourceId,sourceInboxItemId:e.sourceInboxItemId,provenance:e.provenance,createdAt:e.createdAt??e.updatedAt,updatedAt:e.updatedAt,endUnknown:!e.end});
  }
  return result.sort((a,b)=>a.start-b.start || a.id.localeCompare(b.id));
}
// 会议归属：v3 数据带 person；v2 及更早的数据回退到工作区本人（不写死 'me'）。
export function eventPerson(state: State, event: Event): PersonId {
  return event.person ?? requireSelfProfile(state).id;
}
export function conflicts(items: Occurrence[]): Set<string> {
  const ids=new Set<string>();
  for(let i=0;i<items.length;i++) for(let j=i+1;j<items.length && items[j].start<items[i].end;j++) if(items[i].person===items[j].person && items[i].start<items[j].end){ids.add(items[i].id);ids.add(items[j].id);}
  return ids;
}
function generate(state: State, now: number, target?: string): Reminder[] {
  const out: Reminder[]=[];
  // 提醒策略保持旧行为：只为工作区本人的课程与会议生成提醒；同行者不产生本机提醒。
  for(const o of occurrences(state, -Infinity, Infinity,requireSelfProfile(state).id)) {
    if(target && target!==o.target) continue;
    const item=o.kind==='course'?state.courses.find(c=>c.id===o.courseId)!:state.events.find(e=>`events:${e.id}`===o.target)!;
    for(const min of new Set(item.reminders)){const due=o.start-min*60000; if(due>=now) out.push({id:`${o.id}:${due}`,target:o.target,occurrence:o.id,title:o.title,due,status:'scheduled',createdAt:now,updatedAt:now});}
  }
  for(const task of state.tasks){if(task.done||!task.due||(target&&target!==`tasks:${task.id}`))continue; for(const min of new Set(task.reminders)){const due=epoch(task.due)-min*60000;if(due>=now)out.push({id:`t:${task.id}:${due}`,target:`tasks:${task.id}`,title:task.title,due,status:'scheduled',createdAt:now,updatedAt:now});}}
  return out;
}
export function reschedule(state: State, now: number, target?: string, occurrence?: string) {
  const affected=(r:Reminder)=>(!target||r.target===target)&&(!occurrence||r.occurrence===occurrence);
  for(const r of state.reminders)if(affected(r)&&(r.status==='scheduled'||r.status==='due')){r.status='cancelled';r.cancelReason=state.tasks.some(t=>`tasks:${t.id}`===r.target&&t.done)?'completed':'time_changed';r.updatedAt=now;}
  const previous=new Map(state.reminders.map(r=>[r.id,r]));
  for(const fresh of generate(state,now,target))if(!occurrence||fresh.occurrence===occurrence){const old=previous.get(fresh.id);if(!old)state.reminders.push(fresh);else if(old.status==='cancelled')Object.assign(old,fresh,{createdAt:old.createdAt??fresh.createdAt});}
}
export function tick(state: State, now: number): {due: Reminder[]; missed: boolean; changed: boolean} {
  const due=state.reminders.filter(r=>r.status==='scheduled'&&r.due<=now), missed=now-state.lastTick>90000;
  for(const r of due){r.status='due';r.firedAt=now;r.updatedAt=now;}state.lastTick=now;
  return {due,missed,changed:due.length>0};
}
export function apply(state: State, cmd: Command, now=Date.now()): State {
  const s=structuredClone(state); assert(cmd && typeof cmd.type==='string', '操作无效');
  // 每次写入顺手清理已过期的手动状态："保存时清理"是唯一清理点——
  // tick 每秒只是读，不会为了清理产生每秒磁盘写入。
  pruneManualOverrides(s,now);
  if(cmd.type==='inbound')return receive(s,cmd.payload,cmd.id,now);
  if(cmd.type==='review')return confirmDraft(s,cmd,now);
  if(cmd.type==='inboxStatus'||cmd.type==='draft'){
    const n=s.notices.find(n=>n.id===cmd.noticeId);assert(n,'原通知不存在');assert(n.parseStatus!=='CONFIRMED','已处理通知不能再次创建');
    if(cmd.type==='draft'){assert(validDraft(cmd.draft),'草稿格式无效');assert(n.parseStatus!=='PARSING','正在整理，请稍后');n.parsedData=structuredClone(cmd.draft);n.detectedType=cmd.draft.type;n.parseStatus='NEEDS_REVIEW';}
    else {n.parseStatus=cmd.status;n.state=cmd.status==='IGNORED'?'archived':'inbox';}
    n.updatedAt=now;return s;
  }
  if(cmd.type==='save'){
    const entity=cmd.entity; const v=structuredClone(cmd.value) as any; if(entity==='events'&&v&&v.end==='')v.end=null;
    // Avatar 有独立 command；通用 Profile 编辑只能原样携带已有选择，不能绕过
    // Registry 校验写入任意 packId。新建档案只允许获得注册的默认 Pack。
    if(entity==='profiles'&&v){
      const stored=s.profiles.find(profile=>profile.id===v.id);
      // Existing selections are immutable through generic Profile editing.
      // A newly-added companion receives the registered default Pack so the
      // Solo -> Together flow satisfies the v6 invariant without accepting an
      // arbitrary pack id from the form payload.
      v.avatar=stored?.avatar??{packId:DEFAULT_AVATAR_PACK_ID,source:'default'};
    }
    // 会议默认归属工作区本人：界面尚无归属人选择器（Phase 1C 再开放），
    // 但归属必须由身份层解析，而不是写死 'me'。
    if(entity==='events'&&v&&v.person===undefined)v.person=requireSelfProfile(s).id;
    validate(entity,v,s); v.updatedAt=now;
    if(['courses','events','tasks'].includes(entity)&&v.sourceId) assert(s.notices.some(n=>n.id===v.sourceId), '来源通知不存在');
    const list=s[entity] as any[];
    if(entity==='exceptions'){const existing=s.exceptions.find(e=>e.courseId===v.courseId&&e.date===v.date);if(existing)v.id=existing.id;}
    const index=list.findIndex(r=>r.id===v.id), old=list[index]; v.createdAt=old?.createdAt??old?.updatedAt??now;
    if(entity==='notices'&&old){v.originalText=old.originalText??old.text;v.createdAt=old.createdAt??old.updatedAt;}
    if(v.sourceId)v.sourceInboxItemId=v.sourceId;
    if(index<0)list.push(v);else list[index]={...old,...v};
    const keys: Record<string,string[]>={profiles:['startDate','weeks','periods'],courses:['person','weekday','first','last','weeks','reminders'],events:['start','end','reminders'],tasks:['due','done','reminders']};
    const timingChanged=!old||(keys[entity]||[]).some(k=>JSON.stringify(old[k])!==JSON.stringify(v[k]));
    for(const r of s.reminders)if(r.target===`${entity}:${v.id}`&&v.title&&r.title!==v.title){r.title=v.title;r.updatedAt=now;}
    if(entity==='profiles'&&timingChanged)for(const c of s.courses.filter(c=>c.person===v.id))reschedule(s,now,`courses:${c.id}`);
    if(entity==='courses') {s.profiles.find(p=>p.id===v.person)!.updatedAt=now;if(timingChanged)reschedule(s,now,`${entity}:${v.id}`);}
    if((entity==='events'||entity==='tasks')&&timingChanged)reschedule(s,now,`${entity}:${v.id}`);
    if(entity==='exceptions'){s.profiles.find(p=>p.id===s.courses.find(c=>c.id===v.courseId)!.person)!.updatedAt=now;reschedule(s,now,`courses:${v.courseId}`,`c:${v.courseId}:${v.date}`);}
  }else if(cmd.type==='delete'){
    assert(['courses','events','tasks','notices','exceptions'].includes(cmd.entity),'此记录不可删除');
    const list=s[cmd.entity] as any[], previous=list.find(v=>v.id===cmd.id);assert(previous,'记录不存在');
    if(cmd.entity==='notices'){assert(previous.parseStatus!=='CONFIRMED'&&!previous.targetEntityId&&![...s.tasks,...s.events,...s.courses,...s.exceptions].some(v=>('sourceId' in v&&v.sourceId===cmd.id)||('sourceInboxItemId' in v&&v.sourceInboxItemId===cmd.id)),'已确认或关联事务的来源通知不能删除');assert(previous.parseStatus!=='PARSING','正在整理，请稍后删除');}
    list.splice(list.indexOf(previous),1);s.reminders=s.reminders.filter(r=>r.target!==`${cmd.entity}:${cmd.id}`);
    if(cmd.entity==='courses') {s.exceptions=s.exceptions.filter(e=>e.courseId!==cmd.id);s.profiles.find(p=>p.id===previous.person)!.updatedAt=now;}
    if(cmd.entity==='exceptions'){reschedule(s,now,`courses:${previous.courseId}`,`c:${previous.courseId}:${previous.date}`);s.profiles.find(p=>p.id===s.courses.find(c=>c.id===previous.courseId)!.person)!.updatedAt=now;}
  }else if(cmd.type==='convert'){
    assert(s.notices.some(n=>n.id===cmd.noticeId),'原通知不存在');
    if(s.tasks.some(t=>t.sourceId===cmd.noticeId))return s;
    const task={...(cmd.task as object),sourceId:cmd.noticeId,updatedAt:now} as Task;validate('tasks',task,s);assert(!s.tasks.some(t=>t.id===task.id),'任务编号已存在');s.tasks.push(task);reschedule(s,now,`tasks:${task.id}`);Object.assign(s.notices.find(n=>n.id===cmd.noticeId)!,{parseStatus:'CONFIRMED',state:'archived',targetEntityType:'tasks',targetEntityId:task.id,processedAt:now,updatedAt:now});
  }else if(cmd.type==='ack'||cmd.type==='snooze'){
    const r=s.reminders.find(r=>r.id===cmd.id);assert(r&&r.status==='due','提醒已处理或不存在');r.status=cmd.type==='ack'?'acknowledged':'snoozed';r.handledAt=now;r.updatedAt=now;
    if(cmd.type==='snooze'){const minutes=cmd.minutes??10;assert([10,30,60].includes(minutes),'延后时间无效');s.reminders.push({...r,id:`s:${id()}`,due:now+minutes*60000,status:'scheduled',firedAt:undefined,handledAt:undefined,snoozedFrom:r.id,snoozeMinutes:minutes,createdAt:now,updatedAt:now});}
  }else if(cmd.type==='settings'){
    assert(cmd.launch===undefined||typeof cmd.launch==='boolean','设置无效');assert(cmd.setup===undefined||typeof cmd.setup==='boolean','设置无效');assert(cmd.trayResident===undefined||typeof cmd.trayResident==='boolean','设置无效');
    // Phase 5B1：桌宠主体偏好只是呈现偏好，不碰任何 Profile / PersonId / CurrentState。
    assert(cmd.petSubjectRole===undefined||isPetSubjectRole(cmd.petSubjectRole),'设置无效');
    assert(cmd.petEnabled===undefined||typeof cmd.petEnabled==='boolean','设置无效');
    if(cmd.pet!==undefined){
      const pet={mode:'custom',size:'medium',animate:true,reduceMotion:false,bubbles:true,duration:8,pausedUntil:0,miniPanel:true,rememberPosition:true,...s.settings.pet,...cmd.pet};
      // 0.2.20 起不再提供小猫桌宠：旧客户端的 'pet' 请求统一落到默认形象。
      if(pet.mode==='pet')pet.mode='custom';
      assert(['custom','orb'].includes(pet.mode)&&['small','medium','large'].includes(pet.size)&&typeof pet.animate==='boolean'&&typeof pet.reduceMotion==='boolean'&&typeof pet.bubbles==='boolean'&&Number.isInteger(pet.duration)&&pet.duration>=3&&pet.duration<=30&&Number.isFinite(pet.pausedUntil)&&pet.pausedUntil>=0&&typeof pet.miniPanel==='boolean'&&typeof pet.rememberPosition==='boolean'&&typeof pet.nightRest==='boolean','桌宠设置无效');
      s.settings.pet=pet as any;
    }
    if(cmd.launch!==undefined)s.settings.launch=cmd.launch;if(cmd.setup!==undefined)s.settings.setup=cmd.setup;if(cmd.trayResident!==undefined)s.settings.trayResident=cmd.trayResident;
    if(cmd.petSubjectRole!==undefined){
      // Solo 没有第二个 Person：此时的 'companion' 无法被任何档案满足，直接拒绝，
      // 不写进一个"永远回落到本人"的假设置。
      assert(cmd.petSubjectRole==='self'||!!getCompanionProfile(s),'工作区里没有陪伴对象，桌宠只能表示本人');
      s.settings.petSubjectRole=cmd.petSubjectRole;
    }
    // 桌宠开关是呈现偏好：关掉它不删除任何档案 / 形象 / 作息，也不改变 CurrentState。
    if(cmd.petEnabled!==undefined)s.settings.petEnabled=cmd.petEnabled;
  }else if(cmd.type==='importSchedule'){
    const value=cmd.value as SchedulePackage;
    assert(value?.format==='dayhub-schedule'&&value.version===1&&text(value.termName,80)&&value.termName.trim(),'课表文件格式或学期名称无效');
    assert(Array.isArray(value.profiles)&&value.profiles.length>=1&&value.profiles.length<=2,'课表文件应包含一至两个人的学期设置');
    assert(Array.isArray(value.courses)&&value.courses.length<=500,'课表文件课程数量无效');
    const people=new Set(value.profiles.map(p=>p.id));
    // 人员必须是工作区里已存在的档案（id 是身份，不再限定 me / partner）：
    // 这样既支持自定义 id，也避免把未知 id 写进数组之外的位置。
    assert(people.size===value.profiles.length&&[...people].every(p=>s.profiles.some(profile=>profile.id===p)),'课表人员重复或无效');
    const removed=new Set(s.courses.filter(c=>people.has(c.person)).map(c=>c.id));
    s.courses=s.courses.filter(c=>!people.has(c.person));
    s.exceptions=s.exceptions.filter(e=>!removed.has(e.courseId));
    s.reminders=s.reminders.filter(r=>![...removed].some(courseId=>r.target===`courses:${courseId}`));
    for(const raw of value.profiles){
      const incoming=structuredClone(raw);
      // 课表包只承载学期与节次（见 SchedulePackage 类型）：即使旧文件里混进了 routine，
      // 导入课表也绝不覆盖用户自己的作息规则。
      delete (incoming as {routine?:unknown}).routine;
      const profile={...s.profiles.find(p=>p.id===raw.id),...incoming,updatedAt:now};const index=s.profiles.findIndex(p=>p.id===profile.id);s.profiles[index]=profile;validate('profiles',profile,s);
    }
    const ids=new Set(s.courses.map(c=>c.id));
    for(const raw of value.courses){assert(people.has(raw.person),'课程所属人不在本次导入范围');assert(!ids.has(raw.id),'课表文件中的课程编号重复');const course={...structuredClone(raw),updatedAt:now};validate('courses',course,s);s.courses.push(course);ids.add(course.id);reschedule(s,now,`courses:${course.id}`);}
    s.settings.setup=true;
  }else if(cmd.type==='manual'){
    // 第一版：只有本人可以给自己设置临时状态——状态由状态主体本人确认，
    // 本机用户不能替同行者声明"你现在在做什么"。
    const personId=cmd.personId??requireSelfProfile(s).id;
    assert(isSelfId(s,personId),'当前版本只能设置本人的状态');
    assert(isManualStateKind(cmd.kind),'临时状态类型无效');
    assert(cmd.endAt===null||(Number.isFinite(cmd.endAt)&&cmd.endAt>now),'结束时间必须晚于现在');
    assert(text(cmd.label,MANUAL_LABEL_LIMIT)&&cmd.label.trim().length>0,'状态名称应为 1—40 字');
    // 每个人同一时刻只有一条覆盖：新的临时状态直接替换旧的。
    s.manualOverrides=[...(s.manualOverrides??[]).filter(o=>o.personId!==personId),{id:id(),personId,kind:cmd.kind,label:cmd.label.trim(),startAt:now,endAt:cmd.endAt,createdAt:now}];
  }else if(cmd.type==='manualCancel'){
    if(cmd.id!==undefined){
      const target=(s.manualOverrides??[]).find(o=>o.id===cmd.id);
      assert(target&&isSelfId(s,target.personId),'临时状态不存在或不属于本人');
      s.manualOverrides=(s.manualOverrides??[]).filter(o=>o.id!==cmd.id);
    }else{
      s.manualOverrides=(s.manualOverrides??[]).filter(o=>!isSelfId(s,o.personId));
    }
  }else if(cmd.type==='avatarSet'){
    setAvatarPack(s,cmd.personId,cmd.packId,now);
  }else if(cmd.type==='avatarReset'){
    resetAvatarPack(s,cmd.personId,now);
  }else if(cmd.type==='completeSetup'){
    // Phase 5B1：首次使用的唯一写入路径。draft 只活在 UI 内存里，
    // 完成时一次性提交（含 companion 创建与 Avatar），失败则整份克隆被丢弃。
    completeSetup(s,cmd.value,now);
  }else if(cmd.type==='usageMode'){
    // Phase 5B2：Together ↔ Solo 是可逆的运行方式切换，绝不删除 companion 数据。
    switchUsageMode(s,cmd,now);
  }else if(cmd.type==='profileIdentity'){
    // Phase 5B2：档案身份（name / shortAlias）的唯一编辑路径；PersonId 与 role 不可改。
    updateProfileIdentity(s,cmd,now);
  }else throw new Error('不支持的操作');
  return migrateInbox(s);
}
export function validateState(value: unknown): State {
  const s=value as State; assert(s && s.version===1,'备份版本不支持');
  for(const key of ['profiles','courses','events','tasks','notices','exceptions','reminders'] as const)assert(Array.isArray(s[key])&&s[key].length<=50000,'备份记录无效或过大');
  migrateInbox(s);
  // v0.3 Phase 1A：工作区允许 1—2 个个人档案，但必须恰好一个本人、最多一个同行者。
  assert(s.profiles.length>=1 && s.profiles.length<=2,'工作区需要 1—2 个个人档案');
  assert(new Set(s.profiles.map(p=>p.id)).size===s.profiles.length,'记录编号重复');
  const roles=roleCounts(s.profiles);
  assert(roles.self===1,'工作区必须且只能有一个本人档案');
  assert(roles.companion<=1,'同行者最多只能有一个');
  // Phase 5B2：使用方式与档案清单解耦。Solo 允许保留一个 inactive companion
  // （它不是"第二个当前使用的人"，只是被停用的资料），Together 才要求它存在。
  const storedUsageMode=(s.settings as {usageMode?:unknown}|undefined)?.usageMode;
  if(storedUsageMode!==undefined)assert(isUsageMode(storedUsageMode),'使用方式设置无效');
  if(usageModeOf(s)==='together')assert(roles.companion===1,'双人模式需要且只能有一个陪伴对象');
  // v2 数据必须显式带 role；v1 旧备份仍按 角色→历史 id→数组位置 兼容解析。
  if(stateDomainVersion(s)>=2)for(const p of s.profiles)assert(isProfileRole(p.role),'个人档案缺少角色，请重新迁移或从备份恢复');
  // v3 起会议必须归属某个档案；更早的数据由 eventPerson() 回退到本人。
  if(stateDomainVersion(s)>=3)for(const e of s.events)assert(e.person!==undefined,'会议缺少所属人，请重新迁移或从备份恢复');
  // v4 起每个档案都必须带自己的作息（规则本身可以为空；旧版本由迁移补齐）。
  if(stateDomainVersion(s)>=4)for(const p of s.profiles)assertRoutineProfile(p.routine,'个人作息');
  // v5 起临时状态是显式集合（旧版本由迁移补空数组）；记录必须属于存在的档案。
  assert(s.manualOverrides===undefined||Array.isArray(s.manualOverrides)&&s.manualOverrides.length<=MANUAL_OVERRIDE_LIMIT,'临时状态记录无效或过多');
  if(stateDomainVersion(s)>=5)assert(Array.isArray(s.manualOverrides),'临时状态记录缺失，请重新迁移或从备份恢复');
  if(stateDomainVersion(s)>=6)for(const p of s.profiles)assertAvatarSelection(p.avatar,'个人 Avatar 选择');
  for(const override of s.manualOverrides??[]){assertManualOverride(override);assert(s.profiles.some(p=>p.id===override.personId),'临时状态所属人不存在');}
  for(const key of ['profiles','courses','events','tasks','notices','exceptions'] as Entity[]){assert(new Set(s[key].map(v=>v.id)).size===s[key].length,'记录编号重复');for(const v of s[key]){validate(key,v,s);assert(Number.isFinite(v.updatedAt),'更新时间无效');}}
  for(const item of [...s.courses,...s.tasks,...s.events])assert(!item.sourceId||s.notices.some(n=>n.id===item.sourceId),'备份来源关联缺失');
  assert(s.settings&&typeof s.settings.launch==='boolean'&&typeof s.settings.setup==='boolean'&&Number.isFinite(s.lastTick),'备份设置无效');
  if(s.settings.domainVersion!==undefined)assert(Number.isInteger(s.settings.domainVersion)&&s.settings.domainVersion>=1,'领域版本无效');
  if(s.settings.pet){const p=s.settings.pet;assert(['custom','pet','orb'].includes(p.mode)&&['small','medium','large'].includes(p.size)&&typeof p.animate==='boolean'&&(p.reduceMotion===undefined||typeof p.reduceMotion==='boolean')&&typeof p.bubbles==='boolean'&&Number.isInteger(p.duration)&&p.duration>=3&&p.duration<=30&&Number.isFinite(p.pausedUntil)&&p.pausedUntil>=0&&(p.miniPanel===undefined||typeof p.miniPanel==='boolean')&&(p.rememberPosition===undefined||typeof p.rememberPosition==='boolean'),'桌宠设置无效');}
  if(s.settings.trayResident!==undefined)assert(typeof s.settings.trayResident==='boolean','托盘设置无效');
  if(s.settings.petSubjectRole!==undefined)assert(isPetSubjectRole(s.settings.petSubjectRole),'桌宠主体设置无效');
  if(s.settings.petEnabled!==undefined)assert(typeof s.settings.petEnabled==='boolean','桌宠开关设置无效');
  if(s.bubbleHistory)assert(Array.isArray(s.bubbleHistory)&&s.bubbleHistory.length<=50000&&s.bubbleHistory.every(x=>text(x.id,20000)&&Number.isFinite(x.at)),'气泡记录无效');
  if(s.settings.orb)assert(Number.isFinite(s.settings.orb.x)&&Number.isFinite(s.settings.orb.y),'悬浮球位置无效');
  const targets=new Set([...s.courses.map(v=>`courses:${v.id}`),...s.events.map(v=>`events:${v.id}`),...s.tasks.map(v=>`tasks:${v.id}`)]);
  assert(new Set(s.reminders.map(r=>r.id)).size===s.reminders.length,'提醒编号重复');
  for(const r of s.reminders)assert(text(r.id,200)&&text(r.title,200)&&Number.isFinite(r.due)&&targets.has(r.target)&&['scheduled','due','acknowledged','snoozed','cancelled'].includes(r.status),'备份提醒无效');
  return s;
}
