// 每个人自己的作息规则（Routine）的纯计算模块 —— v0.3 Phase 2A。
//
// 这里只有数据形状与纯函数：不读数据库、不走 IPC、不碰 DOM / Electron / 桌宠素材。
// Phase 2A 只建立领域模型与计算引擎，**桌宠消费方（src/companion-display.ts）继续使用
// 0.2.x 的写死时间表**；Phase 2B 才把桌宠切到 Routine 上（迁移种下的默认作息保证
// 逐分钟行为不变）。
//
// 时间语义（与 src/core.ts 的 dateOf / epoch 一致，全部按北京时间 UTC+8）：
//   * days 用 1—7，1 = 周一（与 core.weekday() 相同）；
//   * 规则区间左闭右开 [start, end)：11:30–12:00 命中 11:30:00，不命中 12:00:00；
//   * start > end 表示跨午夜，区间属于**开始的那一天**：
//     days=[1] + 23:30–07:30 = 周一 23:30 到周二 07:30，因此周二 01:00 命中的是
//     这条"周一开始"的规则，跨周同理（周日 23:30 → 周一 07:30）；
//   * 一条跨午夜规则在库里始终是一条（不拆成 23:30–24:00 + 00:00–07:30）：
//     用户认为那是"一次睡眠"，编辑时也只能是一条；
//   * start === end 非法（不是"24 小时"）：校验层拒绝，计算层直接忽略。

export const ROUTINE_DAY_MS = 86400000;
const MINUTE_MS = 60000;
// 北京时间固定偏移：与 core.dateOf / epoch 的 '+08:00' 相同，不存在夏令时。
const BEIJING_OFFSET_MS = 8 * 3600000;
// 单次查询的区间上限：Routine 只服务"现在 / 接下来"的短窗口，
// 上限存在时，误传 Infinity 之类的区间会明确失败而不是死循环。
const MAX_QUERY_SPAN_MS = 366 * ROUTINE_DAY_MS;

export type RoutineKind = 'sleep' | 'wake' | 'meal' | 'nap' | 'commute' | 'focus' | 'custom';
export const ROUTINE_KINDS: readonly RoutineKind[] = ['sleep', 'wake', 'meal', 'nap', 'commute', 'focus', 'custom'];
export const isRoutineKind = (value: unknown): value is RoutineKind =>
  typeof value === 'string' && (ROUTINE_KINDS as readonly string[]).includes(value);

// 意外重叠时的默认优先级：数值越大越优先。UI 本轮不暴露它，只保证结果稳定，
// 并被 Phase 3 的 StateEngine 复用（Routine 整体仍然低于 Schedule）。
export const routineKindPriority: Record<RoutineKind, number> = {
  sleep: 40, nap: 35, meal: 30, wake: 25, focus: 20, commute: 15, custom: 10,
};

export interface RoutineRule {
  id: string;
  kind: RoutineKind;
  label: string;
  /** HH:mm，左闭右开的开始；大于 end 表示跨午夜。 */
  start: string;
  /** HH:mm，左闭右开的结束；等于 start 时非法。 */
  end: string;
  /** 1—7（1 = 周一），指规则**开始**的那一天；跨午夜规则在次日早晨仍然生效。 */
  days: number[];
  enabled: boolean;
  /** 同时命中时的优先级；相同则按"更晚开始 → 更小编号"稳定裁决。 */
  priority: number;
}

// 规则来源：'legacy-default' = 0.2.x 为兼容旧桌宠写死时间表自动种下的默认作息
// （用户还没有确认过）；'user' = 用户自己的规则（含"暂时还没有规则"的空作息）。
// 目的只是让设置页以后能说清"这套作息是旧默认值"，不是审计系统。
export type RoutineSource = 'legacy-default' | 'user';
export const ROUTINE_SOURCES: readonly RoutineSource[] = ['legacy-default', 'user'];

// 以档案为单位的作息；嵌套在 Profile 下，因此**不再存 personId**（Profile.id 就是身份）。
export interface RoutineProfile {
  source: RoutineSource;
  updatedAt: number;
  rules: RoutineRule[];
}

// 运行时派生对象：由规则实时算出，永远不落盘（与 PersonStatus 同类）。
export interface RoutineOccurrence {
  ruleId: string;
  kind: RoutineKind;
  label: string;
  startAt: number;
  endAt: number;
  priority: number;
}

// ---------- 时间工具（纯函数，北京时间） ----------

export const routineTime = (value: unknown): value is string =>
  typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function routineMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** 规则时长（分钟）：同一天为 end - start，跨午夜为 end - start + 24h；start === end 返回 0。 */
export function routineSpanMinutes(rule: Pick<RoutineRule, 'start' | 'end'>): number {
  return (routineMinutes(rule.end) - routineMinutes(rule.start) + 1440) % 1440;
}

/** 北京时间当天 00:00 的整数天序号。 */
export function routineDayIndex(now: number): number {
  return Math.floor((now + BEIJING_OFFSET_MS) / ROUTINE_DAY_MS);
}

/** 北京时间当天 00:00 的时间戳。 */
export function routineDayStart(now: number): number {
  return routineDayIndex(now) * ROUTINE_DAY_MS - BEIJING_OFFSET_MS;
}

/** 北京时间当天分钟数 0—1439。 */
export function routineMinutesOfDay(now: number): number {
  const inDay = (now + BEIJING_OFFSET_MS) % ROUTINE_DAY_MS;
  return Math.floor(((inDay + ROUTINE_DAY_MS) % ROUTINE_DAY_MS) / MINUTE_MS);
}

/** 北京时间当天的星期：1 = 周一 … 7 = 周日（与 core.weekday 一致）。 */
export function routineWeekday(now: number): number {
  return new Date(routineDayStart(now) + BEIJING_OFFSET_MS).getUTCDay() || 7;
}

/** 星期取值 1—7（1 = 周一），与 days 字段同义。 */
export const ROUTINE_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

// ---------- 计算引擎 ----------

function compareOccurrences(a: RoutineOccurrence, b: RoutineOccurrence): number {
  return a.startAt - b.startAt || b.priority - a.priority || a.ruleId.localeCompare(b.ruleId);
}

// 同时命中：优先级大者胜；相同优先级时更晚开始的更贴近当前活动；再相同按规则编号。
// 结果只由数据决定，与 rules 数组顺序无关。
function preferOccurrence(candidate: RoutineOccurrence, current: RoutineOccurrence): boolean {
  if (candidate.priority !== current.priority) return candidate.priority > current.priority;
  if (candidate.startAt !== current.startAt) return candidate.startAt > current.startAt;
  return candidate.ruleId.localeCompare(current.ruleId) < 0;
}

/**
 * 生成 [from, to) 内的作息区间（含从前一天开始、跨过 from 的跨午夜规则）。
 * 区间必须有限且不超过 366 天；空作息、全部停用或非法（start === end）的规则不产出区间。
 */
export function routineOccurrences(routine: RoutineProfile | undefined, from: number, to: number): RoutineOccurrence[] {
  if (!routine || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  if (to - from > MAX_QUERY_SPAN_MS) throw new Error('作息查询区间过长');
  const rules = routine.rules.filter(rule => rule.enabled && routineSpanMinutes(rule) > 0);
  if (!rules.length) return [];
  const occurrences: RoutineOccurrence[] = [];
  // 跨午夜规则从前一天开始，因此向前多算一天。
  for (let day = routineDayIndex(from) - 1; day <= routineDayIndex(to); day += 1) {
    const dayStart = day * ROUTINE_DAY_MS - BEIJING_OFFSET_MS;
    const weekday = new Date(dayStart + BEIJING_OFFSET_MS).getUTCDay() || 7;
    for (const rule of rules) {
      if (!rule.days.includes(weekday)) continue;
      const startAt = dayStart + routineMinutes(rule.start) * MINUTE_MS;
      const endAt = startAt + routineSpanMinutes(rule) * MINUTE_MS;
      if (startAt < to && endAt > from) occurrences.push({ ruleId: rule.id, kind: rule.kind, label: rule.label, startAt, endAt, priority: rule.priority });
    }
  }
  return occurrences.sort(compareOccurrences);
}

/** now 这一刻命中的规则；没有则返回 null。 */
export function activeRoutine(routine: RoutineProfile | undefined, now: number): RoutineOccurrence | null {
  let best: RoutineOccurrence | null = null;
  for (const occurrence of routineOccurrences(routine, now, now + 1)) if (!best || preferOccurrence(occurrence, best)) best = occurrence;
  return best;
}

/**
 * 下一个"状态会变化"的时刻（区间的起点或终点，严格大于 now）；没有规则时返回 null。
 * 按周重复的规则一定在 7 天内出现边界，因此用 8 天窗口就足够。
 */
export function nextRoutineBoundary(routine: RoutineProfile | undefined, now: number): number | null {
  let next = Number.POSITIVE_INFINITY;
  for (const occurrence of routineOccurrences(routine, now, now + 8 * ROUTINE_DAY_MS)) {
    if (occurrence.startAt > now && occurrence.startAt < next) next = occurrence.startAt;
    if (occurrence.endAt > now && occurrence.endAt < next) next = occurrence.endAt;
  }
  return Number.isFinite(next) ? next : null;
}

// ---------- 工厂 ----------

/** 还没有规则的空作息（用户自己的，不是任何人的默认作息）。 */
export function emptyRoutine(updatedAt: number): RoutineProfile {
  return { source: 'user', updatedAt, rules: [] };
}

// 0.2.x 桌宠写死的时间状态（见 src/companion-display.ts 的 companionSchedule）：
// 23:30–07:30 睡觉、07:30–07:50 起床、11:30–12:00 吃饭、12:30–14:00 午睡、14:00–14:20 起床。
// 迁移只把这一套种给"当前桌宠主体"，让 Phase 2B 切换消费方后逐分钟行为不变；
// 它不代表任何人的真实生活习惯，用户之后可以整套改掉。
export const LEGACY_DEFAULT_ROUTINE_TIMES = [
  { id: 'legacy-night-sleep', kind: 'sleep', label: '夜间睡觉', start: '23:30', end: '07:30' },
  { id: 'legacy-morning-wake', kind: 'wake', label: '起床', start: '07:30', end: '07:50' },
  { id: 'legacy-lunch', kind: 'meal', label: '午饭', start: '11:30', end: '12:00' },
  { id: 'legacy-nap', kind: 'nap', label: '午睡', start: '12:30', end: '14:00' },
  { id: 'legacy-afternoon-wake', kind: 'wake', label: '午睡后起床', start: '14:00', end: '14:20' },
] as const;

// 默认规则的唯一构造处：迁移、initial() 与设置页的"使用默认作息"共用它，
// 任何地方都不允许再写一遍这组时间。
function defaultRoutineRules(): RoutineRule[] {
  return LEGACY_DEFAULT_ROUTINE_TIMES.map(entry => ({
    ...entry,
    days: [...ROUTINE_WEEKDAYS],
    enabled: true,
    priority: routineKindPriority[entry.kind],
  }));
}

/** 0.2.x 默认桌宠时间表对应的作息规则（每天启用，优先级取类型默认值）。 */
export function legacyDefaultRoutine(updatedAt: number): RoutineProfile {
  return { source: 'legacy-default', updatedAt, rules: defaultRoutineRules() };
}

/**
 * 「使用默认作息」模板：内容与内置默认值相同，但这是用户在设置页主动选择的，
 * 因此 source = 'user'（不再提示"旧版本默认作息尚未确认"）。
 */
export function createDefaultRoutine(updatedAt: number): RoutineProfile {
  return { source: 'user', updatedAt, rules: defaultRoutineRules() };
}

// ---------- 校验 ----------

function assertRoutine(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const ruleIdOk = (value: unknown): value is string => typeof value === 'string' && value.length <= 100 && /^[\w-]+$/.test(value);

export function assertRoutineRule(value: unknown, context = '作息规则'): asserts value is RoutineRule {
  assertRoutine(value && typeof value === 'object', `${context}无效`);
  const rule = value as RoutineRule;
  assertRoutine(ruleIdOk(rule.id), `${context}编号无效`);
  assertRoutine(isRoutineKind(rule.kind), `${context}类型无效`);
  assertRoutine(typeof rule.label === 'string' && rule.label.trim().length > 0 && rule.label.length <= 40, `${context}说明应为 1—40 字`);
  assertRoutine(routineTime(rule.start) && routineTime(rule.end) && rule.start !== rule.end, `${context}时间无效（应为 HH:mm，且开始与结束不同）`);
  assertRoutine(Array.isArray(rule.days) && rule.days.length > 0 && rule.days.length <= 7 && rule.days.every(day => Number.isInteger(day) && day >= 1 && day <= 7), `${context}适用星期无效（应为 1—7）`);
  assertRoutine(new Set(rule.days).size === rule.days.length, `${context}适用星期重复`);
  assertRoutine(typeof rule.enabled === 'boolean', `${context}启用状态无效`);
  assertRoutine(Number.isInteger(rule.priority) && rule.priority >= 0 && rule.priority <= 100, `${context}优先级无效（应为 0—100 的整数）`);
}

export function assertRoutineProfile(value: unknown, context = '作息'): asserts value is RoutineProfile {
  assertRoutine(value && typeof value === 'object', `${context}无效`);
  const routine = value as RoutineProfile;
  assertRoutine((ROUTINE_SOURCES as readonly string[]).includes(routine.source as string), `${context}来源无效`);
  assertRoutine(Number.isFinite(routine.updatedAt), `${context}更新时间无效`);
  assertRoutine(Array.isArray(routine.rules) && routine.rules.length <= 100, `${context}规则无效或过多`);
  const seen = new Set<string>();
  for (const rule of routine.rules) {
    assertRoutineRule(rule, context);
    assertRoutine(!seen.has(rule.id), `${context}存在重复的规则编号`);
    seen.add(rule.id);
  }
}
