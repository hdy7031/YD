// Phase 5B3 · Optional Academic Semantics.
//
// YD Core 的日程是**通用**的：绝对日期 + 时间 + 标题 + 地点 + 归属人（Event / Task）。
// 「学期 / 教学周 / 节次」只属于学生与教师场景，因此它是**可选能力**：
//
//   Academic present  → 提供学业投影（教学周展开、节次时间、学期阶段）
//   Academic absent   → 通用日程完整工作；任何消费方都必须显式处理这种状态
//
// 三条规则（其它模块都不得自行推导）：
//   1. 学业配置在 Profile 上是**扁平可选字段**（startDate / weeks / periods），
//      三者要么都存在、要么都不存在；持久化结构没有变化，所以旧库不需要 migration。
//   2. 只有 complete 才算"有学业配置"；partial（只填了一两个字段）是**坏数据**，
//      由 core.validate 明确拒绝 —— optional ≠ unvalidated。
//   3. 绝不为"让 Profile 合法"而生成假学期：fresh install 与新 companion 都不写任何
//      学业字段。下面这些 preset 常量只服务于**用户显式打开配置入口**时的表单初值。
import type { AcademicCalendar, ClassPeriod, Profile } from './types.ts';

export type AcademicPresence = 'absent' | 'complete' | 'partial';

const academicFields = (profile: Pick<Profile, 'startDate' | 'weeks' | 'periods'>) =>
  [profile.startDate, profile.weeks, profile.periods].filter(value => value !== undefined).length;

/** 该档案的学业配置状态：absent（普通用户）/ complete（学生、教师）/ partial（坏数据）。 */
export function academicPresence(profile: Pick<Profile, 'startDate' | 'weeks' | 'periods'>): AcademicPresence {
  const present = academicFields(profile);
  if (present === 0) return 'absent';
  return present === 3 ? 'complete' : 'partial';
}

export const hasAcademic = (profile: Pick<Profile, 'startDate' | 'weeks' | 'periods'>): boolean => academicPresence(profile) === 'complete';

/**
 * 该档案的学业配置；没有配置（或数据不完整）时返回 undefined。
 *
 * 消费方拿到 undefined 时必须走"没有学业语义"的通用分支，不得回落到 placeholder：
 * 不显示「第 0 周」「未设置学期」，也不生成任何默认学期。
 */
export function academicOf(profile: Pick<Profile, 'startDate' | 'weeks' | 'periods'> | undefined): AcademicCalendar | undefined {
  if (!profile || academicPresence(profile) !== 'complete') return undefined;
  return { startDate: profile.startDate as string, weeks: profile.weeks as number, periods: profile.periods as ClassPeriod[] };
}

/** 节次表：第 N 节（1 起）→ 起止时间；没有学业配置或越界时为 undefined。 */
export function periodOf(calendar: AcademicCalendar | undefined, index: number): ClassPeriod | undefined {
  if (!calendar || !Number.isInteger(index) || index < 1) return undefined;
  return calendar.periods[index - 1];
}

// ---------------------------------------------------------------------------
// 用户显式配置学业时的表单初值（preset，不是自动写入的数据）
//
// 与 ordinary 用户的差别：**只有用户真的打开「学期与节次」并保存**，这些值才会落盘。
// fresh install / 新 companion / 迁移都不会使用它们。
// ---------------------------------------------------------------------------
export const STANDARD_PERIOD_PRESET: ClassPeriod[] = [
  { start: '08:00', end: '08:45' }, { start: '08:55', end: '09:40' },
  { start: '10:00', end: '10:45' }, { start: '10:55', end: '11:40' },
  { start: '14:00', end: '14:45' }, { start: '14:55', end: '15:40' },
  { start: '16:00', end: '16:45' }, { start: '16:55', end: '17:40' },
];
export const SUGGESTED_TERM_WEEKS = 20;

/** 学期起始日建议值：本周周一（只用于表单初值，不含任何真实校历信息）。 */
export function suggestedTermStart(now: number): string {
  const shifted = new Date(now + 8 * 3600000);
  const iso = shifted.toISOString().slice(0, 10);
  const weekday = new Date(iso + 'T12:00:00Z').getUTCDay() || 7;
  const monday = new Date(Date.parse(iso + 'T00:00:00Z') - (weekday - 1) * 86400000);
  return monday.toISOString().slice(0, 10);
}
