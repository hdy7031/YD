import { validate } from '../core.ts';
import type { State } from '../types.ts';
import type {
  CandidateValidator,
  ImportCandidate,
  ImportSession,
  ScheduleCandidateValue,
  ValidationIssue,
} from './types.ts';
import { isImportableEntity } from './types.ts';

const clone = <T>(value: T): T => structuredClone(value);
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
const issue = (code: string, message: string, severity: ValidationIssue['severity'] = 'error', path?: string): ValidationIssue => ({ code, message, severity, ...(path ? { path } : {}) });
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Reuses the existing formal-domain validator. Import validation adds only
 * import-specific diagnostics such as duplicate targets and useful warnings;
 * it does not create a second set of Event/Course rules.
 */
export function validateScheduleCandidate(state: State, value: ScheduleCandidateValue): ValidationIssue[] {
  if (!value || !isImportableEntity(value.entity)) return [issue('candidate.entity_invalid', '候选记录的正式实体类型无效。')];
  if (!isRecord(value.value)) return [issue('candidate.value_invalid', '候选记录值无效。')];
  const record = clone(value.value);
  const issues: ValidationIssue[] = [];
  const list = state[value.entity] as Array<{ id?: unknown }>;
  if (typeof record.id === 'string' && list.some(item => item.id === record.id)) issues.push(issue('candidate.id_exists', `正式数据中已经存在编号 ${record.id}，导入不会静默覆盖已有记录。`));
  try {
    validate(value.entity, record, state);
  } catch (error) {
    issues.push(issue('candidate.domain_invalid', errorMessage(error)));
  }
  if ((value.entity === 'events' || value.entity === 'courses') && typeof record.place === 'string' && !record.place.trim()) {
    issues.push(issue('candidate.place_missing', '地点为空；确认后仍可提交。', 'warning', 'place'));
  }
  return issues;
}

export function scheduleCandidateValidator<TInput = unknown>(): CandidateValidator<ScheduleCandidateValue, TInput> {
  return (value, context) => {
    const issues = validateScheduleCandidate(context.state, value);
    const record = value && isImportableEntity(value.entity) && isRecord(value.value) ? value.value : undefined;
    if (value && isImportableEntity(value.entity) && record && typeof record.id === 'string') {
      const duplicate = context.session.candidates.some(other => {
        if (other.id === context.candidate.id || !other.reviewedValue || !isImportableEntity((other.reviewedValue as ScheduleCandidateValue).entity)) return false;
        const otherValue = other.reviewedValue as ScheduleCandidateValue;
        return otherValue.entity === value.entity && isRecord(otherValue.value) && otherValue.value.id === record.id;
      });
      if (duplicate) issues.push(issue('candidate.id_duplicate', `本次导入中重复了正式记录编号 ${record.id}。`));
    }
    return issues;
  };
}

function hasBlockingIssue<TValue>(candidate: ImportCandidate<TValue>): boolean {
  return candidate.reviewState !== 'rejected' && candidate.issues.some(item => item.severity === 'error');
}

export function validateImportSession<TValue, TInput>(
  session: ImportSession<TValue, TInput>,
  validator: CandidateValidator<TValue, TInput>,
  state: State,
): ImportSession<TValue, TInput> {
  if (session.status === 'failed' || session.status === 'committed') throw new Error('当前导入会话不能验证');
  const next = clone(session);
  for (const candidate of next.candidates) {
    try {
      const result = validator(clone(candidate.reviewedValue), { state, session: next, candidate });
      if (!Array.isArray(result)) throw new Error('验证器没有返回问题数组');
      candidate.issues = result.map(item => clone(item));
    } catch (error) {
      candidate.issues = [issue('candidate.validation_failed', `候选验证失败：${errorMessage(error)}`)];
    }
  }
  next.issues = [];
  next.status = next.candidates.some(candidate => candidate.reviewState === 'pending' || hasBlockingIssue(candidate))
    ? 'needs_review'
    : 'ready';
  return next;
}
