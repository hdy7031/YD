// v0.3 Phase 3C：临时手动状态的界面模型（纯数据，无 React / 无 IO）。
//
// 领域只提供 kind 与时长预设（src/state/manual.ts）；这里给出用户看到的词，
// 与 Routine 设置页的做法一致：文案不在领域模块里，也不散落在组件里。
import { MANUAL_DURATION_MINUTES, MANUAL_STATE_KINDS, type ManualStateKind } from '../state/manual.ts';

export interface ManualKindOption {
  kind: ManualStateKind;
  label: string;
  /** 没有专属桌宠素材的类型如实说明，避免用户在桌宠上找不到对应动作。 */
  hint?: string;
}

export const manualKindOptions: ManualKindOption[] = MANUAL_STATE_KINDS.map(kind => {
  switch (kind) {
    case 'idle': return { kind, label: '空闲' };
    case 'busy': return { kind, label: '忙碌' };
    case 'rest': return { kind, label: '休息', hint: '桌宠没有专属动作，仍按平时显示' };
    case 'focus': return { kind, label: '专注', hint: '桌宠没有专属动作，仍按平时显示' };
    case 'commute': return { kind, label: '通勤', hint: '桌宠没有专属动作，仍按平时显示' };
    case 'meal': return { kind, label: '吃饭' };
    default: return { kind, label: '自定义' };
  }
});

export interface ManualDurationOption {
  /** null = 直到用户取消。 */
  minutes: number | null;
  label: string;
}

const durationLabels: Record<number, string> = { 30: '30 分钟', 60: '1 小时', 120: '2 小时' };

export const manualDurationOptions: ManualDurationOption[] = MANUAL_DURATION_MINUTES.map(minutes => ({
  minutes,
  label: minutes === null ? '直到我取消' : durationLabels[minutes] ?? `${minutes} 分钟`,
}));

export const manualKindLabel = (kind: ManualStateKind): string => manualKindOptions.find(option => option.kind === kind)?.label ?? kind;

/** 自定义状态必须由用户给出名称；其余类型用选项里的默认文案。 */
export function manualLabelFor(kind: ManualStateKind, custom: string): string {
  return kind === 'custom' ? custom.trim() : manualKindLabel(kind);
}

/** 校验用户输入；返回可读的问题描述，空字符串表示可以保存。 */
export function manualStatusProblem(kind: ManualStateKind, custom: string, endAt: number | null, now: number): string {
  const label = manualLabelFor(kind, custom);
  if (!label) return '请填写状态名称';
  if (label.length > 40) return '状态名称最多 40 字';
  if (endAt !== null && !(Number.isFinite(endAt) && endAt > now)) return '结束时间需要晚于现在';
  return '';
}
