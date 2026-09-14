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
// 2026-09-14 Dock 指示灯口径（最终）：这是**唯一**的状态语义色板，界面各处
// （状态 Dock、详情面板、主窗口状态卡、桌宠状态轨）只允许引用这里的语义。
//
// 指示灯只有三种含义，颜色与语义一一对应：
//
//   calm / upcoming  绿 —— 空闲（含"今天没有课""今日课程已结束""即将有安排"）
//   busy / focus     红 —— 忙碌（上课 / 会议 / 教研 / 专注 / 用餐 / 通勤 / 手动忙碌）
//   neutral          灰 —— 下线（正在睡觉，与桌宠夜间睡眠同源）
//   alert            深红 —— 只有真正的冲突（安排重叠 / 异常）才用，仍然属于"红"
//
// 这里刻意不再给"今天上过课"这类日程阶段单独配色：状态点只表达**此刻**状态。
// 空闲以前是 dusty rose（偏红粉）、忙碌一度是 sage teal（偏绿），两者都会让用户
// 读反，因此统一回红 / 绿 / 灰这组最不容易误解的语义。
export const companionToneColors: Record<CompanionTone, string> = {
  calm: '#66A37F',
  upcoming: '#66A37F',
  busy: '#C2726A',
  focus: '#C2726A',
  alert: '#B4574E',
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
