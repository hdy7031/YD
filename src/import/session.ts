import type { ImportMetadataValue, ImportSourceKind, ImportSourceRef } from '../types.ts';
import type {
  CandidateReviewState,
  ImportCandidate,
  Importer,
  ImportSession,
  ImportSessionStatus,
  RawSource,
  ValidationIssue,
} from './types.ts';

const SOURCE_KINDS: readonly ImportSourceKind[] = ['file', 'text', 'image', 'structured-file'];

const clone = <T>(value: T): T => structuredClone(value);
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
const validId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

function validMetadataValue(value: unknown): value is ImportMetadataValue {
  return value === null
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && value.length <= 2000 && !(/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')));
}

/** Validate source metadata without retaining a machine-specific absolute path. */
export function assertRawSource(source: RawSource<unknown>): void {
  assert(source && typeof source === 'object', '导入来源无效');
  assert(validId(source.id), '导入来源编号无效');
  assert(SOURCE_KINDS.includes(source.kind), '导入来源类型无效');
  assert(Number.isFinite(source.createdAt), '导入来源时间无效');
  assert(source.label === undefined || typeof source.label === 'string' && source.label.length <= 200, '导入来源标签无效');
  assert(source.originalName === undefined || typeof source.originalName === 'string' && source.originalName.length <= 260, '导入来源名称无效');
  assert(source.fingerprint === undefined || typeof source.fingerprint === 'string' && /^[^\\/]{1,200}$/.test(source.fingerprint), '导入来源指纹无效');
  if (source.metadata !== undefined) {
    assert(source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata), '导入来源元数据无效');
    const entries = Object.entries(source.metadata);
    assert(entries.length <= 50 && entries.every(([key, value]) => /^[\w.-]{1,100}$/.test(key) && !/path|filepath|file-path/i.test(key) && validMetadataValue(value)), '导入来源元数据无效');
  }
}

export function sourceReference(source: RawSource<unknown>): ImportSourceRef {
  assertRawSource(source);
  const { id, kind, label, originalName, createdAt, fingerprint, metadata } = source;
  return clone({ id, kind, label, originalName, createdAt, fingerprint, metadata });
}

function assertImporter<TInput, TValue>(importer: Importer<TInput, TValue>): void {
  assert(importer && typeof importer === 'object', '导入器无效');
  assert(validId(importer.id), '导入器编号无效');
  assert(importer.target === 'schedule', '导入目标无效');
  assert(typeof importer.parse === 'function', '导入器缺少解析入口');
}

export interface CreateImportSessionOptions<TInput> {
  id?: string;
  target?: 'schedule';
  importer: string;
  source: RawSource<TInput>;
  createdAt?: number;
}

export function createImportSession<TInput>(options: CreateImportSessionOptions<TInput>): ImportSession<unknown, TInput> {
  const id = options.id ?? globalThis.crypto.randomUUID();
  assert(validId(id), '导入会话编号无效');
  assert(validId(options.importer), '导入器编号无效');
  assert(options.target === undefined || options.target === 'schedule', '导入目标无效');
  assertRawSource(options.source as RawSource<unknown>);
  const createdAt = options.createdAt ?? Date.now();
  assert(Number.isFinite(createdAt), '导入会话时间无效');
  return {
    id,
    target: 'schedule',
    importer: options.importer,
    source: clone(options.source),
    status: 'created',
    createdAt,
    candidates: [],
    issues: [],
  };
}

function parseIssue(error: unknown): ValidationIssue {
  return { code: 'import.parse_failed', message: `导入解析失败：${errorMessage(error)}`, severity: 'error' };
}

export function parseImportSession<TPrevious, TInput, TValue>(
  session: ImportSession<TPrevious, TInput>,
  importer: Importer<TInput, TValue>,
): ImportSession<TValue, TInput> {
  assertImporter(importer);
  const next = clone(session) as unknown as ImportSession<TValue, TInput>;
  assert(next.status === 'created', '当前导入会话不能再次解析');
  assert(next.importer === importer.id, '导入器与会话不匹配');
  try {
    const drafts = importer.parse(clone(next.source));
    assert(Array.isArray(drafts), '导入器没有返回候选数组');
    const ids = new Set<string>();
    next.candidates = drafts.map((draft, index) => {
      assert(draft && typeof draft === 'object' && 'value' in draft, `第 ${index + 1} 个候选格式无效`);
      const candidateDraft = draft as { id?: unknown; value: TValue; confidence?: unknown };
      const id = candidateDraft.id ?? `${next.id}-candidate-${index + 1}`;
      assert(validId(id), `第 ${index + 1} 个候选编号无效`);
      assert(!ids.has(id), `候选编号重复：${id}`);
      ids.add(id);
      assert(candidateDraft.confidence === undefined || candidateDraft.confidence === 'deterministic' || candidateDraft.confidence === 'uncertain', `候选 ${id} 的置信语义无效`);
      const value = clone(candidateDraft.value);
      return {
        id,
        sessionId: next.id,
        sourceId: next.source.id,
        importer: importer.id,
        originalParsedValue: clone(value),
        reviewedValue: value,
        issues: [],
        reviewState: 'pending' as const,
        confidence: candidateDraft.confidence,
      };
    });
    next.status = 'parsed';
    next.issues = [];
    delete next.committedAt;
    return next;
  } catch (error) {
    next.candidates = [];
    next.status = 'failed';
    next.issues = [parseIssue(error)];
    return next;
  }
}

function canReview(status: ImportSessionStatus): boolean {
  return status === 'parsed' || status === 'needs_review' || status === 'ready';
}

function hasBlockingIssue(candidate: ImportCandidate<unknown>): boolean {
  return candidate.reviewState !== 'rejected' && candidate.issues.some(issue => issue.severity === 'error');
}

function allReviewed(candidates: readonly ImportCandidate<unknown>[]): boolean {
  return candidates.every(candidate => candidate.reviewState !== 'pending');
}

function statusAfterReview(candidates: readonly ImportCandidate<unknown>[], wasParsed: boolean, edited: boolean): ImportSessionStatus {
  if (wasParsed || edited || !allReviewed(candidates) || candidates.some(hasBlockingIssue)) return 'needs_review';
  return 'ready';
}

export type CandidateReviewAction<TValue> =
  | { state: Exclude<CandidateReviewState, 'pending' | 'edited'> }
  | { state: 'edited'; value: TValue };

export function reviewCandidate<TValue, TInput>(
  session: ImportSession<TValue, TInput>,
  candidateId: string,
  action: CandidateReviewAction<TValue>,
): ImportSession<TValue, TInput> {
  assert(canReview(session.status), '当前导入会话不能审查');
  const next = clone(session);
  const candidate = next.candidates.find(item => item.id === candidateId);
  assert(candidate, '导入候选不存在');
  const wasParsed = next.status === 'parsed';
  if (action.state === 'edited') {
    candidate.reviewedValue = clone(action.value);
    candidate.reviewState = 'edited';
    // Editing invalidates the previous validation result; the original value remains untouched.
    candidate.issues = [];
  } else {
    candidate.reviewState = action.state;
  }
  next.status = statusAfterReview(next.candidates, wasParsed, action.state === 'edited');
  return next;
}

export function acceptCandidate<TValue, TInput>(session: ImportSession<TValue, TInput>, candidateId: string): ImportSession<TValue, TInput> {
  return reviewCandidate(session, candidateId, { state: 'accepted' });
}

export function rejectCandidate<TValue, TInput>(session: ImportSession<TValue, TInput>, candidateId: string): ImportSession<TValue, TInput> {
  return reviewCandidate(session, candidateId, { state: 'rejected' });
}

export function editCandidate<TValue, TInput>(session: ImportSession<TValue, TInput>, candidateId: string, value: TValue): ImportSession<TValue, TInput> {
  return reviewCandidate(session, candidateId, { state: 'edited', value });
}
