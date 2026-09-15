import { apply, validateState } from '../core.ts';
import type { ImportProvenance, State } from '../types.ts';
import { sourceReference } from './session.ts';
import type {
  ImportCommitContext,
  ImportCommitter,
  ImportSession,
  ScheduleCandidateValue,
} from './types.ts';
import { isImportableEntity } from './types.ts';

const clone = <T>(value: T): T => structuredClone(value);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

function changed(original: unknown, reviewed: unknown): boolean {
  try { return JSON.stringify(original) !== JSON.stringify(reviewed); } catch { return true; }
}

export function provenanceFor<TInput>(session: ImportSession<ScheduleCandidateValue, TInput>, candidate: ImportSession<ScheduleCandidateValue, TInput>['candidates'][number]): ImportProvenance {
  const originalValue = clone(candidate.originalParsedValue);
  const reviewedValue = clone(candidate.reviewedValue);
  const sourceRecordId = typeof originalValue.sourceRecordId === 'string' && originalValue.sourceRecordId.trim()
    ? originalValue.sourceRecordId
    : undefined;
  return {
    sessionId: session.id,
    source: sourceReference(session.source),
    importer: session.importer,
    ...(sourceRecordId ? { sourceRecordId } : {}),
    importedAt: session.createdAt,
    originalValue,
    reviewedValue,
    userEdited: candidate.reviewState === 'edited' || changed(originalValue, reviewedValue),
  };
}

/** The default committer enters the existing YD domain through core.apply/save. */
export function commitScheduleCandidate<TInput>(state: State, context: ImportCommitContext<ScheduleCandidateValue, TInput>): State {
  const candidateValue = context.candidate.reviewedValue;
  assert(candidateValue && isImportableEntity(candidateValue.entity), '候选记录的正式实体类型无效');
  assert(isRecord(candidateValue.value), '候选记录值无效');
  const value = clone(candidateValue.value);
  return apply(state, {
    type: 'save',
    entity: candidateValue.entity,
    value: { ...value, provenance: context.provenance },
  }, context.now);
}

export interface ImportCommitResult<TInput = unknown> {
  state: State;
  session: ImportSession<ScheduleCandidateValue, TInput>;
  committedCandidateIds: string[];
}

export class ImportCommitError<TInput = unknown> extends Error {
  readonly session: ImportSession<ScheduleCandidateValue, TInput>;
  readonly originalError: unknown;

  constructor(
    message: string,
    session: ImportSession<ScheduleCandidateValue, TInput>,
    originalError: unknown,
  ) {
    super(message, { cause: originalError });
    this.name = 'ImportCommitError';
    this.session = session;
    this.originalError = originalError;
  }
}

/**
 * Commit is all-or-nothing. Every mutation is applied to a private state copy;
 * a failure returns no partially committed State and exposes a failed session.
 */
export function commitImport<TInput = unknown>(
  state: State,
  session: ImportSession<ScheduleCandidateValue, TInput>,
  now = Date.now(),
  committer: ImportCommitter<ScheduleCandidateValue, TInput> = commitScheduleCandidate,
): ImportCommitResult<TInput> {
  assert(Number.isFinite(now), '导入提交时间无效');
  if (session.status !== 'ready') throw new Error('导入尚未准备提交：请先完成验证并审查所有候选。');
  if (session.candidates.some(candidate => candidate.reviewState === 'pending')) throw new Error('仍有待审查的导入候选。');
  if (session.candidates.some(candidate => candidate.reviewState !== 'rejected' && candidate.issues.some(item => item.severity === 'error'))) {
    throw new Error('导入包含阻断性验证错误，不能提交。');
  }

  const accepted = session.candidates.filter(candidate => candidate.reviewState === 'accepted' || candidate.reviewState === 'edited');
  let working = clone(state);
  try {
    for (const candidate of accepted) {
      const provenance = provenanceFor(session, candidate);
      working = committer(working, { session, candidate, provenance, now });
    }
    // Validate a throwaway clone because validateState also performs additive
    // legacy inbox normalization. Rejected-only imports must return the exact
    // input state, not gain an unrelated migration field.
    validateState(clone(working));
    const committedSession = clone(session);
    committedSession.status = 'committed';
    committedSession.committedAt = now;
    return {
      state: accepted.length ? working : clone(state),
      session: committedSession,
      committedCandidateIds: accepted.map(candidate => candidate.id),
    };
  } catch (error) {
    const failedSession = clone(session);
    failedSession.status = 'failed';
    failedSession.issues = [...failedSession.issues, { code: 'import.commit_failed', message: `导入提交失败：${errorMessage(error)}`, severity: 'error' }];
    throw new ImportCommitError(`导入提交失败：${errorMessage(error)}`, failedSession, error);
  }
}
