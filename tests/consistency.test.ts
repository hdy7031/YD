import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initial, apply, epoch, occurrences, tick, validateState, DAY } from '../src/core.ts';
import { personStatus, snapshot, migrateLive, statusLabel } from '../src/live.ts';
import { pendingReminders, emptyScheduleText, scheduleDays, attentionSummary } from '../src/selectors.ts';
import { v020Synthetic } from './fixtures/v020-synthetic.ts';
const start=epoch('2026-09-07');
function fixture(){
  let s=initial(start);
  for(const person of ['me','partner'] as const)s=apply(s,{type:'save',entity:'courses',value:{id:person,person,title:'语文',weekday:1,first:1,last:1,weeks:[1,3],notes:'',place:'101',checklist:[],reminders:[0]}},start);
  return s;
}
test('0.2.8 学期、单双周、上课边界及周末由同一状态引擎推导',()=>{
  const s=fixture();assert.equal(personStatus(s,start-DAY,'me').code,'TERM_NOT_STARTED');
  assert.equal(personStatus(s,epoch('2026-09-07T08:10'),'me').code,'BUSY_CLASS');
  for(const t of ['2026-09-07T08:45','2026-09-12T08:10','2026-09-14T08:10'])assert.equal(personStatus(s,epoch(t),'me').current.kind,'idle');
  assert.equal(personStatus(s,epoch('2026-09-21T08:10'),'me').code,'BUSY_CLASS');
});
test('0.2.8 本次停课与跨日调课保留课程模板，原时间为空新时间上课',()=>{
  const original=fixture();let s=apply(original,{type:'save',entity:'exceptions',value:{id:'x',courseId:'me',date:'2026-09-07',cancelled:true}},start);
  assert.notEqual(personStatus(s,epoch('2026-09-07T08:10'),'me').code,'BUSY_CLASS');
  s=apply(s,{type:'save',entity:'exceptions',value:{...s.exceptions[0],cancelled:false,start:'2026-09-08T08:00',end:'2026-09-08T08:45'}},start);
  assert.equal(occurrences(s,start,start+DAY,'me').length,0);
  assert.equal(personStatus(s,epoch('2026-09-08T08:10'),'me').code,'BUSY_CLASS');
  assert.deepEqual(s.courses,original.courses);
});
test('0.2.10 有课表的 Ta 直接显示明确状态，无数据另有空状态',()=>{
  const s=fixture();for(const [time,code,label] of [['08:10','BUSY_CLASS','上课中'],['12:00','DAY_FINISHED','今日课程已结束']] as const){
    const status=personStatus(s,epoch('2026-09-07T'+time),'partner');assert.equal(status.code,code);assert.equal(statusLabel(status),label);
  }
  assert.equal(personStatus(initial(start),start,'partner').code,'NO_SCHEDULE');
  // 未录入课表时："空闲"才显示「尚未录入课表」；落在作息里时如实显示作息状态。
  assert.equal(statusLabel(personStatus(initial(start),epoch('2026-09-07T10:00'),'partner')),'尚未录入课表');
  assert.notEqual(emptyScheduleText(0),emptyScheduleText(1));
});
test('0.2.8 单一未处理集合在触发、确认、延后时同步，确认不完成待办',()=>{
  let s=apply(initial(start),{type:'save',entity:'tasks',value:{id:'todo',title:'报告',due:'2026-09-07T08:00',done:false,notes:'',checklist:[],reminders:[0]}},start);
  assert.equal(snapshot(s,start).pending,0);tick(s,epoch('2026-09-07T08:00'));
  assert.equal(pendingReminders(s).length,1);assert.equal(snapshot(s,start).pending,1);
  s=apply(s,{type:'snooze',id:pendingReminders(s)[0].id},epoch('2026-09-07T08:00'));
  assert.equal(snapshot(s,start).pending,0);tick(s,epoch('2026-09-07T08:10'));
  s=apply(s,{type:'ack',id:pendingReminders(s)[0].id},epoch('2026-09-07T08:10'));
  assert.equal(snapshot(s,start).pending,pendingReminders(s).length);assert.equal(snapshot(s,start).pending,0);assert.equal(s.tasks[0].done,false);
});
test('0.2.14 提醒生命周期兼容旧状态并支持可选延后时长',()=>{
  let s=initial(start);s=apply(s,{type:'save',entity:'tasks',value:{id:'todo',title:'报告',due:'2026-09-07T08:00',done:false,notes:'',checklist:[],reminders:[0]}},start);
  (s.reminders[0] as any).status='fired';s=validateState(s);assert.equal(s.reminders[0].status,'due');
  s=apply(s,{type:'snooze',id:s.reminders[0].id,minutes:30},epoch('2026-09-07T08:00'));
  assert.equal(s.reminders[0].status,'snoozed');assert.equal(s.reminders[1].status,'scheduled');assert.equal(s.reminders[1].due,epoch('2026-09-07T08:30'));assert.equal(s.reminders[1].snoozedFrom,s.reminders[0].id);
});
test('0.2.14 需要处理摘要只汇总待核对、已到提醒与逾期待办',()=>{
  let s=initial(start);s.notices.push({id:'n',title:'',text:'原文',state:'inbox',parseStatus:'NEEDS_REVIEW',updatedAt:start});
  s=apply(s,{type:'save',entity:'tasks',value:{id:'late',title:'逾期',due:'2026-09-07T07:00',done:false,notes:'',checklist:[],reminders:[]}},start);
  s=apply(s,{type:'save',entity:'tasks',value:{id:'due',title:'提醒',due:'2026-09-07T08:00',done:false,notes:'',checklist:[],reminders:[0]}},start);tick(s,epoch('2026-09-07T08:00'));
  assert.deepEqual(attentionSummary(s,epoch('2026-09-07T08:00')),{notices:1,reminders:1,overdue:1,total:3});
});
test('0.2.8 北京时间、显式UTC、ISO秒均表示同一瞬间',()=>{
  const expected=epoch('2026-09-07T08:00');for(const value of ['2026-09-07T08:00:00','2026-09-07T08:00:00+08:00','2026-09-07T00:00:00Z'])assert.equal(epoch(value),expected);
});
test('合成 v0.2 旧备份升级迁移不丢业务、提醒、设置或扩展字段',()=>{
  // 从合成的 v0.2.20 结构出发，再抹掉 0.2.16+ 才有的字段，模拟老安装首次升级。
  const legacy=structuredClone(v020Synthetic());
  legacy.settings.liveVersion=2 as number;
  delete legacy.settings.trayResident;
  for(const profile of legacy.profiles)delete profile.shortAlias;
  const pet=legacy.settings.pet as unknown as Record<string,unknown>;
  delete pet.nightRest;delete pet.miniPanel;delete pet.rememberPosition;
  validateState(legacy);const before=structuredClone(legacy);const next=migrateLive(structuredClone(legacy));validateState(next);
  for(const key of ['courses','tasks','events','notices','exceptions','reminders'] as const)assert.deepEqual((next as unknown as Record<string,unknown>)[key],(before as unknown as Record<string,unknown>)[key]);
  assert.equal(next.settings.liveVersion,5);assert.deepEqual(next.profiles.map(p=>p.shortAlias),['D','Y']);assert.equal(next.profiles[1].name,'Sam');
  assert.equal(next.settings.pet?.nightRest,true);assert.equal(next.settings.trayResident,true);
  assert.deepEqual(migrateLive(structuredClone(next)),next);
  const profile={...next.profiles[0],shortAlias:'自定义'};const edited=apply(next,{type:'save',entity:'profiles',value:profile},start);assert.equal(snapshot(edited,start).people[0].alias,'自定义');
});

test('0.2.8 网格按实际实例展示停课、跨周调课及跨午夜分段',()=>{
  let s=fixture();s=apply(s,{type:'save',entity:'exceptions',value:{id:'x',courseId:'me',date:'2026-09-07',cancelled:false,start:'2026-09-13T23:50',end:'2026-09-14T00:20'}},start);
  const first=scheduleDays(s,'2026-09-07','me'),second=scheduleDays(s,'2026-09-14','me');
  assert.equal(first.length,1);assert.equal(first[0].day,'2026-09-13');assert.equal(first[0].endClock,'24:00');
  assert.equal(second.length,1);assert.equal(second[0].day,'2026-09-14');assert.equal(second[0].startClock,'00:00');
  s=apply(s,{type:'save',entity:'exceptions',value:{...s.exceptions[0],cancelled:true}},start);assert.equal(scheduleDays(s,'2026-09-07','me').length,0);
});
