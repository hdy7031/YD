// v0.3 Phase 3A：统一人物状态引擎（Person State Engine）。
//
// 覆盖：idle / class / research / meeting、七种 Routine kind、优先级
// （Schedule > Routine > Idle）、下课瞬间恢复作息、DailyException 的停课与调课、
// Solo 与 Together、自定义作息 label、冲突标记、纯函数性，以及"引擎语义与现有
// personStatus 在 Schedule 场景一致"的安全绳（消费者迁移留 Phase 3B）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, epoch, initial, occurrences } from '../src/core.ts';
import { personStatus } from '../src/live.ts';
import { getCurrentState, getWorkspaceCurrentStates, STATE_SOURCE_PRIORITY } from '../src/state/engine.ts';
import { emptyRoutine, routineKindPriority, type RoutineProfile, type RoutineRule } from '../src/routine.ts';
import type { Course, Event, PersonId, Profile, ProfileRole, State } from '../src/types.ts';
import { syntheticState } from './fixtures/synthetic.ts';

const at = (text: string) => epoch(text);
// 2027-03-01 是周一，与合成学期锚点一致；第 4 节固定为 11:40–12:30，
// 用来复现 Phase 3A 验收里"午饭与上课重叠"的例子。
const MONDAY = '2027-03-01';
const periods = [
  { start: '08:00', end: '08:45' },
  { start: '08:55', end: '09:40' },
  { start: '10:00', end: '10:45' },
  { start: '11:40', end: '12:30' },
  { start: '14:00', end: '14:45' },
];

const rule = (over: Partial<RoutineRule> & { id: string }): RoutineRule => {
  const kind = over.kind ?? 'custom';
  return {
    kind, label: '自定义', start: '09:00', end: '10:00',
    days: [1, 2, 3, 4, 5, 6, 7], enabled: true, priority: routineKindPriority[kind], ...over,
  };
};
const routineOf = (...rules: RoutineRule[]): RoutineProfile => ({ source: 'user', updatedAt: 0, rules });
const person = (id: PersonId, role: ProfileRole, name = id, routine: RoutineProfile = emptyRoutine(0)): Profile =>
  ({ id, role, name, routine, startDate: MONDAY, weeks: 16, periods, updatedAt: 0 });
const workspace = (profiles: Profile[]): State => {
  const state = initial(at(`${MONDAY}T00:00`));
  state.profiles = profiles;
  return state;
};
const save = (state: State, entity: 'courses' | 'events', value: unknown): State => apply(state, { type: 'save', entity, value }, 0);
const course = (id: string, owner: PersonId, over: Partial<Course> = {}): Course =>
  ({ id, person: owner, title: 'Computer Vision', place: 'Building A 301', notes: '', weekday: 1, first: 4, last: 4, weeks: [1], reminders: [10], checklist: [], activity: 'teaching', updatedAt: 0, ...over });
const event = (id: string, owner: PersonId, over: Partial<Event> = {}): Event =>
  ({ id, person: owner, title: 'Project Review', start: `${MONDAY}T10:00`, end: `${MONDAY}T11:00`, place: 'Room 101', notes: '', reminders: [30], checklist: [], updatedAt: 0, ...over });

test('Idle：没有安排与作息时返回稳定空闲状态，而不是 null', () => {
  const state = workspace([person('alex', 'self', 'Alex')]);
  assert.deepEqual(getCurrentState(state, 'alex', at(`${MONDAY}T15:00`)), {
    personId: 'alex', kind: 'idle', label: '空闲', source: 'idle',
    startAt: at(`${MONDAY}T00:00`), priority: STATE_SOURCE_PRIORITY.idle,
  });
  // 优先级表固定：Manual 为 Phase 3C 预留，本阶段不会产生。
  assert.deepEqual(STATE_SOURCE_PRIORITY, { manual: 100, schedule: 80, routine: 40, idle: 10 });
});

test('Idle 的 startAt 锚在上一次结束时刻，不随查询时间漂移', () => {
  const routine = routineOf(rule({ id: 'lunch', kind: 'meal', label: '午饭', start: '11:30', end: '12:00' }));
  const state = workspace([person('alex', 'self', 'Alex', routine)]);
  const first = getCurrentState(state, 'alex', at(`${MONDAY}T13:00`));
  const later = getCurrentState(state, 'alex', at(`${MONDAY}T15:30`));
  assert.equal(first.startAt, at(`${MONDAY}T12:00`));
  assert.equal(later.startAt, at(`${MONDAY}T12:00`), '空闲开始时刻是稳定的，不是 now');
  assert.equal(first.endAt, undefined, '没有下一条安排时空闲没有结束时刻');
});

test('Schedule：课程期间是 class，区间左闭右开，语义字段齐全', () => {
  const state = save(workspace([person('alex', 'self', 'Alex')]), 'courses', course('c-cv', 'alex'));
  const current = getCurrentState(state, 'alex', at(`${MONDAY}T11:45`));
  assert.equal(current.kind, 'class');
  assert.equal(current.source, 'schedule');
  assert.equal(current.label, 'Computer Vision', 'label 是事项标题，不带人物称呼');
  assert.equal(current.priority, STATE_SOURCE_PRIORITY.schedule);
  assert.equal(current.sourceId, `c:c-cv:${MONDAY}`);
  assert.equal(current.startAt, at(`${MONDAY}T11:40`));
  assert.equal(current.endAt, at(`${MONDAY}T12:30`));
  assert.deepEqual(current.meta, { title: 'Computer Vision', scheduleKind: 'course', place: 'Building A 301', activity: 'teaching' });
  // 左闭右开：11:39:59.999 还没上课，12:30:00 整已经下课。
  assert.equal(getCurrentState(state, 'alex', at(`${MONDAY}T11:40`) - 1).kind, 'idle');
  assert.equal(getCurrentState(state, 'alex', at(`${MONDAY}T12:30`)).kind, 'idle');
});

test('Research：activity=research 的课程是教研，不是上课', () => {
  const state = save(workspace([person('alex', 'self', 'Alex')]), 'courses', course('c-seminar', 'alex', { title: 'Research Seminar', activity: 'research' }));
  const current = getCurrentState(state, 'alex', at(`${MONDAY}T11:45`));
  assert.equal(current.kind, 'research');
  assert.equal(current.meta?.activity, 'research');
  assert.equal(current.label, 'Research Seminar');
});

test('Event：会议 / 活动期间是 meeting（source=schedule）', () => {
  const state = save(workspace([person('alex', 'self', 'Alex')]), 'events', event('e-review', 'alex'));
  const current = getCurrentState(state, 'alex', at(`${MONDAY}T10:30`));
  assert.equal(current.kind, 'meeting');
  assert.equal(current.source, 'schedule');
  assert.equal(current.label, 'Project Review');
  assert.equal(current.meta?.scheduleKind, 'event');
  assert.equal(current.startAt, at(`${MONDAY}T10:00`));
  assert.equal(current.endAt, at(`${MONDAY}T11:00`));
  assert.equal(getCurrentState(state, 'alex', at(`${MONDAY}T11:00`)).kind, 'idle', '结束时刻不再是会议');
});

test('Routine：七种 kind 都是真实 Person State，label 来自规则', () => {
  const routine = routineOf(
    rule({ id: 'night', kind: 'sleep', label: '夜间睡觉', start: '23:30', end: '07:30' }),
    rule({ id: 'wake', kind: 'wake', label: '起床', start: '07:30', end: '07:50' }),
    rule({ id: 'commute', kind: 'commute', label: '通勤', start: '07:50', end: '08:10' }),
    rule({ id: 'focus', kind: 'focus', label: '写论文', start: '08:10', end: '10:00' }),
    rule({ id: 'lunch', kind: 'meal', label: '午饭', start: '11:30', end: '12:00' }),
    rule({ id: 'nap', kind: 'nap', label: '午睡', start: '12:30', end: '14:00' }),
    rule({ id: 'reading', kind: 'custom', label: '阅读', start: '15:00', end: '16:00' }),
  );
  const state = workspace([person('alex', 'self', 'Alex', routine)]);
  const expectations: [string, string, string][] = [
    [`${MONDAY}T07:35`, 'wake', '起床'],
    [`${MONDAY}T08:00`, 'commute', '通勤'],
    [`${MONDAY}T09:00`, 'focus', '写论文'],
    [`${MONDAY}T11:45`, 'meal', '午饭'],
    [`${MONDAY}T13:00`, 'nap', '午睡'],
    [`${MONDAY}T15:30`, 'custom', '阅读'],
    ['2027-03-02T02:00', 'sleep', '夜间睡觉'],
    [`${MONDAY}T22:00`, 'idle', '空闲'],
  ];
  for (const [time, kind, label] of expectations) {
    const current = getCurrentState(state, 'alex', at(time));
    assert.equal(current.kind, kind, time);
    assert.equal(current.label, label, time);
    assert.equal(current.source, kind === 'idle' ? 'idle' : 'routine', time);
    assert.equal(current.priority, kind === 'idle' ? STATE_SOURCE_PRIORITY.idle : STATE_SOURCE_PRIORITY.routine, time);
  }
  const focus = getCurrentState(state, 'alex', at(`${MONDAY}T09:00`));
  assert.equal(focus.sourceId, 'focus');
  assert.equal(focus.meta?.routineKind, 'focus');
  assert.equal(focus.startAt, at(`${MONDAY}T08:10`));
  assert.equal(focus.endAt, at(`${MONDAY}T10:00`));
  // 自定义（custom）即使没有专属桌宠动作，仍然是真实的 Person State。
  const custom = getCurrentState(state, 'alex', at(`${MONDAY}T15:30`));
  assert.equal(custom.meta?.routineKind, 'custom');
  assert.equal(custom.endAt, at(`${MONDAY}T16:00`));
});

test('优先级：Schedule 覆盖 Routine，下课瞬间立刻回到 Routine（Phase 3A 验收例）', () => {
  let state = workspace([person('alex', 'self', 'Alex', routineOf(rule({ id: 'lunch', kind: 'meal', label: '午饭', start: '11:30', end: '13:00' })))]);
  state = save(state, 'courses', course('c-cv', 'alex')); // 11:40–12:30
  const kindAt = (time: string) => getCurrentState(state, 'alex', at(`${MONDAY}T${time}`));
  assert.deepEqual([kindAt('11:35').kind, kindAt('11:35').source], ['meal', 'routine']);
  assert.deepEqual([kindAt('11:45').kind, kindAt('11:45').source], ['class', 'schedule']);
  assert.deepEqual([kindAt('12:29').kind, kindAt('12:29').source], ['class', 'schedule']);
  assert.deepEqual([kindAt('12:30').kind, kindAt('12:30').source], ['meal', 'routine']);
  assert.deepEqual([kindAt('13:00').kind, kindAt('13:00').source], ['idle', 'idle']);
});

test('优先级同样适用于跨午夜：夜间事项压过睡眠，事项结束立即回到睡眠', () => {
  const routine = routineOf(rule({ id: 'night', kind: 'sleep', label: '夜间睡觉', start: '23:30', end: '07:30' }));
  const state = save(workspace([person('alex', 'self', 'Alex', routine)]), 'events', event('e-late', 'alex', { start: `${MONDAY}T23:50`, end: '2027-03-02T00:30' }));
  assert.equal(getCurrentState(state, 'alex', at(`${MONDAY}T23:40`)).kind, 'sleep');
  assert.equal(getCurrentState(state, 'alex', at('2027-03-02T00:10')).kind, 'meeting');
  assert.equal(getCurrentState(state, 'alex', at('2027-03-02T00:30')).kind, 'sleep');
  assert.equal(getCurrentState(state, 'alex', at('2027-03-02T07:30')).kind, 'idle');
});

test('刚下课不是 Person State：课程结束后没有作息就是 idle', () => {
  const state = save(workspace([person('alex', 'self', 'Alex')]), 'courses', course('c-cv', 'alex'));
  for (const time of ['12:30', '12:45', '18:00']) {
    const current = getCurrentState(state, 'alex', at(`${MONDAY}T${time}`));
    assert.equal(current.kind, 'idle', time);
    assert.equal(current.source, 'idle', time);
  }
});

test('DailyException 是课程模板的修饰层：停课不产生 class，调课只在新时间产生', () => {
  const state = save(workspace([person('alex', 'self', 'Alex')]), 'courses', course('c-cv', 'alex'));
  const cancelled = apply(state, { type: 'save', entity: 'exceptions', value: { id: 'x-cancel', courseId: 'c-cv', date: MONDAY, cancelled: true } }, 0);
  assert.equal(getCurrentState(cancelled, 'alex', at(`${MONDAY}T11:45`)).kind, 'idle');

  const moved = apply(state, { type: 'save', entity: 'exceptions', value: { id: 'x-move', courseId: 'c-cv', date: MONDAY, cancelled: false, start: `${MONDAY}T18:00`, end: `${MONDAY}T19:00`, place: 'Lab 204' } }, 0);
  assert.equal(getCurrentState(moved, 'alex', at(`${MONDAY}T11:45`)).kind, 'idle', '原时间不再产生状态');
  const current = getCurrentState(moved, 'alex', at(`${MONDAY}T18:30`));
  assert.equal(current.kind, 'class');
  assert.equal(current.startAt, at(`${MONDAY}T18:00`));
  assert.equal(current.endAt, at(`${MONDAY}T19:00`));
  assert.equal(current.meta?.place, 'Lab 204', '调课地点来自 Exception 修饰层');
  assert.equal(moved.courses[0].place, 'Building A 301', '课程模板不被改写');
});

test('Solo：1 个档案的引擎照常工作，工作区投影恰好一条', () => {
  const state = save(workspace([person('alex', 'self', 'Alex')]), 'courses', course('c-cv', 'alex'));
  const states = getWorkspaceCurrentStates(state, at(`${MONDAY}T11:45`));
  assert.equal(states.length, 1);
  assert.deepEqual(states.map(item => [item.personId, item.kind]), [['alex', 'class']]);
  // 不存在的档案明确失败，而不是伪造第二个人的状态。
  assert.throws(() => getCurrentState(state, 'ghost', at(`${MONDAY}T11:45`)), /档案不存在/);
  // v3 及更早的数据可能还没有 routine：缺省按"没有作息"处理，不抛错。
  const legacy = structuredClone(state);
  delete legacy.profiles[0].routine;
  assert.equal(getCurrentState(legacy, 'alex', at(`${MONDAY}T12:45`)).kind, 'idle');
});

test('Together：双方各自得到自己的状态，身份不来自数组位置', () => {
  let state = workspace([person('sam', 'companion', 'Sam'), person('alex', 'self', 'Alex')]);
  state = save(state, 'courses', course('c-cv', 'alex'));
  state = save(state, 'events', event('e-review', 'sam'));
  const states = getWorkspaceCurrentStates(state, at(`${MONDAY}T10:30`));
  assert.deepEqual(states.map(item => [item.personId, item.kind]), [['sam', 'meeting'], ['alex', 'idle']], '顺序取 profiles 显示顺序');
  assert.equal(getCurrentState(state, 'alex', at(`${MONDAY}T11:45`)).kind, 'class');
  assert.equal(getCurrentState(state, 'sam', at(`${MONDAY}T11:45`)).kind, 'idle');
});

test('冲突：同刻两条日程选出主状态并记录 meta.conflict，与 personStatus.conflict 一致', () => {
  let state = save(workspace([person('alex', 'self', 'Alex')]), 'courses', course('c-cv', 'alex'));
  state = save(state, 'events', event('e-review', 'alex', { start: `${MONDAY}T11:50`, end: `${MONDAY}T12:10` }));
  const now = at(`${MONDAY}T11:55`);
  const current = getCurrentState(state, 'alex', now);
  assert.equal(current.kind, 'class', '课程压过会议，与 BUSY_CLASS > BUSY_EVENT 的既有语义一致');
  assert.equal(current.meta?.conflict, true);
  assert.equal(personStatus(state, now, 'alex').conflict, true);
  assert.equal(getCurrentState(state, 'alex', at(`${MONDAY}T12:20`)).kind, 'class', '会议结束后不再有冲突标记');
  assert.equal(getCurrentState(state, 'alex', at(`${MONDAY}T12:20`)).meta?.conflict, undefined);
});

test('停用的作息规则不产生状态（disable 与 delete 语义不同）', () => {
  const off = workspace([person('alex', 'self', 'Alex', routineOf(rule({ id: 'nap', kind: 'nap', label: '午睡', start: '12:30', end: '14:00', enabled: false })))]);
  assert.equal(getCurrentState(off, 'alex', at(`${MONDAY}T13:00`)).kind, 'idle');
  const on = workspace([person('alex', 'self', 'Alex', routineOf(rule({ id: 'nap', kind: 'nap', label: '午睡', start: '12:30', end: '14:00' })))]);
  assert.equal(getCurrentState(on, 'alex', at(`${MONDAY}T13:00`)).kind, 'nap');
});

test('纯函数：不修改 State，也不依赖调用顺序', () => {
  let state = workspace([person('alex', 'self', 'Alex', routineOf(rule({ id: 'lunch', kind: 'meal', label: '午饭', start: '11:30', end: '12:00' })))]);
  state = save(state, 'courses', course('c-cv', 'alex'));
  const before = structuredClone(state);
  const first = getWorkspaceCurrentStates(state, at(`${MONDAY}T11:45`));
  const single = getCurrentState(state, 'alex', at(`${MONDAY}T11:45`));
  const second = getWorkspaceCurrentStates(state, at(`${MONDAY}T11:45`));
  assert.deepEqual(first, second);
  assert.deepEqual(single, first[0]);
  assert.deepEqual(state, before);
});

test('Together 回归：personStatus.current 就是 StateEngine 的结果（单一真相）', () => {
  const state = syntheticState(at('2027-02-22T00:00'));
  const now = at('2027-02-23T10:00');
  const status = personStatus(state, now, 'partner');
  const current = getCurrentState(state, 'partner', now);
  assert.deepEqual(status.current, current, '状态投影必须与引擎逐字段一致');
  assert.equal(status.code, 'BUSY_CLASS', '日程阶段码由状态派生');
  assert.equal(current.kind, 'class');
  assert.equal(current.source, 'schedule');
  const ongoing = occurrences(state, now, now + 1, 'partner')[0];
  assert.equal(current.label, ongoing.title);
  assert.equal(current.startAt, ongoing.start);
  assert.equal(current.endAt, ongoing.end);
  assert.equal(current.tentative, true, '暂定学期透出到状态，交给消费方决定怎么呈现');
  assert.equal(status.routine, null, '10:00 不在默认作息里，作息层为空');
  // 没有日程但落在作息里时，引擎给出真实人物状态——这正是 Phase 3B 的消费起点。
  assert.equal(personStatus(state, at('2027-02-23T12:45'), 'partner').code, 'FREE');
  assert.equal(personStatus(state, at('2027-02-23T12:45'), 'partner').current.kind, 'nap');
  // 作息层是投影字段：它如实记录"作息本来在午睡"，但绝不参与状态判断。
  assert.equal(personStatus(state, at('2027-02-23T12:45'), 'partner').routine?.meta?.routineKind, 'nap');
  assert.equal(getCurrentState(state, 'me', at('2027-02-23T12:45')).kind, 'idle', '本人的空作息不伪造状态');
});

test('领域 kind 只有约定集合：桌宠姿态名永远不会出现在 CurrentState', () => {
  const state = syntheticState(at('2027-02-22T00:00'));
  const domainKinds = new Set(['class', 'research', 'meeting', 'sleep', 'wake', 'meal', 'nap', 'commute', 'focus', 'custom', 'idle']);
  const displayOnly = ['busy_class', 'busy_work', 'night_sleep', 'wake_up', 'eating', 'reminder', 'gentle', 'upcoming', 'relaxed'];
  const sources = new Set(['manual', 'schedule', 'routine', 'idle']);
  for (let minute = 0; minute < 3 * 24 * 60; minute += 5) {
    const now = at('2027-02-22T00:00') + minute * 60000;
    for (const current of getWorkspaceCurrentStates(state, now)) {
      assert.ok(domainKinds.has(current.kind), `${current.kind} @ ${new Date(now + 8 * 3600000).toISOString()}`);
      assert.equal(displayOnly.includes(current.kind), false);
      assert.ok(sources.has(current.source));
      assert.ok(current.label.length > 0);
      assert.ok(current.kind === 'idle' ? current.source === 'idle' : current.source !== 'idle');
      if (current.source === 'schedule') assert.ok(Number.isFinite(current.endAt), '日程状态恒有结束时刻');
      if (current.source === 'routine') assert.ok(Number.isFinite(current.endAt), '作息状态恒有结束时刻');
    }
  }
});
