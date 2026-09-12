// v0.3 Phase 3C：临时手动状态（Manual Override）。
//
// 覆盖：Manual > Schedule > Routine > Idle 的优先级、到期自动回落、主动取消、
// 重启后仍在、Solo / Together、提醒只影响桌宠、校验与过期清理。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { apply, epoch, initial, validateState } from '../src/core.ts';
import { Store } from '../src/store.ts';
import { companionRailLabel } from '../src/companion-display.ts';
import { personStatus, snapshot, statusLabel } from '../src/live.ts';
import { getCurrentState, getRoutineState, STATE_SOURCE_PRIORITY } from '../src/state/engine.ts';
import { activeManualOverride, manualOverrideActive, pruneManualOverrides } from '../src/state/manual.ts';
import { stateSourceLabel } from '../src/state/presentation.ts';
import { emptyRoutine, routineKindPriority, type RoutineProfile, type RoutineRule } from '../src/routine.ts';
import type { Course, PersonId, Profile, ProfileRole, State } from '../src/types.ts';

const at = (text: string) => epoch(text);
const MONDAY = '2027-03-01';
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

/** 本人：课程 11:40–12:30 + 作息 11:30–13:00 午饭；同行者：同一时段的课程。 */
function togetherState(): State {
  const selfRoutine = routineOf(rule({ id: 'lunch', kind: 'meal', label: '午饭', start: '11:30', end: '13:00' }));
  let state = workspace([person('alex', 'self', 'Alex', selfRoutine), person('sam', 'companion', 'Sam')]);
  state = apply(state, { type: 'save', entity: 'courses', value: course('c-self', 'alex') }, 0);
  state = apply(state, { type: 'save', entity: 'courses', value: course('c-comp', 'sam', { title: 'Staff Meeting' }) }, 0);
  return state;
}
type ManualKind = 'idle' | 'busy' | 'rest' | 'focus' | 'commute' | 'meal' | 'custom';
const manualLabels: Record<ManualKind, string> = { idle: '空闲', busy: '忙碌', rest: '休息', focus: '专注', commute: '通勤', meal: '吃饭', custom: '写论文' };
const setManual = (state: State, now: number, kind: ManualKind, endAt: number | null, label?: string) =>
  apply(state, { type: 'manual', kind, label: label ?? manualLabels[kind], endAt }, now);

test('Manual 压过一切：课程与作息同时进行时，本人状态仍是手动状态', () => {
  let state = togetherState();
  const now = at(`${MONDAY}T11:45`);        // 课程 + 作息都在进行
  state = setManual(state, at(`${MONDAY}T11:30`), 'focus', at(`${MONDAY}T16:00`));
  const current = getCurrentState(state, 'alex', now);
  assert.equal(current.kind, 'focus');
  assert.equal(current.source, 'manual');
  assert.equal(current.priority, STATE_SOURCE_PRIORITY.manual);
  assert.equal(current.confidence, 1, '本人确认不是概率，唯一带 confidence 的来源');
  assert.equal(current.label, '专注');
  assert.equal(current.endAt, at(`${MONDAY}T16:00`));
  assert.equal(current.meta?.manualKind, 'focus');
  // 被压过的层依然存在：作息照记，课程仍在课表里。
  assert.equal(getRoutineState(state, 'alex', now)?.meta?.routineKind, 'meal');
  assert.equal(personStatus(state, now, 'alex').conflict, false);
  assert.equal(statusLabel(personStatus(state, now, 'alex')), '专注中');
  assert.equal(companionRailLabel(personStatus(state, now, 'alex')), '专注');
  assert.equal(stateSourceLabel(current), '本人设置');
});

test('到期自动回落：Manual 结束后立刻恢复 Schedule / Routine / Idle，无需人工恢复', () => {
  let state = togetherState();
  // 11:30–12:00 的手动状态压在课程（11:40–12:30）与午饭（11:30–13:00）之上。
  state = setManual(state, at(`${MONDAY}T11:30`), 'focus', at(`${MONDAY}T12:00`));
  const kindAt = (time: string) => getCurrentState(state, 'alex', at(`${MONDAY}T${time}`));
  assert.deepEqual([kindAt('11:59').kind, kindAt('11:59').source], ['focus', 'manual']);
  assert.deepEqual([kindAt('12:00').kind, kindAt('12:00').source], ['class', 'schedule'], '到期立刻回到课表');
  assert.deepEqual([kindAt('12:30').kind, kindAt('12:30').source], ['meal', 'routine'], '课程结束后回到作息');
  assert.deepEqual([kindAt('13:00').kind, kindAt('13:00').source], ['idle', 'idle']);
});

test('主动取消立即恢复；"直到取消"不会自行过期，也可以被取消', () => {
  let state = togetherState();
  state = setManual(state, at(`${MONDAY}T11:30`), 'busy', null);
  const override = activeManualOverride(state, 'alex', at(`${MONDAY}T11:45`))!;
  assert.equal(override.endAt, null);
  assert.equal(getCurrentState(state, 'alex', at(`${MONDAY}T11:45`)).kind, 'busy');
  // 一周后仍然生效：endAt = null 只由用户取消。
  assert.equal(getCurrentState(state, 'alex', at('2027-03-08T11:45')).source, 'manual');
  const cancelled = apply(state, { type: 'manualCancel', id: override.id }, at(`${MONDAY}T11:50`));
  assert.deepEqual(cancelled.manualOverrides, []);
  assert.deepEqual(
    [getCurrentState(cancelled, 'alex', at(`${MONDAY}T11:50`)).kind, getCurrentState(cancelled, 'alex', at(`${MONDAY}T11:50`)).source],
    ['class', 'schedule'],
  );
});

test('同一个人只有一条覆盖：新的临时状态替换旧的；过期记录在保存时被清理', () => {
  let state = togetherState();
  state = setManual(state, at(`${MONDAY}T09:00`), 'busy', at(`${MONDAY}T10:00`));
  assert.equal(state.manualOverrides.length, 1);
  state = setManual(state, at(`${MONDAY}T11:30`), 'focus', at(`${MONDAY}T16:00`));
  assert.equal(state.manualOverrides.length, 1, '替换而不是累积');
  assert.equal(state.manualOverrides[0].kind, 'focus');
  // 过期记录不影响状态判断，但会在下一次保存时被清掉（不在每秒 tick 里写盘）。
  assert.equal(getCurrentState(state, 'alex', at(`${MONDAY}T20:00`)).source, 'idle');
  const saved = apply(state, { type: 'settings', setup: true }, at(`${MONDAY}T20:00`));
  assert.deepEqual(saved.manualOverrides, [], '保存路径清理过期记录');
  const pruned = structuredClone(state);
  assert.equal(pruneManualOverrides(pruned, at(`${MONDAY}T20:00`)), true);
  assert.deepEqual(pruned.manualOverrides, []);
});

test('重启后未过期的覆盖仍在，过期的会被清理', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayhub-manual-'));
  const dbDir = path.join(dir, 'adapter');
  fs.mkdirSync(dbDir);
  const open = (bytes?: Uint8Array) => {
    const file = path.join(dbDir, crypto.randomUUID() + '.sqlite');
    if (bytes) fs.writeFileSync(file, bytes);
    const db = new DatabaseSync(file);
    return {
      run(sql: string, params: unknown[] = []) { db.prepare(sql).run(...params as any[]); },
      exec(sql: string) { const stmt = db.prepare(sql); const rows = stmt.all(); return rows.length ? [{ columns: Object.keys(rows[0]), values: rows.map(Object.values) }] : []; },
      export() { return fs.readFileSync(file); },
      close() { db.close(); fs.unlinkSync(file); },
    };
  };
  try {
    const now = at(`${MONDAY}T11:30`);
    const store = new Store(dir, open, now);
    await store.update(s => setManual(togetherState(), now, 'focus', at(`${MONDAY}T16:00`)));
    // 新实例 = 重启：手动状态必须还在，并继续压过课程 / 作息。
    const reopened = new Store(dir, open, now);
    const restored = reopened.snapshot();
    assert.equal(restored.manualOverrides.length, 1);
    assert.equal(getCurrentState(restored, 'alex', at(`${MONDAY}T12:00`)).source, 'manual');
    assert.equal(getCurrentState(restored, 'alex', at(`${MONDAY}T12:00`)).kind, 'focus');
    // 到期之后重新打开：状态回落到推导结果，记录在下一次保存时清理。
    const later = new Store(dir, open, now);
    assert.equal(getCurrentState(later.snapshot(), 'alex', at(`${MONDAY}T16:30`)).source, 'idle');
    await later.update(s => apply(s, { type: 'settings', setup: true }, at(`${MONDAY}T16:30`)));
    assert.deepEqual(new Store(dir, open, now).snapshot().manualOverrides, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Solo：一个人也能设置 / 取消临时状态', () => {
  let state = workspace([person('alex', 'self', 'Alex')]);
  state = apply(state, { type: 'save', entity: 'courses', value: course('c-self', 'alex') }, 0);
  state = setManual(state, at(`${MONDAY}T11:30`), 'rest', at(`${MONDAY}T13:00`));
  assert.equal(getCurrentState(state, 'alex', at(`${MONDAY}T11:45`)).kind, 'rest');
  assert.equal(statusLabel(personStatus(state, at(`${MONDAY}T11:45`), 'alex')), '休息中');
  const cancelled = apply(state, { type: 'manualCancel' }, at(`${MONDAY}T11:50`));
  assert.deepEqual(cancelled.manualOverrides, []);
  assert.equal(getCurrentState(cancelled, 'alex', at(`${MONDAY}T11:50`)).kind, 'class');
});

test('Together：本人的手动状态不影响同行者，也不能替同行者设置', () => {
  let state = togetherState();
  state = setManual(state, at(`${MONDAY}T11:30`), 'focus', at(`${MONDAY}T16:00`));
  const self = getCurrentState(state, 'alex', at(`${MONDAY}T11:45`));
  const companion = getCurrentState(state, 'sam', at(`${MONDAY}T11:45`));
  assert.equal(self.source, 'manual');
  assert.equal(companion.source, 'schedule', '同行者仍然按自己的课表推导');
  assert.equal(companion.kind, 'class');
  assert.equal(activeManualOverride(state, 'sam', at(`${MONDAY}T11:45`)), null);
  // 本机不能替同行者声明状态：状态由状态主体本人确认。
  assert.throws(() => apply(state, { type: 'manual', personId: 'sam', kind: 'focus', label: '专注', endAt: at(`${MONDAY}T16:00`) }, at(`${MONDAY}T11:35`)), /只能设置本人的状态/);
  // 取消也只能取消自己的。
  const companionOverride = { ...state.manualOverrides[0], id: 'other', personId: 'sam' };
  const withCompanion = { ...state, manualOverrides: [...state.manualOverrides, companionOverride] };
  assert.throws(() => apply(withCompanion, { type: 'manualCancel', id: 'other' }, at(`${MONDAY}T11:35`)), /不属于本人/);
});

test('提醒只影响桌宠：人物状态仍然是手动状态', () => {
  // Solo：桌宠主体就是本人，手动"吃饭"映射到同一个 eating 姿态。
  let state = workspace([person('alex', 'self', 'Alex')]);
  state = apply(state, { type: 'save', entity: 'courses', value: course('c-self', 'alex') }, 0);
  state = setManual(state, at(`${MONDAY}T11:30`), 'meal', at(`${MONDAY}T16:00`), '午饭');
  const now = at(`${MONDAY}T11:45`);
  const withReminder = structuredClone(state);
  withReminder.reminders.push({ id: 'r-1', target: 'courses:c-self', title: '课堂提醒', due: now, status: 'due', createdAt: now, updatedAt: now });
  const live = snapshot(withReminder, now, { reminderSince: now, nudgeId: 1 });
  assert.equal(live.display.state, 'reminder');
  assert.equal(live.display.base, 'eating', '手动"吃饭"映射到同一个桌宠姿态');
  const status = live.people[0];
  assert.equal(status.current.source, 'manual');
  assert.equal(statusLabel(status), '吃饭中');
  assert.equal(companionRailLabel(status), '吃饭');
  // Together：本人被手动覆盖时，桌宠主体（同行者）仍然按自己的课表显示。
  const together = setManual(togetherState(), at(`${MONDAY}T11:30`), 'meal', at(`${MONDAY}T16:00`), '午饭');
  const togetherLive = snapshot(together, now);
  assert.equal(togetherLive.display.base, 'busy_class', '桌宠主体仍是同行者');
  assert.equal(togetherLive.people.find(item => item.person === 'alex')!.current.source, 'manual');
});

test('校验：非法类型 / 结束时间 / 名称 / 目标人都会被拒绝', () => {
  const state = togetherState();
  const now = at(`${MONDAY}T11:30`);
  assert.throws(() => apply(state, { type: 'manual', kind: 'party' as any, label: '聚会', endAt: at(`${MONDAY}T12:00`) }, now), /类型无效/);
  assert.throws(() => apply(state, { type: 'manual', kind: 'focus', label: '专注', endAt: now }, now), /结束时间必须晚于现在/);
  assert.throws(() => apply(state, { type: 'manual', kind: 'focus', label: '专注', endAt: Number.NaN }, now), /结束时间必须晚于现在/);
  assert.throws(() => apply(state, { type: 'manual', kind: 'focus', label: '   ', endAt: at(`${MONDAY}T12:00`) }, now), /状态名称/);
  assert.throws(() => apply(state, { type: 'manual', kind: 'focus', label: '专注', endAt: at(`${MONDAY}T12:00`), personId: 'ghost' }, now), /只能设置本人的状态/);
  assert.throws(() => apply(state, { type: 'manualCancel', id: 'missing' }, now), /不存在/);
  // 合法写入通过完整校验，并且落在 State 里。
  const ok = setManual(state, now, 'custom', at(`${MONDAY}T12:00`), '写论文');
  assert.equal(ok.manualOverrides.length, 1);
  assert.equal(ok.manualOverrides[0].label, '写论文');
  assert.doesNotThrow(() => validateState(structuredClone(ok)));
  // 领域版本 5 要求显式集合；v4 数据仍然可以没有（由迁移补齐）。
  const legacy = structuredClone(ok);
  delete (legacy as { manualOverrides?: unknown }).manualOverrides;
  legacy.settings.domainVersion = 4;
  assert.doesNotThrow(() => validateState(legacy));
  const broken = structuredClone(ok);
  broken.manualOverrides[0].endAt = broken.manualOverrides[0].startAt - 1;
  assert.throws(() => validateState(broken), /结束时间无效/);
  const ghost = structuredClone(ok);
  ghost.manualOverrides[0].personId = 'ghost';
  assert.throws(() => validateState(ghost), /所属人不存在/);
});

test('手动状态是稳定区间：startAt/endAt 与 active 判定一致', () => {
  let state = togetherState();
  state = setManual(state, at(`${MONDAY}T11:30`), 'focus', at(`${MONDAY}T16:00`));
  const override = state.manualOverrides[0];
  assert.equal(override.startAt, at(`${MONDAY}T11:30`));
  assert.equal(manualOverrideActive(override, at(`${MONDAY}T11:30`)), true, '左闭');
  assert.equal(manualOverrideActive(override, at(`${MONDAY}T15:59`)), true);
  assert.equal(manualOverrideActive(override, at(`${MONDAY}T16:00`)), false, '右开');
  assert.equal(manualOverrideActive(override, at(`${MONDAY}T11:29`)), false);
});
