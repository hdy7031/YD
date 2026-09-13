// v0.3 Phase 1：Self / Companion 共用的 DailyPlan 视图模型。
//
// 这个模块只做投影，因此测试只断言两件事：
//   1. 它如实描述 occurrences() 给出的一天（不新增、不隐藏、不虚构数据）；
//   2. 0 项也是合法的 DailyPlan，摘要与时间带结构保持稳定。
// 它不重新判断人物状态：CurrentState 仍是状态唯一来源（由 state-engine 测试锁定）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { epoch, occurrences } from '../src/core.ts';
import { dailyCountText, dailyItemState, dailyNextText, dailyPlanFrom, timelinePlacement, DAY_MS } from '../src/ui/daily-plan.ts';
import { syntheticState } from './fixtures/synthetic.ts';

const dayStart = epoch('2027-02-23T00:00');
const state = syntheticState(epoch('2027-02-22T00:00'));
const planFor = (person?: string, now = dayStart) =>
  dailyPlanFrom({
    dayStart,
    occurrences: occurrences(state, dayStart, dayStart + DAY_MS, person),
    courses: state.courses,
    now,
  });

test('DailyPlan: 一天的事项按时间排序，数量与时间范围只来自真实 occurrence', () => {
  const plan = planFor('partner');
  assert.ok(plan.items.length > 0, '合成课表在 2027-02-23 有同行者课程');
  assert.equal(plan.activeCount, plan.items.filter(item => !item.cancelled).length);
  assert.equal(plan.cancelledCount, plan.items.filter(item => item.cancelled).length);
  assert.deepEqual(plan.items.map(item => item.start), [...plan.items.map(item => item.start)].sort((a, b) => a - b));
  assert.equal(plan.firstStart, Math.min(...plan.items.map(item => item.start)));
  assert.equal(plan.lastEnd, Math.max(...plan.items.map(item => item.end)));
  assert.equal(plan.rangeText, `${new Date(plan.firstStart! + 8 * 3600000).toISOString().slice(11, 16)} — ${new Date(plan.lastEnd! + 8 * 3600000).toISOString().slice(11, 16)}`);
  assert.equal(plan.date, '2027-02-23');
  assert.equal(plan.dayStart, dayStart);
});

test('DailyPlan: Self 与 Companion 共用同一契约，同一时间带定位', () => {
  const self = planFor('me');
  const companion = planFor('partner');
  for (const plan of [self, companion]) {
    assert.equal(typeof plan.activeCount, 'number');
    assert.ok(plan.items.every(item => ['sea', 'blue', 'violet', 'rose', 'amber'].includes(item.tone)));
    assert.ok(plan.items.every(item => item.kind === 'course' || item.kind === 'event'));
  }
  // 同一时间段在任何一天都落在时间带的同一位置：不随当天数据长度伸缩。
  const morning = timelinePlacement(dayStart, dayStart + 8 * 3600000, dayStart + 9 * 3600000);
  assert.ok(Math.abs(morning.left - (8 / 24) * 100) < 0.01);
  assert.ok(Math.abs(morning.width - (1 / 24) * 100) < 0.01);
});

test('DailyPlan: 0 项仍然是合法摘要，下一项诚实为空', () => {
  const empty = planFor('me', epoch('2027-02-27T12:00'));
  assert.equal(empty.activeCount, 0);
  assert.deepEqual(empty.items, []);
  assert.equal(empty.firstStart, undefined);
  assert.equal(empty.lastEnd, undefined);
  assert.equal(empty.next, undefined);
  assert.equal(dailyCountText(empty, '项安排'), '0 项安排');
  assert.equal(dailyNextText(empty), '今天暂无后续安排');
});

test('DailyPlan: 下一项取 now 之后最近的一项（不重新推导人物状态）', () => {
  const plan = planFor('partner');
  const first = plan.items[0];
  const before = dailyPlanFrom({
    dayStart,
    occurrences: occurrences(state, dayStart, dayStart + DAY_MS, 'partner'),
    courses: state.courses,
    now: first.start - 60000,
  });
  assert.equal(before.next?.id, first.id);
  const afterAll = dailyPlanFrom({
    dayStart,
    occurrences: occurrences(state, dayStart, dayStart + DAY_MS, 'partner'),
    courses: state.courses,
    now: dayStart + DAY_MS,
  });
  assert.equal(afterAll.next, undefined);
});

test('DailyPlan: 事项状态只描述事项本身（进行中 / 已结束），不冒充人物状态', () => {
  const plan = planFor('partner');
  const first = plan.items[0];
  assert.equal(dailyItemState(first, first.start + 60000), first.kind === 'course' ? '上课中' : '进行中');
  assert.equal(dailyItemState(first, first.end + 60000), '已结束');
  assert.equal(dailyItemState({ ...first, cancelled: true }, first.start + 60000), '已停课');
  assert.equal(dailyItemState({ ...first, rescheduled: true }, first.start + 60000), '已调课');
  assert.equal(dailyItemState(first, first.start - 60000), null);
});

test('DailyPlan: 停课只降级显示，不隐藏事项也不虚构数量', () => {
  const base = planFor('partner');
  const cancelled = dailyPlanFrom({
    dayStart,
    occurrences: occurrences(state, dayStart, dayStart + DAY_MS, 'partner').map((occurrence, index) => (index === 0 ? { ...occurrence, cancelled: true } : occurrence)),
    courses: state.courses,
    now: dayStart,
  });
  assert.equal(cancelled.items.length, base.items.length, '停课仍然出现在当天列表里');
  assert.equal(cancelled.cancelledCount, 1);
  assert.equal(cancelled.activeCount, base.activeCount - 1);
});
