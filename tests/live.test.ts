// 状态与气泡的回归测试。数据来自 tests/fixtures 的合成课表（Alex / Sam），
// 不再依赖开发者私人课表或任何真实用户记录。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apply,epoch,occurrences} from '../src/core.ts';
import {togetherWorkspace} from './helpers/workspaces.ts';
import {personStatus,bubbleEvents,migrateLive,snapshot,presenceStateFor,statusLabel} from '../src/live.ts';
import {syntheticState} from './fixtures/synthetic.ts';
const base=()=>syntheticState(epoch('2027-02-22T00:00'));
test('合成课表导入后保留15条课程、两条research与提醒，live迁移幂等',()=>{const s=base();assert.equal(s.courses.length,15);assert.equal(s.courses.filter(c=>c.activity==='research').length,2);assert.equal(s.profiles[1].tentative,true);assert.equal(s.profiles[1].name,'Sam');assert.deepEqual(migrateLive(structuredClone(s)),s);assert.ok(s.reminders.length>0);});
test('两人独立学期：Alex 开课前、第8/9周及结束，Sam继续',()=>{const s=base();assert.equal(personStatus(s,epoch('2027-02-23T10:00'),'me').code,'TERM_NOT_STARTED');assert.equal(statusLabel(personStatus(s,epoch('2027-02-23T10:00'),'partner')),'上课中');assert.equal(personStatus(s,epoch('2027-04-19T10:00'),'me').current.label,'Academic English');assert.equal(personStatus(s,epoch('2027-04-26T10:00'),'me').current.label,'Machine Learning');assert.equal(personStatus(s,epoch('2027-06-21T10:00'),'me').code,'TERM_ENDED');assert.equal(statusLabel(personStatus(s,epoch('2027-06-21T10:00'),'partner')),'上课中');});
test('授课起止精确至毫秒；长空档不是课间',()=>{const s=base(),start=epoch('2027-02-23T09:50'),end=epoch('2027-02-23T10:35');assert.equal(personStatus(s,start-1,'partner').current.kind,'idle');assert.equal(personStatus(s,start,'partner').code,'BUSY_CLASS');assert.equal(personStatus(s,end-1,'partner').code,'BUSY_CLASS');assert.equal(personStatus(s,end,'partner').current.kind,'idle');assert.equal(personStatus(s,end,'partner').code,'FREE');});
test('只有相邻授课的短间隔才是课间，教研不会误归类',()=>{const s=base();assert.equal(personStatus(s,epoch('2027-02-23T16:10'),'partner').code,'UPCOMING');assert.equal(statusLabel(personStatus(s,epoch('2027-02-22T14:30'),'partner')),'教研中');assert.equal(personStatus(s,epoch('2027-02-22T15:15'),'partner').code,'UPCOMING');});
test('同刻开始结束不重叠；冲突保留全部事项',()=>{let s=base();s=apply(s,{type:'save',entity:'events',value:{id:'meeting',title:'临时会议',start:'2027-03-01T08:30',end:'2027-03-01T09:00',notes:'',place:'',reminders:[],checklist:[]}},epoch('2027-02-22T00:00'));assert.equal(statusLabel(personStatus(s,epoch('2027-03-01T08:45'),'me')),'安排冲突');assert.equal(personStatus(s,epoch('2027-03-01T08:45'),'me').conflict,true);assert.equal(personStatus(s,epoch('2027-03-01T08:45'),'me').current.meta?.conflict,true);assert.equal(personStatus(s,epoch('2027-03-01T09:00'),'me').current.kind,'class');assert.equal(personStatus(s,epoch('2027-03-01T09:00'),'me').current.meta?.conflict,undefined,'会议结束后不再有冲突标记');});
test('停课与跨日调课立即影响状态和气泡',()=>{let s=base();const c=s.courses.find(c=>c.person==='partner'&&c.weekday===2&&c.first===3)!;s=apply(s,{type:'save',entity:'exceptions',value:{id:'ex',courseId:c.id,date:'2027-02-23',cancelled:false,start:'2027-02-24T23:50',end:'2027-02-25T00:20'}},epoch('2027-02-22T00:00'));assert.equal(personStatus(s,epoch('2027-02-23T10:00'),'partner').current.kind,'idle');assert.equal(personStatus(s,epoch('2027-02-25T00:00'),'partner').current.label,c.title);assert.equal(bubbleEvents(s,epoch('2027-02-23T09:49'),epoch('2027-02-23T09:50')).length,0);});
test('提前五分钟、开始、结束均有气泡，重复检查区间为空',()=>{const s=base();for(const t of ['09:45','09:50','10:35']){const now=epoch('2027-02-23T'+t);assert.equal(bubbleEvents(s,now-1000,now).length,1);assert.equal(bubbleEvents(s,now,now+1000).length,0);}assert.match(bubbleEvents(s,epoch('2027-02-23T09:44'),epoch('2027-02-23T09:45'))[0].text,/还有 5 分钟/);});
test('后退时钟不产生倒序气泡；正向恢复事件可按id去重',()=>{const s=base(),from=epoch('2027-02-23T09:00'),to=from+2*3600000;const a=bubbleEvents(s,from,to);assert.ok(a.length);assert.deepEqual(bubbleEvents(s,to,from),[]);const seen=new Set(a.map(e=>e.id));assert.equal(bubbleEvents(s,from,to).filter(e=>!seen.has(e.id)).length,0);});
test('同一秒双方变化合并，不逐条排队',()=>{const s=base(),t=epoch('2027-03-04T08:00');const events=bubbleEvents(s,t-1000,t);assert.equal(events.length,1);assert.match(events[0].text,/D开始/);assert.match(events[0].text,/Y开始/);});
test('快照包含时钟来源、双方下一次变化时间与未处理计数',()=>{const s=base(),now=epoch('2027-02-23T10:00'),live=snapshot(s,now);assert.equal(live.now,now);assert.match(live.source,/Windows/);assert.equal(live.people[1].nextChange,epoch('2027-02-23T10:35'));assert.equal(live.preferences.duration,8);});
test('双状态核心使用稳定的六态语义且不暴露身份',()=>{const s=base();assert.equal(presenceStateFor(personStatus(s,epoch('2027-02-23T10:00'),'partner')),'busy');assert.equal(presenceStateFor(personStatus(s,epoch('2027-02-22T14:30'),'partner')),'focus');assert.equal(presenceStateFor({...personStatus(s,epoch('2027-02-23T10:00'),'partner'),conflict:true}),'dnd');// 12:30 起默认作息进入午睡：午睡属于"下线"（灰灯），不再是空闲。
  assert.equal(presenceStateFor(personStatus(s,epoch('2027-02-23T12:30'),'partner')),'offline');assert.equal(presenceStateFor(personStatus(s,epoch('2027-02-23T16:10'),'partner')),'upcoming');assert.equal(presenceStateFor(undefined),'offline');const labels=[statusLabel(personStatus(s,epoch('2027-02-23T10:00'),'partner')),statusLabel(personStatus(s,epoch('2027-02-22T14:30'),'partner')),statusLabel(personStatus(s,epoch('2027-02-23T12:30'),'partner'))];assert.deepEqual(labels,['上课中','教研中','午睡中'],'12:30 起默认作息进入午睡，文案随之变化');assert.ok(labels.every(label=>!label.includes('Sam')&&!label.includes('Ta')),'状态文案只描述行为，称呼由消费方按 Profile 添加');});
test('关闭气泡和完成任务是独立持久状态；偏好参数有校验',()=>{let s=base();s=apply(s,{type:'settings',pet:{bubbles:false,duration:12}});assert.equal(s.settings.pet?.bubbles,false);assert.equal(s.reminders.filter(r=>r.status==='scheduled').length,base().reminders.length);assert.throws(()=>apply(s,{type:'settings',pet:{duration:0}}));});
test('0.2.10 状态覆盖上课、课间、结束、无课、未开始、调课与停课',()=>{
  const s=base();
  const during=personStatus(s,epoch('2027-02-23T10:00'),'partner');
  assert.equal(during.code,'BUSY_CLASS');assert.equal(statusLabel(during),'上课中');
  const between=personStatus(s,epoch('2027-02-23T10:40'),'partner');
  assert.equal(between.current.kind,'idle');assert.equal(between.code,'FREE');assert.equal(between.nextCourse?.title,'Language Lab');
  const finished=personStatus(s,epoch('2027-02-23T18:00'),'partner');
  assert.equal(finished.code,'DAY_FINISHED');assert.equal(statusLabel(finished),'今日课程已结束');assert.equal(finished.todayCount,4);
  const weekend=personStatus(s,epoch('2027-02-28T10:00'),'partner');
  assert.equal(weekend.code,'NO_CLASS_TODAY');assert.equal(statusLabel(weekend),'今天无课');
  // 未录入课表时："空闲"才显示「尚未录入课表」；落在作息里时如实显示作息状态。
  const emptyState=togetherWorkspace(epoch('2027-02-21T00:00'));
  assert.equal(statusLabel(personStatus(emptyState,epoch('2027-02-21T10:00'),'partner')),'尚未录入课表');
  assert.equal(statusLabel(personStatus(emptyState,epoch('2027-02-21T00:00'),'partner')),'睡觉中','默认作息里 00:00 是睡觉时段');
  const beforeTerm=personStatus(s,epoch('2027-02-21T10:00'),'partner');
  assert.equal(beforeTerm.code,'TERM_NOT_STARTED');assert.equal(statusLabel(beforeTerm),'课表尚未开始');

  const course=s.courses.find(c=>c.person==='partner'&&c.weekday===2&&c.first===3)!;
  const moved=apply(s,{type:'save',entity:'exceptions',value:{id:'move',courseId:course.id,date:'2027-02-23',cancelled:false,start:'2027-02-24T23:50',end:'2027-02-25T00:20'}},epoch('2027-02-22T00:00'));
  assert.equal(personStatus(moved,epoch('2027-02-23T10:00'),'partner').code,'FREE');
  assert.equal(personStatus(moved,epoch('2027-02-25T00:00'),'partner').code,'BUSY_CLASS');
  const cancelled=apply(s,{type:'save',entity:'exceptions',value:{id:'cancel',courseId:course.id,date:'2027-02-23',cancelled:true}},epoch('2027-02-22T00:00'));
  assert.notEqual(personStatus(cancelled,epoch('2027-02-23T10:00'),'partner').code,'BUSY_CLASS');
  assert.equal(occurrences(cancelled,epoch('2027-02-23'),epoch('2027-02-24'),'partner',{includeCancelled:true}).find(o=>o.courseId===course.id)?.cancelled,true);
});
