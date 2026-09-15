import type { Entity, ImportProvenance, ImportSourceRef, State } from '../types.ts';

/** 6A 只建立目标边界；真实文件格式 importer 留给后续阶段。 */
export type ImportTarget = 'schedule';
export type ImportableEntity = Extract<Entity, 'courses' | 'events' | 'tasks' | 'exceptions'>;

/**
 * RawSource carries input for the lifetime of an import session. The input is
 * deliberately not part of ImportSourceRef, so future persistence can retain
 * provenance without accidentally retaining a file path or raw payload.
 */
export interface RawSource<TInput = unknown> extends ImportSourceRef { input: TInput }

/** Structured deterministic parsers do not need to invent a numeric probability. */
export type ImportConfidence = 'deterministic' | 'uncertain';
export type CandidateReviewState = 'pending' | 'accepted' | 'rejected' | 'edited';
export type ImportSessionStatus = 'created' | 'parsed' | 'needs_review' | 'ready' | 'committed' | 'failed';
export type ValidationIssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  code: string;
  message: string;
  severity: ValidationIssueSeverity;
  path?: string;
}

/**
 * A candidate points at an existing YD entity kind and value. It is a
 * transport envelope, not a second Event/Course/Task model.
 */
export interface ScheduleCandidateValue {
  entity: ImportableEntity;
  value: unknown;
}

export interface ImportCandidateDraft<TValue = unknown> {
  id?: string;
  value: TValue;
  confidence?: ImportConfidence;
}

export interface Importer<TInput = unknown, TValue = ScheduleCandidateValue> {
  readonly id: string;
  readonly target: ImportTarget;
  parse(source: RawSource<TInput>): readonly ImportCandidateDraft<TValue>[];
}

export interface ImportCandidate<TValue = unknown> {
  id: string;
  sessionId: string;
  sourceId: string;
  importer: string;
  originalParsedValue: TValue;
  reviewedValue: TValue;
  issues: ValidationIssue[];
  reviewState: CandidateReviewState;
  confidence?: ImportConfidence;
}

export interface ImportSession<TValue = unknown, TInput = unknown> {
  id: string;
  target: ImportTarget;
  importer: string;
  source: RawSource<TInput>;
  status: ImportSessionStatus;
  createdAt: number;
  candidates: ImportCandidate<TValue>[];
  issues: ValidationIssue[];
  committedAt?: number;
}

export interface ImportValidationContext<TValue = unknown, TInput = unknown> {
  state: State;
  session: ImportSession<TValue, TInput>;
  candidate: ImportCandidate<TValue>;
}

export type CandidateValidator<TValue = unknown, TInput = unknown> = (
  value: TValue,
  context: ImportValidationContext<TValue, TInput>,
) => readonly ValidationIssue[];

export interface ImportCommitContext<TValue = unknown, TInput = unknown> {
  session: ImportSession<TValue, TInput>;
  candidate: ImportCandidate<TValue>;
  provenance: ImportProvenance;
  now: number;
}

export type ImportCommitter<TValue = unknown, TInput = unknown> = (
  state: State,
  context: ImportCommitContext<TValue, TInput>,
) => State;

export function isImportableEntity(value: unknown): value is ImportableEntity {
  return value === 'courses' || value === 'events' || value === 'tasks' || value === 'exceptions';
}
