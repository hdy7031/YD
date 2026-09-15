import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { apply, createFreshState, epoch, occurrences } from '../src/core.ts';
import {
  acceptCandidate,
  commitImport,
  editCandidate,
  prepareTabularImport,
  tabularCandidateValidator,
  validateImportSession,
  type TabularColumnMapping,
  type TabularFileSelection,
  type TabularImportSession,
  type TabularCandidateValue,
  type ScheduleCandidateValue,
} from '../src/import/index.ts';
import { readCSVTable, readXLSXTable } from '../src/import/tabular-reader.ts';
import { parseAcademicPeriodRange, parseAcademicWeekday, parseAcademicWeeks } from '../src/import/tabular.ts';
import type { Event, State } from '../src/types.ts';

const NOW = epoch('2026-09-14T09:00');
const periods = [{ start: '08:00', end: '08:45' }, { start: '08:55', end: '09:40' }, { start: '10:00', end: '10:45' }, { start: '10:55', end: '11:40' }];

function file(text: string, format: 'csv' | 'xlsx' = 'csv', fingerprint = 'f'.repeat(64), name = `fixture.${format}`): TabularFileSelection {
  return { originalName: name, size: Buffer.byteLength(text, 'utf8'), createdAt: NOW, fingerprint, format, table: readCSVTable(text) };
}

function xlsxFile(table: Awaited<ReturnType<typeof readXLSXTable>>, fingerprint = 'x'.repeat(64)): TabularFileSelection {
  return { originalName: 'fixture.xlsx', size: 100, createdAt: NOW, fingerprint, format: 'xlsx', table };
}

function mapping(headerRow: number, entries: TabularColumnMapping['entries']): TabularColumnMapping {
  return { headerRow, entries };
}

function eventMapping(headerRow = 1): TabularColumnMapping {
  return mapping(headerRow, [
    { sourceColumn: 0, field: 'date' }, { sourceColumn: 1, field: 'startTime' }, { sourceColumn: 2, field: 'endTime' },
    { sourceColumn: 3, field: 'title' }, { sourceColumn: 4, field: 'location' }, { sourceColumn: 5, field: 'notes' },
  ]);
}

function courseMapping(headerRow = 1): TabularColumnMapping {
  return mapping(headerRow, [
    { sourceColumn: 0, field: 'title' }, { sourceColumn: 1, field: 'weekday' }, { sourceColumn: 2, field: 'weeks' },
    { sourceColumn: 3, field: 'periodRange' }, { sourceColumn: 4, field: 'location' },
  ]);
}

function reviewAll(session: TabularImportSession): TabularImportSession {
  let next = session;
  for (const candidate of next.candidates) next = acceptCandidate(next, candidate.id);
  return next;
}

function eventSession(state: State, source: TabularFileSelection, map = eventMapping(), target = state.profiles[0].id): TabularImportSession {
  return prepareTabularImport(state, source, { mode: 'event', targetPersonId: target, sheetName: source.table.sheets[0].name, mapping: map }, 'tabular-session');
}

test('Case A/G/H：CSV 映射按语义工作，Review 前不写 Schedule，commit 后进入 Event', () => {
  const csv = '日期,开始时间,结束时间,标题,地点,备注\n2026-09-18,09:00,10:30,组会,实验室,讨论论文';
  const state = createFreshState(NOW);
  const before = structuredClone(state);
  const session = eventSession(state, file(csv));
  assert.equal(session.candidates.length, 1);
  const wrapped = session.candidates[0].reviewedValue as TabularCandidateValue;
  assert.equal(wrapped.entity, 'events');
  assert.equal((wrapped.value as Event).start, '2026-09-18T09:00');
  assert.equal(wrapped.value.title, '组会');
  assert.equal(wrapped.sourceRecordId, 'CSV#row-2');
  assert.deepEqual(state, before);
  const result = commitImport(state, reviewAll(session), NOW);
  assert.equal(result.state.events.length, 1);
  assert.equal(result.state.events[0].place, '实验室');
  assert.equal(result.state.events[0].provenance?.source.fingerprint, 'f'.repeat(64));
  assert.equal(occurrences(result.state, epoch('2026-09-18'), epoch('2026-09-19'), state.profiles[0].id).length, 1);
});

test('Case B/C/K：CSV 正确处理引号、逗号、多行、转义引号、BOM 与空白行', () => {
  const csv = '\uFEFF日期,开始时间,结束时间,标题,备注\r\n2026-09-18,09:00,10:30,"评审, 会议","第一行\n第二行 ""重点"""\r\n,,,,\r\n';
  const table = readCSVTable(csv);
  assert.equal(table.sheets[0].rows.length, 3);
  assert.deepEqual(table.sheets[0].rows[1].cells.map(cell => cell.value), ['2026-09-18', '09:00', '10:30', '评审, 会议', '第一行\n第二行 "重点"']);
  const state = createFreshState(NOW);
  const session = eventSession(state, file(csv), mapping(1, [
    { sourceColumn: 0, field: 'date' }, { sourceColumn: 1, field: 'startTime' }, { sourceColumn: 2, field: 'endTime' },
    { sourceColumn: 3, field: 'title' }, { sourceColumn: 4, field: 'notes' },
  ]));
  assert.equal(session.candidates.length, 1, '完全空白数据行应被忽略');
  assert.equal((session.candidates[0].reviewedValue as TabularCandidateValue).value.notes, '第一行\n第二行 "重点"');
});

test('Case F/J/L：可选择非首行表头，歧义日期与缺少必填字段都产生 blocking issue', () => {
  const csv = '学校导出\n2026 秋季\n\n日期,开始时间,结束时间,标题\n09/10/2026,09:00,10:00,不猜日期\n2026-09-18,09:00,10:00,\n';
  const state = createFreshState(NOW);
  const session = eventSession(state, file(csv), mapping(4, [
    { sourceColumn: 0, field: 'date' }, { sourceColumn: 1, field: 'startTime' }, { sourceColumn: 2, field: 'endTime' }, { sourceColumn: 3, field: 'title' },
  ]));
  assert.equal(session.candidates.length, 2);
  assert.ok(session.candidates[0].issues.some(item => item.code === 'tabular.date_ambiguous'));
  assert.ok(session.candidates[1].issues.some(item => item.code === 'tabular.required_missing'));
  assert.equal(session.status, 'needs_review');
});

test('Case I/M：完整日期时间布局、编辑保留 originalParsedValue 并重新验证', () => {
  const csv = '标题,开始日期时间,结束日期时间\n写作,2026/9/18 09:00,2026年9月18日 10:30';
  const state = createFreshState(NOW);
  const map = mapping(1, [{ sourceColumn: 0, field: 'title' }, { sourceColumn: 1, field: 'startDateTime' }, { sourceColumn: 2, field: 'endDateTime' }]);
  const session = eventSession(state, file(csv), map);
  const original = structuredClone(session.candidates[0].originalParsedValue);
  const current = session.candidates[0].reviewedValue as TabularCandidateValue;
  const edited = editCandidate(session, session.candidates[0].id, {
    ...current, value: { ...current.value as Event, start: '2026-09-18T10:00', end: '2026-09-18T11:30' },
    metadata: { ...current.metadata, parseIssues: [] },
  } as unknown as ScheduleCandidateValue);
  const revalidated = validateImportSession(edited, tabularCandidateValidator(), state);
  assert.deepEqual(revalidated.candidates[0].originalParsedValue, original);
  assert.equal(((revalidated.candidates[0].reviewedValue as TabularCandidateValue).value as Event).start, '2026-09-18T10:00');
  assert.equal(revalidated.candidates[0].reviewState, 'edited');
  assert.equal(commitImport(state, reviewAll(revalidated), NOW).state.events[0].start, '2026-09-18T10:00');
});

test('Case D/E：XLSX 可读取日期值、缓存公式结果、多 Sheet 只使用所选 Sheet', async () => {
  const workbook = new ExcelJS.Workbook();
  const first = workbook.addWorksheet('课程表 A');
  first.addRow(['导出说明']);
  first.addRow([]);
  first.addRow(['日期', '开始时间', '结束时间', '标题']);
  first.addRow([new Date(Date.UTC(2026, 8, 18)), '09:00', '10:30', 'XLSX 会议']);
  first.getCell('E4').value = { formula: '1+1', result: '缓存备注' };
  const second = workbook.addWorksheet('不要自动导入');
  second.addRow(['日期', '开始时间', '结束时间', '标题']);
  second.addRow(['2026-09-18', '12:00', '13:00', '错误 Sheet']);
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  const table = await readXLSXTable(bytes);
  assert.deepEqual(table.sheets.map(sheet => [sheet.name, sheet.hidden]), [['课程表 A', false], ['不要自动导入', false]]);
  const state = createFreshState(NOW);
  const source = xlsxFile(table);
  const session = prepareTabularImport(state, source, { mode: 'event', targetPersonId: state.profiles[0].id, sheetName: '课程表 A', mapping: mapping(3, [
    { sourceColumn: 0, field: 'date' }, { sourceColumn: 1, field: 'startTime' }, { sourceColumn: 2, field: 'endTime' }, { sourceColumn: 3, field: 'title' },
  ]) }, 'xlsx-session');
  const value = session.candidates[0].reviewedValue as TabularCandidateValue;
  assert.equal((value.value as Event).start, '2026-09-18T09:00');
  assert.equal(value.value.title, 'XLSX 会议');
  assert.equal(session.candidates.length, 1);
  assert.equal(value.metadata.sourceRow.find(cell => cell.column === 'E')?.value, '缓存备注');
});

test('Case N/O/P/Q/R/S：课程模式显式选择、Academic 前置条件、星期/周次/节次语义可复用', () => {
  const state = createFreshState(NOW);
  const csv = '课程名,星期,周次,节次,地点\n计算机视觉,星期二,1-16单周,3~4,研楼201';
  assert.throws(() => prepareTabularImport(state, file(csv), { mode: 'course', targetPersonId: state.profiles[0].id, sheetName: 'CSV', mapping: courseMapping() }), /请先配置该人物的学期与节次/);
  const academic = apply(state, { type: 'save', entity: 'profiles', value: { ...state.profiles[0], startDate: '2026-09-14', weeks: 16, periods } }, NOW);
  const session = prepareTabularImport(academic, file(csv), { mode: 'course', targetPersonId: academic.profiles[0].id, sheetName: 'CSV', mapping: courseMapping() }, 'course-session');
  const value = session.candidates[0].reviewedValue as TabularCandidateValue;
  assert.equal(value.entity, 'courses');
  assert.deepEqual((value.value as import('../src/types.ts').Course).weeks, [1, 3, 5, 7, 9, 11, 13, 15]);
  assert.equal((value.value as import('../src/types.ts').Course).weekday, 2);
  assert.deepEqual([(value.value as import('../src/types.ts').Course).first, (value.value as import('../src/types.ts').Course).last], [3, 4]);
  const committed = commitImport(academic, reviewAll(session), NOW).state;
  assert.equal(committed.courses.length, 1);
  assert.equal(occurrences(committed, epoch('2026-09-14'), epoch('2026-09-21'), academic.profiles[0].id).length, 1);
  assert.deepEqual(parseAcademicWeekday('周一').value, 1);
  assert.deepEqual(parseAcademicWeekday('7').value, 7);
  assert.deepEqual(parseAcademicWeeks('1、3、5', 16).weeks, [1, 3, 5]);
  assert.deepEqual(parseAcademicWeeks('1-16(双)', 16).weeks, [2, 4, 6, 8, 10, 12, 14, 16]);
  assert.deepEqual(parseAcademicPeriodRange('3-4').first, 3);
  const out = prepareTabularImport(academic, file('课程名,星期,周次,节次\n课程,周一,17,3'), { mode: 'course', targetPersonId: academic.profiles[0].id, sheetName: 'CSV', mapping: mapping(1, [{ sourceColumn: 0, field: 'title' }, { sourceColumn: 1, field: 'weekday' }, { sourceColumn: 2, field: 'weeks' }, { sourceColumn: 3, field: 'periodRange' }]) });
  assert.ok(out.candidates[0].issues.some(item => item.code === 'tabular.weeks_out_of_range'));
});

test('Case U/V/Y：同源行保守判重，不同来源相似日程只给 warning，旧数据不覆盖', () => {
  const csv = '日期,开始时间,结束时间,标题,地点\n2026-09-18,09:00,10:30,相似会议,实验室';
  const state = createFreshState(NOW);
  const sourceMap = mapping(1, [
    { sourceColumn: 0, field: 'date' }, { sourceColumn: 1, field: 'startTime' }, { sourceColumn: 2, field: 'endTime' },
    { sourceColumn: 3, field: 'title' }, { sourceColumn: 4, field: 'location' },
  ]);
  const first = commitImport(state, reviewAll(eventSession(state, file(csv, 'csv', 'a'.repeat(64)), sourceMap)), NOW).state;
  const same = eventSession(first, file(csv, 'csv', 'a'.repeat(64), 'again.csv'), sourceMap);
  assert.ok(same.candidates[0].issues.some(item => item.code === 'tabular.duplicate_source'));
  const other = eventSession(first, file(csv, 'csv', 'b'.repeat(64), 'other.csv'), sourceMap);
  assert.ok(other.candidates[0].issues.some(item => item.code === 'tabular.similar_event' && item.severity === 'warning'));
  const imported = commitImport(first, reviewAll(other), NOW).state;
  assert.equal(imported.events.length, 2);
  assert.equal(imported.events.find(event => event.provenance?.source.fingerprint === 'a'.repeat(64))?.title, '相似会议');
});
