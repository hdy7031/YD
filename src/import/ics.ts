import { activeProfiles } from '../people.ts';
import type { Event, PersonId, State } from '../types.ts';
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

export const ICS_IMPORTER_ID = 'ics-v1';
export const MAX_ICS_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ICS_EVENT_COUNT = 500;
/** The raw file is removed before commit; this bounds the parsed review payload. */
export const MAX_ICS_COMMIT_BYTES = 24 * 1024 * 1024;
const MAX_ICS_TEXT_LENGTH = 12 * 1024 * 1024;
const MAX_ICS_LINE_COUNT = 250_000;
const MAX_ICS_PROPERTY_LENGTH = 200_000;
const YD_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface ICSFileSelection {
  originalName: string;
  size: number;
  createdAt: number;
  fingerprint: string;
  text: string;
}

export interface ICSInput {
  text: string;
}

export interface ICSCandidateDisplay {
  start: string;
  end?: string;
  allDay: boolean;
}

export interface ICSCandidateMetadata {
  uid?: string;
  startText?: string;
  endText?: string;
  startTimeZone?: string;
  endTimeZone?: string;
  allDay: boolean;
  parseIssues: ValidationIssue[];
}

/**
 * The wrapper is import transport metadata only. `value` is still the
 * existing Event-shaped domain value; sourceRecordId/display/metadata never
 * get spread into Event by commitScheduleCandidate.
 */
export interface ICSCandidateValue extends ScheduleCandidateValue {
  entity: 'events';
  value: Event;
  sourceRecordId?: string;
  display: ICSCandidateDisplay;
  metadata: ICSCandidateMetadata;
}

export type ICSImportSession = ImportSession<ScheduleCandidateValue, ICSInput>;

const issue = (code: string, message: string, path?: string): ValidationIssue => ({
  code,
  message,
  severity: 'error',
  ...(path ? { path } : {}),
});

const clone = <T>(value: T): T => structuredClone(value);
const upper = (value: string): string => value.toUpperCase();
const isPersonId = (value: unknown): value is PersonId => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);

function hashId(value: string): string {
  // Two FNV-1a lanes keep generated ids deterministic without adding a
  // crypto dependency to the renderer bundle. The id is not a security hash;
  // it only gives Event / Candidate the existing compact id shape.
  let left = 2166136261;
  let right = 2246822519;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 16777619);
    right = Math.imul(right ^ code, 3266489917);
  }
  return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`;
}

function candidateIdFor(targetPersonId: PersonId, uid: string | undefined, index: number): string {
  return `ics-candidate-${hashId(`${targetPersonId}|${uid ?? `missing-${index}`}|${index}`)}`;
}

function eventIdFor(targetPersonId: PersonId, uid: string | undefined, index: number): string {
  return `ics-event-${hashId(`${targetPersonId}|${uid ?? `missing-${index}`}`)}`;
}

function splitUnquoted(value: string, separator: string): string[] {
  const result: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') quoted = !quoted;
    else if (character === separator && !quoted) {
      result.push(value.slice(start, index));
      start = index + 1;
    }
  }
  result.push(value.slice(start));
  return result;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1)
    : trimmed;
}

/** RFC 5545 TEXT escaping for the properties used by this importer. */
export function unescapeICSText(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '\\' || index + 1 >= value.length) {
      result += value[index];
      continue;
    }
    const escaped = value[index + 1];
    if (escaped === 'n' || escaped === 'N') result += '\n';
    else if (escaped === ',') result += ',';
    else if (escaped === ';') result += ';';
    else if (escaped === '\\') result += '\\';
    else result += `\\${escaped}`;
    index += 1;
  }
  return result;
}

interface ParsedProperty {
  name: string;
  value: string;
  params: Record<string, string>;
  issues: ValidationIssue[];
}

function parsePropertyLine(line: string): ParsedProperty | null {
  if (line.length > MAX_ICS_PROPERTY_LENGTH) return null;
  const separator = line.indexOf(':');
  if (separator <= 0) return null;
  const left = line.slice(0, separator);
  const pieces = splitUnquoted(left, ';');
  const name = pieces.shift()?.trim().toUpperCase() ?? '';
  if (!/^[A-Z][A-Z0-9-]*$/.test(name)) return null;
  const params: Record<string, string> = {};
  const issues: ValidationIssue[] = [];
  for (const piece of pieces) {
    const equals = piece.indexOf('=');
    if (equals <= 0) {
      issues.push(issue('ics.parameter_malformed', `属性 ${name} 的参数格式无效。`, name));
      continue;
    }
    const key = piece.slice(0, equals).trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9-]*$/.test(key)) {
      issues.push(issue('ics.parameter_malformed', `属性 ${name} 的参数名称无效。`, name));
      continue;
    }
    params[key] = unquote(piece.slice(equals + 1));
  }
  return { name, value: line.slice(separator + 1), params, issues };
}

function unfoldICS(text: string): string[] {
  if (typeof text !== 'string' || !text.length) throw new Error('ICS 文件为空。');
  if (text.length > MAX_ICS_TEXT_LENGTH) throw new Error('ICS 文件超过 10 MB 资源上限。');
  const physical = text.split(/\r\n|\n|\r/);
  if (physical.length > MAX_ICS_LINE_COUNT) throw new Error('ICS 文件行数过多，无法安全读取。');
  const lines: string[] = [];
  for (const line of physical) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length) lines[lines.length - 1] += line.slice(1);
    else if (line.startsWith(' ') || line.startsWith('\t')) throw new Error('ICS 文件折行格式无效。');
    else lines.push(line);
  }
  return lines;
}

interface RawEvent {
  index: number;
  properties: Map<string, ParsedProperty[]>;
  issues: ValidationIssue[];
  complete: boolean;
}

function collectEvents(text: string): RawEvent[] {
  const lines = unfoldICS(text);
  let inCalendar = false;
  let sawCalendarBegin = false;
  let sawCalendarEnd = false;
  let nestedComponentDepth = 0;
  let current: RawEvent | null = null;
  const events: RawEvent[] = [];

  const finish = (complete: boolean) => {
    if (!current) return;
    current.complete = complete;
    events.push(current);
    current = null;
    nestedComponentDepth = 0;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const separator = trimmed.indexOf(':');
    const name = separator > 0 ? trimmed.slice(0, separator).split(';', 1)[0].toUpperCase() : '';
    if (name === 'BEGIN' && upper(trimmed) === 'BEGIN:VCALENDAR') {
      if (sawCalendarBegin) throw new Error('ICS 文件包含重复的 VCALENDAR。');
      sawCalendarBegin = true;
      inCalendar = true;
      continue;
    }
    if (name === 'END' && upper(trimmed) === 'END:VCALENDAR') {
      if (current) {
        current.issues.push(issue('ics.event_unclosed', 'VEVENT 未正常结束。'));
        finish(false);
      }
      sawCalendarEnd = true;
      inCalendar = false;
      continue;
    }
    if (!inCalendar) continue;

    if (upper(trimmed) === 'BEGIN:VEVENT') {
      if (current) {
        current.issues.push(issue('ics.event_nested', 'VEVENT 嵌套或前一个 VEVENT 未结束。'));
        finish(false);
      }
      if (events.length >= MAX_ICS_EVENT_COUNT) throw new Error(`ICS 文件超过 ${MAX_ICS_EVENT_COUNT} 个事件的资源上限。`);
      current = { index: events.length, properties: new Map(), issues: [], complete: false };
      continue;
    }
    if (upper(trimmed) === 'END:VEVENT') {
      if (!current) continue;
      if (nestedComponentDepth > 0) {
        nestedComponentDepth -= 1;
        continue;
      }
      finish(true);
      continue;
    }
    if (!current) continue;

    if (name === 'BEGIN' || name === 'END') {
      if (name === 'BEGIN') nestedComponentDepth += 1;
      else if (nestedComponentDepth > 0) nestedComponentDepth -= 1;
      continue;
    }
    if (!trimmed) {
      current.issues.push(issue('ics.line_empty', 'VEVENT 中包含空行。'));
      continue;
    }
    const property = parsePropertyLine(trimmed);
    if (!property) {
      current.issues.push(issue('ics.property_malformed', 'VEVENT 中包含格式无效的属性行。'));
      continue;
    }
    current.issues.push(...property.issues);
    const list = current.properties.get(property.name) ?? [];
    list.push(property);
    current.properties.set(property.name, list);
  }

  if (current) {
    current.issues.push(issue('ics.event_unclosed', 'VEVENT 未正常结束。'));
    finish(false);
  }
  if (!sawCalendarBegin || !sawCalendarEnd) throw new Error('这不是有效的 ICS 文件：缺少完整的 VCALENDAR。');
  if (!events.length) throw new Error('这不是有效的 ICS 文件：没有找到 VEVENT。');
  return events;
}

function firstProperty(raw: RawEvent, name: string): ParsedProperty | undefined {
  const properties = raw.properties.get(name);
  return properties?.[0];
}

function duplicatePropertyIssue(raw: RawEvent, name: string): ValidationIssue[] {
  const count = raw.properties.get(name)?.length ?? 0;
  return count > 1 ? [issue('ics.property_duplicate', `VEVENT 的 ${name} 出现多次，当前版本无法确定应使用哪一个值。`, name)] : [];
}

function utcFromParts(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

function partsMatch(date: Date, year: number, month: number, day: number, hour: number, minute: number, second: number): boolean {
  return date.getUTCFullYear() === year
    && date.getUTCMonth() + 1 === month
    && date.getUTCDate() === day
    && date.getUTCHours() === hour
    && date.getUTCMinutes() === minute
    && date.getUTCSeconds() === second;
}

function formatLocalStamp(instant: number): string {
  return new Date(instant + YD_OFFSET_MS).toISOString().slice(0, 16);
}

interface TimeZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function timeZoneParts(instant: number, timeZone: string): TimeZoneParts {
  const result: Partial<TimeZoneParts> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(instant))) {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day' || part.type === 'hour' || part.type === 'minute' || part.type === 'second') {
      result[part.type] = Number(part.value);
    }
  }
  return result as TimeZoneParts;
}

function sameTimeZoneParts(a: TimeZoneParts, b: TimeZoneParts): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day
    && a.hour === b.hour && a.minute === b.minute && a.second === b.second;
}

function timeZoneOffset(instant: number, timeZone: string): number {
  const local = timeZoneParts(instant, timeZone);
  return utcFromParts(local.year, local.month, local.day, local.hour, local.minute, local.second) - instant;
}

/**
 * Convert a wall clock in an IANA zone to an instant. Sampling nearby offsets
 * lets us reject both nonexistent DST times and ambiguous fall-back times
 * instead of silently choosing one.
 */
function instantForTimeZone(
  wall: TimeZoneParts,
  timeZone: string,
): { instant?: number; problem?: 'unknown' | 'nonexistent' | 'ambiguous' } {
  try {
    formatterFor(timeZone);
  } catch {
    return { problem: 'unknown' };
  }
  const wallMs = utcFromParts(wall.year, wall.month, wall.day, wall.hour, wall.minute, wall.second);
  const offsets = new Set<number>();
  for (let step = -96; step <= 96; step += 1) offsets.add(timeZoneOffset(wallMs + step * 30 * 60 * 1000, timeZone));
  const matches: number[] = [];
  for (const offset of offsets) {
    const instant = wallMs - offset;
    if (sameTimeZoneParts(timeZoneParts(instant, timeZone), wall)) matches.push(instant);
  }
  const unique = [...new Set(matches)].sort((a, b) => a - b);
  if (unique.length === 1) return { instant: unique[0] };
  return { problem: unique.length ? 'ambiguous' : 'nonexistent' };
}

interface ParsedTemporal {
  kind: 'date' | 'datetime' | 'invalid';
  raw: string;
  stamp?: string;
  instant?: number;
  timeZone?: string;
  issues: ValidationIssue[];
}

function parseTemporal(property: ParsedProperty | undefined, label: 'DTSTART' | 'DTEND'): ParsedTemporal {
  if (!property) return { kind: 'invalid', raw: '', issues: [issue('ics.time_missing', `${label} 缺失。`, label)] };
  const raw = property.value.trim();
  const valueKind = property.params.VALUE?.toUpperCase();
  if (valueKind === 'DATE' || /^\d{8}$/.test(raw)) {
    if (!/^\d{8}$/.test(raw)) return { kind: 'invalid', raw, issues: [issue('ics.date_invalid', `${label} 的日期格式无效。`, label)] };
    const year = Number(raw.slice(0, 4));
    const month = Number(raw.slice(4, 6));
    const day = Number(raw.slice(6, 8));
    const date = new Date(utcFromParts(year, month, day));
    if (!partsMatch(date, year, month, day, 0, 0, 0)) return { kind: 'invalid', raw, issues: [issue('ics.date_invalid', `${label} 的日期无效。`, label)] };
    if (valueKind !== 'DATE' && /T/i.test(raw)) return { kind: 'invalid', raw, issues: [issue('ics.date_invalid', `${label} 的日期格式无效。`, label)] };
    return { kind: 'date', raw, issues: [] };
  }

  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/i.exec(raw);
  if (!match) return { kind: 'invalid', raw, issues: [issue('ics.datetime_invalid', `${label} 的日期时间格式无效。`, label)] };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? '0');
  const wallDate = new Date(utcFromParts(year, month, day, hour, minute, second));
  if (!partsMatch(wallDate, year, month, day, hour, minute, second)) {
    return { kind: 'invalid', raw, issues: [issue('ics.datetime_invalid', `${label} 的日期时间无效。`, label)] };
  }
  if (valueKind === 'DATE') return { kind: 'invalid', raw, issues: [issue('ics.datetime_invalid', `${label} 声明为 DATE，但值不是全天日期。`, label)] };

  const hasUtc = Boolean(match[7]);
  const timeZoneParam = property.params.TZID;
  const issues: ValidationIssue[] = [];
  if (hasUtc && timeZoneParam !== undefined) issues.push(issue('ics.timezone_conflict', `${label} 不能同时使用 UTC 后缀和 TZID。`, label));
  const wall: TimeZoneParts = { year, month, day, hour, minute, second };
  let instant: number | undefined;
  let timeZone: string | undefined;
  if (hasUtc) instant = wallDate.getTime();
  else if (timeZoneParam === undefined) {
    timeZone = 'Asia/Shanghai';
    instant = utcFromParts(year, month, day, hour, minute, second) - YD_OFFSET_MS;
  } else {
    timeZone = timeZoneParam;
    const converted = instantForTimeZone(wall, timeZoneParam);
    if (converted.problem === 'unknown') issues.push(issue('ics.timezone_unknown', `${label} 使用了无法识别的时区 “${timeZoneParam}”，无法安全导入。`, label));
    else if (converted.problem === 'nonexistent') issues.push(issue('ics.timezone_nonexistent', `${label} 在时区 ${timeZoneParam} 中不是有效的本地时间。`, label));
    else if (converted.problem === 'ambiguous') issues.push(issue('ics.timezone_ambiguous', `${label} 在时区 ${timeZoneParam} 中对应多个瞬间，无法安全导入。`, label));
    else instant = converted.instant;
  }
  if (second !== 0) issues.push(issue('ics.seconds_unsupported', `${label} 含有非零秒数，而当前 Event 只能保存到分钟。`, label));
  return {
    kind: 'datetime',
    raw,
    ...(instant === undefined ? {} : { instant, stamp: formatLocalStamp(instant) }),
    ...(timeZone ? { timeZone } : {}),
    issues,
  };
}

function eventContent(value: Pick<Event, 'title' | 'start' | 'end' | 'place' | 'notes' | 'person'>): string {
  return JSON.stringify([value.person ?? '', value.title, value.start, value.end, value.place, value.notes]);
}

function rawEventCandidate(raw: RawEvent, targetPersonId: PersonId): ImportCandidateDraft<ScheduleCandidateValue> {
  const uidProperty = firstProperty(raw, 'UID');
  const uid = uidProperty ? unescapeICSText(uidProperty.value).trim() : '';
  const summary = firstProperty(raw, 'SUMMARY');
  const location = firstProperty(raw, 'LOCATION');
  const description = firstProperty(raw, 'DESCRIPTION');
  const startProperty = firstProperty(raw, 'DTSTART');
  const endProperty = firstProperty(raw, 'DTEND');
  const start = parseTemporal(startProperty, 'DTSTART');
  const end = parseTemporal(endProperty, 'DTEND');
  const parseIssues: ValidationIssue[] = [...raw.issues];
  if (!uid) parseIssues.push(issue('ics.uid_missing', 'VEVENT 缺少 UID，无法作为可追踪的外部记录导入。', 'UID'));
  parseIssues.push(...duplicatePropertyIssue(raw, 'UID'), ...duplicatePropertyIssue(raw, 'SUMMARY'), ...duplicatePropertyIssue(raw, 'DTSTART'), ...duplicatePropertyIssue(raw, 'DTEND'));
  parseIssues.push(...start.issues, ...end.issues);
  const allDay = start.kind === 'date' || end.kind === 'date';
  if (allDay) parseIssues.push(issue('ics.all_day_unsupported', '该日历事件是全天事件，当前版本尚不支持全天事件。'));
  if (start.kind !== 'invalid' && end.kind !== 'invalid' && start.kind !== end.kind) parseIssues.push(issue('ics.time_type_mismatch', 'DTSTART 与 DTEND 的时间类型不一致。'));
  const duration = firstProperty(raw, 'DURATION');
  if (duration && endProperty) parseIssues.push(issue('ics.duration_with_end', 'VEVENT 不能同时使用 DTEND 和 DURATION，当前版本无法确定结束时间。', 'DURATION'));
  else if (duration) parseIssues.push(issue('ics.duration_unsupported', '该日历事件使用 DURATION，当前版本暂不支持按持续时长计算结束时间。', 'DURATION'));
  for (const name of ['RRULE', 'RDATE', 'EXDATE', 'EXRULE']) {
    if (raw.properties.has(name)) parseIssues.push(issue('ics.recurrence_unsupported', '该日历事件包含当前版本尚不支持的重复规则。', name));
  }
  if (start.kind !== 'date' && endProperty === undefined && !duration) parseIssues.push(issue('ics.end_missing', 'VEVENT 缺少 DTEND，当前版本不会自动编造结束时间。', 'DTEND'));
  if (start.instant !== undefined && end.instant !== undefined && end.instant <= start.instant) parseIssues.push(issue('ics.end_not_after_start', '结束时间必须晚于开始时间。', 'DTEND'));
  if (startProperty === undefined) parseIssues.push(issue('ics.start_missing', 'VEVENT 缺少 DTSTART。', 'DTSTART'));
  if (!summary) parseIssues.push(issue('ics.summary_missing', 'VEVENT 缺少 SUMMARY，无法确定事件标题。', 'SUMMARY'));

  const value: Event = {
    id: eventIdFor(targetPersonId, uid || undefined, raw.index),
    person: targetPersonId,
    title: summary ? unescapeICSText(summary.value) : '',
    start: start.stamp ?? '',
    end: end.stamp ?? null,
    place: location ? unescapeICSText(location.value) : '',
    notes: description ? unescapeICSText(description.value) : '',
    reminders: [],
    checklist: [],
    updatedAt: 0,
  };
  const display: ICSCandidateDisplay = {
    start: start.stamp ?? start.raw,
    ...(end.stamp || end.raw ? { end: end.stamp ?? end.raw } : {}),
    allDay,
  };
  const metadata: ICSCandidateMetadata = {
    ...(uid ? { uid } : {}),
    ...(start.raw ? { startText: start.raw } : {}),
    ...(end.raw ? { endText: end.raw } : {}),
    ...(start.timeZone ? { startTimeZone: start.timeZone } : {}),
    ...(end.timeZone ? { endTimeZone: end.timeZone } : {}),
    allDay,
    parseIssues: clone(parseIssues),
  };
  const wrapper: ICSCandidateValue = {
    entity: 'events',
    value,
    ...(uid ? { sourceRecordId: uid } : {}),
    display,
    metadata,
  };
  return { id: candidateIdFor(targetPersonId, uid || undefined, raw.index), value: wrapper };
}

export function createICSImporter(targetPersonId: PersonId): Importer<ICSInput, ScheduleCandidateValue> {
  if (!isPersonId(targetPersonId)) throw new Error('ICS 导入目标人物无效。');
  return {
    id: ICS_IMPORTER_ID,
    target: 'schedule',
    parse(source) {
      if (!source.input || typeof source.input.text !== 'string') throw new Error('ICS 输入内容无效。');
      return collectEvents(source.input.text).map(raw => rawEventCandidate(raw, targetPersonId));
    },
  };
}

export function rawSourceFromICSFile(file: ICSFileSelection, sourceId: string): RawSource<ICSInput> {
  if (!file || typeof file.text !== 'string' || !Number.isInteger(file.size) || file.size < 0 || file.size > MAX_ICS_FILE_BYTES) throw new Error('ICS 文件大小无效。');
  if (!file.originalName || file.originalName.length > 260) throw new Error('ICS 文件名无效。');
  if (!/^[^\\/]{1,200}$/.test(file.fingerprint)) throw new Error('ICS 文件指纹无效。');
  return {
    id: sourceId,
    kind: 'file',
    originalName: file.originalName,
    label: 'ICS 日历',
    createdAt: file.createdAt,
    fingerprint: file.fingerprint,
    metadata: { format: 'ics', version: 1, size: file.size },
    input: { text: file.text },
  };
}

function isICSValue(value: unknown): value is ICSCandidateValue {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ICSCandidateValue>;
  return candidate.entity === 'events' && !!candidate.value && typeof candidate.value === 'object' && !!candidate.display && !!candidate.metadata;
}

function blockingFor(issues: readonly ValidationIssue[]): boolean {
  return issues.some(item => item.severity === 'error');
}

function sameTargetUid(value: unknown, personId: PersonId, sourceRecordId: string): boolean {
  return isICSValue(value) && value.sourceRecordId === sourceRecordId && value.value.person === personId;
}

/**
 * ICS-specific checks sit on top of the existing formal-domain validator.
 * They deliberately treat duplicate and target-boundary violations as errors,
 * so the user must reject them before the batch can be committed.
 */
export function icsCandidateValidator<TInput = ICSInput>(): CandidateValidator<ScheduleCandidateValue, TInput> {
  const domainValidator = scheduleCandidateValidator<TInput>();
  return (value, context) => {
    const issues = [...domainValidator(value, context)];
    if (!isICSValue(value)) return [...issues, issue('ics.candidate_invalid', 'ICS 候选记录格式无效。')];
    if (context.session.importer !== ICS_IMPORTER_ID) issues.push(issue('ics.importer_invalid', '候选记录不是由受支持的 ICS 导入器生成。'));
    issues.push(...value.metadata.parseIssues.map(clone));
    const personId = value.value.person;
    if (!isPersonId(personId)) return [...issues, issue('ics.target_invalid', 'ICS 候选记录缺少有效的目标人物。')];
    if (!activeProfiles(context.state).some(profile => profile.id === personId)) issues.push(issue('ics.target_inactive', '目标人物当前不在活跃使用方式中，不能导入到该人物。'));
    const sourceRecordId = value.sourceRecordId;
    if (sourceRecordId) {
      const sameUidInSession = context.session.candidates.some(other => other.id !== context.candidate.id
        && sameTargetUid(other.originalParsedValue, personId, sourceRecordId));
      if (sameUidInSession) issues.push(issue('ics.uid_duplicate_in_file', '同一个 ICS UID 在本次文件中出现多次，无法确定应保留哪一条。'));
      const existing = context.state.events.filter(event => event.person === personId
        && event.provenance?.importer === ICS_IMPORTER_ID
        && event.provenance.sourceRecordId === sourceRecordId);
      for (const event of existing) {
        if (eventContent(event) === eventContent(value.value)) issues.push(issue('ics.duplicate_uid', '该日历事件已经导入过，当前不会再次创建重复事件。'));
        else issues.push(issue('ics.duplicate_changed', '发现同源事件已存在且内容不同，当前版本暂不支持自动覆盖更新。'));
      }
    }
    return issues;
  };
}

export function prepareICSImport(
  state: State,
  source: RawSource<ICSInput>,
  targetPersonId: PersonId,
  sessionId?: string,
): ICSImportSession {
  const importer = createICSImporter(targetPersonId);
  const created = createImportSession({ id: sessionId, importer: importer.id, source, createdAt: source.createdAt });
  const parsed = parseImportSession(created, importer);
  if (parsed.status === 'failed') return parsed as ICSImportSession;
  return validateImportSession(parsed, icsCandidateValidator<ICSInput>(), state);
}

/** Keep the file contents in the renderer only; commit needs source metadata and candidates, not raw ICS text. */
export function stripICSRawInput(session: ICSImportSession): ICSImportSession {
  return {
    ...session,
    source: { ...sourceReference(session.source), input: { text: '' } },
  };
}

export function isBlockingICSImport(session: ICSImportSession): boolean {
  return session.candidates.some(candidate => candidate.reviewState !== 'rejected' && blockingFor(candidate.issues));
}
