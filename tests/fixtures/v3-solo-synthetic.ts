// v3 Solo 工作区 fixture：1 个本人档案（自定义 id `alex`）+ 课程 / 会议 / 待办 + 提醒。
//
// 用途：
//   * 单元测试：导航、悬浮球、桌宠主体、快照消费者在"没有同行者"时的行为；
//   * runtime-audit-solo.cjs：真实 Electron 下的 Solo 验收（隔离数据目录）；
//   * v3 → v4 迁移测试与 Electron 迁移验收：它刻意保持在 Phase 2A **之前**的 v3 形态
//     （domainVersion = 3、档案没有 routine），构建产物也固定在这个形态。
// 用自定义 id（而不是 'me'）是刻意的：它证明界面与桌宠都不再依赖历史字面量。
import { apply, createFreshState, epoch, validateState } from '../../src/core.ts';
import type { Course, Event, State, Task } from '../../src/types.ts';

export const soloPersonId = 'alex';
export const soloNow = epoch('2027-03-01T00:00');   // 周一，与档案 startDate 对齐
// 桌宠/状态验收用的时刻：此时本人正在上第二节课（10:00–10:45）。
export const soloClassTime = epoch('2027-03-01T10:10');
/** 本 fixture 固定表示的领域版本：Phase 2A（v4 / Routine）之前。 */
export const soloDomainVersion = 3;

const weeks = Array.from({ length: 16 }, (_, index) => index + 1);
const course = (id: string, over: Partial<Course>): Course => ({
  id, person: soloPersonId, title: 'Computer Vision', place: 'Building A 301', notes: '', weekday: 1,
  first: 1, last: 2, weeks, reminders: [10], checklist: [], updatedAt: soloNow, ...over,
});
const event = (over: Partial<Event>): Event => ({
  id: 'solo-review', title: 'Project Review', start: '2027-03-01T13:00', end: '2027-03-01T14:00',
  place: 'Room 101', notes: '', reminders: [30], checklist: [], updatedAt: soloNow, ...over,
});
const task = (over: Partial<Task> = {}): Task => ({
  id: 'solo-task', title: 'Submit report', due: '2027-03-02T18:00', notes: '', done: false,
  checklist: [{ id: 'solo-check-1', text: 'Collect data', done: true }], reminders: [60], updatedAt: soloNow, ...over,
});

export function v3SoloSynthetic(now = soloNow): State {
  const state = createFreshState(now);
  // 只保留一个本人档案，并换成自定义 id / 名称：Solo 工作区没有任何同行者。
  const self = state.profiles[0];
  const profile = { ...self, id: soloPersonId, role: 'self' as const, name: 'Alex', shortAlias: 'A', startDate: '2027-03-01', weeks: 16, updatedAt: now };
  // v4 之前档案没有 routine：删掉 fresh state 种下的字段，让这份 fixture 真的是"迁移前"。
  delete profile.routine;
  delete profile.avatar;
  // v5 之前也没有临时状态（Phase 3C）：fixture 固定表示 v3 形态。
  delete (state as { manualOverrides?: unknown }).manualOverrides;
  state.profiles = [profile];
  state.settings.domainVersion = soloDomainVersion;
  state.settings.setup = true;
  let s = state;
  s = apply(s, { type: 'save', entity: 'courses', value: course('solo-cv', { title: 'Computer Vision', place: 'Building A 301', weekday: 1, first: 1, last: 2 }) }, now);
  s = apply(s, { type: 'save', entity: 'courses', value: course('solo-ml', { title: 'Machine Learning', place: 'Lab 204', weekday: 1, first: 3, last: 4 }) }, now);
  s = apply(s, { type: 'save', entity: 'courses', value: course('solo-seminar', { title: 'Research Seminar', place: 'Lab 204', activity: 'research', weekday: 4, first: 1, last: 2 }) }, now);
  s = apply(s, { type: 'save', entity: 'events', value: event({}) }, now);
  s = apply(s, { type: 'save', entity: 'tasks', value: task() }, now);
  s.settings.launch = false;
  s.settings.trayResident = true;
  s.lastTick = now;
  return validateState(s);
}
