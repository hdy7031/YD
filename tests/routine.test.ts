// v0.3 Phase 2A：Routine 领域模型与纯计算引擎。
//
// 覆盖：左闭右开的时间边界、跨午夜与跨周、days 过滤、停用规则、重叠裁决、
// 空作息、nextRoutineBoundary、非法输入校验，以及"legacy 默认作息与 0.2.x 桌宠
// 写死时间表逐分钟等价"——后者是 Phase 2B 切换消费方时的安全绳。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, epoch, initial, validateState } from '../src/core.ts';
import { routineKindToPetState, type ScheduledPetState } from '../src/companion-display.ts';
import {
  activeRoutine, assertRoutineProfile, assertRoutineRule, emptyRoutine, legacyDefaultRoutine,
  nextRoutineBoundary, routineKindPriority, routineOccurrences,
  type RoutineKind, type RoutineProfile, type RoutineRule,
} from '../src/routine.ts';
import { syntheticSchedule, syntheticState } from './fixtures/synthetic.ts';

const at = (text: string) => epoch(text);
const pad = (value: number) => String(value).padStart(2, '0');

// 2027-03-01 是周一，与合成学期锚点一致。
const MONDAY = '2027-03-01';
const rule = (over: Partial<RoutineRule> & { id: string }): RoutineRule => {
  const kind = over.kind ?? 'custom';
  return {
    kind, label: '自定义', start: '09:00', end: '10:00',
    days: [1, 2, 3, 4, 5, 6, 7], enabled: true, priority: routineKindPriority[kind], ...over,
  };
};
const routineOf = (...rules: RoutineRule[]): RoutineProfile => ({ source: 'user', updatedAt: 0, rules });
const activeId = (routine: RoutineProfile | undefined, now: number) => activeRoutine(routine, now)?.ruleId ?? null;

test('时间语义：左闭右开 [start, end)，11:30–12:00 的四个边界', () => {
  const lunch = routineOf(rule({ id: 'lunch', kind: 'meal', label: '午饭', start: '11:30', end: '12:00', priority: routineKindPriority.meal }));
  assert.equal(activeId(lunch, at(`${MONDAY}T11:29`)), null);
  assert.equal(activeId(lunch, at(`${MONDAY}T11:30`)), 'lunch');
  assert.equal(activeId(lunch, at(`${MONDAY}T11:59`)), 'lunch');
  assert.equal(activeId(lunch, at(`${MONDAY}T12:00`)), null, '12:00 整必须不命中');
  // 午休空档不是规则：不命中任何规则时返回 null，而不是"上一条延续"。
  assert.equal(activeRoutine(lunch, at(`${MONDAY}T12:30`)), null);
});

test('跨午夜：一条 23:30–07:30 的规则整夜有效，且不拆成两条', () => {
  const sleep = routineOf(rule({ id: 'night', kind: 'sleep', label: '夜间睡觉', start: '23:30', end: '07:30', priority: routineKindPriority.sleep }));
  const expectations: [string, boolean][] = [
    [`${MONDAY}T23:29`, false],
    [`${MONDAY}T23:30`, true],
    [`${MONDAY}T23:59`, true],
    [`2027-03-02T00:00`, true],
    [`2027-03-02T07:29`, true],
    [`2027-03-02T07:30`, false],
    [`${MONDAY}T12:00`, false],
  ];
  for (const [time, hit] of expectations) assert.equal(activeId(sleep, at(time)) === 'night', hit, time);
  // 库里始终是一条规则，只有计算层把它当成跨午夜的 occurrence。
  assert.equal(sleep.rules.length, 1);
  const occurrences = routineOccurrences(sleep, at(`${MONDAY}T12:00`), at('2027-03-03'));
  assert.equal(occurrences.length, 2, '每天只产出一条"从当天晚上开始"的睡眠区间');
  assert.equal(occurrences[0].startAt, at(`${MONDAY}T23:30`));
  assert.equal(occurrences[0].endAt, at(`2027-03-02T07:30`));
});

test('跨周：周日 23:30 的睡眠延续到周一早晨（days 指规则开始的那一天）', () => {
  const sundaySleep = routineOf(rule({ id: 'sun-night', kind: 'sleep', start: '23:30', end: '07:30', days: [7], priority: routineKindPriority.sleep }));
  assert.equal(activeId(sundaySleep, at('2027-03-07T23:30')), 'sun-night', '周日 23:30 开始');
  assert.equal(activeId(sundaySleep, at('2027-03-08T01:00')), 'sun-night', '周一凌晨仍属于周日开始的那一晚');
  assert.equal(activeId(sundaySleep, at('2027-03-08T07:29')), 'sun-night');
  assert.equal(activeId(sundaySleep, at('2027-03-08T07:30')), null);
  assert.equal(activeId(sundaySleep, at('2027-03-08T23:30')), null, '周一晚上不属于周日规则');
  // 反向：周一 23:30 开始的规则在周二凌晨生效，周一凌晨不生效。
  const mondaySleep = routineOf(rule({ id: 'mon-night', kind: 'sleep', start: '23:30', end: '07:30', days: [1], priority: routineKindPriority.sleep }));
  assert.equal(activeId(mondaySleep, at('2027-03-01T01:00')), null);
  assert.equal(activeId(mondaySleep, at('2027-03-02T01:00')), 'mon-night');
});

test('days 过滤：只启用周一至周五的规则，周末不命中', () => {
  const workdayLunch = routineOf(rule({ id: 'workday-lunch', kind: 'meal', start: '11:30', end: '12:00', days: [1, 2, 3, 4, 5] }));
  assert.equal(activeId(workdayLunch, at('2027-03-01T11:40')), 'workday-lunch', '周一');
  assert.equal(activeId(workdayLunch, at('2027-03-05T11:40')), 'workday-lunch', '周五');
  assert.equal(activeId(workdayLunch, at('2027-03-06T11:40')), null, '周六');
  assert.equal(activeId(workdayLunch, at('2027-03-07T11:40')), null, '周日');
  // days 的顺序不影响结果。
  const unsorted = routineOf(rule({ id: 'unsorted', start: '11:30', end: '12:00', days: [5, 1, 3] }));
  assert.equal(activeId(unsorted, at('2027-03-03T11:40')), 'unsorted', '周三');
  assert.equal(activeId(unsorted, at('2027-03-02T11:40')), null, '周二不在 days 里');
});

test('enabled=false 的规则既不命中也不产生边界', () => {
  const disabled = routineOf(rule({ id: 'off', start: '11:30', end: '12:00', enabled: false }));
  assert.equal(activeRoutine(disabled, at(`${MONDAY}T11:40`)), null);
  assert.equal(nextRoutineBoundary(disabled, at(`${MONDAY}T00:00`)), null);
  assert.deepEqual(routineOccurrences(disabled, at(MONDAY), at('2027-03-02')), []);
});

test('重叠裁决：优先级大者胜，与数组顺序无关；同级按"更晚开始 → 更小编号"', () => {
  const low = rule({ id: 'low', label: '低优先', start: '12:00', end: '13:00', priority: 10 });
  const high = rule({ id: 'high', label: '高优先', start: '12:30', end: '12:45', priority: 30 });
  assert.equal(activeId(routineOf(low, high), at(`${MONDAY}T12:40`)), 'high');
  assert.equal(activeId(routineOf(low, high), at(`${MONDAY}T12:10`)), 'low');
  assert.equal(activeId(routineOf(high, low), at(`${MONDAY}T12:40`)), 'high', '结果与数组顺序无关');

  const early = rule({ id: 'early', start: '12:00', end: '13:00', priority: 20 });
  const late = rule({ id: 'late', start: '12:30', end: '12:45', priority: 20 });
  assert.equal(activeId(routineOf(early, late), at(`${MONDAY}T12:40`)), 'late', '同优先级：更晚开始的更贴近当前活动');
  assert.equal(activeId(routineOf(early, late), at(`${MONDAY}T12:10`)), 'early');

  const alpha = rule({ id: 'alpha', start: '12:00', end: '13:00', priority: 20 });
  const beta = rule({ id: 'beta', start: '12:00', end: '13:00', priority: 20 });
  assert.equal(activeId(routineOf(beta, alpha), at(`${MONDAY}T12:10`)), 'alpha', '同一时刻开始：编号小者胜');
});

test('空作息：没有规则时一切查询都返回 null / 空集，不抛错', () => {
  const empty = emptyRoutine(7);
  assert.deepEqual(empty, { source: 'user', updatedAt: 7, rules: [] });
  assert.equal(activeRoutine(empty, at(`${MONDAY}T11:40`)), null);
  assert.equal(activeRoutine(undefined, at(`${MONDAY}T11:40`)), null);
  assert.equal(nextRoutineBoundary(empty, at(`${MONDAY}T11:40`)), null);
  assert.equal(nextRoutineBoundary(undefined, at(`${MONDAY}T11:40`)), null);
  assert.deepEqual(routineOccurrences(empty, at(MONDAY), at('2027-03-02')), []);
  assert.deepEqual(routineOccurrences(undefined, at(MONDAY), at('2027-03-02')), []);
});

test('nextRoutineBoundary：返回下一个状态变化点（区间起点或终点），并按周重复', () => {
  const day = routineOf(
    rule({ id: 'lunch', kind: 'meal', start: '11:30', end: '12:00', priority: routineKindPriority.meal }),
    rule({ id: 'nap', kind: 'nap', start: '12:30', end: '14:00', priority: routineKindPriority.nap }),
  );
  assert.equal(nextRoutineBoundary(day, at(`${MONDAY}T10:00`)), at(`${MONDAY}T11:30`));
  assert.equal(nextRoutineBoundary(day, at(`${MONDAY}T11:45`)), at(`${MONDAY}T12:00`));
  assert.equal(nextRoutineBoundary(day, at(`${MONDAY}T12:10`)), at(`${MONDAY}T12:30`));
  assert.equal(nextRoutineBoundary(day, at(`${MONDAY}T20:00`)), at('2027-03-02T11:30'), '第二天重复同一条规则');
  const sleep = routineOf(rule({ id: 'night', kind: 'sleep', start: '23:30', end: '07:30', priority: routineKindPriority.sleep }));
  assert.equal(nextRoutineBoundary(sleep, at(`${MONDAY}T22:00`)), at(`${MONDAY}T23:30`));
  assert.equal(nextRoutineBoundary(sleep, at(`${MONDAY}T23:45`)), at('2027-03-02T07:30'));
});

test('routineOccurrences：按开始时间排序，按 [from, to) 过滤，并拒绝过长的区间', () => {
  const day = routineOf(
    rule({ id: 'b-lunch', kind: 'meal', start: '11:30', end: '12:00' }),
    rule({ id: 'a-focus', kind: 'focus', start: '09:00', end: '10:00' }),
  );
  assert.deepEqual(routineOccurrences(day, at(MONDAY), at('2027-03-02')).map(item => item.ruleId), ['a-focus', 'b-lunch']);
  // 区间外的规则不产出；紧贴边界的半开区间不重复计算。
  assert.deepEqual(routineOccurrences(day, at(`${MONDAY}T10:00`), at(`${MONDAY}T11:30`)), []);
  const item = routineOccurrences(day, at(`${MONDAY}T09:30`), at(`${MONDAY}T09:31`))[0];
  assert.equal(item.startAt, at(`${MONDAY}T09:00`));
  assert.equal(item.endAt, at(`${MONDAY}T10:00`));
  assert.equal(item.kind, 'focus');
  assert.equal(item.priority, routineKindPriority.focus);
  assert.throws(() => routineOccurrences(day, 0, 400 * 86400000), /区间过长/);
  assert.deepEqual(routineOccurrences(day, 10, 10), []);
});

test('校验：非法时间、时长、星期、优先级、编号与来源都被拒绝', () => {
  const good = rule({ id: 'ok' });
  assert.doesNotThrow(() => assertRoutineRule(good));
  assert.doesNotThrow(() => assertRoutineProfile(routineOf(good)));
  const invalid: [string, unknown, RegExp][] = [
    ['非 HH:mm（缺前导零）', rule({ id: 'r', start: '8:00' }), /时间无效/],
    ['24:00 不存在', rule({ id: 'r', start: '24:00' }), /时间无效/],
    ['分钟越界', rule({ id: 'r', end: '07:60' }), /时间无效/],
    ['start === end 不是 24 小时', rule({ id: 'r', start: '11:30', end: '11:30' }), /时间无效/],
    ['days 为空', rule({ id: 'r', days: [] }), /星期/],
    ['days 越界', rule({ id: 'r', days: [0, 1] }), /星期/],
    ['days 不是整数', rule({ id: 'r', days: [1.5] }), /星期/],
    ['days 重复', rule({ id: 'r', days: [2, 2] }), /星期重复/],
    ['优先级非整数', rule({ id: 'r', priority: 12.5 }), /优先级/],
    ['优先级越界', rule({ id: 'r', priority: 101 }), /优先级/],
    ['类型未知', { ...good, kind: 'party' }, /类型/],
    ['说明为空', rule({ id: 'r', label: '  ' }), /说明/],
    ['启用状态非布尔', { ...good, enabled: 'yes' }, /启用/],
    ['规则编号非法', rule({ id: '有 空格' }), /编号无效/],
  ];
  for (const [name, value, pattern] of invalid) assert.throws(() => assertRoutineRule(value), pattern, name);

  assert.throws(() => assertRoutineProfile({ ...routineOf(good), rules: 'nope' }), /规则/);
  assert.throws(() => assertRoutineProfile({ ...routineOf(good), updatedAt: Number.NaN }), /更新时间/);
  assert.throws(() => assertRoutineProfile({ ...routineOf(good), source: 'imported' }), /来源/);
  assert.throws(() => assertRoutineProfile(routineOf(good, { ...good })), /重复的规则编号/);
  assert.throws(() => assertRoutineProfile(routineOf(...Array.from({ length: 101 }, (_, index) => rule({ id: `r-${index}` })))), /过多/);
  assert.throws(() => assertRoutineProfile(null), /无效/);
});

test('v4 不变式：每个档案都必须带合法 RoutineProfile，v3 数据仍然可以没有', () => {
  const now = at(`${MONDAY}T08:00`);
  const state = initial(now);
  assert.deepEqual(state.profiles.map(profile => profile.routine?.source), ['user', 'legacy-default']);
  assert.equal(state.profiles[0].routine?.rules.length, 0);
  assert.equal(state.profiles[1].routine?.rules.length, 5);
  assert.doesNotThrow(() => validateState(structuredClone(state)));

  const missing = structuredClone(state);
  delete missing.profiles[0].routine;
  assert.throws(() => validateState(missing), /个人作息/);

  const broken = structuredClone(state);
  broken.profiles[1].routine!.rules[0] = { ...broken.profiles[1].routine!.rules[0], start: '23:30', end: '23:30' };
  assert.throws(() => validateState(broken), /作息/);

  const legacy = structuredClone(state);
  legacy.settings.domainVersion = 3;
  for (const profile of legacy.profiles) delete profile.routine;
  assert.doesNotThrow(() => validateState(legacy), 'v3 及更早的数据由迁移补齐，而不是在校验里被拒');
});

test('档案保存不会丢作息：带 routine 覆盖、缺省保留、非法 routine 被拒绝', () => {
  const now = at(`${MONDAY}T08:00`);
  const state = initial(now);
  const custom = { ...state.profiles[0], routine: routineOf(rule({ id: 'my-focus', kind: 'focus', start: '20:00', end: '21:00' })) };
  const saved = apply(state, { type: 'save', entity: 'profiles', value: custom }, now);
  assert.deepEqual(saved.profiles[0].routine, custom.routine);

  const { routine: _dropped, ...withoutRoutine } = state.profiles[0];
  const merged = apply(state, { type: 'save', entity: 'profiles', value: withoutRoutine }, now);
  assert.deepEqual(merged.profiles[0].routine, state.profiles[0].routine, '缺省 routine 时保留旧值');

  const invalid = { ...state.profiles[0], routine: { ...state.profiles[0].routine!, rules: [rule({ id: 'r', days: [9] })] } };
  assert.throws(() => apply(state, { type: 'save', entity: 'profiles', value: invalid }, now), /作息/);
});

test('导入课表永远不覆盖作息规则（课表包不携带 routine）', () => {
  const state = syntheticState(at('2027-02-22T00:00'));
  const custom = { ...state.profiles[0], routine: { source: 'user' as const, updatedAt: 1, rules: [rule({ id: 'my-focus', kind: 'focus' as RoutineKind, start: '20:00', end: '21:00' })] } };
  const before = apply(state, { type: 'save', entity: 'profiles', value: custom }, 1);
  assert.equal(before.profiles[0].routine?.rules.length, 1);

  const imported = apply(before, { type: 'importSchedule', value: syntheticSchedule() }, 1);
  assert.deepEqual(imported.profiles.map(profile => profile.routine), before.profiles.map(profile => profile.routine));

  // 即使课表文件里混进了 routine 字段，也一律忽略。
  const hostile = JSON.parse(JSON.stringify(syntheticSchedule()));
  hostile.profiles[0].routine = legacyDefaultRoutine(0);
  const guarded = apply(before, { type: 'importSchedule', value: hostile }, 1);
  assert.deepEqual(guarded.profiles.map(profile => profile.routine), before.profiles.map(profile => profile.routine));
});

// 0.2.x 写死的时间表（历史契约，只允许留在测试里）：
// Phase 2B 之后桌宠只读 Routine，因此这里锁定"legacy 默认作息走完整条新链路
// （routine → 桌宠适配器）后与旧行为逐分钟一致"。
const legacyPetTable: { state: ScheduledPetState; start: number; end: number }[] = [
  { state: 'night_sleep', start: 23 * 60 + 30, end: 24 * 60 },
  { state: 'night_sleep', start: 0, end: 7 * 60 + 30 },
  { state: 'wake_up', start: 7 * 60 + 30, end: 7 * 60 + 50 },
  { state: 'eating', start: 11 * 60 + 30, end: 12 * 60 },
  { state: 'nap', start: 12 * 60 + 30, end: 14 * 60 },
  { state: 'wake_up', start: 14 * 60, end: 14 * 60 + 20 },
];

test('legacy 默认作息走桌宠适配器后与 0.2.x 写死的时间表逐分钟一致', () => {
  const legacy = legacyDefaultRoutine(0);
  assert.equal(legacy.source, 'legacy-default');
  assert.deepEqual(legacy.rules.map(item => [item.id, item.kind, item.start, item.end]), [
    ['legacy-night-sleep', 'sleep', '23:30', '07:30'],
    ['legacy-morning-wake', 'wake', '07:30', '07:50'],
    ['legacy-lunch', 'meal', '11:30', '12:00'],
    ['legacy-nap', 'nap', '12:30', '14:00'],
    ['legacy-afternoon-wake', 'wake', '14:00', '14:20'],
  ]);
  assert.ok(legacy.rules.every(item => item.enabled && item.days.join(',') === '1,2,3,4,5,6,7'));
  assert.deepEqual(legacy.rules.map(item => item.priority), [
    routineKindPriority.sleep, routineKindPriority.wake, routineKindPriority.meal,
    routineKindPriority.nap, routineKindPriority.wake,
  ]);
  // 工厂每次返回独立对象，改一条规则不会污染下一次调用。
  legacy.rules[0].days.push(1);
  assert.equal(legacyDefaultRoutine(0).rules[0].days.length, 7);

  const scheduledAt = (minutes: number) => legacyPetTable.find(slot => minutes >= slot.start && minutes < slot.end)?.state ?? null;
  const reference = legacyDefaultRoutine(0);
  for (let minutes = 0; minutes < 1440; minutes += 1) {
    const time = `${MONDAY}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
    // 桌宠姿态的来源已经统一到 StateEngine：这里用同一个 kind → 姿态映射验证逐分钟等价。
    assert.equal(routineKindToPetState(activeRoutine(reference, at(time))?.kind ?? 'custom'), scheduledAt(minutes), `第 ${minutes} 分钟（${time}）`);
  }
});
