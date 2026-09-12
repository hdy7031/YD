// v0.3 Phase 3B：跨消费方一致性（Home / Orb / Mini / Tip / Tray / 桌宠）。
//
// 每个表面都只从同一份 CurrentState 得出结论，因此"人物现在在做什么"只有一个答案：
//   * Home / Mini / Tip / Tray 的文案 → live.statusLabel()（presentation.stateLabel）
//   * 桌宠状态条 / mini 短标签        → companion-display.companionRailLabel()（stateShortLabel）
//   * Orb 色点 / 悬停色                → live.presenceStateFor()（presentation.stateTone）
//   * 桌宠姿态                        → currentStateToPetDisplay(CurrentState)
// 表现层叠加（提醒保持、刚结束的轻庆祝）只影响桌宠姿态，绝不改写人物状态。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, epoch, initial } from '../src/core.ts';
import { companionRailLabel, currentStateToPetDisplay, resolvePetState } from '../src/companion-display.ts';
import { personStatus, presenceStateFor, snapshot, statusLabel } from '../src/live.ts';
import { getCurrentState } from '../src/state/engine.ts';
import { emptyRoutine, routineKindPriority, type RoutineProfile, type RoutineRule } from '../src/routine.ts';
import type { Course, PersonId, Profile, ProfileRole, State } from '../src/types.ts';

const at = (text: string) => epoch(text);
const MONDAY = '2027-03-01';
// 第 4 节固定为 11:40–12:30：与 Phase 3B 验收例里的课程时段一致。
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
  ({ id, person: owner, title: 'Computer Vision', place: 'Building A 301', notes: '', weekday: 1, first: 4, last: 4, weeks: [1], reminders: [10], checklist: [], activity: 'teaching', updatedAt: 0, ...over });

// 验收时间线：同行者的作息「11:30–13:00 午饭」与课程「11:40–12:30」重叠。
function timelineState(): State {
  const routine = routineOf(rule({ id: 'lunch', kind: 'meal', label: '午饭', start: '11:30', end: '13:00' }));
  const state = workspace([person('alex', 'self', 'Alex'), person('sam', 'companion', 'Sam', routine)]);
  return apply(state, { type: 'save', entity: 'courses', value: course('c-cv', 'sam') }, 0);
}

test('四个验收时刻：Home / Mini / Tip / Tray 文案、Orb 色点与桌宠姿态同源', () => {
  const s = timelineState();
  // [时刻, 人物状态 kind, 完整文案, 短标签, Orb presence]
  // 13:00 是"空闲"的真实状态；当天最后一门课之后，空闲会补上日程阶段说明「今日课程已结束」。
  const moments = [
    ['11:35', 'meal', '吃饭中', '吃饭', 'idle'],
    ['11:45', 'class', '上课中', '上课', 'busy'],
    ['12:30', 'meal', '吃饭中', '吃饭', 'idle'],
    ['13:00', 'idle', '今日课程已结束', '已下课', 'idle'],
  ] as const;
  for (const [time, kind, label, short, presence] of moments) {
    const now = at(`${MONDAY}T${time}`);
    const status = personStatus(s, now, 'sam');
    assert.equal(status.current.kind, kind, time);
    // Home / Mini / Tip / Tray 共用这一句文案。
    assert.equal(statusLabel(status), label, time);
    // 桌宠状态条（companionRailLabel）与 mini 短标签。
    assert.equal(companionRailLabel(status), short, time);
    // Orb 的色点词汇只由同一 CurrentState 推出。
    assert.equal(presenceStateFor(status), presence, time);
  }
  // 桌宠姿态：11:35 吃饭、11:45 上课、12:30 刚下课的三分钟轻庆祝（表现层装饰）、
  // 12:34 起回到作息里的吃饭、13:00 空闲。
  const pose = (time: string) => snapshot(s, at(`${MONDAY}T${time}`)).display;
  assert.deepEqual([pose('11:35').state, pose('11:35').scheduled], ['eating', 'eating']);
  assert.deepEqual([pose('11:45').state, pose('11:45').scheduled], ['busy_class', 'eating']);
  assert.equal(pose('12:30').state, 'gentle', '刚下课的三分钟是显示层装饰，不是人物状态');
  assert.equal(pose('12:30').scheduled, 'eating', '作息层如实记录"本来是午饭"');
  assert.equal(pose('12:34').state, 'eating');
  assert.equal(pose('13:00').state, 'idle');
  // 12:30 这一刻人物状态仍然是"吃饭"，不会被桌宠的轻庆祝改写。
  assert.equal(statusLabel(personStatus(s, at(`${MONDAY}T12:30`), 'sam')), '吃饭中');
});

test('提醒姿态只影响桌宠：Orb / Mini / Tip / Tray 仍然显示上课中', () => {
  const s = timelineState();
  const now = at(`${MONDAY}T11:45`);
  const withReminder = structuredClone(s);
  // 直接放一条已到时间的提醒（提醒是持久状态，不是人物状态）。
  withReminder.reminders.push({ id: 'r-1', target: 'courses:c-cv', title: '课堂提醒', due: now, status: 'due', createdAt: now, updatedAt: now });
  const live = snapshot(withReminder, now, { reminderSince: now, nudgeId: 1 });
  assert.equal(live.pending, 1);
  assert.equal(live.display.state, 'reminder', '桌宠播放提醒姿态是允许的');
  assert.equal(live.display.base, 'busy_class', '提醒下的真实姿态仍是上课');
  const status = live.people.find(item => item.person === 'sam')!;
  assert.equal(status.current.kind, 'class');
  assert.equal(statusLabel(status), '上课中');
  assert.equal(companionRailLabel(status), '上课');
  assert.equal(presenceStateFor(status), 'busy');
});

test('每个人物的状态都是引擎的同一个结果，桌宠姿态只是它的映射', () => {
  const s = timelineState();
  const now = at(`${MONDAY}T11:45`);
  const live = snapshot(s, now);
  for (const status of live.people) assert.deepEqual(status.current, getCurrentState(s, status.person, now));
  const subject = live.people.find(item => item.person === live.subject)!;
  const resolved = resolvePetState({ people: live.people, subjectId: live.subject, pending: 0, now });
  assert.equal(resolved.base, currentStateToPetDisplay(subject.current));
  assert.equal(resolved.base, 'busy_class');
});

test('Solo：一个人时所有表面照常，没有幽灵同伴', () => {
  const routine = routineOf(rule({ id: 'lunch', kind: 'meal', label: '午饭', start: '11:30', end: '13:00' }));
  const s = workspace([person('alex', 'self', 'Alex', routine)]);
  const now = at(`${MONDAY}T11:45`);
  const live = snapshot(s, now);
  assert.equal(live.people.length, 1);
  assert.equal(live.subject, 'alex');
  assert.equal(statusLabel(live.people[0]), '吃饭中');
  assert.equal(companionRailLabel(live.people[0]), '吃饭');
  assert.equal(live.display.state, 'eating');
  assert.equal(live.display.scheduled, 'eating');
});
