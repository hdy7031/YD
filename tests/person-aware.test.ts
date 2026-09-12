// v0.3 Phase 1B：Person-aware 领域链路。
//
// 覆盖 Solo（1 个档案）与 Together（self + companion）两种状态在
// Course / Event / Occurrence / Live / Reminder 链路上的行为，
// 并锁定"提醒只为工作区本人生成、同行者不产生本机提醒"的既有策略。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, epoch, initial, occurrences, validateState } from '../src/core.ts';
import { personStatus, snapshot } from '../src/live.ts';
import { scheduleDays } from '../src/selectors.ts';
import type { Course, Event, PersonId, Profile, ProfileRole, Task } from '../src/types.ts';
import { syntheticState } from './fixtures/synthetic.ts';

const clone = <T>(value: T): T => structuredClone(value);
const periods = [{ start: '08:00', end: '08:45' }, { start: '08:55', end: '09:40' }];
const person = (id: PersonId, role: ProfileRole, name = id): Profile => ({ id, role, name, startDate: '2027-03-01', weeks: 16, periods, updatedAt: 0 });
type CourseOverrides = Partial<Omit<Course, 'id' | 'person' | 'updatedAt'>>;
type EventOverrides = Partial<Omit<Event, 'id' | 'person' | 'updatedAt'>>;
type TaskOverrides = Partial<Omit<Task, 'id' | 'updatedAt'>>;
const course = (id: string, owner: PersonId, over: CourseOverrides = {}): Course => ({ id, person: owner, title: 'Computer Vision', place: 'Building A 301', notes: '', weekday: 1, first: 1, last: 1, weeks: [1], reminders: [10], checklist: [], updatedAt: 0, ...over });
const event = (id: string, owner?: PersonId, over: EventOverrides = {}): Event => ({ id, ...(owner ? { person: owner } : {}), title: 'Project Review', start: '2027-03-01T10:00', end: '2027-03-01T11:00', place: 'Room 101', notes: '', reminders: [30], checklist: [], updatedAt: 0, ...over });
const task = (id: string, over: TaskOverrides = {}): Task => ({ id, title: 'Submit report', due: '2027-03-02T18:00', notes: '', done: false, checklist: [], reminders: [60], updatedAt: 0, ...over });
const at = (text: string) => epoch(text);
const workspace = (profiles: Profile[]) => { const state = initial(0); state.profiles = profiles; return state; };

test('Solo 课程：单人工作区的课程照常产生 occurrence 与状态', () => {
  let s = workspace([person('alex', 'self', 'Alex')]);
  s = apply(s, { type: 'save', entity: 'courses', value: course('c-cv', 'alex') }, at('2027-03-01T00:00'));
  const today = occurrences(s, at('2027-03-01'), at('2027-03-02'));
  assert.equal(today.length, 1);
  assert.equal(today[0].person, 'alex');
  const status = personStatus(s, at('2027-03-01T08:10'), 'alex');
  assert.equal(status.code, 'BUSY_CLASS');
  assert.equal(status.alias, 'D');
  assert.equal(status.todayCount, 1);
  assert.deepEqual(scheduleDays(s, '2027-03-01', 'alex').map(day => day.day), ['2027-03-01']);
});

test('Solo 会议：新建会议自动归属本人，occurrence 与状态正确', () => {
  let s = workspace([person('alex', 'self', 'Alex')]);
  s = apply(s, { type: 'save', entity: 'events', value: event('e-review') }, 0);
  assert.equal(s.events[0].person, 'alex', '默认归属由身份层解析');
  const today = occurrences(s, at('2027-03-01'), at('2027-03-02'));
  assert.deepEqual(today.map(o => [o.kind, o.person]), [['event', 'alex']]);
  const status = personStatus(s, at('2027-03-01T10:30'), 'alex');
  assert.equal(status.code, 'BUSY_EVENT');
  assert.equal(status.current.kind, 'meeting');
  assert.equal(status.current.meta?.title, 'Project Review');
});

test('Solo 提醒：本人的课程 / 会议 / 待办照常生成提醒', () => {
  let s = workspace([person('alex', 'self', 'Alex')]);
  s = apply(s, { type: 'save', entity: 'courses', value: course('c1', 'alex') }, 0);
  s = apply(s, { type: 'save', entity: 'events', value: event('e1') }, 0);
  s = apply(s, { type: 'save', entity: 'tasks', value: task('t1') }, 0);
  const targets = new Set(s.reminders.map(reminder => reminder.target));
  assert.ok(targets.has('courses:c1'));
  assert.ok(targets.has('events:e1'));
  assert.ok(targets.has('tasks:t1'));
});

test('提醒策略保持旧行为：同行者的课程与会议不产生本机提醒', () => {
  let s = workspace([person('alex', 'self', 'Alex'), person('sam', 'companion', 'Sam')]);
  s = apply(s, { type: 'save', entity: 'courses', value: course('c-self', 'alex') }, 0);
  s = apply(s, { type: 'save', entity: 'courses', value: course('c-comp', 'sam') }, 0);
  s = apply(s, { type: 'save', entity: 'events', value: event('e-comp', 'sam') }, 0);
  const targets = new Set(s.reminders.map(reminder => reminder.target));
  assert.ok(targets.has('courses:c-self'));
  assert.equal(targets.has('courses:c-comp'), false, '同行者课程不产生本机提醒');
  assert.equal(targets.has('events:e-comp'), false, '同行者会议不产生本机提醒');
});

test('会议归属参与过滤：同行者的会议不会出现在本人的日程里', () => {
  let s = workspace([person('alex', 'self', 'Alex'), person('sam', 'companion', 'Sam')]);
  s = apply(s, { type: 'save', entity: 'events', value: event('e-mine') }, 0);
  s = apply(s, { type: 'save', entity: 'events', value: event('e-theirs', 'sam') }, 0);
  assert.deepEqual(occurrences(s, at('2027-03-01'), at('2027-03-02'), 'alex').map(o => o.id), ['e:e-mine']);
  assert.deepEqual(occurrences(s, at('2027-03-01'), at('2027-03-02'), 'sam').map(o => o.id), ['e:e-theirs']);
  assert.equal(occurrences(s, at('2027-03-01'), at('2027-03-02')).length, 2);
  assert.equal(occurrences(s, at('2027-03-01'), at('2027-03-02'), 'ghost').length, 0);
});

test('Solo 快照：只投影一个档案，没有幽灵同行者与空代号', () => {
  let s = workspace([person('alex', 'self', 'Alex')]);
  s = apply(s, { type: 'save', entity: 'courses', value: course('c1', 'alex') }, 0);
  const live = snapshot(s, at('2027-03-01T08:10'));
  assert.equal(live.people.length, 1);
  assert.deepEqual(live.people.map(status => status.person), ['alex']);
  assert.equal(live.people[0].code, 'BUSY_CLASS');
  assert.equal(live.people[0].alias, 'D');
  assert.ok(live.people.every(status => typeof status.alias === 'string' && status.alias.length > 0));
  assert.equal(personStatus(s, at('2027-03-01T08:10'), 'partner').code, 'UNKNOWN', '不存在的同行者不抛错');
});

test('任意合法档案 id 都能走完课程 / 会议 / 提醒链路', () => {
  const id = '6f1a3c88-1f0e-4a5b-9f4c-7c2b2a9d51e0';
  let s = workspace([person(id, 'self')]);
  s = apply(s, { type: 'save', entity: 'courses', value: course('c-custom', id) }, 0);
  s = apply(s, { type: 'save', entity: 'events', value: event('e-custom') }, 0);
  assert.equal(personStatus(s, at('2027-03-01T08:10'), id).code, 'BUSY_CLASS');
  assert.equal(s.events[0].person, id);
  assert.deepEqual(snapshot(s, at('2027-03-01T08:10')).people.map(status => status.person), [id]);
  assert.equal(new Set(s.reminders.map(reminder => reminder.target)).has(`events:e-custom`), true);
});

// Together 回归：默认双人体验（合成课表：Alex self / Sam companion 暂定）必须逐项保持。
test('Together 回归：状态、提醒、暂定、教研、调课与周网格保持旧行为', () => {
  const s = syntheticState(at('2027-02-22T00:00'));
  const live = snapshot(s, at('2027-02-23T10:00'));
  assert.deepEqual(live.people.map(status => status.person), ['me', 'partner'], '顺序取 profiles 顺序');
  assert.deepEqual(live.people.map(status => status.alias), ['D', 'Y']);
  assert.equal(live.people[1].code, 'BUSY_CLASS');
  assert.equal(live.people[1].tentative, true);
  assert.equal(s.courses.filter(c => c.activity === 'research').length, 2);
  // 提醒只覆盖本人的课程。
  assert.ok(s.reminders.length > 0);
  assert.ok(s.reminders.every(reminder => !reminder.target.includes('sam-')), '同行者课程没有本机提醒');
  // 单次调课仍然作用于实际 occurrence，不改课程模板。
  const courseTemplate = s.courses.find(c => c.person === 'partner' && c.weekday === 2 && c.first === 3)!;
  const moved = apply(s, { type: 'save', entity: 'exceptions', value: { id: 'x', courseId: courseTemplate.id, date: '2027-02-23', cancelled: false, start: '2027-02-24T23:50', end: '2027-02-25T00:20' } }, at('2027-02-22T00:00'));
  assert.equal(personStatus(moved, at('2027-02-23T10:00'), 'partner').current.kind, 'idle');
  assert.equal(personStatus(moved, at('2027-02-25T00:00'), 'partner').current.label, courseTemplate.title);
  assert.deepEqual(moved.courses, s.courses, '课程模板不被调课改写');
  // 周网格与状态使用同一份 occurrence：原日期消失，调课后的实例（跨午夜会拆段）出现。
  const grid = scheduleDays(moved, '2027-02-22', 'partner');
  assert.equal(grid.some(segment => segment.courseId === courseTemplate.id && segment.day === '2027-02-23'), false);
  assert.ok(grid.some(segment => segment.courseId === courseTemplate.id && segment.day === '2027-02-25'), '调课实例出现在周网格里');
});

test('v3 校验：会议必须归属存在的档案，v2 旧数据允许缺省', () => {
  const v3 = workspace([person('alex', 'self')]);
  v3.settings.domainVersion = 3;
  v3.events.push(event('e-ghost'));
  assert.throws(() => validateState(clone(v3)), /会议缺少所属人/);
  const wrongOwner = clone(v3);
  wrongOwner.events[0].person = 'ghost';
  assert.throws(() => validateState(clone(wrongOwner)), /会议所属人不存在/);
  const legacy = clone(v3);
  legacy.settings.domainVersion = 2;
  delete legacy.events[0].person;
  assert.doesNotThrow(() => validateState(clone(legacy)));
  const owned = clone(v3);
  owned.events[0].person = 'alex';
  assert.doesNotThrow(() => validateState(clone(owned)));
});
