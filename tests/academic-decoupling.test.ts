// Phase 5B3 · Academic Decoupling（学业语义是可选能力）。
//
// 这一份测试只证明一件事：**YD Core 不再默认用户是学生**。
//   A. fresh install 没有学业配置，仍然合法、CurrentState = idle；
//   B. 通用日程（会议 / 活动）不依赖学期 / 教学周 / 节次，照常进入 occurrence 与 StateEngine；
//   C. Together 的双方都可以没有学业配置，且各自的日程与状态互相独立；
//   D. 已有学生数据（学期 / 课程 / 节次 / 周次）读取与展开不退化；
//   E. Solo ↔ Together 生命周期与学业有无无关：PersonId / 日程 / 作息 / 形象 / 主体偏好都不变；
//   F. fresh install 与新 companion 都不生成假学期，也不存在「20 周 / 中性学期」占位。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, createCompanionProfile, createFreshState, dateOf, epoch, occurrences, validateState } from '../src/core.ts';
import { academicOf, academicPresence, hasAcademic, STANDARD_PERIOD_PRESET, suggestedTermStart, SUGGESTED_TERM_WEEKS } from '../src/academic.ts';
import { getCompanionProfile, getSelfProfile, resolvePetSubject } from '../src/people.ts';
import { personStatus, statusLabel } from '../src/live.ts';
import { getCurrentState } from '../src/state/engine.ts';
import { resolvePetInstance } from '../src/pet-instance.ts';
import { listAvatarPacks } from '../src/avatar.ts';
import { emptyRoutine } from '../src/routine.ts';
import { snapshot } from '../src/live.ts';
import { togetherWorkspace } from './helpers/workspaces.ts';
import type { Command, Profile, State } from '../src/types.ts';

const NOW = epoch('2027-06-07T09:00');   // 周一
const change = (state: State, command: Command, now = NOW): State => apply(state, command, now);
const solo = (now = NOW): State => createFreshState(now);
const self = (state: State): Profile => getSelfProfile(state)!;
const companion = (state: State): Profile => getCompanionProfile(state)!;
const workingFrame = { startDate: '2027-06-07', weeks: 16, periods: structuredClone(STANDARD_PERIOD_PRESET) };
/** 通用日程事项：绝对日期 + 时间，不含任何学业语义。 */
const genericEvent = (id: string, start: string, end: string, person?: string) => ({
  id, ...(person ? { person } : {}), title: '团队会议', start, end, place: '线上', notes: '', reminders: [], checklist: [], updatedAt: NOW,
});

// ---------------------------------------------------------------------------
// A. Fresh non-academic
// ---------------------------------------------------------------------------
test('A：fresh install 没有学业配置仍然合法，CurrentState = idle', () => {
  const state = solo();
  validateState(state);
  const profile = self(state);
  assert.equal(academicPresence(profile), 'absent');
  assert.equal(hasAcademic(profile), false);
  assert.equal(profile.startDate, undefined);
  assert.equal(profile.weeks, undefined);
  assert.equal(profile.periods, undefined);
  for (const at of [NOW, epoch('2027-06-07T12:30'), epoch('2027-06-08T03:00')]) {
    const current = getCurrentState(state, profile.id, at);
    assert.deepEqual([current.kind, current.source], ['idle', 'idle']);
  }
  // 通用文案：没有学业配置的人不会看到「尚未录入课表」这类学业措辞。
  const status = personStatus(state, NOW, profile.id);
  assert.equal(status.code, 'FREE');
  assert.equal(statusLabel(status), '空闲');
  assert.equal(status.termStart, undefined, '没有学期就没有学期起始日');
  assert.equal(snapshot(state, NOW).people.length, 1);
});

// ---------------------------------------------------------------------------
// B. Generic Solo
// ---------------------------------------------------------------------------
test('B：没有学业配置也能按绝对时间安排日程（occurrence + CurrentState=schedule）', () => {
  const state = change(solo(), { type: 'save', entity: 'events', value: genericEvent('g1', '2027-06-07T09:00', '2027-06-07T10:30') }, NOW);
  validateState(state);
  const id = self(state).id;
  const list = occurrences(state, epoch('2027-06-07T00:00'), epoch('2027-06-08T00:00'), id);
  assert.equal(list.length, 1, '通用日程照常产生 occurrence');
  assert.equal(list[0].title, '团队会议');
  assert.deepEqual([epoch('2027-06-07T09:00'), epoch('2027-06-07T10:30')], [list[0].start, list[0].end]);
  const current = getCurrentState(state, id, epoch('2027-06-07T09:30'));
  assert.deepEqual([current.kind, current.source, current.meta?.scheduleKind], ['meeting', 'schedule', 'event']);
  assert.equal(statusLabel(personStatus(state, epoch('2027-06-07T09:30'), id)), '活动中');
  // 会议结束后回到通用空闲，不出现「今日课程已结束」。
  const after = personStatus(state, epoch('2027-06-07T11:00'), id);
  assert.equal(after.code, 'FREE');
  assert.equal(statusLabel(after), '空闲');
});

// ---------------------------------------------------------------------------
// C. Generic Together
// ---------------------------------------------------------------------------
test('C：Together 双方都可以没有学业配置，各自日程与状态独立', () => {
  let state = change(solo(), { type: 'usageMode', mode: 'together', companionName: 'Sam' }, NOW);
  assert.equal(academicPresence(self(state)), 'absent');
  assert.equal(academicPresence(companion(state)), 'absent');
  state = change(state, { type: 'save', entity: 'events', value: genericEvent('self-meeting', '2027-06-07T09:00', '2027-06-07T10:00', self(state).id) }, NOW);
  state = change(state, { type: 'save', entity: 'events', value: genericEvent('sam-meeting', '2027-06-07T11:00', '2027-06-07T12:00', companion(state).id) }, NOW);
  validateState(state);
  const live = snapshot(state, epoch('2027-06-07T09:30'));
  assert.deepEqual(live.people.map(person => person.person), [self(state).id, companion(state).id], '两位活跃人物都在');
  assert.equal(live.people[0].current.kind, 'meeting');
  assert.equal(live.people[1].current.kind, 'idle', '同伴的日程不会串到本人身上');
  assert.equal(getCurrentState(state, companion(state).id, epoch('2027-06-07T11:30')).kind, 'meeting');
  assert.equal(getCurrentState(state, self(state).id, epoch('2027-06-07T11:30')).kind, 'idle');
});

// ---------------------------------------------------------------------------
// D. Existing academic user
// ---------------------------------------------------------------------------
test('D：已有学生数据（学期 / 节次 / 教学周）读取与展开不退化', () => {
  const state = togetherWorkspace(epoch('2026-09-07T00:00'));
  validateState(state);
  const profile = self(state);
  const frame = academicOf(profile)!;
  assert.deepEqual(frame, { startDate: '2026-09-07', weeks: SUGGESTED_TERM_WEEKS, periods: STANDARD_PERIOD_PRESET }, '学业配置逐字段保持');
  // 课程仍按"教学周 + 周几 + 节次"展开：第 1 周周一第 1 节 = 2026-09-07 08:00。
  const course = { id: 'cv', person: profile.id, title: 'Computer Vision', place: 'A301', notes: '', weekday: 1, first: 1, last: 1, weeks: [1, 2], reminders: [], checklist: [], updatedAt: NOW };
  const withCourse = change(state, { type: 'save', entity: 'courses', value: course }, NOW);
  const list = occurrences(withCourse, epoch('2026-09-01T00:00'), epoch('2026-09-30T00:00'), profile.id).filter(o => o.title === 'Computer Vision');
  assert.deepEqual(list.map(o => dateOf(o.start)), ['2026-09-07', '2026-09-14']);
  assert.equal(list[0].start, epoch('2026-09-07T08:00'));
  // 学业阶段码与桌宠主体行为保持原样（学期尚未开始 / 学期结束）。
  const beforeTerm = personStatus(withCourse, epoch('2026-08-31T09:00'), profile.id);
  assert.equal(beforeTerm.code, 'TERM_NOT_STARTED');
  assert.equal(beforeTerm.termStart, '2026-09-07');
  const afterTerm = personStatus(withCourse, epoch('2027-03-01T09:00'), profile.id);
  assert.deepEqual([afterTerm.code, hasAcademic(profile)], ['TERM_ENDED', true]);
});

// ---------------------------------------------------------------------------
// E. Mode lifecycle（学业有无都不影响 5B2 语义）
// ---------------------------------------------------------------------------
test('E：Solo ↔ Together 生命周期与学业配置无关（有 / 无学业都成立）', () => {
  for (const academic of [false, true]) {
    let state = change(solo(), { type: 'usageMode', mode: 'together', companionName: 'Sam', petSubjectRole: 'companion' }, NOW);
    if (academic) {
      state = change(state, { type: 'save', entity: 'profiles', value: { ...companion(state), ...workingFrame } }, NOW);
      state = change(state, { type: 'avatarSet', personId: companion(state).id, packId: listAvatarPacks()[1].id }, NOW);
      state = change(state, { type: 'save', entity: 'profiles', value: { ...companion(state), routine: { source: 'user', updatedAt: NOW, rules: [] } } }, NOW);
    }
    const before = JSON.stringify(companion(state));
    const personId = companion(state).id;
    const back = change(change(state, { type: 'usageMode', mode: 'solo' }, NOW), { type: 'usageMode', mode: 'together' }, NOW);
    assert.equal(companion(back).id, personId, `academic=${academic}: PersonId 不变`);
    assert.equal(JSON.stringify(companion(back)), before, `academic=${academic}: 档案逐字段不变（含学业配置有无）`);
    assert.equal(back.settings.petSubjectRole, 'companion', '存储的桌宠偏好不变');
    assert.equal(hasAcademic(companion(back)), academic, `academic=${academic}: 学业配置存在性不变`);
    assert.equal(resolvePetSubject(back).id, personId, 'Together 下主体仍是同伴');
    assert.equal(resolvePetInstance(change(back, { type: 'usageMode', mode: 'solo' }, NOW)).subjectId, self(back).id, 'Solo 下主体是本人');
  }
});

test('E2：学业配置只影响课程，不影响通用日程与状态来源优先级', () => {
  const state = change(solo(), { type: 'save', entity: 'events', value: genericEvent('g1', '2027-06-07T09:00', '2027-06-07T10:30') }, NOW);
  const withAcademic = change(state, { type: 'save', entity: 'profiles', value: { ...self(state), ...workingFrame } }, NOW);
  const person = self(state).id;
  for (const subject of [state, withAcademic]) {
    const current = getCurrentState(subject, person, epoch('2027-06-07T09:30'));
    assert.deepEqual([current.kind, current.source, current.priority], ['meeting', 'schedule', 80], 'Schedule 层优先级不变');
  }
});

// ---------------------------------------------------------------------------
// F. No fake placeholder
// ---------------------------------------------------------------------------
test('F：fresh install 与新 companion 都不生成假学期 / 假教学周', () => {
  const fresh = solo();
  const freshJson = JSON.stringify(fresh);
  for (const forbidden of ['startDate', 'weeks', 'periods']) assert.ok(!freshJson.includes(forbidden), `fresh state 不含 ${forbidden}`);
  assert.ok(!JSON.stringify(fresh.profiles[0]).includes(String(SUGGESTED_TERM_WEEKS)));

  const together = change(fresh, { type: 'usageMode', mode: 'together', companionName: '阿丁' }, NOW);
  validateState(together);
  assert.deepEqual(Object.keys(companion(together)).sort(), Object.keys(createCompanionProfile(NOW, self(together))).sort(), '新 person 的字段集合与领域模板同源');
  assert.ok(together.profiles.every(profile => academicPresence(profile) === 'absent'), '两个人都不带学业配置');
  assert.ok(together.profiles.every(profile => profile.startDate === undefined && profile.weeks === undefined && profile.periods === undefined));

  // 没有学业配置时课程被明确拒绝（而不是偷偷造一个学期）。
  assert.throws(() => change(together, { type: 'save', entity: 'courses', value: { id: 'c1', person: self(together).id, title: '课', place: '', notes: '', weekday: 1, first: 1, last: 1, weeks: [1], reminders: [], checklist: [], updatedAt: NOW } }, NOW), /学期与节次/);
  // 用户显式配置学业后，课程才成立。
  const configured = change(together, { type: 'save', entity: 'profiles', value: { ...self(together), ...workingFrame } }, NOW);
  const withCourse = change(configured, { type: 'save', entity: 'courses', value: { id: 'c1', person: self(together).id, title: '课', place: 'A1', notes: '', weekday: 1, first: 1, last: 1, weeks: [1], reminders: [], checklist: [], updatedAt: NOW } }, NOW);
  assert.equal(withCourse.courses.length, 1);
  assert.equal(occurrences(withCourse, epoch('2027-06-07T00:00'), epoch('2027-06-08T00:00'), self(together).id)[0].start, epoch('2027-06-07T08:00'));
  // 只有部分学业字段 → 坏数据，必须被拒绝（optional ≠ unvalidated）。
  const partial = structuredClone(configured);
  delete partial.profiles[0].periods;
  assert.throws(() => validateState(partial), /必须一起设置/);
  const badWeeks = structuredClone(configured);
  badWeeks.profiles[0].weeks = 0;
  assert.throws(() => validateState(badWeeks), /教学周数/);
  const badStart = structuredClone(configured);
  badStart.profiles[0].startDate = '2027-06-08';   // 周二不是第一教学周的周一
  assert.throws(() => validateState(badStart), /周一/);
});

test('F2：建议学期起始日只是表单预设（本周周一），不会被写进任何状态', () => {
  assert.equal(suggestedTermStart(epoch('2027-06-09T12:00')), '2027-06-07', '周三 → 本周周一');
  assert.equal(suggestedTermStart(epoch('2027-06-07T00:30')), '2027-06-07', '周一本身');
  const untouched = solo();
  assert.equal(academicOf(untouched.profiles[0]), undefined);
  assert.equal('startDate' in untouched.profiles[0], false);
});
