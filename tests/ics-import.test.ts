import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apply, createFreshState, epoch, occurrences } from '../src/core.ts';
import { getCurrentState } from '../src/state/engine.ts';
import {
  ImportCommitError,
  acceptCandidate,
  commitImport,
  commitScheduleCandidate,
  prepareICSImport,
  rawSourceFromICSFile,
  rejectCandidate,
  type ICSImportSession,
  type ImportCommitter,
} from '../src/import/index.ts';
import type { Event, State } from '../src/types.ts';

const NOW = epoch('2026-09-14T09:00');

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/import/${name}`, import.meta.url), 'utf8');
}

function source(text: string, name = 'fixture.ics', id = 'ics-source-1') {
  return rawSourceFromICSFile({
    originalName: name,
    size: Buffer.byteLength(text, 'utf8'),
    createdAt: NOW,
    fingerprint: 'b'.repeat(64),
    text,
  }, id);
}

function prepare(state: State, text: string, target = state.profiles[0].id, name = 'fixture.ics', sourceId = 'ics-source-1') {
  return prepareICSImport(state, source(text, name, sourceId), target, `ics-session-${sourceId}`);
}

function hasError(session: ICSImportSession, candidateId: string): boolean {
  return session.candidates.find(candidate => candidate.id === candidateId)?.issues.some(item => item.severity === 'error') ?? false;
}

function review(session: ICSImportSession, selected: (candidate: ICSImportSession['candidates'][number]) => boolean = candidate => !hasError(session, candidate.id)) {
  let next = session;
  for (const candidate of next.candidates) next = selected(candidate) ? acceptCandidate(next, candidate.id) : rejectCandidate(next, candidate.id);
  return next;
}

function eventValue(overrides: Partial<Event> = {}): Event {
  return {
    id: 'legacy-event', person: 'legacy-self', title: '旧事件', start: '2026-09-18T12:00', end: '2026-09-18T13:00', place: '', notes: '',
    reminders: [], checklist: [], updatedAt: NOW, ...overrides,
  };
}

test('Case A：Basic ICS 经过 6A pipeline，Review 前不改正式数据，commit 后进入 Event / occurrences / CurrentState', () => {
  const state = createFreshState(NOW);
  const before = structuredClone(state);
  const session = prepare(state, fixture('basic.ics'), state.profiles[0].id, 'basic.ics');
  assert.equal(session.status, 'needs_review');
  assert.deepEqual(state, before);
  assert.equal(session.candidates.length, 1);
  assert.equal(session.candidates[0].confidence, undefined);
  const wrapped = session.candidates[0].reviewedValue as { sourceRecordId?: string; value: Event };
  assert.equal(wrapped.sourceRecordId, 'basic-event@example.test');
  assert.equal(wrapped.value.start, '2026-09-18T09:00');
  assert.equal(wrapped.value.end, '2026-09-18T10:30');
  assert.equal(wrapped.value.place, '会议室 A101');
  assert.equal(state.events.length, 0);

  const result = commitImport(state, review(session), NOW);
  const saved = result.state.events[0];
  assert.equal(result.session.status, 'committed');
  assert.equal(result.committedCandidateIds.length, 1);
  assert.equal(saved.person, state.profiles[0].id);
  assert.equal(saved.provenance?.importer, 'ics-v1');
  assert.equal(saved.provenance?.sourceRecordId, 'basic-event@example.test');
  assert.equal(saved.provenance?.source.originalName, 'basic.ics');
  assert.equal(saved.provenance?.source.fingerprint, 'b'.repeat(64));
  assert.deepEqual(saved.provenance?.originalValue, session.candidates[0].originalParsedValue);
  const day = occurrences(result.state, epoch('2026-09-18'), epoch('2026-09-19'), saved.person);
  assert.equal(day.length, 1);
  assert.equal(day[0].title, '项目评审');
  assert.equal(getCurrentState(result.state, saved.person!, epoch('2026-09-18T09:30')).source, 'schedule');
  assert.equal(result.state.profiles[0].startDate, undefined, 'generic ICS 不需要 Academic 配置');
});

test('Case B：多个 VEVENT 一次 Review、一次 atomic commit，旧数据保持不变', () => {
  let state = createFreshState(NOW);
  state = apply(state, { type: 'save', entity: 'events', value: eventValue({ person: state.profiles[0].id }) }, NOW);
  const before = structuredClone(state);
  const session = prepare(state, fixture('multiple.ics'), state.profiles[0].id, 'multiple.ics', 'ics-source-multiple');
  assert.equal(session.candidates.length, 2);
  const result = commitImport(state, review(session), NOW);
  assert.equal(result.state.events.length, 3);
  assert.equal(result.state.events.find(event => event.id === 'legacy-event')?.title, before.events[0].title);
  assert.equal(result.committedCandidateIds.length, 2);
});

test('Case C/D/E：UTC、有效 TZID、其它 IANA TZID 与 floating time 均转换到 Asia/Shanghai，未知 TZID 不猜', () => {
  const state = createFreshState(NOW);
  const session = prepare(state, fixture('timezone.ics'), state.profiles[0].id, 'timezone.ics', 'ics-source-timezone');
  assert.equal(session.candidates.length, 4);
  const starts = new Map(session.candidates.map(candidate => [
    (candidate.reviewedValue as { sourceRecordId: string }).sourceRecordId,
    (candidate.reviewedValue as { value: Event }).value.start,
  ]));
  assert.equal(starts.get('utc@example.test'), '2026-09-18T09:00');
  assert.equal(starts.get('tzid@example.test'), '2026-09-18T09:00');
  assert.equal(starts.get('iana@example.test'), '2026-09-18T21:00');
  assert.equal(starts.get('floating@example.test'), '2026-09-18T11:00');

  const unknown = prepare(state, fixture('invalid.ics'), state.profiles[0].id, 'invalid.ics', 'ics-source-invalid');
  const unknownCandidate = unknown.candidates.find(candidate => (candidate.reviewedValue as { sourceRecordId?: string }).sourceRecordId === 'unknown-zone@example.test')!;
  assert.ok(unknownCandidate.issues.some(item => item.code === 'ics.timezone_unknown'));
  assert.equal((unknownCandidate.reviewedValue as { value: Event }).value.start, '');
  assert.throws(() => commitImport(state, review(unknown, () => true), NOW), /尚未准备提交|阻断/);
  assert.equal(state.events.length, 0);
});

test('Case F：CRLF / 折行 / 中文 / escaped TEXT 正确展开', () => {
  const state = createFreshState(NOW);
  const session = prepare(state, fixture('folded-escaped.ics'), state.profiles[0].id, 'folded-escaped.ics', 'ics-source-folded');
  const value = (session.candidates[0].reviewedValue as { value: Event }).value;
  assert.equal(value.title, '中文标题, 评审;会议');
  assert.equal(value.place, '会议室, A101');
  assert.equal(value.notes, '第一行\n第二行\\路径');
  assert.equal(session.status, 'needs_review');
  assert.equal(session.candidates[0].issues.length, 0);
});

test('Case G/H：结束时间倒置、重复规则、全天事件都是 blocking，不伪造可提交时间', () => {
  const state = createFreshState(NOW);
  const invalid = prepare(state, fixture('invalid.ics'), state.profiles[0].id, 'invalid.ics', 'ics-source-invalid-time');
  const badTime = invalid.candidates.find(candidate => (candidate.reviewedValue as { sourceRecordId?: string }).sourceRecordId === 'bad-time@example.test')!;
  assert.ok(badTime.issues.some(item => item.code === 'ics.end_not_after_start'));
  assert.throws(() => commitImport(state, review(invalid, candidate => candidate.id === badTime.id), NOW), /尚未准备提交|阻断/);

  const recurring = prepare(state, fixture('recurrence-unsupported.ics'), state.profiles[0].id, 'recurrence-unsupported.ics', 'ics-source-recurrence');
  assert.ok(recurring.candidates[0].issues.some(item => item.code === 'ics.recurrence_unsupported'));
  assert.throws(() => commitImport(state, review(recurring, () => true), NOW), /尚未准备提交|阻断/);

  const allDay = prepare(state, fixture('all-day.ics'), state.profiles[0].id, 'all-day.ics', 'ics-source-all-day');
  const allDayValue = allDay.candidates[0].reviewedValue as unknown as { value: Event; display: { allDay: boolean } };
  assert.equal(allDayValue.display.allDay, true);
  assert.equal(allDayValue.value.start, '');
  assert.equal(allDayValue.value.end, null);
  assert.ok(allDay.candidates[0].issues.some(item => item.code === 'ics.all_day_unsupported'));
  assert.throws(() => commitImport(state, review(allDay, () => true), NOW), /尚未准备提交|阻断/);
});

test('Case I：首次导入、相同 UID 重复导入、同 UID 内容变化分别按保守策略处理', () => {
  const state = createFreshState(NOW);
  const first = commitImport(state, review(prepare(state, fixture('basic.ics'), state.profiles[0].id, 'basic.ics', 'ics-source-first')), NOW).state;
  const duplicate = prepare(first, fixture('basic.ics'), first.profiles[0].id, 'copy.ics', 'ics-source-copy');
  assert.ok(duplicate.candidates[0].issues.some(item => item.code === 'ics.duplicate_uid'));
  assert.throws(() => commitImport(first, review(duplicate, () => true), NOW), /尚未准备提交|阻断/);
  const rejected = commitImport(first, review(duplicate, () => false), NOW);
  assert.equal(rejected.state.events.length, 1);

  const changedText = fixture('basic.ics').replace('项目评审', '内容已变化');
  const changed = prepare(first, changedText, first.profiles[0].id, 'changed.ics', 'ics-source-changed');
  assert.ok(changed.candidates[0].issues.some(item => item.code === 'ics.duplicate_changed'));
  assert.ok(changed.candidates[0].issues.some(item => item.message.includes('暂不支持自动覆盖更新')));
});

test('Case J/K：Review 选择只提交选中的合法项；invalid 被 reject 后合法项仍可提交', () => {
  const state = createFreshState(NOW);
  const text = fixture('multiple.ics').replace('END:VCALENDAR', [
    'BEGIN:VEVENT',
    'UID:bad-batch@example.test',
    'SUMMARY:坏事件',
    'DTSTART:20260918T160000',
    'DTEND:20260918T150000',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\n'));
  const session = prepare(state, text, state.profiles[0].id, 'mixed.ics', 'ics-source-mixed');
  assert.equal(session.candidates.length, 3);
  const selectedIds = new Set(session.candidates.slice(0, 1).map(candidate => candidate.id));
  const result = commitImport(state, review(session, candidate => selectedIds.has(candidate.id)), NOW);
  assert.equal(result.state.events.length, 1);
  assert.deepEqual(result.committedCandidateIds, [...selectedIds]);
  assert.equal(result.state.events[0].title, '第一场会议');
});

test('Case L/M/P：accepted batch 中途失败完全回滚；已有 Event 不被删除或覆盖', () => {
  let state = createFreshState(NOW);
  state = apply(state, { type: 'save', entity: 'events', value: eventValue({ person: state.profiles[0].id }) }, NOW);
  const session = review(prepare(state, fixture('multiple.ics'), state.profiles[0].id, 'multiple.ics', 'ics-source-atomic'));
  const before = structuredClone(state);
  const failing: ImportCommitter<import('../src/import/types.ts').ScheduleCandidateValue, import('../src/import/ics.ts').ICSInput> = (current, context) => {
    if (context.candidate.id === session.candidates[1].id) throw new Error('测试保存失败');
    return commitScheduleCandidate(current, context);
  };
  let caught: unknown;
  try { commitImport(state, session, NOW, failing); } catch (error) { caught = error; }
  assert.ok(caught instanceof ImportCommitError);
  assert.deepEqual(state, before);
  assert.equal(state.events.length, 1);
});

test('Case N/O：Together 目标人物绑定到 companion，Solo 不展示或接受 inactive companion target；无 Academic 也能工作', () => {
  let state = createFreshState(NOW);
  state = apply(state, { type: 'completeSetup', value: { selfName: '我', mode: 'together', companion: { name: 'TA' }, petEnabled: false } }, NOW);
  const companion = state.profiles.find(profile => profile.role === 'companion')!;
  const imported = commitImport(state, review(prepare(state, fixture('basic.ics'), companion.id, 'companion.ics', 'ics-source-companion')), NOW).state;
  assert.equal(imported.events[0].person, companion.id);
  assert.equal(occurrences(imported, epoch('2026-09-18'), epoch('2026-09-19'), state.profiles[0].id).length, 0);
  assert.equal(occurrences(imported, epoch('2026-09-18'), epoch('2026-09-19'), companion.id).length, 1);
  assert.equal(imported.profiles.some(profile => profile.startDate !== undefined), false);

  const solo = apply(imported, { type: 'usageMode', mode: 'solo' }, NOW);
  const inactive = prepare(solo, fixture('basic.ics'), companion.id, 'inactive.ics', 'ics-source-inactive');
  assert.ok(inactive.candidates[0].issues.some(item => item.code === 'ics.target_inactive'));
  assert.throws(() => commitImport(solo, review(inactive, () => true), NOW), /尚未准备提交|阻断/);
});

test('Case Q：完全无效 ICS 是文件级失败，不创建候选或正式数据', () => {
  const state = createFreshState(NOW);
  const failed = prepare(state, 'not an ics file', state.profiles[0].id, 'bad.ics', 'ics-source-file-failure');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.candidates.length, 0);
  assert.ok(failed.issues[0].message.includes('不是有效的 ICS 文件') || failed.issues[0].message.includes('解析失败'));
  assert.equal(state.events.length, 0);
});
