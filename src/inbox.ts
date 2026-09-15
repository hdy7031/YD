import { apply, id, epoch, dateOf, occurrences } from './core.ts';
import { academicOf } from './academic.ts';
import type { State, Notice, Command } from './types.ts';
import { validDraft } from './inbox-types.ts';
import type { InboundPayload, ParsedDraft, ParserAdapter, ParseContext } from './inbox-types.ts';
export const sourceLabels={MANUAL:'文字录入',CLIPBOARD:'剪贴板文字',SCREENSHOT:'截图',IMAGE_IMPORT:'图片导入',QQ_GROUP:'群消息',MOBILE:'手机',OTHER:'其他来源'};
export const typeLabels={TODO:'待办',EVENT:'会议与活动',COURSE_CHANGE:'课程调整',GENERAL_NOTICE:'普通通知',UNKNOWN:'待处理'};
export const statusLabels={UNPARSED:'待处理',PARSING:'正在整理通知……',NEEDS_REVIEW:'待确认',CONFIRMED:'已确认',FAILED:'识别失败',IGNORED:'已忽略'};
export function migrateInbox(s:State):State {
  // Additive migration: the v1 SQLite envelope and all existing IDs are retained.
  for(const list of [s.courses,s.events,s.tasks,s.exceptions,s.notices])for(const x of list)x.createdAt??=x.updatedAt;
  for(const x of [...s.tasks,...s.events])x.sourceInboxItemId??=x.sourceId;
  for(const n of s.notices){
    n.sourceType??=n.image?'IMAGE_IMPORT':'MANUAL';n.receivedAt??=n.createdAt;
    n.originalText??=n.text;n.parseStatus??=n.state==='archived'?'IGNORED':'UNPARSED';
    if(n.parsedData!==undefined&&!validDraft(n.parsedData)){delete n.parsedData;if(n.parseStatus!=='CONFIRMED'&&n.parseStatus!=='IGNORED'){n.parseStatus='FAILED';n.parseError='历史草稿格式不受支持，请重新整理或手动填写。';}}
    if(!s.inboxVersion){const target=s.tasks.find(x=>x.sourceId===n.id)||s.events.find(x=>x.sourceId===n.id);if(target){n.parseStatus='CONFIRMED';n.targetEntityType='due' in target?'tasks':'events';n.targetEntityId=target.id;n.processedAt=target.createdAt;}}
  }
  for(const r of s.reminders){
    const legacy=r.status as string;
    if(legacy==='pending')r.status='scheduled';else if(legacy==='fired')r.status='due';else if(legacy==='ack')r.status='acknowledged';
    r.createdAt??=Math.min(r.due,s.lastTick);r.updatedAt??=r.firedAt??r.createdAt;
  }
  s.inboxVersion=1;return s;
}
export function receive(s:State,p:InboundPayload,noticeId:string,now:number):State {
  if(!p||!Object.keys(sourceLabels).includes(p.sourceType||'MANUAL'))throw new Error('来源类型无效');
  for(const k of ['sourceLabel','externalSourceId','externalConversationId','externalMessageId'] as const)if(p[k]!=null&&(typeof p[k]!=='string'||p[k]!.length>500))throw new Error('来源元数据无效');
  if(p.receivedAt!==undefined&&!Number.isFinite(p.receivedAt))throw new Error('接收时间无效');
  // External IDs are opaque and must be stable and unique within sourceType.
  if(p.externalMessageId&&s.notices.some(n=>n.sourceType===(p.sourceType||'MANUAL')&&n.externalMessageId===p.externalMessageId))return s;
  if(s.notices.some(n=>n.id===noticeId))return s;
  return apply(s,{type:'save',entity:'notices',value:{id:noticeId,title:'',text:p.text??'',originalText:p.text??'',image:p.image,state:'inbox',createdAt:now,updatedAt:now,sourceType:p.sourceType||'MANUAL',sourceLabel:p.sourceLabel??null,externalSourceId:p.externalSourceId??null,externalConversationId:p.externalConversationId??null,externalMessageId:p.externalMessageId??null,receivedAt:p.receivedAt??now,parseStatus:'UNPARSED'}},now);
}
export function parseContext(s:State,n:Notice):ParseContext {return {now:n.createdAt??n.updatedAt,profiles:structuredClone(s.profiles),courses:structuredClone(s.courses),tasks:structuredClone(s.tasks),events:structuredClone(s.events),source:{sourceType:n.sourceType,sourceLabel:n.sourceLabel,externalSourceId:n.externalSourceId,externalConversationId:n.externalConversationId,externalMessageId:n.externalMessageId,receivedAt:n.receivedAt}};}
export async function parseSaved(n:Notice,s:State,parser:ParserAdapter):Promise<ParsedDraft>{const d=await parser.parse({text:n.text,createdAt:n.createdAt??n.updatedAt},parseContext(s,n));if(!validDraft(d))throw new Error('解析结果格式无效');return d;}
const norm=(s:string)=>s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
export function candidates(s:State,d:ParsedDraft){
  if(d.type==='EVENT')return s.events.filter(e=>d.correction?(!d.date||e.start.startsWith(d.date)):(norm(e.title)===norm(d.title)&&e.start===`${d.date}T${d.startTime}`&&norm(e.place)===norm(d.location))).map(e=>({id:e.id,entity:'events' as const,title:e.title,detail:`${e.start.replace('T',' ')} · ${e.place||'未填地点'}`}));
  if(d.type==='TODO')return s.tasks.filter(t=>norm(t.title)===norm(d.title)&&t.due===(d.date?`${d.date}T${d.startTime}`:'')).map(t=>({id:t.id,entity:'tasks' as const,title:t.title,detail:t.due||'未填截止时间'}));
  if(d.type==='COURSE_CHANGE')return s.exceptions.filter(e=>e.courseId===d.courseId&&e.date===d.date).map(e=>({id:e.id,entity:'exceptions' as const,title:s.courses.find(c=>c.id===e.courseId)?.title||'课程调整',detail:`${e.date} · ${e.cancelled?'停课':e.start||'地点调整'}`}));
  return [];
}
export function draftErrors(s:State,d:ParsedDraft):string[]{
  if(!validDraft(d))return ['草稿格式无效'];
  const errors:string[]=[];const validDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(epoch(v))&&dateOf(epoch(v))===v;
  const validTime=(v:string)=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  if(d.type==='UNKNOWN')errors.push('请选择事务类型。');
  if(!d.title.trim()||d.title.length>200)errors.push('请填写标题（最多 200 字）。');
  if(['EVENT','COURSE_CHANGE'].includes(d.type)&&!validDate(d.date))errors.push('缺少或无效的日期，请确认后再创建。');
  if(d.type==='TODO'&&d.date&&!validDate(d.date))errors.push('截止日期无效。');
  if((d.type==='EVENT'||d.type==='TODO'&&d.date)&&!validTime(d.startTime))errors.push('请填写有效时间。');
  if(d.type==='EVENT'&&d.endTime&&(!validTime(d.endTime)||d.endTime<=d.startTime))errors.push('结束时间必须晚于开始时间。');
  if(d.type==='COURSE_CHANGE'){
    const c=s.courses.find(c=>c.id===d.courseId);if(!c)errors.push('请选择已有课程。');
    // 课程按教学周展开，因此它一定属于某个有学业配置的档案（见 core.validate）；
    // 这里仍显式处理 absence（例如旧备份里遗留的课程 + 已被移除的学业配置）。
    else if(validDate(d.date)){const calendar=academicOf(s.profiles.find(p=>p.id===c.person));if(!calendar)errors.push('该课程所属人缺少学期与节次，请先在「课表与学校」里设置。');else{const day=Math.round((epoch(d.date)-epoch(calendar.startDate))/86400000);if(day<0||day%7!==c.weekday-1||!c.weeks.includes(Math.floor(day/7)+1))errors.push('原日期不属于该课程的教学周。');}}
    if(d.operation==='RESCHEDULE'&&(!validDate(d.newDate)||!validTime(d.startTime)||!validTime(d.endTime)||d.endTime<=d.startTime))errors.push('请补全新的日期和起止时间。');
    if(d.operation==='LOCATION_CHANGE'&&!d.location.trim())errors.push('请填写新地点。');
  }
  return errors;
}
export function confirmDraft(state:State,cmd:Extract<Command,{type:'review'}>,now:number):State {
  const n=state.notices.find(n=>n.id===cmd.noticeId);if(!n)throw new Error('原通知不存在');if(n.parseStatus==='CONFIRMED')return state;
  if(n.parseStatus==='IGNORED'||n.parseStatus==='PARSING')throw new Error('请先恢复待处理或等待整理结束');
  const d=cmd.draft,errors=draftErrors(state,d);if(errors.length)throw new Error(errors.join(' '));
  const matches=candidates(state,d);if(matches.length&&!cmd.allowDuplicate&&!cmd.updateId)throw new Error('可能已经存在相似事项，请查看已有或明确选择仍然创建。');
  if(cmd.updateId&&(d.type!=='EVENT'||!d.correction||!matches.some(x=>x.id===cmd.updateId)))throw new Error('更新对象无效，请重新核对候选事项。');
  let s=structuredClone(state),targetEntityType:Notice['targetEntityType']='notice',targetEntityId=n.id;
  const base={id:id(),title:d.title.trim(),notes:d.note,checklist:[],reminders:d.reminderMinutes===null?[]:[d.reminderMinutes],sourceId:n.id,sourceInboxItemId:n.id,createdAt:now,updatedAt:now};
  if(d.type==='TODO'){targetEntityType='tasks';targetEntityId=base.id;s=apply(s,{type:'save',entity:'tasks',value:{...base,due:d.date?`${d.date}T${d.startTime}`:'',done:false}},now);}
  if(d.type==='EVENT'){
    const old=s.events.find(e=>e.id===cmd.updateId);targetEntityType='events';targetEntityId=old?.id||base.id;
    s=apply(s,{type:'save',entity:'events',value:{...base,...(old?{id:old.id,createdAt:old.createdAt,checklist:old.checklist}:{}),start:`${d.date}T${d.startTime}`,end:d.endTime?`${d.date}T${d.endTime}`:null,place:d.location}},now);
  }
  if(d.type==='COURSE_CHANGE'){
    const c=s.courses.find(c=>c.id===d.courseId)!,calendar=academicOf(s.profiles.find(p=>p.id===c.person)),old=s.exceptions.find(e=>e.courseId===c.id&&e.date===d.date);
    if(!calendar)throw new Error('该课程所属人缺少学期与节次，请先在「课表与学校」里设置。');
    targetEntityType='exceptions';targetEntityId=old?.id||id();
    const start=d.operation==='RESCHEDULE'?`${d.newDate}T${d.startTime}`:old?.start||`${d.date}T${calendar.periods[c.first-1].start}`,end=d.operation==='RESCHEDULE'?`${d.newDate}T${d.endTime}`:old?.end||`${d.date}T${calendar.periods[c.last-1].end}`;
    s=apply(s,{type:'save',entity:'exceptions',value:{id:targetEntityId,courseId:c.id,date:d.date,cancelled:d.operation==='CANCEL',start,end,place:d.location||old?.place||c.place,sourceInboxItemId:n.id,createdAt:old?.createdAt??now,updatedAt:now}},now);
  }
  Object.assign(s.notices.find(x=>x.id===n.id)!,{parsedData:structuredClone(d),detectedType:d.type,confidence:d.confidence,parseStatus:'CONFIRMED',state:'archived',targetEntityType,targetEntityId,processedAt:now,updatedAt:now});
  return s;
}
