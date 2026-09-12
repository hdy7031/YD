// 「日常节奏」设置页的纯视图模型 —— v0.3 Phase 2C。
//
// 这里只有数据与纯函数：草稿、展示文案、规则数组的增删改，以及"这次保存写什么"。
// 没有 React / DOM / IPC：真正的写入永远走 Command → core apply → validate → Store
// （见 src/core.ts 的 save + assertRoutineProfile），UI 不允许直接改 State。
import { routineKindToPetState } from '../companion-display.ts';
import { effectiveRole, PROFILE_SELF } from '../people.ts';
import { ROUTINE_WEEKDAYS, isRoutineKind, routineKindPriority, routineSpanMinutes, routineTime, type RoutineKind, type RoutineProfile, type RoutineRule, type RoutineSource } from '../routine.ts';
import type { PersonId, Profile } from '../types.ts';

/** 建议规则里可以选的类型；label 由用户自己写（meal 可以有早饭 / 午饭 / 晚饭多条）。 */
export const routineKindLabels: Record<RoutineKind, string> = {
  sleep: '睡觉', wake: '起床', meal: '吃饭', nap: '午睡',
  commute: '通勤', focus: '专注', custom: '日常',
};

/** 有专属桌宠动作的类型（其余只作为日常节奏记录，不伪造画面）。 */
export const routineKindHasPetState = (kind: RoutineKind): boolean => routineKindToPetState(kind) !== null;

export const routineKindHint = '当前没有专属桌宠动作，只作为日常节奏记录。';

/** 新建 / 换类型时给出的默认名称（用户随时可改；meal 默认是午饭，可直接改成早饭 / 晚饭）。 */
export function routineDefaultLabelFor(kind: RoutineKind): string {
  return kind === 'meal' ? '午饭' : routineKindLabels[kind];
}

export const routineWeekdayLabels = ['一', '二', '三', '四', '五', '六', '日'] as const;

/** 设置页里"编辑谁的日常节奏"：本人永远显示为「我的」（与导航、课表一致）。 */
export function routinePersonLabel(profile: Pick<Profile, 'id' | 'role' | 'name'>, index = 0): string {
  return effectiveRole(profile, index) === PROFILE_SELF ? '我的' : profile.name;
}

/** 人物选择顺序与状态一致：本人优先，然后同行者（Solo 只有一条）。 */
export function routinePersonOptions(profiles: Profile[]): { id: PersonId; label: string }[] {
  return [...profiles]
    .map((profile, index) => ({ profile, index }))
    .sort((a, b) => Number(effectiveRole(b.profile, b.index) === PROFILE_SELF) - Number(effectiveRole(a.profile, a.index) === PROFILE_SELF))
    .map(({ profile, index }) => ({ id: profile.id, label: routinePersonLabel(profile, index) }));
}

export interface RoutineRuleDraft {
  id: string;
  kind: RoutineKind;
  label: string;
  start: string;
  end: string;
  days: number[];
  enabled: boolean;
  priority: number;
}

/** 新规则 / 编辑现有规则的草稿；times 是 HH:mm 字符串，保存时由领域层再校验一次。 */
export function routineDraft(rule?: RoutineRule): RoutineRuleDraft {
  if (rule) return { id: rule.id, kind: rule.kind, label: rule.label, start: rule.start, end: rule.end, days: [...rule.days], enabled: rule.enabled, priority: rule.priority };
  const kind: RoutineKind = 'meal';
  return { id: '', kind, label: routineDefaultLabelFor(kind), start: '12:00', end: '12:30', days: [...ROUTINE_WEEKDAYS], enabled: true, priority: routineKindPriority[kind] };
}

/** 保存前的 UI 侧校验：错误信息直接展示在编辑框里，绝不写库。 */
export function routineDraftError(draft: RoutineRuleDraft): string | null {
  if (!draft.label.trim()) return '请填写这段节奏的名称';
  if (draft.label.trim().length > 40) return '名称最多 40 字';
  if (!isRoutineKind(draft.kind)) return '请选择类型';
  if (!routineTime(draft.start) || !routineTime(draft.end)) return '时间格式应为 HH:mm';
  if (draft.start === draft.end) return '开始与结束时间不能相同；跨过午夜请把结束时间写到次日';
  if (!Array.isArray(draft.days) || draft.days.length === 0) return '请至少选择一天';
  if (!draft.days.every(day => Number.isInteger(day) && day >= 1 && day <= 7)) return '适用星期无效';
  if (!Number.isInteger(draft.priority) || draft.priority < 0 || draft.priority > 100) return '优先级无效';
  return null;
}

/** 草稿 → 规则：整理名称与星期顺序，生成缺失的编号（由调用方传入 id()）。 */
export function routineRuleFromDraft(draft: RoutineRuleDraft, id: string): RoutineRule {
  return {
    id: draft.id || id,
    kind: draft.kind,
    label: draft.label.trim(),
    start: draft.start,
    end: draft.end,
    days: [...new Set(draft.days)].sort((a, b) => a - b),
    enabled: draft.enabled,
    priority: draft.priority,
  };
}

/** 列表展示：23:30 → 次日 07:30（跨午夜必须让用户看出来）。 */
export function routineWindowText(rule: Pick<RoutineRule, 'start' | 'end'>): string {
  return `${rule.start} → ${routineSpanMinutes(rule) > 0 && rule.end < rule.start ? '次日 ' : ''}${rule.end}`;
}

const weekdayName = (day: number) => `周${routineWeekdayLabels[day - 1] ?? '?'}`;

export function routineDaysText(days: number[]): string {
  const list = [...new Set(days)].sort((a, b) => a - b);
  if (list.length === 0) return '未选择';
  if (list.length === 7) return '每天';
  if (list.join(',') === '1,2,3,4,5') return '周一至周五';
  if (list.join(',') === '6,7') return '周末';
  return list.map(weekdayName).join('、');
}

export function routineDurationText(rule: Pick<RoutineRule, 'start' | 'end'>): string {
  const minutes = routineSpanMinutes(rule);
  if (minutes <= 0) return '时间无效';
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (!hours) return `${rest} 分钟`;
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

// ---------- 规则数组的增删改（唯一入口，UI 只调用它们） ----------

export function routineRulesWith(rules: RoutineRule[], rule: RoutineRule): RoutineRule[] {
  const index = rules.findIndex(item => item.id === rule.id);
  if (index < 0) return [...rules, rule];
  return rules.map(item => item.id === rule.id ? rule : item);
}

export function routineRulesWithout(rules: RoutineRule[], id: string): RoutineRule[] {
  return rules.filter(item => item.id !== id);
}

export function routineRulesToggled(rules: RoutineRule[], id: string, enabled: boolean): RoutineRule[] {
  return rules.map(item => item.id === id ? { ...item, enabled } : item);
}

/**
 * 一次保存写回的 RoutineProfile：任何用户修改都会把来源标记为用户自己的
 * （legacy-default 只代表"迁移自动种下、还没被确认过"），并刷新 updatedAt，
 * 桌宠的 PetScheduleClock 因此会立刻重新调度。
 */
export function routineForRules(rules: RoutineRule[], now: number, source: RoutineSource = 'user'): RoutineProfile {
  return { source, updatedAt: now, rules };
}

export const routineIsEmpty = (routine: RoutineProfile | undefined): boolean => !routine || routine.rules.length === 0;

/** 迁移自动种下的默认作息还没被用户确认过：设置页低调提示一次，不弹窗。 */
export const routineNeedsConfirmation = (routine: RoutineProfile | undefined): boolean => routine?.source === 'legacy-default';
