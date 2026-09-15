import React, { useState } from 'react';
import { id } from '../core.ts';
import { profileLabelFor } from './shell.ts';
import {
  acceptCandidate,
  prepareICSImport,
  rawSourceFromICSFile,
  rejectCandidate,
  type ImportCandidate,
  type ScheduleCandidateValue,
  type ValidationIssue,
} from '../import/index.ts';
import type {
  ICSCandidateValue,
  ICSFileSelection,
  ICSImportSession,
} from '../import/ics.ts';
import type { Event, PersonId, State } from '../types.ts';

const h = React.createElement;

interface CommitResult {
  state: State;
  committedCandidateIds: string[];
}

export interface ICSImportDialogProps {
  state: State;
  file: ICSFileSelection;
  targetPersonId: PersonId;
  pending: boolean;
  onClose: () => void;
  onCommit: (session: ICSImportSession) => Promise<CommitResult>;
  onDone: (result: CommitResult) => void;
}

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);
const isBlocking = (candidate: ImportCandidate<ScheduleCandidateValue>): boolean => candidate.issues.some(issue => issue.severity === 'error');
const candidateValue = (candidate: ImportCandidate<ScheduleCandidateValue>): ICSCandidateValue | null => {
  const value = candidate.reviewedValue;
  return value && typeof value === 'object' && value.entity === 'events' && 'display' in value && 'metadata' in value
    ? value as ICSCandidateValue
    : null;
};

function displayStamp(value: string | undefined): string {
  return value ? value.replace('T', ' ') : '时间无法解析';
}

function candidateRange(candidate: ImportCandidate<ScheduleCandidateValue>): string {
  const wrapped = candidateValue(candidate);
  if (!wrapped) return '事件内容无法读取';
  if (wrapped.display.allDay) return `${wrapped.display.start || '日期无法解析'} · 全天`;
  const start = displayStamp(wrapped.display.start);
  const end = wrapped.display.end ? displayStamp(wrapped.display.end) : '';
  return end ? `${start} — ${end}` : start;
}

function candidateTitle(candidate: ImportCandidate<ScheduleCandidateValue>): string {
  const wrapped = candidateValue(candidate);
  const title = (wrapped?.value as Partial<Event> | undefined)?.title;
  return title?.trim() ? title : '（缺少标题）';
}

function candidatePlace(candidate: ImportCandidate<ScheduleCandidateValue>): string | undefined {
  const wrapped = candidateValue(candidate);
  const place = (wrapped?.value as Partial<Event> | undefined)?.place;
  return place?.trim() ? place : undefined;
}

function CandidateRow({ candidate, selected, disabled, toggle }: {
  candidate: ImportCandidate<ScheduleCandidateValue>;
  selected: boolean;
  disabled: boolean;
  toggle: () => void;
}) {
  const blocking = isBlocking(candidate);
  return h('article', {
    className: `ics-candidate${blocking ? ' has-error' : ''}${selected ? ' is-selected' : ''}`,
    'data-ics-candidate': candidate.id,
  },
  h('label', { className: 'ics-candidate-select' },
    h('input', {
      type: 'checkbox',
      checked: selected,
      disabled: disabled || blocking,
      'aria-label': `选择${candidateTitle(candidate)}`,
      onChange: toggle,
    }),
    h('span', { className: 'ics-candidate-check', 'aria-hidden': true })),
  h('div', { className: 'ics-candidate-main' },
    h('div', { className: 'ics-candidate-title-line' }, h('h3', null, candidateTitle(candidate)),
      blocking ? h('span', { className: 'tag' }, '无法导入') : null),
    h('p', { className: 'time' }, candidateRange(candidate)),
    candidatePlace(candidate) ? h('p', { className: 'muted' }, candidatePlace(candidate)) : null,
    candidate.issues.length
      ? h('ul', { className: 'ics-candidate-issues' }, ...candidate.issues.map((item: ValidationIssue, index) => h('li', {
        key: `${item.code}-${index}`,
        className: item.severity === 'error' ? 'error' : 'warning',
      }, item.message)))
      : null));
}

export function ICSImportDialog({ state, file, targetPersonId, pending, onClose, onCommit, onDone }: ICSImportDialogProps) {
  const [prepared] = useState<{ session: ICSImportSession | null; error: string }>(() => {
    try {
      const source = rawSourceFromICSFile(file, id());
      const session = prepareICSImport(state, source, targetPersonId);
      return { session, error: '' };
    } catch (error) {
      return { session: null, error: messageOf(error) };
    }
  });
  const [reviewSession, setReviewSession] = useState<ICSImportSession | null>(prepared.session);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(
    prepared.session?.status === 'failed' ? [] : prepared.session?.candidates.filter(candidate => !isBlocking(candidate)).map(candidate => candidate.id) ?? [],
  ));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const session = reviewSession;
  const candidates = session?.candidates ?? [];
  const validCount = candidates.filter(candidate => !isBlocking(candidate)).length;
  const issueCount = candidates.filter(candidate => candidate.issues.length > 0).length;
  const selectedCount = candidates.filter(candidate => selected.has(candidate.id) && !isBlocking(candidate)).length;
  const target = state.profiles.find(profile => profile.id === targetPersonId);
  const targetLabel = target?.name?.trim() || profileLabelFor(state, targetPersonId);
  const busy = pending || submitting;

  const toggle = (candidate: ImportCandidate<ScheduleCandidateValue>) => {
    if (busy || isBlocking(candidate)) return;
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(candidate.id)) next.delete(candidate.id);
      else next.add(candidate.id);
      return next;
    });
  };

  const submit = async () => {
    if (!session || session.status === 'failed' || !selectedCount || busy) return;
    setSubmitting(true);
    setError('');
    try {
      let next = session;
      for (const candidate of next.candidates) {
        next = selected.has(candidate.id) ? acceptCandidate(next, candidate.id) : rejectCandidate(next, candidate.id);
      }
      if (next.status !== 'ready') throw new Error('请先取消有问题的事件，再确认导入。');
      const result = await onCommit(next);
      onDone(result);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return h('div', { className: 'modal-backdrop' },
    h('section', { className: 'modal ics-import-modal', role: 'dialog', 'aria-modal': true, 'aria-label': '核对日历导入', 'data-ics-import-dialog': true },
      h('header', { className: 'modal-head' },
        h('div', null, h('div', { className: 'import-kicker' }, '日历文件已读取'), h('h2', null, '核对 ICS 导入')),
        h('button', { type: 'button', className: 'ghost', disabled: busy, 'data-ics-cancel': true, onClick: onClose }, '关闭')),
      h('dl', { className: 'ics-import-meta' },
        h('div', null, h('dt', null, '文件'), h('dd', { 'data-ics-file-name': true }, file.originalName)),
        h('div', null, h('dt', null, '目标人物'), h('dd', { 'data-ics-target': true }, targetLabel)),
        h('div', null, h('dt', null, '解析结果'), h('dd', { 'data-ics-summary-events': true }, `${candidates.length} 个事件`)),
        h('div', null, h('dt', null, '可导入'), h('dd', { 'data-ics-summary-valid': true }, `${validCount} 个`)),
        h('div', null, h('dt', null, '有问题'), h('dd', { 'data-ics-summary-issues': true }, `${issueCount} 个`))),
      prepared.error || session?.status === 'failed'
        ? h('div', { className: 'ics-import-failure', role: 'alert' }, prepared.error || session?.issues.map(item => item.message).join('；') || '无法解析这个 ICS 文件。')
        : h('div', { className: 'ics-candidate-list' }, ...candidates.map(candidate => h(CandidateRow, {
          key: candidate.id,
          candidate,
          selected: selected.has(candidate.id),
          disabled: busy,
          toggle: () => toggle(candidate),
        }))),
      error ? h('p', { className: 'error', role: 'alert', 'data-ics-error': true }, error) : null,
      h('footer', { className: 'modal-foot' },
        h('span', { className: 'modal-spacer' }),
        h('button', { type: 'button', className: 'ghost', disabled: busy, 'data-ics-cancel': true, onClick: onClose }, '取消'),
        h('button', { type: 'button', className: 'primary', disabled: busy || !session || session.status === 'failed' || selectedCount === 0, 'data-ics-confirm': true, onClick: submit }, submitting ? '正在导入…' : `确认导入 ${selectedCount} 项`))));
}
