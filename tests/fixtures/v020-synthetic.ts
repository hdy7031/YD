// v0.2.20 形态的迁移回归 fixture 构造器。
//
// 用途：以后每一次 v0.3 schema / 语义迁移，都必须能从这个状态出发，
// 并证明 course / event / task / reminder / exception / notice / settings
// 没有静默丢失。这里只使用合成数据，不包含任何真实用户记录。
//
// 覆盖：partner、tentative、course activity（teaching / research）、
// exception（调课）、notice→task 来源关联、reminder 三种状态、pet 与 setup 设置。
import { apply, epoch, validateState } from '../../src/core.ts';
import { blankDraft } from '../../src/inbox-types.ts';
import type { State } from '../../src/types.ts';
import { syntheticState } from './synthetic.ts';

export const v020Now = epoch('2027-02-22T00:00');
export const v020Ids = {
  notice: 'v020-notice',
  task: 'v020-task',
  event: 'v020-event',
  exception: 'v020-exception',
  course: 'alex-mon-1-2',
  reminderScheduled: 'v020-rem-scheduled',
  reminderDue: 'v020-rem-due',
  reminderAcknowledged: 'v020-rem-ack',
} as const;

export function v020Synthetic(now = v020Now): State {
  let s = syntheticState(now);

  const draft = { ...blankDraft(), type: 'TODO' as const, title: 'Submit report', date: '2027-03-05', startTime: '18:00', reminderMinutes: 1440, confidence: 0.8 };
  s = apply(s, { type: 'save', entity: 'notices', value: {
    id: v020Ids.notice, title: 'Submit report', text: '请在下周五前提交报告。', originalText: '请在下周五前提交报告。',
    state: 'inbox', sourceType: 'MANUAL', receivedAt: now, parseStatus: 'NEEDS_REVIEW', detectedType: 'TODO', parsedData: draft, confidence: 0.8,
  } }, now);
  s = apply(s, { type: 'convert', noticeId: v020Ids.notice, task: {
    id: v020Ids.task, title: 'Submit report', due: '2027-03-05T18:00', notes: 'fixture', done: false,
    checklist: [{ id: 'c1', text: 'Collect data', done: true }, { id: 'c2', text: 'Write up', done: false }], reminders: [1440, 0],
  } }, now);

  s = apply(s, { type: 'save', entity: 'events', value: {
    id: v020Ids.event, title: 'Project Review', start: '2027-03-22T13:00', end: '2027-03-22T14:00', place: 'Room 101',
    notes: 'fixture', reminders: [30], checklist: [{ id: 'e1', text: 'Prepare slides', done: false }],
  } }, now);

  // 调课：2027-03-15 是 alex-mon-1-2 的第 3 教学周（周一），改到次日 15:00。
  s = apply(s, { type: 'save', entity: 'exceptions', value: {
    id: v020Ids.exception, courseId: v020Ids.course, date: '2027-03-15', cancelled: false,
    start: '2027-03-16T15:00', end: '2027-03-16T16:00', place: 'Building A 302',
  } }, now);

  // 提醒的三种状态都要出现，迁移测试才能断言状态机字段没有被改写。
  s.reminders = [
    { id: v020Ids.reminderScheduled, target: `events:${v020Ids.event}`, title: 'Project Review', due: epoch('2027-03-22T12:30'), status: 'scheduled', createdAt: now, updatedAt: now },
    { id: v020Ids.reminderDue, target: `tasks:${v020Ids.task}`, title: 'Submit report', due: epoch('2027-03-05T08:00'), status: 'due', firedAt: epoch('2027-03-05T08:00'), createdAt: now, updatedAt: now },
    { id: v020Ids.reminderAcknowledged, target: `courses:${v020Ids.course}`, title: 'Computer Vision', due: epoch('2027-03-01T07:50'), status: 'acknowledged', firedAt: epoch('2027-03-01T07:50'), handledAt: epoch('2027-03-01T08:00'), createdAt: now, updatedAt: now },
  ];
  s.settings.orb = { x: 960, y: 520 };
  s.settings.setup = true;
  s.settings.launch = false;
  s.settings.trayResident = true;
  s.bubbleHistory = [];
  s.inboxVersion = 1;
  s.lastTick = now;
  // 这份 fixture 固定表示“v0.2.20 写到磁盘上的 v1 数据”：档案没有 role、
  // 设置里没有 domainVersion、会议没有 person、档案没有 routine。迁移测试才能证明
  // v1 → v2 → v3 → v4 的身份、归属与作息升级真的发生过。
  for(const profile of s.profiles) delete profile.role;
  for(const profile of s.profiles) delete profile.routine;
  for(const event of s.events) delete event.person;
  delete s.settings.domainVersion;
  return validateState(s);
}
