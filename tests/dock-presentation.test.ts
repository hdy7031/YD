// Dock Status Presentation —— 状态语义 / 时间边界 / 相对日期 的回归测试。
//
// 这组测试锁住本次修复的核心不变量：
//   * CurrentState 仍然是"此刻在做什么"的唯一真相（manual > schedule > routine > idle）；
//   * 「今日课程已结束」只能出现在 secondary，不能占着 compact 的主文案；
//   * 状态点只表达此刻状态：课程结束后空闲的人不会保留 busy / 红粉色调；
//   * 「下一项」永远带相对日期（明天 / 后天 / 周X），不再只给裸时间。
//
// 交互层（hover 进出、drag > 4px 不触发 detail、drag cleanup 无残留）由真实
// Electron 验收脚本 verify-v030-dock.cjs 覆盖——那些行为只有在真实窗口 + 真实
// 指针事件下才有意义，合成 DOM 断言证明不了任何东西。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, epoch, initial } from '../src/core.ts';
import { personPresentation, personStatus, presenceStateFor } from '../src/live.ts';
import { relativeDayLabel, nextItemText, statusLight } from '../src/state/presentation.ts';
import { companionTone } from '../src/companion-colors.ts';
import { getCurrentState } from '../src/state/engine.ts';
import { createDefaultRoutine, emptyRoutine, routineKindPriority, type RoutineProfile, type RoutineRule } from '../src/routine.ts';
import type { Course, PersonId, Profile, ProfileRole, State } from '../src/types.ts';

const at = (text: string) => epoch(text);
const MONDAY = '2027-03-01';
// 2027-03-01 是周一：第 4 节 11:40–12:30，课程在第 1 教学周、周一。
const periods = [
  { start: '08:00', end: '08:45' },
  { start: '08:55', end: '09:40' },
  { start: '10:00', end: '10:45' },
  { start: '11:40', end: '12:30' },
];
const rule = (over: Partial<RoutineRule> & { id: string }): RoutineRule => {
  const kind = over.kind ?? 'custom';
  return { kind, label: '自定义', start: '09:00', end: '10:00', days: [1, 2, 3, 4, 5, 6, 7], enabled: true, priority: routineKindPriority[kind], ...over };
};
const routineOf = (...rules: RoutineRule[]): RoutineProfile => ({ source: 'user', updatedAt: 0, rules });
const person = (id: PersonId, role: ProfileRole, name = id, routine: RoutineProfile = emptyRoutine(0)): Profile =>
  ({ id, role, name, routine, startDate: MONDAY, weeks: 16, periods, updatedAt: 0 });
const workspace = (profiles: Profile[]): State => {
  const state = initial(at(`${MONDAY}T00:00`));
  state.profiles = profiles;
  return state;
};
const course = (id: string, owner: PersonId, over: Partial<Course> = {}): Course =>
  ({ id, person: owner, title: '研究生英语', place: '研究生院楼 D10x', notes: '', weekday: 1, first: 4, last: 4, weeks: [1], reminders: [10], checklist: [], activity: 'teaching', updatedAt: 0, ...over });
/** 周二第一节课：用来验证「下一项」跨天会说"明天"。 */
const tuesdayCourse = (id: string, owner: PersonId, over: Partial<Course> = {}): Course =>
  course(id, owner, { title: '研究生英语', weekday: 2, first: 1, last: 1, weeks: [1], ...over });
/** 一天最后一节课 11:40–12:30 的单人工作区（没有作息）。 */
const soloState = (): State => apply(workspace([person('alex', 'self', 'Alex')]), { type: 'save', entity: 'courses', value: course('c-cv', 'alex') }, 0);

test('A：课程进行中 CurrentState = schedule，presentation = 上课中', () => {
  const s = soloState(), now = at(`${MONDAY}T11:45`);
  const current = getCurrentState(s, 'alex', now);
  assert.equal(current.kind, 'class');
  assert.equal(current.source, 'schedule');
  const view = personPresentation(personStatus(s, now, 'alex'));
  assert.equal(view.primaryLabel, '上课中');
  assert.equal(view.tone, 'busy');
  assert.equal(view.dotTone, 'busy');
  assert.equal(view.secondaryLabel, '还有 45 分钟');
});

test('B：课程 end − 1ms 仍然 active，presentation 是上课中', () => {
  const s = soloState(), now = at(`${MONDAY}T12:30`) - 1;
  const status = personStatus(s, now, 'alex');
  assert.equal(status.current.kind, 'class');
  assert.equal(status.current.source, 'schedule');
  assert.equal(status.code, 'BUSY_CLASS');
  assert.equal(personPresentation(status).primaryLabel, '上课中');
  assert.equal(presenceStateFor(status), 'busy');
});

test('C/D：课程 end 与 end + 1ms 都不再 active；最后一节结束后空闲而不是继续 busy', () => {
  const s = soloState(), end = at(`${MONDAY}T12:30`);
  for (const now of [end, end + 1]) {
    const status = personStatus(s, now, 'alex');
    // CurrentState：没有 manual / routine，就直接落到 idle，绝不 force 成别的状态。
    assert.equal(status.current.kind, 'idle', new Date(now).toISOString());
    assert.equal(status.current.source, 'idle');
    assert.equal(status.code, 'DAY_FINISHED');
    const view = personPresentation(status);
    // 「今日课程已结束」只能是上下文，不能是此刻状态。
    assert.equal(view.primaryLabel, '空闲');
    assert.equal(view.secondaryLabel, '今日课程已结束');
    assert.equal(view.tone, 'calm');
    assert.equal(view.dotTone, 'calm');
    assert.equal(companionTone(presenceStateFor(status)), 'calm');
    assert.notEqual(view.dotTone, 'busy');
    assert.notEqual(companionTone(presenceStateFor(status)), 'alert');
  }
});

test('E：课程结束后 manual override busy 仍然优先（manual > schedule > routine > idle）', () => {
  const s = soloState();
  s.manualOverrides = [{ id: 'm-1', personId: 'alex', kind: 'busy', label: '写论文', startAt: at(`${MONDAY}T12:20`), endAt: at(`${MONDAY}T13:00`), createdAt: at(`${MONDAY}T12:20`) }];
  const now = at(`${MONDAY}T12:30`);
  const status = personStatus(s, now, 'alex');
  assert.equal(status.current.kind, 'busy');
  assert.equal(status.current.source, 'manual');
  const view = personPresentation(status);
  assert.equal(view.primaryLabel, '忙碌中');
  assert.equal(view.dotTone, 'busy');
});

test('F：课程结束后命中 routine 时使用 routine，而不是 idle', () => {
  const s = apply(workspace([person('alex', 'self', 'Alex', routineOf(rule({ id: 'lunch', kind: 'meal', label: '午饭', start: '12:30', end: '13:10' })))]), { type: 'save', entity: 'courses', value: course('c-cv', 'alex') }, 0);
  const now = at(`${MONDAY}T12:30`);
  const status = personStatus(s, now, 'alex');
  assert.equal(status.current.kind, 'meal');
  assert.equal(status.current.source, 'routine');
  const view = personPresentation(status);
  assert.equal(view.primaryLabel, '吃饭中');
  assert.equal(view.secondaryLabel, '预计 13:10 结束');
});

test('F2：课程进行中时 manual > schedule 仍然成立（manual 不会被课表抢走）', () => {
  const s = soloState(), now = at(`${MONDAY}T11:50`);
  s.manualOverrides = [{ id: 'm-2', personId: 'alex', kind: 'rest', label: '休息', startAt: at(`${MONDAY}T11:45`), endAt: null, createdAt: at(`${MONDAY}T11:45`) }];
  const status = personStatus(s, now, 'alex');
  assert.equal(status.current.source, 'manual');
  assert.equal(personPresentation(status).primaryLabel, '休息中');
});

test('G：下一项必须给相对日期，不能只有裸时间', () => {
  const now = at(`${MONDAY}T20:00`);
  assert.equal(relativeDayLabel(at(`${MONDAY}T21:00`), now), '今天');
  assert.equal(relativeDayLabel(at('2027-03-02T08:00'), now), '明天');
  assert.equal(relativeDayLabel(at('2027-03-03T08:00'), now), '后天');
  assert.equal(relativeDayLabel(at('2027-03-04T14:30'), now), '周四');
  assert.equal(relativeDayLabel(at('2027-03-09T08:00'), now), '3月9日');
  // 今天的下一项保持简洁（时间已经足够），跨天则必须带出"明天 / 后天 / 周X"。
  assert.equal(nextItemText({ start: at(`${MONDAY}T21:00`), title: '晚自习' }, now), '21:00 · 晚自习');
  assert.equal(nextItemText({ start: at('2027-03-02T08:00'), title: '研究生英语' }, now), '明天 08:00 · 研究生英语');
  // presentation 透出的下一项同样带相对日期。
  const s = apply(workspace([person('alex', 'self', 'Alex')]), { type: 'save', entity: 'courses', value: tuesdayCourse('c-en', 'alex') }, 0);
  const next = personPresentation(personStatus(s, now, 'alex')).nextItem;
  assert.ok(next, '晚上 20:00 应该能看到下一项');
  assert.equal(next.relativeDay, '明天');
  assert.equal(next.time, '08:00');
  assert.match(next.text, /^明天 08:00 · 研究生英语$/);
  // 首页窄位置只放时间也仍然带着"明天"这个关键信息。
  assert.match(next.text.slice(0, next.text.indexOf('08:00')), /明天/);
});

test('H：Solo 工作区不依赖 companion，presentation 照常给出结论', () => {
  const s = apply(soloState(), { type: 'save', entity: 'courses', value: tuesdayCourse('c-en', 'alex') }, 0), now = at(`${MONDAY}T20:00`);
  const live = personStatus(s, now, 'alex');
  assert.equal(live.role, 'self');
  const view = personPresentation(live);
  assert.equal(view.primaryLabel, '空闲');
  assert.equal(view.secondaryLabel, '今日课程已结束');
  assert.equal(view.nextItem?.relativeDay, '明天');
});

test('I/J：Together 两个人各自独立，双方课程都结束后都不会保留 busy 色调', () => {
  const alex = person('alex', 'self', 'Alex');
  const sam = person('sam', 'companion', 'Sam');
  const s = workspace([alex, sam]);
  const withCourses = apply(apply(s, { type: 'save', entity: 'courses', value: course('c-alex', 'alex') }, 0), { type: 'save', entity: 'courses', value: course('c-sam', 'sam', { title: '高二（105）语文' }) }, 0);
  // 上午：Alex 上课（第 4 节），Sam 也在上自己的课。
  const morning = personStatus(withCourses, at(`${MONDAY}T11:45`), 'sam');
  assert.equal(morning.current.kind, 'class');
  assert.equal(personPresentation(morning).primaryLabel, '上课中');
  // 晚上：两个人的当天课程都已结束 → 两边都是空闲 + calm，没有任何一边保留 busy。
  const evening = at(`${MONDAY}T21:00`);
  for (const id of ['alex', 'sam'] as PersonId[]) {
    const status = personStatus(withCourses, evening, id);
    const view = personPresentation(status);
    assert.equal(status.current.kind, 'idle', id);
    assert.equal(view.primaryLabel, '空闲', id);
    assert.equal(view.dotTone, 'calm', id);
    assert.notEqual(view.dotTone, 'busy', id);
  }
});

test('统一投影：Dock / 首页 / 详情用同一份结论（不出现第二套状态文案）', () => {
  const s = soloState();
  for (const time of ['11:45', '12:30', '21:00']) {
    const now = at(`${MONDAY}T${time}`), status = personStatus(s, now, 'alex');
    const view = personPresentation(status);
    // primaryLabel 永远来自 CurrentState；空闲时它就是「空闲」。
    assert.equal(view.primaryLabel, status.current.kind === 'idle' ? '空闲' : view.primaryLabel, time);
    // secondary 永远不会把日程阶段说成"此刻状态"。
    assert.notEqual(view.secondaryLabel, '上课中', time);
    // 投影是纯函数：同一份输入永远得到同一个结论。
    assert.deepEqual(personPresentation(status), view, time);
  }
});

// ---------------------------------------------------------------------------
// 指示灯：绿 = 空闲，红 = 忙碌（上课），灰 = 下线（睡眠）
// ---------------------------------------------------------------------------
test('指示灯只有三态：空闲绿 / 忙碌红 / 睡眠灰，并且三处消费方完全一致', () => {
  const s = soloState(), monday = (time: string) => at(`${MONDAY}T${time}`);
  // 空闲（含"今日课程已结束"）→ 绿。
  const evening = personStatus(s, monday('21:00'), 'alex');
  assert.equal(statusLight(evening.current), 'available');
  assert.equal(personPresentation(evening).dotTone, 'calm');
  assert.equal(companionTone(presenceStateFor(evening)), 'calm');
  assert.equal(presenceStateFor(evening), 'idle');
  // 上课 → 红。
  const inClass = personStatus(s, monday('11:45'), 'alex');
  assert.equal(statusLight(inClass.current), 'busy');
  assert.equal(personPresentation(inClass).dotTone, 'busy');
  assert.equal(companionTone(presenceStateFor(inClass)), 'busy');
  assert.equal(presenceStateFor(inClass), 'busy');
  // 三态互不相同：空闲不会是红，忙碌不会是绿，睡眠不会是红。
  assert.notEqual(personPresentation(evening).dotTone, personPresentation(inClass).dotTone);
  assert.notEqual(presenceStateFor(evening), 'busy');
  assert.notEqual(presenceStateFor(inClass), 'idle');
});

test('休眠灰灯跟随每个人的作息（可自定义），默认模板是 23:30–次日 07:30', () => {
  // 默认模板：与桌宠夜间睡眠用的是同一条 Routine sleep 规则。
  const template = createDefaultRoutine(at(`${MONDAY}T00:00`)).rules.find(rule => rule.kind === 'sleep')!;
  assert.equal(template.start, '23:30');
  assert.equal(template.end, '07:30');
  // 用户把它改成 22:00–06:00 之后，灰灯就按新窗口生效（不是写死的钟点）。
  const routine = routineOf(rule({ id: 'night', kind: 'sleep', label: '夜间睡觉', start: '22:00', end: '06:00' }));
  const s = apply(workspace([person('alex', 'self', 'Alex', routine)]), { type: 'save', entity: 'courses', value: course('c-cv', 'alex') }, 0);
  const at22 = personStatus(s, at(`${MONDAY}T22:30`), 'alex');
  assert.equal(at22.current.kind, 'sleep');
  assert.equal(at22.current.source, 'routine');
  assert.equal(statusLight(at22.current), 'offline');
  assert.equal(personPresentation(at22).dotTone, 'neutral');
  assert.equal(companionTone(presenceStateFor(at22)), 'neutral');
  assert.equal(personPresentation(at22).primaryLabel, '睡觉中');
  // 同一份数据：白天是空闲（绿），不是灰。
  const daytime = personStatus(s, at(`${MONDAY}T21:00`), 'alex');
  assert.equal(statusLight(daytime.current), 'available');
  // 跨午夜：次日 05:00 仍然在"下线"，07:00 已经回到空闲。
  assert.equal(statusLight(personStatus(s, at('2027-03-02T05:00'), 'alex').current), 'offline');
  assert.equal(statusLight(personStatus(s, at('2027-03-02T07:00'), 'alex').current), 'available');
});

test('没有作息时不会有灰灯：默认不睡觉的人只有空闲（绿）与忙碌（红）', () => {
  const s = soloState(); // 本人档案默认是空作息
  assert.equal(s.profiles[0].routine?.rules.length, 0);
  for (const time of ['07:00', '12:00', '23:45']) {
    const light = statusLight(personStatus(s, at(`${MONDAY}T${time}`), 'alex').current);
    assert.notEqual(light, 'offline', time);
  }
});
