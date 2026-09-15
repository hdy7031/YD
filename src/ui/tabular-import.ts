import React, { useEffect, useState } from 'react';
import { id } from '../core.ts';
import { academicPresence } from '../academic.ts';
import { activeProfiles } from '../people.ts';
import { profileLabelFor } from './shell.ts';
import {
  acceptCandidate,
  editCandidate,
  prepareTabularImport,
  rejectCandidate,
  suggestTabularMapping,
  tabularCandidateValidator,
  tabularFieldLabel,
  validateTabularMapping,
  validateImportSession,
  type ImportCandidate,
  type ScheduleCandidateValue,
  type TabularCandidateValue,
  type TabularColumnMapping,
  type TabularFileSelection,
  type TabularImportMode,
  type TabularImportSession,
  type TabularField,
  type ValidationIssue,
} from '../import/index.ts';
import {
  cellText,
  columnLabel,
  headerRowFor,
  headersFor,
  previewRows,
} from '../import/tabular.ts';
import type { Course, Event, PersonId, State } from '../types.ts';

const h = React.createElement;

interface CommitResult {
  state: State;
  committedCandidateIds: string[];
}

export interface TabularImportDialogProps {
  state: State;
  file: TabularFileSelection;
  pending: boolean;
  onClose: () => void;
  onCommit: (session: TabularImportSession) => Promise<CommitResult>;
  onDone: (result: CommitResult) => void;
}

type Step = 'setup' | 'sheet' | 'mapping' | 'review';

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);
const isBlocking = (candidate: ImportCandidate<ScheduleCandidateValue>): boolean => candidate.issues.some(item => item.severity === 'error');

function wrapped(candidate: ImportCandidate<ScheduleCandidateValue>): TabularCandidateValue | null {
  const value = candidate.reviewedValue;
  return value && typeof value === 'object' && (value.entity === 'events' || value.entity === 'courses') && 'metadata' in value && 'display' in value
    ? value as TabularCandidateValue
    : null;
}

function modeLabel(mode: TabularImportMode): string {
  return mode === 'event' ? '普通日程' : '课程表';
}

function displayStamp(value: string): string {
  return value ? value.replace('T', ' ') : '时间无法解析';
}

function candidateTitle(candidate: ImportCandidate<ScheduleCandidateValue>): string {
  const value = wrapped(candidate)?.value;
  return value && typeof value.title === 'string' && value.title.trim() ? value.title : '（缺少标题）';
}

function candidatePrimary(candidate: ImportCandidate<ScheduleCandidateValue>): string {
  const value = wrapped(candidate)?.value;
  const data = wrapped(candidate);
  if (!value || !data) return '记录内容无法读取';
  if (data.entity === 'events') {
    const event = value as Event;
    return event.start && event.end ? `${displayStamp(event.start)} — ${displayStamp(event.end)}` : '时间无法解析';
  }
  const course = value as Course;
  const weekday = Number.isInteger(course.weekday) && course.weekday >= 1 && course.weekday <= 7 ? '一二三四五六日'[course.weekday - 1] : '?';
  const weeks = course.weeks?.length ? course.weeks.join(',') : '周次无法解析';
  return `${weekday === '?' ? '星期?' : `星期${weekday}`} · 第 ${course.first || '?'}-${course.last || '?'} 节 · ${weeks} 周`;
}

function candidatePlace(candidate: ImportCandidate<ScheduleCandidateValue>): string | undefined {
  const value = wrapped(candidate)?.value;
  return value?.place?.trim() ? value.place : undefined;
}

function displayFor(value: Event | Course, mode: TabularImportMode, rowNumber: number): TabularCandidateValue['display'] {
  const place = value.place?.trim();
  if (mode === 'event') {
    const event = value as Event;
    return { mode, title: event.title || '（缺少标题）', primary: event.start && event.end ? `${event.start} — ${event.end}` : '时间无法解析', ...(place ? { place } : {}), rowNumber };
  }
  const course = value as Course;
  const weekday = course.weekday >= 1 && course.weekday <= 7 ? '一二三四五六日'[course.weekday - 1] : '?';
  return { mode, title: course.title || '（缺少课程名）', primary: weekday === '?' ? '课程语义无法解析' : `星期${weekday} · 第 ${course.first || '?'}-${course.last || '?'} 节 · ${course.weeks?.join(',') || '周次无法解析'} 周`, ...(place ? { place } : {}), rowNumber };
}

function CandidateEditPanel({
  candidate,
  onCancel,
  onSave,
}: {
  candidate: ImportCandidate<ScheduleCandidateValue>;
  onCancel: () => void;
  onSave: (value: TabularCandidateValue) => void;
}) {
  const current = wrapped(candidate);
  const initial = current?.value;
  const mode = current?.metadata.mode ?? 'event';
  const [draft, setDraft] = useState(() => structuredClone(initial ?? ({ title: '' } as Event | Course)));
  const [weeks, setWeeks] = useState(() => initial && 'weeks' in initial ? initial.weeks.join(',') : '');
  const update = (key: string, value: unknown) => setDraft(previous => ({ ...previous, [key]: value }));
  if (!current || !initial) return null;
  const event = mode === 'event' ? draft as Event : undefined;
  const course = mode === 'course' ? draft as Course : undefined;
  const save = () => {
    const value = mode === 'event'
      ? { ...event, end: event?.end || null }
      : { ...course, weeks: weeks.split(/[,，、\s]+/).filter(Boolean).map(Number) };
    onSave({
      ...current,
      value: value as Event | Course,
      display: displayFor(value as Event | Course, mode, current.metadata.rowNumber),
      metadata: { ...current.metadata, parseIssues: [] },
    });
  };
  const field = (label: string, child: React.ReactElement) => h('label', { className: 'tabular-edit-field' }, h('span', null, label), child);
  return h('section', { className: 'tabular-edit-panel', 'data-tabular-edit-panel': true },
    h('div', { className: 'tabular-edit-head' }, h('strong', null, `编辑第 ${current.metadata.rowNumber} 行`), h('span', { className: 'muted' }, '原始值保留在导入记录中')),
    mode === 'event'
      ? h('div', { className: 'tabular-edit-grid' },
        field('标题', h('input', { value: event?.title ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => update('title', e.target.value) })),
        field('开始', h('input', { type: 'datetime-local', value: event?.start ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => update('start', e.target.value) })),
        field('结束', h('input', { type: 'datetime-local', value: event?.end ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => update('end', e.target.value) })),
        field('地点', h('input', { value: event?.place ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => update('place', e.target.value) })),
        field('备注', h('textarea', { rows: 2, value: event?.notes ?? '', onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => update('notes', e.target.value) })))
      : h('div', { className: 'tabular-edit-grid' },
        field('课程名', h('input', { value: course?.title ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => update('title', e.target.value) })),
        field('星期', h('select', { value: course?.weekday ?? 0, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => update('weekday', Number(e.target.value)) }, ...Array.from({ length: 7 }, (_, index) => h('option', { key: index + 1, value: index + 1 }, `星期${'一二三四五六日'[index]}`)))),
        field('周次', h('input', { value: weeks, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setWeeks(e.target.value) })),
        field('开始节次', h('input', { type: 'number', min: 1, value: course?.first || '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => update('first', Number(e.target.value)) })),
        field('结束节次', h('input', { type: 'number', min: 1, value: course?.last || '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => update('last', Number(e.target.value)) })),
        field('地点', h('input', { value: course?.place ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => update('place', e.target.value) })),
        field('备注', h('textarea', { rows: 2, value: course?.notes ?? '', onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => update('notes', e.target.value) }))),
    h('div', { className: 'actions' }, h('button', { type: 'button', className: 'ghost', onClick: onCancel }, '取消编辑'), h('button', { type: 'button', className: 'secondary', onClick: save, 'data-tabular-edit-save': true }, '保存并重新核对')));
}

function CandidateRow({ candidate, selected, disabled, toggle, edit }: {
  candidate: ImportCandidate<ScheduleCandidateValue>;
  selected: boolean;
  disabled: boolean;
  toggle: () => void;
  edit: () => void;
}) {
  const blocking = isBlocking(candidate);
  return h('article', { className: `tabular-candidate${blocking ? ' has-error' : ''}${selected ? ' is-selected' : ''}`, 'data-tabular-candidate': candidate.id },
    h('label', { className: 'ics-candidate-select' },
      h('input', { type: 'checkbox', checked: selected, disabled: disabled || blocking, 'aria-label': `选择${candidateTitle(candidate)}`, onChange: toggle }),
      h('span', { className: 'ics-candidate-check', 'aria-hidden': true })),
    h('div', { className: 'ics-candidate-main' },
      h('div', { className: 'ics-candidate-title-line' }, h('h3', null, candidateTitle(candidate)), blocking ? h('span', { className: 'tag' }, '无法导入') : null, candidate.issues.some(item => item.severity === 'warning') ? h('span', { className: 'tabular-warning-tag' }, '有提醒') : null),
      h('p', { className: 'time' }, candidatePrimary(candidate)),
      candidatePlace(candidate) ? h('p', { className: 'muted' }, candidatePlace(candidate)) : null,
      h('p', { className: 'tabular-row-ref' }, `来源第 ${wrapped(candidate)?.metadata.rowNumber ?? '？'} 行`),
      candidate.issues.length ? h('ul', { className: 'ics-candidate-issues' }, ...candidate.issues.map((item: ValidationIssue, index: number) => h('li', { key: `${item.code}-${index}`, className: item.severity === 'error' ? 'error' : 'warning' }, item.message))) : null,
      h('button', { type: 'button', className: 'text-button tabular-edit-button', disabled, onClick: edit, 'data-tabular-edit': candidate.id }, '编辑这一行')));
}

export function TabularImportDialog({ state, file, pending, onClose, onCommit, onDone }: TabularImportDialogProps) {
  const targets = activeProfiles(state);
  const visibleSheets = file.table.sheets.filter(sheet => !sheet.hidden);
  const firstSheet = visibleSheets[0];
  const [step, setStep] = useState<Step>('setup');
  const [mode, setMode] = useState<TabularImportMode>('event');
  const [targetPersonId, setTargetPersonId] = useState<PersonId>(targets[0]?.id ?? '');
  const [sheetName, setSheetName] = useState(firstSheet?.name ?? '');
  const [headerRow, setHeaderRow] = useState(firstSheet ? headerRowFor(firstSheet) ?? firstSheet.rows[0]?.rowNumber ?? 1 : 1);
  const [mapping, setMapping] = useState<TabularColumnMapping>(() => firstSheet ? suggestTabularMapping(firstSheet, 'event', headerRowFor(firstSheet) ?? firstSheet.rows[0]?.rowNumber ?? 1) : { headerRow: 1, entries: [] });
  const [mappingError, setMappingError] = useState('');
  const [session, setSession] = useState<TabularImportSession | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const currentSheet = file.table.sheets.find(sheet => sheet.name === sheetName) ?? firstSheet;
  const target = targets.find(profile => profile.id === targetPersonId);
  const targetAcademic = target ? academicPresence(target) : 'absent';
  const courseUnavailable = mode === 'course' && targetAcademic !== 'complete';
  const busy = pending || submitting;

  useEffect(() => {
    if (!currentSheet) return;
    const nextHeader = headerRowFor(currentSheet) ?? currentSheet.rows[0]?.rowNumber ?? 1;
    setHeaderRow(nextHeader);
    setMapping(suggestTabularMapping(currentSheet, mode, nextHeader));
    setMappingError('');
  }, [sheetName, mode]);

  const chooseMode = (next: TabularImportMode) => {
    setMode(next);
    setError('');
  };

  const chooseSheet = (next: string) => {
    setSheetName(next);
    setError('');
  };

  const chooseHeader = (next: number) => {
    setHeaderRow(next);
    if (currentSheet) setMapping(suggestTabularMapping(currentSheet, mode, next));
    setMappingError('');
  };

  const setColumnField = (sourceColumn: number, field: string) => {
    setMapping(previous => ({
      ...previous,
      entries: [...previous.entries.filter(entry => entry.sourceColumn !== sourceColumn), ...(field ? [{ sourceColumn, field: field as TabularField }] : [])],
    }));
    setMappingError('');
  };

  const nextFromSetup = () => {
    if (!targetPersonId) { setError('没有可用的活跃目标人物。'); return; }
    if (courseUnavailable) return;
    if (file.format === 'xlsx' && visibleSheets.length > 1) setStep('sheet');
    else setStep('mapping');
  };

  const nextFromSheet = () => {
    if (!currentSheet) { setError('没有可用的工作表。'); return; }
    setStep('mapping');
  };

  const prepare = () => {
    if (!currentSheet) { setMappingError('没有可用的工作表。'); return; }
    const issues = validateTabularMapping(file.table, mode, currentSheet.name, mapping);
    const blocking = issues.filter(item => item.severity === 'error');
    if (blocking.length) { setMappingError(blocking.map(item => item.message).join('；')); return; }
    try {
      const prepared = prepareTabularImport(state, file, { mode, targetPersonId, sheetName: currentSheet.name, mapping }, id());
      setSession(prepared);
      setSelected(new Set(prepared.status === 'failed' ? [] : prepared.candidates.filter(candidate => !isBlocking(candidate)).map(candidate => candidate.id)));
      setEditingId(null);
      setError('');
      setStep('review');
    } catch (caught) {
      setMappingError(messageOf(caught));
    }
  };

  const saveEdited = (value: TabularCandidateValue) => {
    if (!session || !editingId) return;
    try {
      let next = editCandidate(session, editingId, value);
      next = validateImportSessionLocal(next, state);
      setSession(next);
      const updated = next.candidates.find(candidate => candidate.id === editingId);
      setSelected(previous => {
        const result = new Set(previous);
        if (updated && !isBlocking(updated)) result.add(editingId);
        else result.delete(editingId);
        return result;
      });
      setEditingId(null);
    } catch (caught) {
      setError(messageOf(caught));
    }
  };

  const toggle = (candidate: ImportCandidate<ScheduleCandidateValue>) => {
    if (busy || isBlocking(candidate)) return;
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(candidate.id)) next.delete(candidate.id); else next.add(candidate.id);
      return next;
    });
  };

  const submit = async () => {
    if (!session || session.status === 'failed' || busy) return;
    const selectedCount = session.candidates.filter(candidate => selected.has(candidate.id) && !isBlocking(candidate)).length;
    if (!selectedCount) return;
    setSubmitting(true);
    setError('');
    try {
      let next = session;
      for (const candidate of next.candidates) next = selected.has(candidate.id) ? acceptCandidate(next, candidate.id) : rejectCandidate(next, candidate.id);
      if (next.status !== 'ready') throw new Error('请先取消有问题的记录，再确认导入。');
      const result = await onCommit(stripSession(next));
      onDone(result);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const mappingIssues = currentSheet ? validateTabularMapping(file.table, mode, currentSheet.name, mapping) : [];
  const headers = currentSheet ? headersFor(currentSheet, headerRow) : [];
  const sampleRows = currentSheet ? previewRows(currentSheet, headerRow, 8).filter(row => row.rowNumber > headerRow) : [];
  const definitions = mode === 'event'
    ? [
      ['title', '标题'], ['date', '日期'], ['startTime', '开始时间'], ['endTime', '结束时间'], ['startDateTime', '开始日期时间'], ['endDateTime', '结束日期时间'], ['location', '地点'], ['notes', '备注'],
    ] as Array<[TabularField, string]>
    : [
      ['title', '课程名'], ['weekday', '星期'], ['weeks', '周次'], ['startPeriod', '开始节次'], ['endPeriod', '结束节次'], ['periodRange', '节次范围'], ['location', '地点'], ['notes', '备注'],
    ] as Array<[TabularField, string]>;
  const candidates = session?.candidates ?? [];
  const validCount = candidates.filter(candidate => !isBlocking(candidate)).length;
  const issueCount = candidates.filter(candidate => candidate.issues.length > 0).length;
  const warningCount = candidates.filter(candidate => candidate.issues.some(item => item.severity === 'warning')).length;
  const selectedCount = candidates.filter(candidate => selected.has(candidate.id) && !isBlocking(candidate)).length;
  const dataRowCount = currentSheet?.rows.filter(row => row.rowNumber > headerRow && row.cells.some(cell => cellText(cell) !== '')).length ?? 0;

  return h('div', { className: 'modal-backdrop' },
    h('section', { className: 'modal tabular-import-modal', role: 'dialog', 'aria-modal': true, 'aria-label': '导入表格', 'data-tabular-import-dialog': true },
      h('header', { className: 'modal-head' },
        h('div', null, h('div', { className: 'import-kicker' }, step === 'review' ? '表格已核对' : '结构化表格导入'), h('h2', null, step === 'review' ? '核对表格导入' : '导入表格')),
        h('button', { type: 'button', className: 'ghost', disabled: busy, onClick: onClose, 'data-tabular-cancel': true }, '关闭')),
      step !== 'review' ? h('dl', { className: 'ics-import-meta tabular-import-meta' },
        h('div', null, h('dt', null, '文件'), h('dd', { 'data-tabular-file-name': true }, file.originalName)),
        h('div', null, h('dt', null, '格式'), h('dd', null, file.format.toUpperCase())),
        h('div', null, h('dt', null, '流程'), h('dd', null, `${step === 'setup' ? '选择类型与人物' : step === 'sheet' ? '选择工作表' : '确认表头与列映射'}`))) : null,
      step === 'setup' ? h('div', { className: 'tabular-step' },
        h('div', { className: 'tabular-section-head' }, h('h3', null, '导入类型'), h('p', { className: 'muted' }, '请明确选择表格要生成的 YD 记录。')),
        h('div', { className: 'tabular-choice-grid' },
          h('button', { type: 'button', className: `tabular-choice${mode === 'event' ? ' active' : ''}`, onClick: () => chooseMode('event'), 'data-tabular-mode': 'event' }, h('strong', null, '普通日程'), h('span', null, '会议、计划与普通事务')),
          h('button', { type: 'button', className: `tabular-choice${mode === 'course' ? ' active' : ''}`, onClick: () => chooseMode('course'), 'data-tabular-mode': 'course' }, h('strong', null, '课程表'), h('span', null, '按星期、周次与节次排课'))),
        h('div', { className: 'tabular-section-head' }, h('h3', null, '目标人物'), h('p', { className: 'muted' }, '导入会固定到这里；之后切换页面人物不会改变目标。')),
        h('select', { className: 'tabular-target-select', value: targetPersonId, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setTargetPersonId(e.target.value), 'aria-label': '表格导入目标人物', 'data-tabular-target': true }, ...targets.map(profile => h('option', { key: profile.id, value: profile.id }, profileLabelFor(state, profile.id)))),
        courseUnavailable ? h('p', { className: 'error tabular-academic-note', role: 'alert', 'data-tabular-academic-required': true }, targetAcademic === 'partial' ? '该人物的学期与节次配置不完整，请先修正配置。' : '请先配置该人物的学期与节次，课程表导入才可用。') : null,
        error ? h('p', { className: 'error', role: 'alert' }, error) : null,
        h('div', { className: 'tabular-step-actions' }, h('button', { type: 'button', className: 'ghost', disabled: busy, onClick: onClose }, '取消'), h('button', { type: 'button', className: 'primary', disabled: busy || courseUnavailable || !targetPersonId, onClick: nextFromSetup, 'data-tabular-next': true }, '下一步')))
      : step === 'sheet' ? h('div', { className: 'tabular-step' },
        h('div', { className: 'tabular-section-head' }, h('h3', null, '选择工作表'), h('p', { className: 'muted' }, '一次导入只使用一个可见工作表；隐藏工作表不会被自动读取。')),
        h('div', { className: 'tabular-sheet-list' }, ...visibleSheets.map(sheet => h('button', { type: 'button', className: `tabular-sheet-card${sheet.name === sheetName ? ' active' : ''}`, key: sheet.name, onClick: () => chooseSheet(sheet.name), 'data-tabular-sheet': sheet.name }, h('strong', null, sheet.name), h('span', null, `${sheet.rowCount} 行 · ${sheet.columnCount} 列`), h('small', null, sheet.rows.slice(0, 2).map(row => row.cells.slice(0, 4).map(cellText).join(' · ')).join(' / ') || '暂无内容')))),
        h('div', { className: 'tabular-step-actions' }, h('button', { type: 'button', className: 'ghost', disabled: busy, onClick: () => setStep('setup') }, '上一步'), h('button', { type: 'button', className: 'primary', disabled: busy || !currentSheet, onClick: nextFromSheet, 'data-tabular-next': true }, '确认工作表')))
      : step === 'mapping' ? h('div', { className: 'tabular-step tabular-mapping-step' },
        h('div', { className: 'tabular-mapping-toolbar' },
          h('label', null, h('span', null, '表头行'), h('select', { value: headerRow, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => chooseHeader(Number(e.target.value)), 'aria-label': '选择表头行', 'data-tabular-header-row': true }, ...(currentSheet?.rows ?? []).map(row => h('option', { key: row.rowNumber, value: row.rowNumber }, `第 ${row.rowNumber} 行${row.rowNumber === headerRowFor(currentSheet!) ? ' · 建议' : ''}`)))),
          h('span', { className: 'muted' }, currentSheet ? `${currentSheet.name} · ${dataRowCount} 个数据行 · ${currentSheet.columnCount} 列` : '没有工作表')),
        h('div', { className: 'tabular-preview-wrap' }, h('table', { className: 'tabular-preview' }, h('thead', null, h('tr', null, h('th', null, '行'), ...headers.slice(0, 12).map((header, index) => h('th', { key: index }, `${columnLabel(index)} · ${header || '未命名列'}`)))), h('tbody', null, ...previewRows(currentSheet!, headerRow, 9).map(row => h('tr', { key: row.rowNumber }, h('th', null, row.rowNumber), ...Array.from({ length: Math.min(12, headers.length) }, (_, index) => h('td', { key: index }, cellText(row.cells[index]))))))), headers.length > 12 ? h('p', { className: 'muted' }, `预览显示前 12 列；共 ${headers.length} 列。`) : null),
        h('div', { className: 'tabular-section-head tabular-mapping-head' }, h('h3', null, '映射列到语义字段'), h('p', { className: 'muted' }, '建议只做提示；最终映射由你确认。')),
        h('div', { className: 'tabular-mapping-list' }, ...headers.map((header, sourceColumn) => {
          const current = mapping.entries.find(entry => entry.sourceColumn === sourceColumn)?.field ?? '';
          const sample = sampleRows.find(row => !(!row.cells[sourceColumn] || cellText(row.cells[sourceColumn]) === ''));
          return h('div', { className: 'tabular-mapping-row', key: sourceColumn, 'data-tabular-mapping': sourceColumn }, h('div', { className: 'tabular-mapping-source' }, h('strong', null, `${columnLabel(sourceColumn)} · ${header || '未命名列'}`), h('small', null, sample ? cellText(sample.cells[sourceColumn]) : '暂无示例值')), h('select', { value: current, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setColumnField(sourceColumn, e.target.value), 'aria-label': `${header || `第 ${sourceColumn + 1} 列`}映射` }, h('option', { value: '' }, '未映射'), ...definitions.map(([field, label]) => h('option', { key: field, value: field }, label))));
        })),
        mappingIssues.filter(item => item.severity === 'error').length || mappingError ? h('p', { className: 'error', role: 'alert', 'data-tabular-mapping-error': true }, mappingError || mappingIssues.filter(item => item.severity === 'error').map(item => item.message).join('；')) : null,
        h('div', { className: 'tabular-step-actions' }, h('button', { type: 'button', className: 'ghost', disabled: busy, onClick: () => setStep(file.format === 'xlsx' && visibleSheets.length > 1 ? 'sheet' : 'setup') }, '上一步'), h('button', { type: 'button', className: 'primary', disabled: busy || courseUnavailable, onClick: prepare, 'data-tabular-next': true }, '生成预览')))
      : h('div', { className: 'tabular-step tabular-review-step' },
        h('dl', { className: 'ics-import-meta tabular-import-meta' }, h('div', null, h('dt', null, '文件'), h('dd', null, file.originalName)), h('div', null, h('dt', null, '工作表'), h('dd', null, currentSheet?.name ?? '—')), h('div', null, h('dt', null, '目标人物'), h('dd', null, target ? profileLabelFor(state, target.id) : '—')), h('div', null, h('dt', null, '导入类型'), h('dd', null, modeLabel(mode))), h('div', null, h('dt', null, '数据行'), h('dd', { 'data-tabular-summary-rows': true }, `${dataRowCount} 行`)), h('div', null, h('dt', null, '可导入'), h('dd', { 'data-tabular-summary-valid': true }, `${validCount} 条`)), h('div', null, h('dt', null, '有问题'), h('dd', { 'data-tabular-summary-issues': true }, `${issueCount} 条`)), h('div', null, h('dt', null, '提醒'), h('dd', { 'data-tabular-summary-warnings': true }, `${warningCount} 条`))),
        session?.status === 'failed' ? h('div', { className: 'ics-import-failure', role: 'alert' }, session.issues.map(item => item.message).join('；') || '无法解析这个表格。') : null,
        editingId && session ? h(CandidateEditPanel, { candidate: session.candidates.find(candidate => candidate.id === editingId)!, onCancel: () => setEditingId(null), onSave: saveEdited }) : null,
        h('div', { className: 'ics-candidate-list tabular-candidate-list' }, ...candidates.map(candidate => h(CandidateRow, { key: candidate.id, candidate, selected: selected.has(candidate.id), disabled: busy, toggle: () => toggle(candidate), edit: () => setEditingId(candidate.id) }))),
        error ? h('p', { className: 'error', role: 'alert', 'data-tabular-error': true }, error) : null,
        h('footer', { className: 'modal-foot' }, h('button', { type: 'button', className: 'ghost', disabled: busy, onClick: onClose }, '取消'), h('span', { className: 'modal-spacer' }), h('button', { type: 'button', className: 'secondary', disabled: busy, onClick: () => setStep('mapping') }, '返回映射'), h('button', { type: 'button', className: 'primary', disabled: busy || !session || session.status === 'failed' || selectedCount === 0, onClick: submit, 'data-tabular-confirm': true }, submitting ? '正在导入…' : `确认导入 ${selectedCount} 项`)))));
}

function validateImportSessionLocal(session: TabularImportSession, state: State): TabularImportSession {
  return validateImportSession(session, tabularCandidateValidator(), state) as TabularImportSession;
}

function stripSession(session: TabularImportSession): TabularImportSession {
  const source = session.source;
  return {
    ...session,
    source: {
      ...source,
      input: { ...source.input, table: { format: source.input.table.format, sheets: [] } },
    },
  };
}
