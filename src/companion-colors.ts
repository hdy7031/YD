// Companion tone map — the single colour authority for the desk pet.
//
// Every surface that expresses a person's state (status rail dots, the glass
// orb, the mini panel legend) resolves its colour through this file, so the
// same semantics always produce the same colour:
//
//   idle / free        → calm      green
//   upcoming           → upcoming  amber
//   busy (class/event) → busy      orange
//   research / focus   → focus     blue
//   conflict (dnd)     → alert     red      (真正的警示才用红)
//   unknown / offline  → neutral   gray
//
// There is deliberately no per-person palette: D and Y must never look
// different just because they are different people.
import type { PresenceState } from './live.ts';

export type CompanionTone = 'calm' | 'upcoming' | 'busy' | 'focus' | 'alert' | 'neutral';

// State semantics → tone. One row per presence state, no fallbacks to red.
export const companionToneOf: Record<PresenceState, CompanionTone> = {
  idle: 'calm',
  upcoming: 'upcoming',
  busy: 'busy',
  focus: 'focus',
  dnd: 'alert',
  offline: 'neutral',
};

// Reference colours (the UI uses the CSS classes; tests and docs use these).
//
// 2026-09-14 收口（Asset 04）：这是**唯一**的状态语义色板，界面各处（状态 Dock、
// 详情面板、主窗口状态点、桌宠状态轨）只允许引用这里的语义：
//
//   calm     空闲 / 休息 —— 低饱和 dusty rose，非常克制
//   upcoming 即将开始    —— warm amber（**不再是红色**）
//   busy     上课 / 活动 —— 低饱和 sage teal
//   focus    教研 / 专注 —— sage teal，比 busy 略深一档
//   alert    冲突        —— 只有真正的警示才用红（安排冲突 / 异常）
//   neutral  暂不可用    —— 中性灰
export const companionToneColors: Record<CompanionTone, string> = {
  calm: '#C18A9C',
  upcoming: '#D7AD59',
  busy: '#55A995',
  focus: '#60998F',
  alert: '#C2726A',
  neutral: '#A3ACB0',
};

/**
 * 日程阶段码的补充分化色（presentation-only）：
 * "今日结束 / 学期结束"这类**已完成**语义使用 sage gray，
 * 不允许和进行中的 active 一样饱和。`src/ui/presence-orb.css` 与 `style.css`
 * 用 `[data-code="…"]` 选择器引用同一组取值。
 */
export const companionFinishedColor = '#9AA79F';

export function companionTone(state: PresenceState): CompanionTone {
  return companionToneOf[state] ?? 'neutral';
}

// One presentation object per person: the label and the colour are derived from
// the same input in the same call, so a stale or mismatched dot colour is not
// representable. `label` is the long form used by the mini panel and tooltips.
export interface CompanionPersonView {
  alias: string;
  state: PresenceState;
  tone: CompanionTone;
  color: string;
}

export function companionPersonView(person: {
  alias: string;
  code: string;
  conflict: boolean;
  research: boolean;
  presence: PresenceState;
}): CompanionPersonView {
  const tone = companionTone(person.presence);
  return { alias: person.alias, state: person.presence, tone, color: companionToneColors[tone] };
}
