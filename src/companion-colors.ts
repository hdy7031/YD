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
// 0.2.17 起统一到 YD 的低饱和语义色：同一个语义在任何界面都是同一个颜色，
// 且不做成高饱和信号灯——桌面产品要“看得懂”，不需要“刺眼”。
export const companionToneColors: Record<CompanionTone, string> = {
  calm: '#8CBE9E',
  upcoming: '#D6AE6A',
  busy: '#DE9A63',
  focus: '#8FAED2',
  alert: '#C2726A',
  neutral: '#A3ACB0',
};

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
