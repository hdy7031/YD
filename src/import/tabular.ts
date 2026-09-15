import { activeProfiles } from '../people.ts';
import { academicPresence } from '../academic.ts';
import type { Course, Event, PersonId, State } from '../types.ts';
import type {
  CandidateValidator,
  ImportCandidateDraft,
  ImportSession,
  Importer,
  RawSource,
  ScheduleCandidateValue,
  ValidationIssue,
} from './types.ts';
import { createImportSession, parseImportSession, sourceReference } from './session.ts';
import { scheduleCandidateValidator, validateImportSession } from './validation.ts';

export const TABULAR_IMPORTER_ID = 'tabular-v1';
export const MAX_TABULAR_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_TABULAR_ROWS = 2_200;
export const MAX_TABULAR_COLUMNS = 100;
export const MAX_TABULAR_SHEETS = 20;
export const MAX_TABULAR_COMMIT_BYTES = 24 * 1024 * 1024;

export type TabularFormat = 'csv' | 'xlsx';
export type TabularImportMode = 'event' | 'course';
export type TabularCellType = 'blank' | 'string' | 'number' | 'boolean' | 'date' | 'error';
export type TabularCellScalar = string | number | boolean | null;

/** A renderer-safe, file-format-neutral cell. Dates are canonical spreadsheet wall-clock text. */
export interface NormalizedCell {
  type: TabularCellType;
  value: TabularCellScalar;
  formula?: boolean;
  cached?: boolean;
}

export interface NormalizedRow {
  /** One-based source row number. CSV logical records use the same identity. */
  rowNumber: number;
  cells: NormalizedCell[];
}

export interface NormalizedSheet {
  name: string;
  hidden: boolean;
  rows: NormalizedRow[];
  rowCount: number;
  columnCount: number;
}

export interface NormalizedTable {
  format: TabularFormat;
  sheets: NormalizedSheet[];
}

export interface TabularFileSelection {
  originalName: string;
  size: number;
  createdAt: number;
  fingerprint: string;
  format: TabularFormat;
  table: NormalizedTable;
}

export type EventTabularField = 'title' | 'date' | 'startTime' | 'endTime' | 'startDateTime' | 'endDateTime' | 'location' | 'notes';
export type CourseTabularField = 'title' | 'weekday' | 'weeks' | 'startPeriod' | 'endPeriod' | 'periodRange' | 'location' | 'notes';
export type TabularField = EventTabularField | CourseTabularField;

export interface TabularMappingEntry {
  sourceColumn: number;
  field: TabularField;
}

export interface TabularColumnMapping {
  /** One-based source row selected as the header. */
  headerRow: number;
  entries: TabularMappingEntry[];
}

export interface TabularSourceCell {
  column: string;
  value: TabularCellScalar;
  type: TabularCellType;
  formula?: boolean;
  cached?: boolean;
}

export interface TabularCandidateDisplay {
  mode: TabularImportMode;
  title: string;
  primary: string;
  place?: string;
  rowNumber: number;
}

export interface TabularCandidateMetadata {
  format: TabularFormat;
  mode: TabularImportMode;
  sheetName: string;
  rowNumber: number;
  headerRow: number;
  mapping: TabularColumnMapping;
  headers: string[];
  sourceRow: TabularSourceCell[];
  parseIssues: ValidationIssue[];
}

export interface TabularCandidateValue extends ScheduleCandidateValue {
  entity: 'events' | 'courses';
  value: Event | Course;
  sourceRecordId: string;
  display: TabularCandidateDisplay;
  metadata: TabularCandidateMetadata;
}

export interface TabularInput {
  table: NormalizedTable;
  mode: TabularImportMode;
  targetPersonId: PersonId;
  sheetName: string;
  mapping: TabularColumnMapping;
  /** Ephemeral target-calendar limits used during parsing; never copied to provenance. */
  academic?: { weeks: number; periodCount: number };
}

export type TabularImportSession = ImportSession<ScheduleCandidateValue, TabularInput>;

export interface TabularPrepareOptions {
  mode: TabularImportMode;
  targetPersonId: PersonId;
  sheetName: string;
  mapping: TabularColumnMapping;
}

export interface TabularFieldDefinition {
  field: TabularField;
  label: string;
  required?: boolean;
}

export const EVENT_TABULAR_FIELDS: readonly TabularFieldDefinition[] = [
  { field: 'title', label: '标题', required: true },
  { field: 'date', label: '日期' },
  { field: 'startTime', label: '开始时间' },
  { field: 'endTime', label: '结束时间' },
  { field: 'startDateTime', label: '开始日期时间' },
  { field: 'endDateTime', label: '结束日期时间' },
  { field: 'location', label: '地点' },
  { field: 'notes', label: '备注' },
];

export const COURSE_TABULAR_FIELDS: readonly TabularFieldDefinition[] = [
  { field: 'title', label: '课程名', required: true },
  { field: 'weekday', label: '星期', required: true },
  { field: 'weeks', label: '周次', required: true },
  { field: 'startPeriod', label: '开始节次' },
  { field: 'endPeriod', label: '结束节次' },
  { field: 'periodRange', label: '节次范围' },
  { field: 'location', label: '地点' },
  { field: 'notes', label: '备注' },
];

const clone = <T>(value: T): T => structuredClone(value);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
const issue = (code: string, message: string, severity: ValidationIssue['severity'] = 'error', path?: string): ValidationIssue => ({ code, message, severity, ...(path ? { path } : {}) });
const isPersonId = (value: unknown): value is PersonId => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function hashId(value: string): string {
  let left = 2166136261;
  let right = 2246822519;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 16777619);
    right = Math.imul(right ^ code, 3266489917);
  }
  return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`;
}

export function columnLabel(index: number): string {
  assert(Number.isInteger(index) && index >= 0, '表格列编号无效');
  let value = index + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

export function emptyCell(): NormalizedCell {
  return { type: 'blank', value: null };
}

export function cellIsEmpty(cell: NormalizedCell | undefined): boolean {
  if (!cell || cell.type === 'blank' || cell.value === null) return true;
  return typeof cell.value === 'string' && cell.value.trim() === '';
}

export function cellText(cell: NormalizedCell | undefined): string {
  if (cellIsEmpty(cell)) return '';
  if (!cell) return '';
  if (cell.type === 'date' && typeof cell.value === 'string') return cell.value.replace('T', ' ');
  if (typeof cell.value === 'boolean') return cell.value ? 'true' : 'false';
  return String(cell.value).trim();
}

export function sheetOf(table: NormalizedTable, name: string): NormalizedSheet | undefined {
  return table.sheets.find(sheet => sheet.name === name);
}

export function headerRowFor(sheet: NormalizedSheet): number | undefined {
  return sheet.rows.find(row => row.cells.some(cell => !cellIsEmpty(cell)))?.rowNumber;
}

export function headersFor(sheet: NormalizedSheet, headerRow: number): string[] {
  const row = sheet.rows.find(item => item.rowNumber === headerRow);
  const width = Math.max(sheet.columnCount, row?.cells.length ?? 0);
  return Array.from({ length: width }, (_, index) => cellText(row?.cells[index]));
}

export function previewRows(sheet: NormalizedSheet, headerRow: number, count = 10): NormalizedRow[] {
  return sheet.rows.filter(row => row.rowNumber >= headerRow && !row.cells.every(cell => cellIsEmpty(cell))).slice(0, count);
}

function allowedFields(mode: TabularImportMode): readonly TabularFieldDefinition[] {
  return mode === 'event' ? EVENT_TABULAR_FIELDS : COURSE_TABULAR_FIELDS;
}

export function tabularFieldLabel(field: TabularField): string {
  return [...EVENT_TABULAR_FIELDS, ...COURSE_TABULAR_FIELDS].find(item => item.field === field)?.label ?? field;
}

function fieldsOf(mapping: TabularColumnMapping): Set<TabularField> {
  return new Set(mapping.entries.map(entry => entry.field));
}

function sourceForField(mapping: TabularColumnMapping, field: TabularField): number | undefined {
  return mapping.entries.find(entry => entry.field === field)?.sourceColumn;
}

export function validateTabularMapping(
  table: NormalizedTable,
  mode: TabularImportMode,
  sheetName: string,
  mapping: TabularColumnMapping,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!table || (table.format !== 'csv' && table.format !== 'xlsx')) issues.push(issue('tabular.format_invalid', '表格格式不受支持。'));
  const sheet = table && sheetOf(table, sheetName);
  if (!sheet) issues.push(issue('tabular.sheet_missing', '所选工作表不存在。'));
  if (!mapping || !Number.isInteger(mapping.headerRow) || mapping.headerRow < 1 || !sheet?.rows.some(row => row.rowNumber === mapping.headerRow)) {
    issues.push(issue('tabular.header_invalid', '请选择有效的表头行。', 'error', 'headerRow'));
  }
  if (!mapping || !Array.isArray(mapping.entries)) {
    issues.push(issue('tabular.mapping_invalid', '列映射格式无效。'));
    return issues;
  }
  if (!sheet || issues.some(item => item.severity === 'error' && (item.code === 'tabular.header_invalid' || item.code === 'tabular.format_invalid' || item.code === 'tabular.sheet_missing'))) return issues;
  const allowed = new Set(allowedFields(mode).map(item => item.field));
  const usedColumns = new Set<number>();
  const usedFields = new Set<TabularField>();
  for (const entry of mapping.entries) {
    if (!entry || !Number.isInteger(entry.sourceColumn) || entry.sourceColumn < 0 || entry.sourceColumn >= (sheet?.columnCount ?? MAX_TABULAR_COLUMNS)) {
      issues.push(issue('tabular.mapping_column_invalid', '映射的来源列无效。'));
      continue;
    }
    if (usedColumns.has(entry.sourceColumn)) issues.push(issue('tabular.mapping_column_duplicate', `来源列 ${columnLabel(entry.sourceColumn)} 被重复映射。`));
    usedColumns.add(entry.sourceColumn);
    if (typeof entry.field !== 'string' || !allowed.has(entry.field)) {
      issues.push(issue('tabular.mapping_field_invalid', '映射的目标字段不属于当前导入类型。'));
      continue;
    }
    if (usedFields.has(entry.field)) issues.push(issue('tabular.mapping_field_duplicate', `目标字段“${tabularFieldLabel(entry.field)}”被重复映射。`));
    usedFields.add(entry.field);
    const header = headersFor(sheet!, mapping.headerRow)[entry.sourceColumn];
    if (!header?.trim()) issues.push(issue('tabular.header_missing', `映射列 ${columnLabel(entry.sourceColumn)} 的表头为空。`));
  }
  if (issues.some(item => item.severity === 'error' && item.code.startsWith('tabular.mapping_'))) return issues;

  if (!usedFields.has('title')) issues.push(issue('tabular.mapping_required', '请映射标题列。'));
  if (mode === 'event') {
    const split = ['date', 'startTime', 'endTime'].filter(field => usedFields.has(field as EventTabularField));
    const datetime = ['startDateTime', 'endDateTime'].filter(field => usedFields.has(field as EventTabularField));
    const splitComplete = split.length === 3;
    const datetimeComplete = datetime.length === 2;
    if (split.length > 0 && datetime.length > 0) issues.push(issue('tabular.mapping_time_layout_conflict', '普通日程只能选择“日期+开始/结束时间”或“开始/结束日期时间”其中一种布局。'));
    else if (!splitComplete && !datetimeComplete) {
      if (split.length > 0) issues.push(issue('tabular.mapping_time_layout_incomplete', '拆分时间布局必须同时映射日期、开始时间和结束时间。'));
      else if (datetime.length > 0) issues.push(issue('tabular.mapping_datetime_incomplete', '完整日期时间布局必须同时映射开始日期时间和结束日期时间。'));
      else issues.push(issue('tabular.mapping_time_required', '请映射一组完整的时间列。'));
    }
  } else {
    for (const field of ['weekday', 'weeks'] as CourseTabularField[]) {
      if (!usedFields.has(field)) issues.push(issue('tabular.mapping_required', `请映射${tabularFieldLabel(field)}列。`));
    }
    const periodPair = usedFields.has('startPeriod') || usedFields.has('endPeriod');
    const periodRange = usedFields.has('periodRange');
    if (periodPair && periodRange) issues.push(issue('tabular.mapping_period_layout_conflict', '课程表只能选择“开始/结束节次”或“节次范围”其中一种布局。'));
    else if (periodPair && !(usedFields.has('startPeriod') && usedFields.has('endPeriod'))) issues.push(issue('tabular.mapping_period_layout_incomplete', '节次拆分布局必须同时映射开始节次和结束节次。'));
    else if (!periodPair && !periodRange) issues.push(issue('tabular.mapping_period_required', '请映射节次范围，或同时映射开始节次和结束节次。'));
  }
  return issues;
}

function normalizedHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]/g, '');
}

/** Deterministic, conservative suggestions. A header with no unique meaning remains unmapped. */
export function suggestTabularField(header: string, mode: TabularImportMode): TabularField | undefined {
  const value = normalizedHeader(header);
  if (!value) return undefined;
  const event: Record<string, EventTabularField> = {
    '标题': 'title', '名称': 'title', '事件': 'title', '事件名称': 'title', '日程': 'title',
    '日期': 'date', '开始日期': 'date',
    '开始时间': 'startTime', '起始时间': 'startTime',
    '结束时间': 'endTime', '截止时间': 'endTime',
    '开始日期时间': 'startDateTime', '开始时间日期': 'startDateTime', '开始datetime': 'startDateTime',
    '结束日期时间': 'endDateTime', '结束时间日期': 'endDateTime', '结束datetime': 'endDateTime',
    '地点': 'location', '位置': 'location', '教室': 'location',
    '备注': 'notes', '说明': 'notes', '描述': 'notes',
  };
  const course: Record<string, CourseTabularField> = {
    '课程': 'title', '课程名': 'title', '课程名称': 'title', '科目': 'title', '标题': 'title', '名称': 'title',
    '星期': 'weekday', '周几': 'weekday', '上课星期': 'weekday',
    '周次': 'weeks', '教学周': 'weeks', '上课周次': 'weeks',
    '开始节次': 'startPeriod', '起始节次': 'startPeriod',
    '结束节次': 'endPeriod', '终止节次': 'endPeriod',
    '节次': 'periodRange', '节次范围': 'periodRange', '上课节次': 'periodRange',
    '地点': 'location', '位置': 'location', '教室': 'location',
    '备注': 'notes', '说明': 'notes', '描述': 'notes',
  };
  return mode === 'event' ? event[value] : course[value];
}

export function suggestTabularMapping(sheet: NormalizedSheet, mode: TabularImportMode, headerRow: number): TabularColumnMapping {
  const headers = headersFor(sheet, headerRow);
  const suggestions = headers.map(header => suggestTabularField(header, mode));
  const counts = new Map<TabularField, number>();
  for (const field of suggestions) if (field) counts.set(field, (counts.get(field) ?? 0) + 1);
  return {
    headerRow,
    entries: suggestions.flatMap((field, sourceColumn) => field && counts.get(field) === 1 ? [{ sourceColumn, field }] : []),
  };
}

function validDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function dateTextParts(value: string): [number, number, number] | undefined {
  const text = value.trim();
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
    ?? /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text)
    ?? /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(text);
  if (!match) return undefined;
  const parts: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return validDateParts(...parts) ? parts : undefined;
}

export function parseTabularDate(cell: NormalizedCell | undefined): { value?: string; issue?: ValidationIssue } {
  const raw = cellText(cell);
  if (!raw) return { issue: issue('tabular.date_missing', '日期为空或无法读取。', 'error', 'date') };
  const source = cell?.type === 'date' ? raw.slice(0, 10) : raw;
  const parts = dateTextParts(source);
  if (!parts) return { issue: issue('tabular.date_ambiguous', '日期格式不明确，请使用 YYYY-MM-DD、YYYY/M/D 或 YYYY年M月D日。', 'error', 'date') };
  return { value: `${parts[0].toString().padStart(4, '0')}-${parts[1].toString().padStart(2, '0')}-${parts[2].toString().padStart(2, '0')}` };
}

function timeText(cell: NormalizedCell | undefined): string {
  const raw = cellText(cell);
  if (cell?.type === 'date' && /^\d{4}-\d{2}-\d{2}T/.test(String(cell.value))) return String(cell.value).slice(11, 16);
  return raw;
}

export function parseTabularTime(cell: NormalizedCell | undefined, field: string): { value?: string; issue?: ValidationIssue } {
  const raw = timeText(cell);
  if (!raw) return { issue: issue('tabular.time_missing', `${field}为空或无法读取。`, 'error', field) };
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return { issue: issue('tabular.time_invalid', `${field}格式无效，请使用 H:mm 或 HH:mm。`, 'error', field) };
  return { value: `${Number(match[1]).toString().padStart(2, '0')}:${match[2]}` };
}

export function parseTabularDateTime(cell: NormalizedCell | undefined, field: string): { value?: string; issue?: ValidationIssue } {
  const raw = cellText(cell);
  if (!raw) return { issue: issue('tabular.datetime_missing', `${field}为空或无法读取。`, 'error', field) };
  if (cell?.type === 'date' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(String(cell.value))) {
    const stamp = String(cell.value).replace('T', ' ');
    if (stamp.length > 16 && stamp.slice(16) !== ':00') return { issue: issue('tabular.datetime_seconds', `${field}包含非零秒数，当前日程只能保存到分钟。`, 'error', field) };
    return { value: stamp.slice(0, 16).replace(' ', 'T') };
  }
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/.exec(raw)
    ?? /^(\d{4})\/(\d{1,2})\/(\d{1,2})[ T](\d{1,2}):(\d{2})$/.exec(raw)
    ?? /^(\d{4})年(\d{1,2})月(\d{1,2})日[ T](\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return { issue: issue('tabular.datetime_invalid', `${field}格式不明确，请使用 YYYY-MM-DD HH:mm、YYYY/M/D H:mm 或 YYYY年M月D日 H:mm。`, 'error', field) };
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]), hour = Number(match[4]), minute = Number(match[5]);
  if (!validDateParts(year, month, day) || hour > 23 || minute > 59) return { issue: issue('tabular.datetime_invalid', `${field}的日期或时间无效。`, 'error', field) };
  return { value: `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}` };
}

const WEEKDAY_NAMES: Record<string, number> = {
  '周一': 1, '周二': 2, '周三': 3, '周四': 4, '周五': 5, '周六': 6, '周日': 7,
  '星期一': 1, '星期二': 2, '星期三': 3, '星期四': 4, '星期五': 5, '星期六': 6, '星期日': 7,
};

export function parseAcademicWeekday(value: string | NormalizedCell | undefined): { value?: number; issue?: ValidationIssue } {
  const raw = typeof value === 'string' ? value.trim() : cellText(value);
  if (!raw) return { issue: issue('tabular.weekday_missing', '星期为空。', 'error', 'weekday') };
  if (/^[1-7]$/.test(raw)) return { value: Number(raw) };
  if (WEEKDAY_NAMES[raw]) return { value: WEEKDAY_NAMES[raw] };
  return { issue: issue('tabular.weekday_invalid', '星期格式无效，请使用 1–7、周一至周日或星期一至星期日。', 'error', 'weekday') };
}

export interface AcademicWeeksResult {
  weeks?: number[];
  issue?: ValidationIssue;
}

export function parseAcademicWeeks(value: string | NormalizedCell | undefined, maxWeeks: number): AcademicWeeksResult {
  const raw = typeof value === 'string' ? value.trim() : cellText(value);
  if (!raw) return { issue: issue('tabular.weeks_missing', '周次为空。', 'error', 'weeks') };
  if (!Number.isInteger(maxWeeks) || maxWeeks < 1) return { issue: issue('tabular.weeks_profile_invalid', '目标人物的教学周配置无效。', 'error', 'weeks') };
  let text = raw.replace(/^第\s*/, '').replace(/周\s*$/, '').trim();
  let parity: 'odd' | 'even' | undefined;
  const parityMatch = /(单周?|双周?)$/.exec(text);
  if (parityMatch) {
    parity = parityMatch[1].startsWith('单') ? 'odd' : 'even';
    text = text.slice(0, parityMatch.index).trim();
  }
  const parenthesized = /^(.+?)\s*[（(]\s*(单|双)\s*[）)]$/.exec(text);
  if (parenthesized) {
    if (parity && parity !== (parenthesized[2] === '单' ? 'odd' : 'even')) return { issue: issue('tabular.weeks_invalid', '周次的单周/双周标记冲突。', 'error', 'weeks') };
    parity = parenthesized[2] === '单' ? 'odd' : 'even';
    text = parenthesized[1].trim();
  }
  const tokens = text.split(/[，,、]/).map(token => token.trim()).filter(Boolean);
  if (!tokens.length) return { issue: issue('tabular.weeks_invalid', '周次格式无效。', 'error', 'weeks') };
  const values: number[] = [];
  for (const token of tokens) {
    const single = /^(\d+)$/.exec(token);
    const range = /^(\d+)\s*[-~—～]\s*(\d+)$/.exec(token);
    if (single) values.push(Number(single[1]));
    else if (range) {
      const start = Number(range[1]), end = Number(range[2]);
      if (start > end) return { issue: issue('tabular.weeks_invalid', '周次范围的开始周不能大于结束周。', 'error', 'weeks') };
      for (let week = start; week <= end; week += 1) if (!parity || parity === 'odd' && week % 2 === 1 || parity === 'even' && week % 2 === 0) values.push(week);
    } else return { issue: issue('tabular.weeks_invalid', '周次格式不受支持，请使用 1-16、1,3,5 或单/双周范围。', 'error', 'weeks') };
  }
  const weeks = [...new Set(values)].sort((a, b) => a - b);
  if (!weeks.length || weeks.some(week => !Number.isInteger(week) || week < 1)) return { issue: issue('tabular.weeks_invalid', '周次必须至少包含第 1 周。', 'error', 'weeks') };
  if (weeks.some(week => week > maxWeeks)) return { issue: issue('tabular.weeks_out_of_range', `周次超出目标人物已配置的 ${maxWeeks} 周学期。`, 'error', 'weeks') };
  return { weeks };
}

export function parseAcademicPeriodRange(value: string | NormalizedCell | undefined): { first?: number; last?: number; issue?: ValidationIssue } {
  const raw = typeof value === 'string' ? value.trim() : cellText(value);
  if (!raw) return { issue: issue('tabular.period_missing', '节次为空。', 'error', 'periods') };
  const match = /^(\d+)\s*[-~—～]\s*(\d+)(?:\s*节)?$/.exec(raw) ?? /^(\d+)(?:\s*节)?$/.exec(raw);
  if (!match) return { issue: issue('tabular.period_invalid', '节次格式无效，请使用 3、3-4、3~4 或 3—4。', 'error', 'periods') };
  const first = Number(match[1]), last = Number(match[2] ?? match[1]);
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first) return { issue: issue('tabular.period_invalid', '节次范围无效。', 'error', 'periods') };
  return { first, last };
}

function sourceRecordIdFor(sheetName: string, rowNumber: number): string {
  return `${sheetName}#row-${rowNumber}`;
}

function candidateIdFor(input: TabularInput, rowNumber: number): string {
  return `tabular-candidate-${hashId(`${input.targetPersonId}|${input.mode}|${input.sheetName}|${rowNumber}`)}`;
}

function formalIdFor(source: RawSource<TabularInput>, input: TabularInput, rowNumber: number): string {
  return `tabular-${input.mode}-${hashId(`${input.targetPersonId}|${source.fingerprint}|${input.sheetName}|${rowNumber}`)}`;
}

function sourceRowFor(row: NormalizedRow): TabularSourceCell[] {
  return row.cells.map((cell, index) => ({
    column: columnLabel(index), value: clone(cell.value), type: cell.type,
    ...(cell.formula === undefined ? {} : { formula: cell.formula }),
    ...(cell.cached === undefined ? {} : { cached: cell.cached }),
  }));
}

function cellFor(row: NormalizedRow, mapping: TabularColumnMapping, field: TabularField): NormalizedCell | undefined {
  const column = sourceForField(mapping, field);
  return column === undefined ? undefined : row.cells[column];
}

function requiredCell(row: NormalizedRow, mapping: TabularColumnMapping, field: TabularField, label = tabularFieldLabel(field)): { cell?: NormalizedCell; issues: ValidationIssue[] } {
  const cell = cellFor(row, mapping, field);
  return cellIsEmpty(cell) ? { cell, issues: [issue('tabular.required_missing', `${label}为空。`, 'error', field)] } : { cell, issues: [] };
}

function eventCandidate(source: RawSource<TabularInput>, input: TabularInput, sheet: NormalizedSheet, row: NormalizedRow, headers: string[]): ImportCandidateDraft<ScheduleCandidateValue> {
  const issues: ValidationIssue[] = [];
  const titleCell = requiredCell(row, input.mapping, 'title');
  issues.push(...titleCell.issues);
  const title = cellText(titleCell.cell);
  let start = '', end = '';
  const fields = fieldsOf(input.mapping);
  if (fields.has('date')) {
    const dateCell = requiredCell(row, input.mapping, 'date', '日期');
    const startCell = requiredCell(row, input.mapping, 'startTime', '开始时间');
    const endCell = requiredCell(row, input.mapping, 'endTime', '结束时间');
    issues.push(...dateCell.issues, ...startCell.issues, ...endCell.issues);
    const parsedDate = parseTabularDate(dateCell.cell);
    const parsedStart = parseTabularTime(startCell.cell, '开始时间');
    const parsedEnd = parseTabularTime(endCell.cell, '结束时间');
    if (!dateCell.issues.length && parsedDate.issue) issues.push(parsedDate.issue);
    if (!startCell.issues.length && parsedStart.issue) issues.push(parsedStart.issue);
    if (!endCell.issues.length && parsedEnd.issue) issues.push(parsedEnd.issue);
    if (parsedDate.value && parsedStart.value) start = `${parsedDate.value}T${parsedStart.value}`;
    if (parsedDate.value && parsedEnd.value) end = `${parsedDate.value}T${parsedEnd.value}`;
  } else {
    const startCell = requiredCell(row, input.mapping, 'startDateTime', '开始日期时间');
    const endCell = requiredCell(row, input.mapping, 'endDateTime', '结束日期时间');
    issues.push(...startCell.issues, ...endCell.issues);
    const parsedStart = parseTabularDateTime(startCell.cell, '开始日期时间');
    const parsedEnd = parseTabularDateTime(endCell.cell, '结束日期时间');
    if (!startCell.issues.length && parsedStart.issue) issues.push(parsedStart.issue);
    if (!endCell.issues.length && parsedEnd.issue) issues.push(parsedEnd.issue);
    start = parsedStart.value ?? '';
    end = parsedEnd.value ?? '';
  }
  const place = cellText(cellFor(row, input.mapping, 'location'));
  const notes = cellText(cellFor(row, input.mapping, 'notes'));
  const value: Event = {
    id: formalIdFor(source, input, row.rowNumber), person: input.targetPersonId, title, start, end: end || null,
    place, notes, reminders: [], checklist: [], updatedAt: 0,
  };
  const sourceRecordId = sourceRecordIdFor(input.sheetName, row.rowNumber);
  const wrapper: TabularCandidateValue = {
    entity: 'events', value, sourceRecordId,
    display: { mode: 'event', title: title || '（缺少标题）', primary: start && end ? `${start} — ${end}` : '时间无法解析', ...(place ? { place } : {}), rowNumber: row.rowNumber },
    metadata: { format: source.metadata?.format === 'xlsx' ? 'xlsx' : 'csv', mode: input.mode, sheetName: input.sheetName, rowNumber: row.rowNumber, headerRow: input.mapping.headerRow, mapping: clone(input.mapping), headers: clone(headers), sourceRow: sourceRowFor(row), parseIssues: clone(issues) },
  };
  return { id: candidateIdFor(input, row.rowNumber), value: wrapper };
}

function courseCandidate(source: RawSource<TabularInput>, input: TabularInput, sheet: NormalizedSheet, row: NormalizedRow, headers: string[]): ImportCandidateDraft<ScheduleCandidateValue> {
  const issues: ValidationIssue[] = [];
  const titleCell = requiredCell(row, input.mapping, 'title', '课程名');
  const weekdayCell = requiredCell(row, input.mapping, 'weekday', '星期');
  const weeksCell = requiredCell(row, input.mapping, 'weeks', '周次');
  issues.push(...titleCell.issues, ...weekdayCell.issues, ...weeksCell.issues);
  const title = cellText(titleCell.cell);
  const parsedWeekday = parseAcademicWeekday(weekdayCell.cell);
  const parsedWeeks = parseAcademicWeeks(weeksCell.cell, input.academic?.weeks ?? 60);
  if (!weekdayCell.issues.length && parsedWeekday.issue) issues.push(parsedWeekday.issue);
  if (!weeksCell.issues.length && parsedWeeks.issue) issues.push(parsedWeeks.issue);
  let first = 0, last = 0;
  if (fieldsOf(input.mapping).has('periodRange')) {
    const periodCell = requiredCell(row, input.mapping, 'periodRange', '节次范围');
    issues.push(...periodCell.issues);
    const parsed = parseAcademicPeriodRange(periodCell.cell);
    if (!periodCell.issues.length && parsed.issue) issues.push(parsed.issue);
    first = parsed.first ?? 0; last = parsed.last ?? 0;
  } else {
    const firstCell = requiredCell(row, input.mapping, 'startPeriod', '开始节次');
    const lastCell = requiredCell(row, input.mapping, 'endPeriod', '结束节次');
    issues.push(...firstCell.issues, ...lastCell.issues);
    const parsedFirst = parseAcademicPeriodRange(firstCell.cell);
    const parsedLast = parseAcademicPeriodRange(lastCell.cell);
    if (!firstCell.issues.length && parsedFirst.issue) issues.push({ ...parsedFirst.issue, path: 'startPeriod' });
    if (!lastCell.issues.length && parsedLast.issue) issues.push({ ...parsedLast.issue, path: 'endPeriod' });
    first = parsedFirst.first ?? 0; last = parsedLast.last ?? 0;
  }
  const periodCount = input.academic?.periodCount ?? 24;
  if (first > 0 && last > 0 && (first > periodCount || last > periodCount)) {
    issues.push(issue('tabular.period_out_of_range', `节次超出目标人物已配置的 ${periodCount} 节。`, 'error', 'periods'));
  }
  const place = cellText(cellFor(row, input.mapping, 'location'));
  const notes = cellText(cellFor(row, input.mapping, 'notes'));
  const value: Course = {
    id: formalIdFor(source, input, row.rowNumber), person: input.targetPersonId, title, place, notes, weekday: parsedWeekday.value ?? 0,
    first, last, weeks: parsedWeeks.weeks ?? [], reminders: [], checklist: [], activity: 'teaching', updatedAt: 0,
  };
  const sourceRecordId = sourceRecordIdFor(input.sheetName, row.rowNumber);
  const wrapper: TabularCandidateValue = {
    entity: 'courses', value, sourceRecordId,
    display: { mode: 'course', title: title || '（缺少课程名）', primary: parsedWeekday.value && first && last ? `星期${'一二三四五六日'[parsedWeekday.value - 1]} · 第 ${first}-${last} 节 · ${parsedWeeks.weeks?.join(',') ?? '周次无法解析'} 周` : '课程语义无法解析', ...(place ? { place } : {}), rowNumber: row.rowNumber },
    metadata: { format: source.metadata?.format === 'xlsx' ? 'xlsx' : 'csv', mode: input.mode, sheetName: input.sheetName, rowNumber: row.rowNumber, headerRow: input.mapping.headerRow, mapping: clone(input.mapping), headers: clone(headers), sourceRow: sourceRowFor(row), parseIssues: clone(issues) },
  };
  return { id: candidateIdFor(input, row.rowNumber), value: wrapper };
}

export function parseTabularRows(source: RawSource<TabularInput>): readonly ImportCandidateDraft<ScheduleCandidateValue>[] {
  const input = source.input;
  assert(input && (input.mode === 'event' || input.mode === 'course'), '表格导入类型无效。');
  const sheet = sheetOf(input.table, input.sheetName);
  assert(sheet, '所选工作表不存在。');
  const mappingIssues = validateTabularMapping(input.table, input.mode, input.sheetName, input.mapping);
  const blocking = mappingIssues.filter(item => item.severity === 'error');
  if (blocking.length) throw new Error(`表头或列映射无效：${blocking.map(item => item.message).join('；')}`);
  const headers = headersFor(sheet, input.mapping.headerRow);
  const candidates: ImportCandidateDraft<ScheduleCandidateValue>[] = [];
  for (const row of sheet.rows) {
    if (row.rowNumber <= input.mapping.headerRow || row.cells.every(cell => cellIsEmpty(cell))) continue;
    if (input.mode === 'event') candidates.push(eventCandidate(source, input, sheet, row, headers));
    else {
      // The precondition is checked before session creation and again in the validator.
      assert(input.academic, '课程导入缺少目标人物学期配置。');
      candidates.push(courseCandidate(source, input, sheet, row, headers));
    }
  }
  if (!candidates.length) throw new Error('表头之后没有可导入的数据行。');
  return candidates;
}

function eventContent(value: Event): string {
  return JSON.stringify([value.person ?? '', value.title, value.start, value.end, value.place, value.notes]);
}

function courseContent(value: Course): string {
  return JSON.stringify([value.person, value.title, value.weekday, value.first, value.last, [...value.weeks].sort((a, b) => a - b), value.place]);
}

function isTabularValue(value: unknown): value is TabularCandidateValue {
  if (!isRecord(value)) return false;
  const candidate = value as Partial<TabularCandidateValue>;
  return (candidate.entity === 'events' || candidate.entity === 'courses')
    && isRecord(candidate.value) && typeof candidate.sourceRecordId === 'string'
    && isRecord(candidate.metadata) && isRecord(candidate.display);
}

function sameSourceRecord(provenance: NonNullable<Event['provenance']> | undefined, source: RawSource<TabularInput>, sourceRecordId: string, personId: PersonId): boolean {
  return !!(provenance
    && provenance.importer === TABULAR_IMPORTER_ID
    && provenance.source.fingerprint === source.fingerprint
    && provenance.sourceRecordId === sourceRecordId
    && provenance.source.metadata?.sheet === source.metadata?.sheet
    && (provenance.reviewedValue as Partial<TabularCandidateValue>)?.value && ((provenance.reviewedValue as TabularCandidateValue).value as Event | Course).person === personId);
}

function candidateIssuesForExisting(state: State, source: RawSource<TabularInput>, candidate: TabularCandidateValue, session: TabularImportSession, candidateId: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const value = candidate.value;
  const personId = value.person;
  if (!isPersonId(personId)) return [issue('tabular.target_invalid', '表格候选记录缺少有效的目标人物。')];
  const records = candidate.entity === 'events' ? state.events : state.courses;
  for (const existing of records) {
    if (sameSourceRecord(existing.provenance, source, candidate.sourceRecordId, personId)) {
      const same = candidate.entity === 'events'
        ? eventContent(existing as Event) === eventContent(value as Event)
        : courseContent(existing as Course) === courseContent(value as Course);
      issues.push(issue(same ? 'tabular.duplicate_source' : 'tabular.duplicate_changed', same ? '这条来源记录已经导入过，默认不会再次创建。' : '同一来源行已存在但内容不同，当前版本不支持自动覆盖更新。'));
    }
  }
  const duplicateInSession = session.candidates.some(other => other.id !== candidateId
    && isTabularValue(other.originalParsedValue)
    && other.originalParsedValue.entity === candidate.entity
    && other.originalParsedValue.sourceRecordId === candidate.sourceRecordId);
  if (duplicateInSession) issues.push(issue('tabular.duplicate_row', '同一来源行在本次导入中出现多次，无法确定应保留哪一条。'));
  if (candidate.entity === 'events') {
    const similar = state.events.some(event => event.person === personId && eventContent(event) === eventContent(value as Event)
      && !sameSourceRecord(event.provenance, source, candidate.sourceRecordId, personId));
    if (similar) issues.push(issue('tabular.similar_event', '已有内容相同的日程；这是提醒，不会强制阻止导入。', 'warning'));
  } else {
    const similar = state.courses.some(course => course.person === personId && courseContent(course) === courseContent(value as Course)
      && !sameSourceRecord(course.provenance, source, candidate.sourceRecordId, personId));
    if (similar) issues.push(issue('tabular.similar_course', '已有语义相同的课程；这是提醒，不会强制覆盖或阻止导入。', 'warning'));
  }
  return issues;
}

export function tabularCandidateValidator<TInput = TabularInput>(): CandidateValidator<ScheduleCandidateValue, TInput> {
  const domainValidator = scheduleCandidateValidator<TInput>();
  return (value, context) => {
    const issues = [...domainValidator(value, context)];
    if (!isTabularValue(value)) return [...issues, issue('tabular.candidate_invalid', '表格候选记录格式无效。')];
    if (context.session.importer !== TABULAR_IMPORTER_ID) issues.push(issue('tabular.importer_invalid', '候选记录不是由受支持的表格导入器生成。'));
    issues.push(...value.metadata.parseIssues.map(clone));
    const personId = value.value.person;
    if (!isPersonId(personId)) issues.push(issue('tabular.target_invalid', '表格候选记录缺少有效的目标人物。'));
    else if (!activeProfiles(context.state).some(profile => profile.id === personId)) issues.push(issue('tabular.target_inactive', '目标人物当前不在活跃使用方式中，不能导入到该人物。'));
    const mode = context.session.source.metadata?.mode;
    if (mode !== value.metadata.mode || (mode !== 'event' && mode !== 'course')) issues.push(issue('tabular.mode_invalid', '导入类型与候选记录不一致。'));
    if (value.metadata.sheetName !== context.session.source.metadata?.sheet) issues.push(issue('tabular.sheet_invalid', '候选记录与所选工作表不一致。'));
    if (value.sourceRecordId !== sourceRecordIdFor(value.metadata.sheetName, value.metadata.rowNumber)) issues.push(issue('tabular.source_row_invalid', '来源行定位无效。'));
    if (value.metadata.mode === 'course') {
      const profile = context.state.profiles.find(item => item.id === personId);
      const presence = profile ? academicPresence(profile) : 'absent';
      if (presence !== 'complete') issues.push(issue('tabular.academic_required', presence === 'partial' ? '目标人物的学期与节次配置不完整，请先修正配置。' : '请先配置该人物的学期与节次，再导入课程表。'));
    }
    const source = context.session.source as unknown as RawSource<TabularInput>;
    issues.push(...candidateIssuesForExisting(context.state, source, value, context.session as unknown as TabularImportSession, context.candidate.id));
    return issues;
  };
}

function targetProfile(state: State, targetPersonId: PersonId, mode: TabularImportMode): State['profiles'][number] {
  assert(isPersonId(targetPersonId), '表格导入目标人物无效。');
  const profile = state.profiles.find(item => item.id === targetPersonId);
  assert(profile && activeProfiles(state).some(item => item.id === targetPersonId), '目标人物当前不在活跃使用方式中。');
  if (mode === 'course') {
    const presence = academicPresence(profile);
    assert(presence === 'complete', presence === 'partial' ? '请先修正该人物不完整的学期与节次配置。' : '请先配置该人物的学期与节次。');
  }
  return profile;
}

export function rawSourceFromTabularFile(file: TabularFileSelection, options: TabularPrepareOptions, sourceId: string = globalThis.crypto.randomUUID()): RawSource<TabularInput> {
  assert(file && (file.format === 'csv' || file.format === 'xlsx'), '表格文件格式无效。');
  assert(Number.isInteger(file.size) && file.size >= 0 && file.size <= MAX_TABULAR_FILE_BYTES, '表格文件大小无效。');
  assert(typeof file.originalName === 'string' && /^[^\\/]{1,260}$/.test(file.originalName), '表格文件名无效。');
  assert(typeof file.fingerprint === 'string' && /^[^\\/]{1,200}$/.test(file.fingerprint), '表格文件指纹无效。');
  assert(file.table?.format === file.format, '表格解析结果与文件格式不一致。');
  assert(options && (options.mode === 'event' || options.mode === 'course'), '表格导入类型无效。');
  assert(isPersonId(options.targetPersonId), '表格导入目标人物无效。');
  assert(typeof options.sheetName === 'string' && options.sheetName.length > 0 && options.sheetName.length <= 200, '工作表名称无效。');
  return {
    id: sourceId,
    kind: 'structured-file',
    originalName: file.originalName,
    label: file.format === 'csv' ? 'CSV 表格' : 'XLSX 工作簿',
    createdAt: file.createdAt,
    fingerprint: file.fingerprint,
    metadata: { format: file.format, version: 1, size: file.size, sheet: options.sheetName, mode: options.mode, headerRow: options.mapping.headerRow },
    input: { table: clone(file.table), ...clone(options) },
  };
}

export function createTabularImporter(): Importer<TabularInput, ScheduleCandidateValue> {
  return {
    id: TABULAR_IMPORTER_ID,
    target: 'schedule',
    parse(source) {
      if (!source.input || !source.input.table) throw new Error('表格输入内容无效。');
      return parseTabularRows(source);
    },
  };
}

export function prepareTabularImport(
  state: State,
  file: TabularFileSelection,
  options: TabularPrepareOptions,
  sessionId?: string,
): TabularImportSession {
  const profile = targetProfile(state, options.targetPersonId, options.mode);
  const mappingIssues = validateTabularMapping(file.table, options.mode, options.sheetName, options.mapping);
  const blocking = mappingIssues.filter(item => item.severity === 'error');
  if (blocking.length) throw new Error(`表头或列映射无效：${blocking.map(item => item.message).join('；')}`);
  const source = rawSourceFromTabularFile(file, options, sessionId ? `source-${hashId(sessionId)}` : undefined);
  // The calendar limits are carried only in the in-memory raw input. The
  // source reference and provenance intentionally omit this payload.
  if (options.mode === 'course') {
    source.input.academic = { weeks: profile.weeks!, periodCount: profile.periods!.length };
  }
  const created = createImportSession({ id: sessionId, importer: TABULAR_IMPORTER_ID, source, createdAt: file.createdAt });
  const parsed = parseImportSession(created, createTabularImporter());
  if (parsed.status === 'failed') return parsed as TabularImportSession;
  return validateImportSession(parsed, tabularCandidateValidator<TabularInput>(), state) as TabularImportSession;
}

/** Remove the workbook/table payload before IPC commit and long-term provenance. */
export function stripTabularRawInput(session: TabularImportSession): TabularImportSession {
  const input = session.source.input;
  return {
    ...session,
    source: {
      ...sourceReference(session.source),
      input: { table: { format: input?.table?.format ?? 'csv', sheets: [] }, mode: input?.mode ?? 'event', targetPersonId: input?.targetPersonId ?? '', sheetName: input?.sheetName ?? '', mapping: input?.mapping ?? { headerRow: 1, entries: [] } },
    },
  };
}

export function isBlockingTabularImport(session: TabularImportSession): boolean {
  return session.candidates.some(candidate => candidate.reviewState !== 'rejected' && candidate.issues.some(item => item.severity === 'error'));
}
