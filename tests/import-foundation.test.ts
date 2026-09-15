import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, createFreshState, epoch, occurrences, validateState } from '../src/core.ts';
import { getCurrentState } from '../src/state/engine.ts';
import {
  ImportCommitError,
  acceptCandidate,
  commitImport,
  commitScheduleCandidate,
  createImportSession,
  editCandidate,
  parseImportSession,
  rejectCandidate,
  scheduleCandidateValidator,
  validateImportSession,
} from '../src/import/index.ts';
import type { ImportCommitter, Importer, RawSource, ScheduleCandidateValue } from '../src/import/index.ts';
import type { State } from '../src/types.ts';

const NOW = epoch('2027-06-07T09:00');
type FixtureInput = { records: ScheduleCandidateValue[] };

const fixtureImporter: Importer<FixtureInput> = {
  id: 'test-fixture-importer',
  target: 'schedule',
  parse(source) {
    return source.input.records.map((value, index) => ({ id: `candidate-${index + 1}`, value, confidence: 'deterministic' as const }));
  },
};

const eventValue = (person: string, id: string, title = '导入会议', overrides: Record<string, unknown> = {}): ScheduleCandidateValue => ({
  entity: 'events',
  value: {
    id, person, title, start: '2027-06-07T09:00', end: '2027-06-07T10:00', place: '线上', notes: '', reminders: [], checklist: [],
    ...overrides,
  },
});

const taskValue = (id: string): ScheduleCandidateValue => ({
  entity: 'tasks',
  value: { id, title: '导入待办', due: '2027-06-07T18:00', notes: '', done: false, reminders: [], checklist: [] },
});

function source(records: ScheduleCandidateValue[]): RawSource<FixtureInput> {
  return {
    id: 'source-fixture-1', kind: 'structured-file', originalName: 'fixture.schedule', label: '测试输入', createdAt: NOW,
    fingerprint: 'a'.repeat(64), metadata: { format: 'test-fixture' }, input: { records },
  };
}

function parsedSession(state: State, records: ScheduleCandidateValue[], sessionId = 'session-fixture-1') {
  const created = createImportSession({ id: sessionId, importer: fixtureImporter.id, source: source(records), createdAt: NOW });
  const parsed = parseImportSession(created, fixtureImporter);
  return validateImportSession(parsed, scheduleCandidateValidator<FixtureInput>(), state);
}

function reviewAll<TInput>(session: ReturnType<typeof parsedSession>): ReturnType<typeof parsedSession> {
  let next = session;
  for (const candidate of next.candidates) next = acceptCandidate(next, candidate.id);
  return next;
}

test('Case A：RawSource → importer → candidates，review 前正式 Schedule 完全不变', () => {
  const state = createFreshState(NOW);
  const before = structuredClone(state);
  const session = parsedSession(state, [eventValue(state.profiles[0].id, 'event-a')]);
  assert.equal(session.status, 'needs_review');
  assert.equal(session.candidates[0].reviewState, 'pending');
  assert.deepEqual(state, before);
  assert.equal(state.events.length, 0);
});

test('Case B：accepted candidate 进入现有 Event domain，并保留完整 provenance', () => {
  const state = createFreshState(NOW);
  const session = reviewAll(parsedSession(state, [eventValue(state.profiles[0].id, 'event-b')]));
  assert.equal(session.status, 'ready');
  const result = commitImport(state, session, NOW);
  assert.equal(result.session.status, 'committed');
  assert.deepEqual(result.committedCandidateIds, ['candidate-1']);
  assert.equal(result.state.events.length, 1);
  const saved = result.state.events[0];
  assert.equal(saved.title, '导入会议');
  assert.equal(saved.provenance?.sessionId, session.id);
  assert.equal(saved.provenance?.source.id, 'source-fixture-1');
  assert.equal(saved.provenance?.source.kind, 'structured-file');
  assert.equal(saved.provenance?.source.originalName, 'fixture.schedule');
  assert.equal(saved.provenance?.importer, fixtureImporter.id);
  assert.equal(saved.provenance?.userEdited, false);
  assert.deepEqual(saved.provenance?.originalValue, session.candidates[0].originalParsedValue);
  assert.deepEqual(saved.provenance?.reviewedValue, session.candidates[0].reviewedValue);
  const day = occurrences(result.state, epoch('2027-06-07'), epoch('2027-06-08'), state.profiles[0].id);
  assert.equal(day[0].provenance?.source.id, 'source-fixture-1');
  assert.equal(getCurrentState(result.state, state.profiles[0].id, epoch('2027-06-07T09:30')).source, 'schedule');
});

test('Case C：rejected candidate commit 不写入正式数据', () => {
  const state = createFreshState(NOW);
  const validated = parsedSession(state, [eventValue(state.profiles[0].id, 'event-c')]);
  const rejected = rejectCandidate(validated, 'candidate-1');
  assert.equal(rejected.status, 'ready');
  const result = commitImport(state, rejected, NOW);
  assert.deepEqual(result.state, state);
  assert.deepEqual(result.committedCandidateIds, []);
  assert.equal(result.state.events.length, 0);
});

test('Case D：blocking validation error 拒绝 commit，正式数据完全不变', () => {
  const state = createFreshState(NOW);
  const invalid = parsedSession(state, [eventValue(state.profiles[0].id, 'event-d', '坏时间', { end: '2027-06-07T08:00' })]);
  assert.equal(invalid.status, 'needs_review');
  assert.ok(invalid.candidates[0].issues.some(item => item.severity === 'error'));
  const accepted = acceptCandidate(invalid, 'candidate-1');
  const before = structuredClone(state);
  assert.throws(() => commitImport(state, accepted, NOW), /尚未准备提交|阻断/);
  assert.deepEqual(state, before);
  assert.equal(state.events.length, 0);
});

test('Case E：用户编辑保留 original parsed value，commit 使用 final reviewed value', () => {
  const state = createFreshState(NOW);
  const validated = parsedSession(state, [eventValue(state.profiles[0].id, 'event-e')]);
  const original = structuredClone(validated.candidates[0].originalParsedValue);
  const edited = editCandidate(validated, 'candidate-1', eventValue(state.profiles[0].id, 'event-e', '确认后的会议', { place: '新地点' }));
  assert.equal(edited.status, 'needs_review');
  assert.deepEqual(edited.candidates[0].originalParsedValue, original);
  assert.equal((edited.candidates[0].reviewedValue.value as { title: string }).title, '确认后的会议');
  const revalidated = validateImportSession(edited, scheduleCandidateValidator<FixtureInput>(), state);
  assert.equal(revalidated.status, 'ready');
  const result = commitImport(state, revalidated, NOW);
  assert.equal(result.state.events[0].title, '确认后的会议');
  assert.equal(result.state.events[0].place, '新地点');
  assert.equal(result.state.events[0].provenance?.userEdited, true);
  assert.equal((result.state.events[0].provenance?.originalValue as ScheduleCandidateValue).value && ((result.state.events[0].provenance?.originalValue as ScheduleCandidateValue).value as { title: string }).title, '导入会议');
  assert.equal(((result.state.events[0].provenance?.reviewedValue as ScheduleCandidateValue).value as { title: string }).title, '确认后的会议');
});

test('Case F：批量 commit 中途失败时不留下半提交数据', () => {
  const state = createFreshState(NOW);
  const session = reviewAll(parsedSession(state, [
    eventValue(state.profiles[0].id, 'event-f-1'),
    eventValue(state.profiles[0].id, 'event-f-2', '第二条'),
  ]));
  const failingCommitter: ImportCommitter<ScheduleCandidateValue, FixtureInput> = (current, context) => {
    if (context.candidate.id === 'candidate-2') throw new Error('测试故障');
    return commitScheduleCandidate(current, context);
  };
  const before = structuredClone(state);
  let caught: unknown;
  try { commitImport(state, session, NOW, failingCommitter); } catch (error) { caught = error; }
  assert.ok(caught instanceof ImportCommitError);
  assert.equal((caught as ImportCommitError<FixtureInput>).session.status, 'failed');
  assert.deepEqual(state, before);
  assert.equal(state.events.length, 0);
});

test('Case G：引入 Foundation 不改写已有旧 Schedule 数据', () => {
  let state = createFreshState(NOW);
  state = apply(state, { type: 'save', entity: 'events', value: eventValue(state.profiles[0].id, 'legacy-event').value }, NOW);
  state = apply(state, { type: 'save', entity: 'tasks', value: taskValue('legacy-task').value }, NOW);
  validateState(state);
  const before = structuredClone(state);
  const rejected = rejectCandidate(parsedSession(state, [eventValue(state.profiles[0].id, 'new-event')]), 'candidate-1');
  const result = commitImport(state, rejected, NOW);
  assert.deepEqual(result.state, before);
  assert.deepEqual(result.state.events, before.events);
  assert.deepEqual(result.state.tasks, before.tasks);
  assert.equal(result.state.events[0].provenance, undefined);
});

test('Case H：Academic absent 的 Generic 用户可以导入通用 Task，不创建学业配置', () => {
  const state = createFreshState(NOW);
  assert.equal(state.profiles[0].startDate, undefined);
  const session = reviewAll(parsedSession(state, [taskValue('generic-task')], 'session-generic'));
  const result = commitImport(state, session, NOW);
  assert.equal(result.state.profiles[0].startDate, undefined);
  assert.equal(result.state.profiles[0].weeks, undefined);
  assert.equal(result.state.tasks[0].id, 'generic-task');
  assert.equal(result.state.tasks[0].provenance?.source.id, 'source-fixture-1');
  assert.equal(result.state.courses.length, 0);
});

test('RawSource provenance 拒绝机器绝对路径元数据', () => {
  assert.throws(() => createImportSession({
    id: 'session-path', importer: fixtureImporter.id,
    source: { ...source([]), metadata: { absolutePath: 'C:\\Users\\hdy\\Desktop\\secret.json' } },
    createdAt: NOW,
  }), /元数据/);
});
