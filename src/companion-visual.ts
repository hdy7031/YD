// Shared vocabulary for the companion presentation layer.
//
// These are visual states, not Person CurrentState kinds. Reminder and gentle
// celebration therefore stay here and can never leak into the StateEngine.
export const companionVisualStates = [
  'idle',
  'upcoming',
  'busy_class',
  'busy_work',
  'reminder',
  'gentle',
  'night_sleep',
  'eating',
  'nap',
  'wake_up',
] as const;

export type CompanionDisplayState = typeof companionVisualStates[number];

export const isCompanionDisplayState = (value: unknown): value is CompanionDisplayState =>
  typeof value === 'string' && (companionVisualStates as readonly string[]).includes(value);
