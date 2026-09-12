import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {initial,apply,epoch} from '../src/core.ts';
import {migrateLive,snapshot,personStatus,petDefaults} from '../src/live.ts';
import {CompanionTimeline,companionBusinessState,companionDisplay,companionDisplayAssets,companionRailLabel,reminderHoldMs,reminderNudgeMs} from '../src/companion-display.ts';
import {getScheduledPetState,nextPetScheduleBoundary,PetScheduleClock,petRoutineSummary,resolvePetState,routineKindToPetState} from '../src/companion-display.ts';
import {emptyRoutine,legacyDefaultRoutine,type RoutineProfile,type RoutineRule} from '../src/routine.ts';
import {companionTone,companionToneOf,companionToneColors} from '../src/companion-colors.ts';
import {presenceStateFor,presenceMeta,statusLabel} from '../src/live.ts';
import {resolveCompanionAssets,companionRequiredStates} from '../src/companion-assets.ts';
import {companionFrame} from '../src/companion-frame.ts';
import {companionFallbackIdle} from '../src/companion-fallback-idle.ts';
import {companionGeometry,companionCharacter,companionFrame as companionFrameBox,companionRail,petSpriteFor} from '../src/companion-layout.ts';
import {buildCompanionMenu,companionMenuHeight,companionMenuMetrics,companionToggleShortcut,type CompanionMenuItem} from '../src/companion-menu.ts';
import type {PersonStatus} from '../src/live.ts';
import {syntheticState} from './fixtures/synthetic.ts';
import {resolvePetSubject} from '../src/people.ts';

// 合成课表（Alex / Sam）。所有时间断言都基于这份 fixture，不再读取私人课表。
const base=()=>syntheticState(epoch('2027-02-22T00:00'));
// 桌宠代表谁由身份层解析：有同行者时是同行者，Solo 时是本人。
const subjectOf=(s:ReturnType<typeof base>)=>resolvePetSubject(s).id;
// 按工作区实际档案投影（Together 两人 / Solo 一人），不再写死 me / partner。
const people=(s:ReturnType<typeof base>,now:number)=>s.profiles.map(profile=>personStatus(s,now,profile.id));

test('0.2.20 显示态收敛到十种（含四个时间状态），业务状态映射稳定',()=>{
  assert.deepEqual(Object.keys(companionDisplayAssets).sort(),['busy_class','busy_work','eating','gentle','idle','nap','night_sleep','reminder','upcoming','wake_up']);
  const s=base();
  // 上课中 -> busy_class
  assert.equal(companionBusinessState(people(s,epoch('2027-02-23T10:00')),epoch('2027-02-23T10:00'),subjectOf(s)),'busy_class');
  // 教研中 -> busy_work
  assert.equal(companionBusinessState(people(s,epoch('2027-02-22T14:30')),epoch('2027-02-22T14:30'),subjectOf(s)),'busy_work');
  // 即将开始 -> upcoming
  assert.equal(companionBusinessState(people(s,epoch('2027-02-23T16:10')),epoch('2027-02-23T16:10'),subjectOf(s)),'upcoming');
  // 双方空闲 -> idle（周日两人都没有课）
  assert.equal(companionBusinessState(people(s,epoch('2027-02-28T10:00')),epoch('2027-02-28T10:00'),subjectOf(s)),'idle');
  // 我的会议 -> busy_work（家里正忙，角色用同一套忙碌表达）
  const meeting=apply(s,{type:'save',entity:'events',value:{id:'meeting',title:'临时会议',start:'2027-02-28T10:00',end:'2027-02-28T11:00',notes:'',place:'',reminders:[],checklist:[]}},epoch('2027-02-28T09:00'));
  assert.equal(companionBusinessState(people(meeting,epoch('2027-02-28T10:20')),epoch('2027-02-28T10:20'),subjectOf(meeting)),'busy_work');
});

test('0.2.15 刚下课的三分钟表达“完成”，之后回到真实业务状态',()=>{
  const s=base();
  const end=epoch('2027-02-23T10:35');
  assert.equal(personStatus(s,end-1,'partner').code,'BUSY_CLASS');
  assert.equal(companionBusinessState(people(s,end+60000),end+60000,subjectOf(s)),'gentle');
  // 三分钟窗口过后不再庆祝，改回当下真实状态（这里下一节课还没开始）
  const later=end+10*60000;
  assert.notEqual(companionBusinessState(people(s,later),later,subjectOf(s)),'gentle');
  // 当天课程结束后稳定为空闲
  assert.equal(companionBusinessState(people(s,epoch('2027-02-23T18:00')),epoch('2027-02-23T18:00'),subjectOf(s)),'idle');
});

test('0.2.15 待处理提醒先占据显示态，超时后回到业务状态并保留计数',()=>{
  const s=base();
  const now=epoch('2027-02-28T10:00');
  const pending=2,statuses=people(s,now);
  const fresh=companionDisplay({people:statuses,pending,now,reminderSince:now,nudgeId:1,subjectId:subjectOf(s)});
  assert.equal(fresh.state,'reminder');
  assert.equal(fresh.base,'idle');
  assert.equal(fresh.label,'2 条待处理');
  assert.equal(fresh.holdingReminder,true);
  const later=companionDisplay({people:statuses,pending,now:now+reminderHoldMs+1000,reminderSince:now,nudgeId:1,subjectId:subjectOf(s)});
  assert.equal(later.state,'idle');
  assert.equal(later.pending,2);
  const cleared=companionDisplay({people:statuses,pending:0,now:now+reminderHoldMs+1000,reminderSince:now,nudgeId:1,subjectId:subjectOf(s)});
  assert.equal(cleared.state,'idle');
  assert.equal(cleared.reminderSince,0);
  assert.equal(cleared.label,'空闲');
});

test('0.2.15 轻提示一次性触发，之后低频重复且不会自己变频繁',()=>{
  const timeline=new CompanionTimeline(),now=epoch('2027-02-27T10:00');
  timeline.reset(now);
  assert.deepEqual(timeline.sync(0,now),{reminderSince:0,nudgeId:0});
  const first=timeline.sync(1,now+1000);
  assert.equal(first.nudgeId,1);
  assert.equal(first.reminderSince,now+1000);
  // 同一批未处理提醒不会每秒重复提示
  for(let i=1;i<60;i++)assert.equal(timeline.sync(1,now+1000+i*1000).nudgeId,1);
  assert.equal(timeline.sync(1,now+1000+reminderNudgeMs).nudgeId,2);
  // 处理干净后重新开始计数
  assert.equal(timeline.sync(0,now+1000+reminderNudgeMs+1000).nudgeId,2);
  const restarted=timeline.sync(1,now+1000+reminderNudgeMs+2000);
  assert.equal(restarted.nudgeId,3);
  assert.equal(restarted.reminderSince,now+1000+reminderNudgeMs+2000);
});

test('0.2.16 状态颜色只有一套：语义相同必然同色，空闲不会变成红色',()=>{
  // 每个 presence 语义只有一个 tone，D / Y 不存在各自的调色板。
  assert.deepEqual(Object.keys(companionToneOf).sort(),['busy','dnd','focus','idle','offline','upcoming']);
  assert.equal(companionTone('idle'),'calm');
  assert.equal(companionTone('upcoming'),'upcoming');
  assert.equal(companionTone('busy'),'busy');
  assert.equal(companionTone('focus'),'focus');
  assert.equal(companionTone('dnd'),'alert');
  assert.equal(companionTone('offline'),'neutral');
  // 空闲是绿色，不是红色；只有真正的冲突才用 alert 色。
  assert.equal(companionToneColors.calm,'#8CBE9E');
  assert.notEqual(companionTone('idle'),'alert');
  assert.notEqual(companionTone('offline'),'alert');

  const s=base();
  // D 空闲、Y 空闲：两边必须同色。
  const idleNow=epoch('2027-02-28T10:00'),bothIdle=people(s,idleNow).map(presenceStateFor);
  assert.deepEqual(bothIdle,['idle','idle']);
  assert.equal(new Set(bothIdle.map(companionTone)).size,1);
  // D 忙碌、Y 空闲：语义不同才允许颜色不同。
  const busyNow=epoch('2027-02-23T10:00'),mixed=people(s,busyNow).map(presenceStateFor);
  assert.deepEqual(mixed,['idle','busy']);
  assert.notEqual(companionTone(mixed[0]),companionTone(mixed[1]));
  // 双方都忙碌时颜色一致。
  const meeting=apply(s,{type:'save',entity:'events',value:{id:'tone-meeting',title:'临时会议',start:'2027-02-23T10:00',end:'2027-02-23T11:00',notes:'',place:'',reminders:[],checklist:[]}},epoch('2027-02-23T09:00'));
  const bothBusy=people(meeting,busyNow).map(presenceStateFor);
  assert.deepEqual(bothBusy,['busy','busy']);
  assert.equal(new Set(bothBusy.map(companionTone)).size,1);
  // 文案与颜色来自同一份语义：文案相同的状态必然同色（逐状态码穷举）。
  const codes=['FREE','BUSY_CLASS','BUSY_EVENT','BUSY_MEETING','UPCOMING','UNKNOWN','TERM_NOT_STARTED','NO_SCHEDULE','TERM_ENDED','DAY_FINISHED','NO_CLASS_TODAY'] as const;
  const byLabel=new Map<string,Set<string>>();
  for(const code of codes){
    for(const research of [false,true]){
      const status={code,research,conflict:false} as PersonStatus;
      const label=statusLabel(status),tone=companionTone(presenceStateFor(status));
      byLabel.set(label,new Set([...(byLabel.get(label)??[]),tone]));
    }
  }
  for(const [label,tones] of byLabel)assert.equal(tones.size,1,`文案「${label}」出现了多种颜色：${[...tones].join(',')}`);
  // 空闲语义（空闲 / 今天无课 / 今日课程已结束 / 课表尚未开始）全部是同一个绿色。
  assert.equal(companionTone(presenceStateFor({code:'TERM_NOT_STARTED'} as PersonStatus)),'calm');
  assert.equal(companionTone(presenceStateFor({code:'NO_CLASS_TODAY'} as PersonStatus)),'calm');
  // 未知 / 未录入课表不会误显示成“红色空闲”。
  const empty=migrateLive(initial(epoch('2027-02-22T00:00')));
  for(const status of people(empty,idleNow))assert.equal(companionTone(presenceStateFor(status)),'neutral');
  assert.equal(presenceStateFor(people(s,epoch('2027-02-23T16:10'))[1]),'upcoming');
  assert.equal(companionTone('upcoming'),'upcoming');
});

// 北京时间构造：Routine 领域统一按 UTC+8 判定（src/routine.ts）。
// 基准 2027-03-01（周一，Alex 学期首日）：dayOffset 0 = 当日，-1 = 前一天周日，1 = 次日。
const local=(hour:number,minute:number,second=0,dayOffset=0)=>Date.UTC(2027,2,1+dayOffset,hour-8,minute,second);
// 0.2.x 的默认桌宠时间表：迁移后它就是"当前桌宠主体"的 Routine（source = legacy-default）。
const legacyRoutine=legacyDefaultRoutine(0);
// 测试用的自定义作息构造。
const rule=(over:Partial<RoutineRule>&{id:string}):RoutineRule=>({kind:'custom',label:'自定义',start:'09:00',end:'10:00',days:[1,2,3,4,5,6,7],enabled:true,priority:10,...over});
const routineOf=(...rules:RoutineRule[]):RoutineProfile=>({source:'user',updatedAt:1,rules});
const withRoutine=(s:ReturnType<typeof base>,id:string,routine:RoutineProfile)=>({...s,profiles:s.profiles.map(profile=>profile.id===id?{...profile,routine}:profile)});

test('0.2.20 时间状态边界全部左闭右开：07:29/07:30 · 07:49/07:50 · 11:29/11:30/11:59/12:00 · 12:29/12:30/13:59/14:00 · 23:29/23:30/23:59/00:00',()=>{
  // 0.2.x 的时间表现在只以"迁移默认作息"的形式存在（LEGACY_DEFAULT_ROUTINE_TIMES），
  // 这里锁定它的形状：迁移后的默认用户必须逐分钟与旧行为一致。
  assert.deepEqual(legacyRoutine.rules.map(entry=>[entry.kind,entry.start,entry.end]),[
    ['sleep','23:30','07:30'],
    ['wake','07:30','07:50'],
    ['meal','11:30','12:00'],
    ['nap','12:30','14:00'],
    ['wake','14:00','14:20'],
  ]);
  // 早晨：睡 -> 刚睡醒 -> 正常
  assert.equal(getScheduledPetState(legacyRoutine,local(7,29)),'night_sleep');
  assert.equal(getScheduledPetState(legacyRoutine,local(7,29,59)),'night_sleep');
  assert.equal(getScheduledPetState(legacyRoutine,local(7,30)),'wake_up');
  assert.equal(getScheduledPetState(legacyRoutine,local(7,49)),'wake_up');
  assert.equal(getScheduledPetState(legacyRoutine,local(7,49,59)),'wake_up');
  assert.equal(getScheduledPetState(legacyRoutine,local(7,50)),null);
  // 中午：吃饭 11:30–12:00
  assert.equal(getScheduledPetState(legacyRoutine,local(11,29)),null);
  assert.equal(getScheduledPetState(legacyRoutine,local(11,29,59)),null);
  assert.equal(getScheduledPetState(legacyRoutine,local(11,30)),'eating');
  assert.equal(getScheduledPetState(legacyRoutine,local(11,59)),'eating');
  assert.equal(getScheduledPetState(legacyRoutine,local(11,59,59)),'eating');
  assert.equal(getScheduledPetState(legacyRoutine,local(12,0)),null);
  // 午后：午睡 12:30–14:00
  assert.equal(getScheduledPetState(legacyRoutine,local(12,29)),null);
  assert.equal(getScheduledPetState(legacyRoutine,local(12,30)),'nap');
  assert.equal(getScheduledPetState(legacyRoutine,local(13,59)),'nap');
  assert.equal(getScheduledPetState(legacyRoutine,local(13,59,59)),'nap');
  // 午睡结束后还有一小段“刚睡醒”，14:20 才真正回到普通状态
  assert.equal(getScheduledPetState(legacyRoutine,local(14,0)),'wake_up');
  assert.equal(getScheduledPetState(legacyRoutine,local(14,19,59)),'wake_up');
  assert.equal(getScheduledPetState(legacyRoutine,local(14,20)),null);
  // 夜间跨日：23:30 开始，次日 07:30 结束
  assert.equal(getScheduledPetState(legacyRoutine,local(23,29)),null);
  assert.equal(getScheduledPetState(legacyRoutine,local(23,29,59)),null);
  assert.equal(getScheduledPetState(legacyRoutine,local(23,30)),'night_sleep');
  assert.equal(getScheduledPetState(legacyRoutine,local(23,59)),'night_sleep');
  assert.equal(getScheduledPetState(legacyRoutine,local(0,0,0,1)),'night_sleep');
  assert.equal(getScheduledPetState(legacyRoutine,local(0,0,0,1)),'night_sleep');
  assert.equal(getScheduledPetState(legacyRoutine,local(6,0,0,1)),'night_sleep');
  // 白天普通时段没有任何时间状态
  for(const hour of [8,10,15,18,21])assert.equal(getScheduledPetState(legacyRoutine,local(hour,0)),null);
  // 两个刚睡醒窗口都是同一个状态：早上起床后与午睡结束后。
  assert.deepEqual(legacyRoutine.rules.filter(entry=>entry.kind==='wake').map(entry=>[entry.start,entry.end]),[['07:30','07:50'],['14:00','14:20']]);
});

test('0.2.20 下一个时间边界只在真正的切换点触发重算',()=>{
  assert.equal(nextPetScheduleBoundary(legacyRoutine,local(11,0)),local(11,30));
  assert.equal(nextPetScheduleBoundary(legacyRoutine,local(11,30)),local(12,0));
  assert.equal(nextPetScheduleBoundary(legacyRoutine,local(12,10)),local(12,30));
  assert.equal(nextPetScheduleBoundary(legacyRoutine,local(14,30)),local(23,30));
  // 23:40 之后的下一个边界是次日 07:30
  assert.equal(nextPetScheduleBoundary(legacyRoutine,local(23,40)),local(7,30,0,1));
  // 没有作息（或规则全部停用）时既没有时间状态，也没有边界——不会每秒空转。
  assert.equal(nextPetScheduleBoundary(undefined,local(11,0)),Number.POSITIVE_INFINITY);
  assert.equal(nextPetScheduleBoundary(emptyRoutine(1),local(11,0)),Number.POSITIVE_INFINITY);
  const clock=new PetScheduleClock();
  assert.equal(clock.read(legacyRoutine,local(11,0)),null);
  assert.equal(clock.read(legacyRoutine,local(11,20)),null);
  assert.equal(clock.read(legacyRoutine,local(11,30)),'eating');
  assert.equal(clock.read(legacyRoutine,local(11,45)),'eating');
  assert.equal(clock.read(legacyRoutine,local(12,5)),null);
  clock.reset();
  assert.equal(clock.read(legacyRoutine,local(23,45)),'night_sleep');
});

test('0.2.20 时间状态优先级：业务忙碌与提醒压过时间状态，夜间睡觉不会被空闲顶掉',()=>{
  const s=base();
  const night=local(23,40,0,-1);   // 周日 23:40，次日是 Alex 学期首日
  // 夜间且没有任何安排 -> night_sleep
  assert.equal(companionBusinessState(people(s,night),night,subjectOf(s)),'idle');
  const live=snapshot(s,night);
  assert.equal(live.display.state,'night_sleep');
  assert.equal(live.display.asset,'night_sleep');
  assert.equal(live.display.nightly,true);
  // 时间状态来自桌宠主体（同行者）自己的 Routine，而不是任何全局常量。
  assert.equal(live.display.scheduled,'night_sleep');
  const nightScheduled=live.display.scheduled;
  // 关闭夜间自动睡觉后回到普通状态，但吃饭 / 午睡 / 刚睡醒仍然按时间生效
  const off=migrateLive({...structuredClone(s),settings:{...s.settings,pet:{...petDefaults,nightRest:false}}});
  assert.equal(snapshot(off,night).display.state,'idle');
  assert.equal(snapshot(off,local(11,45,0,-1)).display.state,'eating');
  assert.equal(snapshot(off,local(12,45,0,-1)).display.state,'nap');
  assert.equal(snapshot(off,local(7,35,0,-1)).display.state,'wake_up');
  // 午睡时间段的进行中会议优先
  const napMeeting=apply(s,{type:'save',entity:'events',value:{id:'nap-meeting',title:'午后会议',start:'2027-03-01T12:40',end:'2027-03-01T13:30',notes:'',place:'',reminders:[],checklist:[]}},local(12,35));
  assert.equal(snapshot(napMeeting,local(12,45)).display.state,'busy_work');
  assert.equal(snapshot(napMeeting,local(12,45)).display.scheduled,'nap');
  // 夜间进行中的会议优先于睡觉，且不再标记夜间休息
  const nightMeeting=apply(s,{type:'save',entity:'events',value:{id:'night-meeting',title:'深夜会议',start:'2027-02-28T23:30',end:'2027-03-01T00:30',notes:'',place:'',reminders:[],checklist:[]}},local(23,0,0,-1));
  assert.equal(snapshot(nightMeeting,night).display.state,'busy_work');
  assert.equal(snapshot(nightMeeting,night).display.nightly,false);
  // 待处理提醒优先级最高：午睡时段也保持提醒姿态，但仍然记录时间状态
  const pendingLive=companionDisplay({people:people(s,night),pending:1,now:night,reminderSince:night,nudgeId:1,subjectId:subjectOf(s),scheduled:nightScheduled});
  assert.equal(pendingLive.state,'reminder');
  assert.equal(pendingLive.base,'night_sleep');
  assert.equal(pendingLive.nightly,true);
  // 提醒保持窗口结束后回到时间状态而不是普通空闲
  const settled=resolvePetState({people:people(s,night),pending:1,now:night+reminderHoldMs+1000,reminderSince:night,subjectId:subjectOf(s),scheduled:nightScheduled});
  assert.equal(settled.state,'night_sleep');
  // 白天普通时段仍然是普通状态
  assert.equal(snapshot(s,local(10,0,0,-1)).display.state,'idle');
});

/* ----------------------------------------------------------------------------
 * Phase 2B：桌宠时间状态由 Profile.routine 驱动。
 * 0.2.x 的固定时间表已经删除，只剩迁移默认值与上面的历史契约测试。
 * -------------------------------------------------------------------------- */
test('2B 自定义作息驱动桌宠：sleep 01:00–09:00 与 meal 13:00–13:30（旧时间表完全不生效）',()=>{
  const routine=routineOf(
    rule({id:'my-sleep',kind:'sleep',label:'睡觉',start:'01:00',end:'09:00'}),
    rule({id:'my-meal',kind:'meal',label:'午饭',start:'13:00',end:'13:30'}),
  );
  const s=withRoutine(base(),'partner',routine);
  // 旧时间表的 23:30–07:30 之外：凌晨 02:00 在旧实现里是普通状态，现在必须睡觉。
  assert.equal(snapshot(s,local(2,0,0,-1)).display.state,'night_sleep');
  assert.equal(snapshot(s,local(8,59,0,-1)).display.state,'night_sleep');
  assert.equal(snapshot(s,local(9,0,0,-1)).display.state,'idle');
  // 旧时间表的 11:30–12:00 吃饭时段不再生效；新规则的 13:15 必须吃饭。
  assert.equal(snapshot(s,local(11,45,0,-1)).display.state,'idle');
  assert.equal(snapshot(s,local(13,15,0,-1)).display.state,'eating');
  assert.equal(snapshot(s,local(13,30,0,-1)).display.state,'idle');
  // 旧的午睡 / 刚睡醒窗口也随旧时间表一起消失。
  for(const [hour,minute] of [[12,45],[14,5]] as const)assert.equal(snapshot(s,local(hour,minute,0,-1)).display.state,'idle',`${hour}:${minute}`);
});

test('2B 停用的规则不产生时间状态与边界；重新启用后立即恢复',()=>{
  const nap=rule({id:'my-nap',kind:'nap',label:'午睡',start:'13:00',end:'14:00'});
  const off=withRoutine(base(),'partner',routineOf({...nap,enabled:false}));
  assert.equal(snapshot(off,local(13,15,0,-1)).display.state,'idle');
  assert.equal(snapshot(off,local(13,15,0,-1)).display.scheduled,null);
  assert.equal(nextPetScheduleBoundary(routineOf({...nap,enabled:false}),local(9,0,0,-1)),Number.POSITIVE_INFINITY);
  const on=withRoutine(base(),'partner',routineOf(nap));
  assert.equal(snapshot(on,local(13,15,0,-1)).display.state,'nap');
});

test('2B 空作息：没有时间状态、没有边界，业务状态与空闲照常',()=>{
  const empty=withRoutine(base(),'partner',emptyRoutine(1));
  const now=local(12,45,0,-1);
  const live=snapshot(empty,now);
  assert.equal(live.display.scheduled,null);
  assert.equal(live.display.state,'idle');
  assert.equal(live.display.nightly,false);
  assert.equal(nextPetScheduleBoundary(emptyRoutine(1),now),Number.POSITIVE_INFINITY);
  const clock=new PetScheduleClock();
  assert.equal(clock.read(emptyRoutine(1),now),null);
  assert.equal(clock.read(undefined,now),null);
  // 商务课程仍然压过"没有时间状态"的桌宠：周二 10:00 同行者在课上。
  const busy=withRoutine(base(),'partner',emptyRoutine(1));
  assert.equal(snapshot(busy,epoch('2027-02-23T10:00')).display.state,'busy_class');
});

test('2B 运行中改掉作息立即生效：clock 缓存键跟着规则内容走',()=>{
  const clock=new PetScheduleClock();
  const before=emptyRoutine(1);
  const after=routineOf(rule({id:'my-meal',kind:'meal',label:'午饭',start:'21:00',end:'22:00'}));
  const now=local(21,30,0,-1);
  assert.equal(clock.read(before,now),null);
  // 同一时刻、同一 clock 实例：规则变了就必须重算，而不是等到下个边界或重启。
  assert.equal(clock.read(after,now),'eating');
  assert.equal(clock.read(before,now),null);
  // 规则内容相同但 updatedAt 变了（用户重新保存）同样视为变化。
  assert.equal(clock.read({...after,updatedAt:2},now),'eating');
});

test('2B 主体沿用身份层：Together 看同行者作息，Solo 看本人作息',()=>{
  // Together：桌宠主体是同行者（Sam），改本人的作息不影响桌宠。
  const together=withRoutine(base(),'me',routineOf(rule({id:'self-nap',kind:'nap',label:'午睡',start:'15:00',end:'15:30'})));
  assert.equal(subjectOf(together),'partner');
  assert.equal(snapshot(together,local(15,10,0,-1)).display.state,'idle');
  const companionNap=withRoutine(together,'partner',routineOf(rule({id:'partner-nap',kind:'nap',label:'午睡',start:'15:00',end:'15:30'})));
  assert.equal(snapshot(companionNap,local(15,10,0,-1)).display.state,'nap');
  // Solo：同行者不存在时主体回落到本人，桌宠用本人的作息。
  const solo=structuredClone(base());
  solo.profiles=solo.profiles.filter(profile=>profile.role==='self');
  solo.courses=solo.courses.filter(course=>course.person===solo.profiles[0].id);
  solo.events=[];solo.reminders=[];
  solo.profiles[0].routine=routineOf(rule({id:'self-nap',kind:'nap',label:'午睡',start:'15:00',end:'15:30'}));
  assert.equal(resolvePetSubject(solo).id,solo.profiles[0].id);
  assert.equal(snapshot(solo,local(15,10,0,-1)).display.state,'nap');
  assert.equal(snapshot(solo,local(12,45,0,-1)).display.state,'idle');
});

test('2B 业务忙碌压过 Routine：上课与吃饭 / 午睡重叠时仍然是上课',()=>{
  // 周二 10:00 同行者在上课；把吃饭规则放在同一时段，桌宠必须显示上课。
  const meal=routineOf(rule({id:'meal-overlap',kind:'meal',label:'午饭',start:'10:00',end:'11:00'}));
  const s=withRoutine(base(),'partner',meal);
  const busy=snapshot(s,epoch('2027-02-23T10:10'));
  assert.equal(busy.display.state,'busy_class');
  assert.equal(busy.display.scheduled,'eating',"时间状态照实记录，但被业务状态压过");
  // 进行中的会议同理。
  const meeting=apply(s,{type:'save',entity:'events',value:{id:'meal-meeting',title:'临时会议',start:'2027-02-28T10:00',end:'2027-02-28T11:00',notes:'',place:'',reminders:[],checklist:[]}},epoch('2027-02-28T09:00'));
  assert.equal(snapshot(meeting,local(10,30,0,-1)).display.state,'busy_work');
  assert.equal(snapshot(meeting,local(10,30,0,-1)).display.scheduled,'eating');
});

test('2B 没有视觉表达的 kind 不伪造姿态（focus / commute / custom）',()=>{
  const routine=routineOf(
    rule({id:'focus',kind:'focus',label:'专注',start:'09:00',end:'10:00'}),
    rule({id:'commute',kind:'commute',label:'通勤',start:'08:00',end:'08:30'}),
    rule({id:'custom',kind:'custom',label:'阅读',start:'15:00',end:'16:00'}),
  );
  assert.equal(routineKindToPetState('focus'),null);
  assert.equal(routineKindToPetState('commute'),null);
  assert.equal(routineKindToPetState('custom'),null);
  assert.deepEqual(['sleep','wake','meal','nap'].map(kind=>routineKindToPetState(kind as RoutineRule['kind'])),['night_sleep','wake_up','eating','nap']);
  const s=withRoutine(base(),'partner',routine);
  for(const [hour,minute] of [[8,10],[9,30],[15,30]] as const)assert.equal(snapshot(s,local(hour,minute,0,-1)).display.state,'idle',`${hour}:${minute}`);
  // 这些时段也不会制造边界（只有真正会换姿态的规则才算切换点）。
  assert.equal(nextPetScheduleBoundary(routine,local(7,0,0,-1)),Number.POSITIVE_INFINITY);
});

test('2B 设置页文案由作息生成：默认迁移用户与自定义用户各自准确',()=>{
  assert.deepEqual(petRoutineSummary(legacyDefaultRoutine(0)),{
    sleep:'23:30–07:30',
    states:'07:30–07:50 起床、11:30–12:00 午饭、12:30–14:00 午睡、14:00–14:20 午睡后起床',
  });
  assert.deepEqual(petRoutineSummary(undefined),{sleep:'',states:''});
  assert.deepEqual(petRoutineSummary(emptyRoutine(1)),{sleep:'',states:''});
  // 自定义作息与停用规则都不会在文案里留下旧时间。
  const custom=routineOf(
    rule({id:'late-sleep',kind:'sleep',label:'睡觉',start:'01:00',end:'09:00'}),
    rule({id:'nap-off',kind:'nap',label:'午睡',start:'12:30',end:'14:00',enabled:false}),
    rule({id:'read',kind:'custom',label:'阅读',start:'20:00',end:'21:00'}),
  );
  assert.deepEqual(petRoutineSummary(custom),{sleep:'01:00–09:00',states:''});
});

test('0.2.15 状态短文案保持低打扰且不暴露关系称呼',()=>{
  const s=base();
  const labels=[personStatus(s,epoch('2027-02-23T10:00'),'partner'),personStatus(s,epoch('2027-02-22T14:30'),'partner'),personStatus(s,epoch('2027-02-23T16:10'),'partner'),personStatus(s,epoch('2027-02-23T18:00'),'partner'),personStatus(s,epoch('2027-02-28T10:00'),'partner')].map(companionRailLabel);
  assert.deepEqual(labels,['上课','教研','即将','已下课','无课']);
  for(const label of labels)assert.ok(label.length<=4);
  assert.equal(companionRailLabel(undefined),'未知');
});

test('0.2.15 快照默认带上显示态；偏好新增字段有默认值',()=>{
  const s=base(),now=epoch('2027-02-23T10:00'),live=snapshot(s,now);
  assert.equal(live.display.state,'busy_class');
  assert.equal(live.display.asset,'busy_class');
  assert.equal(live.preferences.mode,petDefaults.mode);
  assert.equal(live.preferences.reduceMotion,false);
  assert.equal(live.preferences.miniPanel,true);
  assert.equal(live.preferences.rememberPosition,true);
});

test('0.2.20 旧版偏好迁移补全新字段、保留用户选择，删除小猫后回到默认形象',()=>{
  const legacy=base();
  legacy.settings.pet={mode:'orb',size:'large',animate:false,bubbles:false,duration:12,pausedUntil:0} as any;
  const migrated=migrateLive(legacy);
  const pet=migrated.settings.pet!;
  assert.equal(pet.mode,'orb');
  assert.equal(pet.size,'large');
  assert.equal(pet.duration,12);
  // 旧安装关闭过“轻微动态效果”，0.2.16 合并开关后应落到“减少动态”。
  assert.equal(pet.reduceMotion,true);
  assert.equal(pet.animate,true);
  assert.equal(pet.miniPanel,true);
  assert.equal(pet.rememberPosition,true);
  // 0.2.16 新增夜间休息，旧安装默认开启且可被显式关闭。
  assert.equal(pet.nightRest,true);
  const off=migrateLive({...structuredClone(legacy),settings:{...legacy.settings,pet:{...legacy.settings.pet,nightRest:false} as any}});
  assert.equal(off.settings.pet!.nightRest,false);
  assert.equal(migrated.settings.trayResident,true);
  assert.equal(migrated.settings.liveVersion,5);
  // 旧安装里选过的小猫桌宠（mode='pet'）一次性迁移到唯一默认形象，不留下第二个角色。
  const cat=migrateLive({...structuredClone(base()),settings:{...base().settings,pet:{...petDefaults,mode:'pet' as any}}});
  assert.equal(cat.settings.pet!.mode,'custom');
  // 迁移必须幂等：再次迁移不能改变结果。
  assert.equal(migrateLive(structuredClone(migrated)).settings.pet!.reduceMotion,true);
  assert.deepEqual(migrateLive(structuredClone(migrated)),migrated);
});

test('0.2.20 仓库内的素材清单可直接解析（十态素材，缺帧只回退到相近动作）',()=>{
  const assets=resolveCompanionAssets(path.join(process.cwd(),'src','ui'));
  assert.equal(assets.available,true,assets.reason);
  // 十态名单来自统一的 display 映射表，业务代码里没有第二份图片名单。
  assert.deepEqual([...companionRequiredStates].sort(),['busy_class','busy_work','eating','happy','idle','nap','night_sleep','relaxed','reminder','wake_up']);
  assert.equal(assets.manifest?.format,'dayhub-companion');
  assert.ok(Math.abs(assets.aspect-assets.manifest!.canvas.width/assets.manifest!.canvas.height)<1e-9);
  // 0.2.20 十宫格素材随包发布：十个状态都必须能直接解析成可用的 PNG。
  assert.deepEqual(assets.missing,[]);
  for(const key of companionRequiredStates){
    const url=assets.images[key];
    assert.match(url,/^data:image\/png;base64,/);
    const bytes=Buffer.from(url.split(',')[1],'base64');
    assert.deepEqual([...bytes.subarray(0,4)],[0x89,0x50,0x4e,0x47]);
    assert.ok(bytes.length>2000);
  }
  // 每一个显示态都能拿到自己的素材帧，不再依赖“相近动作”兜底。
  for(const state of Object.keys(companionDisplayAssets) as (keyof typeof companionDisplayAssets)[]){
    const meta=companionDisplayAssets[state];
    assert.equal(companionFrame(assets.images,meta.asset,meta.fallbacks),assets.images[meta.asset],state);
  }
  // 缺帧时只记录缺失并回退，不会让整个形象不可用。
  for(const key of assets.missing)assert.ok(companionRequiredStates.includes(key),key);
});

test('0.2.20 素材缺失时逐级回退：缺帧回退相邻状态，整组缺失回退同形象内置待机帧（不再有猫）',()=>{
  const layout=(root:string)=>path.join(root,'assets','companion','custom');
  const dir=layout(fs.mkdtempSync(path.join(os.tmpdir(),'dayhub-companion-')));
  try{
    fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({format:'dayhub-companion',version:1,canvas:{width:10,height:20},states:{idle:{file:'idle.png'},busy_class:{file:'busy_class.png'}}}));
    fs.writeFileSync(path.join(dir,'idle.png'),Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47]),Buffer.alloc(64)]));
    fs.writeFileSync(path.join(dir,'busy_class.png'),Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47]),Buffer.alloc(64)]));
    const partial=resolveCompanionAssets(path.dirname(path.dirname(path.dirname(dir))));
    assert.equal(partial.available,true);
    // 老素材包缺的帧只会回退，不会让整个专属角色不可用。
    assert.deepEqual(partial.missing.sort(),['busy_work','eating','happy','nap','night_sleep','relaxed','reminder','wake_up']);
    assert.match(partial.reason,/相近动作/);
    // 缺 busy_work 时用 busy_class 顶替，缺其他状态时回到 idle
    assert.equal(companionFrame(partial.images,companionDisplayAssets.busy_work.asset,companionDisplayAssets.busy_work.fallbacks),partial.images.busy_class);
    assert.equal(companionFrame(partial.images,companionDisplayAssets.reminder.asset,companionDisplayAssets.reminder.fallbacks),partial.images.idle);

    const empty=fs.mkdtempSync(path.join(os.tmpdir(),'dayhub-companion-empty-'));
    try{
      const none=resolveCompanionAssets(empty);
      assert.equal(none.available,false);
      assert.equal(none.images.idle,undefined);
      // 整组素材读不到时，仍然使用同一形象的内置待机帧；文案里不出现任何其它角色。
      assert.match(none.reason,/专属角色/);
      assert.doesNotMatch(none.reason,/猫/);
      assert.equal(companionFrame(none.images,'eating',['relaxed','idle']),companionFallbackIdle);
      assert.match(companionFallbackIdle,/^data:image\/png;base64,/);
      assert.ok(companionFallbackIdle.length>2000);
    }finally{fs.rmSync(empty,{recursive:true,force:true});}

    // 只有 busy_class 而没有 idle 时不接管桌宠，避免没有待机帧的形象
    const noIdle=layout(fs.mkdtempSync(path.join(os.tmpdir(),'dayhub-companion-noidle-')));
    try{
      fs.mkdirSync(noIdle,{recursive:true});
      fs.writeFileSync(path.join(noIdle,'manifest.json'),JSON.stringify({format:'dayhub-companion',version:1,canvas:{width:10,height:20},states:{busy_class:{file:'busy_class.png'}}}));
      fs.writeFileSync(path.join(noIdle,'busy_class.png'),Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47]),Buffer.alloc(64)]));
      assert.equal(resolveCompanionAssets(path.dirname(path.dirname(path.dirname(noIdle)))).available,false);
    }finally{fs.rmSync(path.dirname(path.dirname(path.dirname(noIdle))),{recursive:true,force:true});}
  }finally{fs.rmSync(path.dirname(path.dirname(path.dirname(dir))),{recursive:true,force:true});}
});

test('0.2.15 素材文件损坏或格式不符时按不可用处理',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dayhub-companion-bad-'));
  const dir=path.join(root,'assets','companion','custom');
  try{
    fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({format:'other-tool',version:1,canvas:{width:10,height:20},states:{idle:{file:'idle.png'}}}));
    assert.equal(resolveCompanionAssets(root).available,false);
    fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({format:'dayhub-companion',version:1,canvas:{width:10,height:20},states:{idle:{file:'missing.png'}}}));
    const assets=resolveCompanionAssets(root);
    assert.equal(assets.available,false);
    assert.deepEqual(assets.missing.slice(0,1),['idle']);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('0.2.15 显示态与人物状态解耦：角色不知道业务细节',()=>{
  const status=(code:PersonStatus['code'],extra:Partial<PersonStatus>={})=>({person:'partner',alias:'Y',conflict:false,research:false,current:[],today:[],todayCount:0,termStart:'2027-02-22',tentative:false,code,...extra} as PersonStatus);
  const now=epoch('2027-02-23T10:00');
  assert.equal(companionBusinessState([status('BUSY_EVENT')],now,'partner'),'busy_work');
  assert.equal(companionBusinessState([status('BUSY_MEETING')],now,'partner'),'busy_work');
  assert.equal(companionBusinessState([status('NO_SCHEDULE')],now,'partner'),'idle');
  // 教研也是上课时段，但用抱教案的忙碌姿态而不是讲课姿态
  assert.equal(companionBusinessState([status('BUSY_CLASS')],now,'partner'),'busy_class');
  assert.equal(companionBusinessState([status('BUSY_CLASS',{research:true})],now,'partner'),'busy_work');
});

test('0.2.20 桌宠窗口固定且比人物本体大一圈，姿态偏移集中在布局表里',()=>{
  const assets=resolveCompanionAssets(path.join(process.cwd(),'src','ui'));
  const canvas=assets.manifest!.canvas,baseline=assets.manifest!.baseline??canvas.height;
  const bodyRatio=(assets.manifest!.bodyHeight??canvas.height)/canvas.height;
  const aspect=canvas.width/canvas.height;
  const geometry=(size:'small'|'medium'|'large')=>companionGeometry('custom',size,aspect);
  const small=geometry('small'),medium=geometry('medium'),large=geometry('large');
  // 窗口永远比人物本体高：上沿留有透明安全区，教鞭 / 星星 / 太阳不会被裁切。
  for(const [size,value] of [['small',small],['medium',medium],['large',large]] as const){
    assert.ok(value.height>companionCharacter.height[size],`${size} 高度不足`);
    assert.ok(value.width>=companionCharacter.minWidth);
  }
  assert.ok(small.height<medium.height&&medium.height<large.height);
  // 默认（中）档在 100% DPI 下可见人物约 150–190 CSS px：
  // 图片按 contain 放进“窗口去掉状态条后的舞台”，底边贴齐，再按画布里的本体比例换算。
  const stage={width:medium.width-companionFrameBox.padX*2,height:medium.height-companionRail.height};
  const drawn=Math.min(stage.height,stage.width/aspect);
  const visible=Math.round(drawn*bodyRatio);
  assert.ok(visible>=150&&visible<=190,`可见人物高度 ${visible}px`);
  // 同一份画布里，脚底基线之上才是人物本体，基线之下只留透明边距。
  assert.ok(baseline<canvas.height,'画布底部应有透明安全区');
  // 每个状态都有调参项，且只允许很小的偏移：换动作不会让角色跳位。
  for(const state of Object.keys(companionDisplayAssets)){
    const tuning=petSpriteFor(state);
    assert.ok(tuning.scale>=0.9&&tuning.scale<=1.1,state);
    assert.ok(Math.abs(tuning.offsetX)<=6&&Math.abs(tuning.offsetY)<=6,state);
  }
  assert.deepEqual(petSpriteFor('unknown-state'),petSpriteFor('idle'));
  const orb=companionGeometry('orb','medium',aspect);
  assert.equal(orb.width,orb.height);
});

test('0.2.20 内置小猫桌宠已彻底删除：没有猫的形象、几何或素材',()=>{
  for(const file of ['src/ui/companion.ts','src/ui/companion-custom.ts','src/companion-layout.ts','src/companion-assets.ts','src/companion-frame.ts']){
    const source=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
    assert.doesNotMatch(source,/PetArt|pet-art|companionCat/,file);
  }
  const manifest=resolveCompanionAssets(path.join(process.cwd(),'src','ui')).manifest!;
  assert.ok(!Object.keys(manifest.states).some(key=>/cat|kitty|pixel|sprite/i.test(key)));
  assert.equal(Object.values(manifest.states).some(entry=>/cat|kitty/i.test(entry.file)),false);
});

test('0.2.20 桌宠右键菜单：样式切换、气泡暂停与快捷键提示来自同一份模型',()=>{
  const item=(items:CompanionMenuItem[],id:string)=>items.find((entry):entry is Extract<CompanionMenuItem,{kind:'item'}>=>(entry.kind==='item'&&entry.id===id));
  const radio=(items:CompanionMenuItem[],id:string)=>items.find((entry):entry is Extract<CompanionMenuItem,{kind:'radio'}>=>(entry.kind==='radio'&&entry.id===id));

  const pet=buildCompanionMenu({mode:'custom',paused:false,visible:true,shortcut:companionToggleShortcut.label,shortcutReady:true});
  assert.equal(radio(pet,'mode:custom')?.checked,true);
  assert.equal(radio(pet,'mode:orb')?.checked,false);
  // 气泡行是动作不是勾选项：只有在暂停中才显示“已暂停”，避免“勾选=已暂停”的歧义。
  assert.equal(item(pet,'bubbles')?.label,'暂停气泡提醒 1 小时');
  assert.equal(item(pet,'bubbles')?.hint,undefined);
  assert.equal(pet.some(entry=>entry.kind==='check'),false);
  assert.equal(item(pet,'toggle')?.label,'隐藏桌宠');
  assert.equal(item(pet,'toggle')?.hint,companionToggleShortcut.label);
  assert.equal(item(pet,'quit')?.tone,'danger');
  assert.equal(pet.filter(entry=>entry.kind==='sep').length,3);
  assert.equal(companionToggleShortcut.accelerator,'Control+Alt+Y');

  const orb=buildCompanionMenu({mode:'orb',paused:true,visible:false,shortcut:companionToggleShortcut.label,shortcutReady:false});
  assert.equal(radio(orb,'mode:orb')?.checked,true);
  assert.equal(item(orb,'bubbles')?.label,'恢复气泡提醒');
  assert.equal(item(orb,'bubbles')?.hint,'已暂停');
  assert.equal(item(orb,'toggle')?.label,'显示桌宠');
  // 快捷键没注册成功时菜单不显示提示，避免说话不算数。
  assert.equal(item(orb,'toggle')?.hint,undefined);

  // 行高与分隔高度由同一份常量决定，主进程算出的窗口高度必然等于渲染高度。
  const rows=pet.filter(entry=>entry.kind!=='sep').length,seps=pet.filter(entry=>entry.kind==='sep').length;
  assert.equal(companionMenuHeight(pet),companionMenuMetrics.paddingY*2+rows*companionMenuMetrics.rowHeight+seps*companionMenuMetrics.separator);
  assert.equal(rows,8);
});
