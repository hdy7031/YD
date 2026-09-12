// v0.3 Phase 3C：临时手动状态（Manual Override）。
//
// Manual 是"临时现实状态"——用户此刻实际在做什么；Routine 是"日常规律"。
// 两者语义不同，因此 manual 单独持久化，**不塞进 Routine**，也不新增
// manual_busy / manual_meal 这类重复 kind：来源由 CurrentState.source = 'manual' 表达。
//
// 优先级（见 src/state/engine.ts）：Manual 100 > Schedule 80 > Routine 40 > Idle 10。
// 到期后不需要任何人工恢复：下一次计算自然回落到 Schedule / Routine / Idle。
import type { ManualOverride, PersonId, State } from '../types.ts';

/**
 * 第一版支持的临时状态：复用 CurrentState 的领域 kind（外加两个日程不会产生的
 * 现实状态 busy / rest），不创建 manual_* 变体。
 */
export type ManualStateKind = 'idle' | 'busy' | 'rest' | 'focus' | 'commute' | 'meal' | 'custom';

export const MANUAL_STATE_KINDS: readonly ManualStateKind[] = ['idle', 'busy', 'rest', 'focus', 'commute', 'meal', 'custom'];

export const isManualStateKind = (value: unknown): value is ManualStateKind =>
  typeof value === 'string' && (MANUAL_STATE_KINDS as readonly string[]).includes(value);

/** 时长预设（分钟）；null = 直到用户取消。UI 负责把它换算成 endAt。 */
export const MANUAL_DURATION_MINUTES: readonly (number | null)[] = [30, 60, 120, null];

/** 每个人最多同时有一条覆盖，因此总记录数上限很小。 */
export const MANUAL_OVERRIDE_LIMIT = 8;
export const MANUAL_LABEL_LIMIT = 40;

/** 覆盖此刻是否生效：左闭右开；endAt === null 表示"直到取消"。 */
export function manualOverrideActive(override: ManualOverride, now: number): boolean {
  return override.startAt <= now && (override.endAt === null || now < override.endAt);
}

/** 已经过期的覆盖（endAt 已到）。用于保存时清理，绝不用于状态判断。 */
export function manualOverrideExpired(override: ManualOverride, now: number): boolean {
  return override.endAt !== null && override.endAt <= now;
}

/** 这个人此刻生效的手动状态；没有则 null。 */
export function activeManualOverride(state: Pick<State, 'manualOverrides'>, personId: PersonId, now: number): ManualOverride | null {
  return (state.manualOverrides ?? []).find(override => override.personId === personId && manualOverrideActive(override, now)) ?? null;
}

/**
 * 清理已过期的覆盖。只在**保存路径**（用户命令 / 迁移）调用，
 * 不在每秒运行的 tick 里调用——过期记录不影响任何状态判断，
 * 不需要为了清理它而产生每秒磁盘写入。
 */
export function pruneManualOverrides(state: Pick<State, 'manualOverrides'>, now: number): boolean {
  const before = state.manualOverrides ?? [];
  const kept = before.filter(override => !manualOverrideExpired(override, now));
  // 没有可清理的就不碰这个字段：旧版本形态的数据（迁移前的 fixture / 备份）
  // 不能在保存时被凭空补上一个空数组。
  if (kept.length === before.length) return false;
  state.manualOverrides = kept;
  return true;
}

function assertManual(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const idOk = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 100 && /^[\w-]+$/.test(value);

export function assertManualOverride(value: unknown, context = '临时状态'): asserts value is ManualOverride {
  assertManual(value && typeof value === 'object', `${context}无效`);
  const override = value as ManualOverride;
  assertManual(idOk(override.id), `${context}编号无效`);
  assertManual(typeof override.personId === 'string' && override.personId.length > 0 && override.personId.length <= 100, `${context}所属人无效`);
  assertManual(isManualStateKind(override.kind), `${context}类型无效`);
  assertManual(typeof override.label === 'string' && override.label.trim().length > 0 && override.label.length <= MANUAL_LABEL_LIMIT, `${context}名称应为 1—${MANUAL_LABEL_LIMIT} 字`);
  assertManual(Number.isFinite(override.startAt), `${context}开始时间无效`);
  assertManual(override.endAt === null || (Number.isFinite(override.endAt) && override.endAt > override.startAt), `${context}结束时间无效`);
  assertManual(Number.isFinite(override.createdAt), `${context}创建时间无效`);
}
