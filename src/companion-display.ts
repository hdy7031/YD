// Companion display model.
//
// 桌宠姿态 = **人物状态**（src/state/engine.ts 的 CurrentState）
//          + 显示层叠加（提醒保持 / 刚结束的轻庆祝 / 即将开始 / 交互动画）。
//
// 这个模块不再判断"这个人现在在做什么"：那只发生在 StateEngine 里。
// 它只做两件事：
//   1. CurrentState.kind → 桌宠姿态（唯一的映射，见 currentStateToPetDisplay）；
//   2. 把提醒、轻庆祝、即将开始这类**表现**叠加到姿态上。
//
// 因此 reminding / gentle / click / drag 永远不会反向写进人物状态；反过来，
// Orb / Mini / Tip / Tray 的人物文案也永远不受提醒姿态影响。
import type { PersonStatus } from './live.ts';
import type { PersonId } from './types.ts';
import { stateShortLabel } from './state/presentation.ts';
import type { CurrentState } from './state/types.ts';
import { type RoutineKind, type RoutineProfile, type RoutineRule } from './routine.ts';

export type CompanionDisplayState =
  | 'idle' | 'upcoming' | 'busy_class' | 'busy_work' | 'reminder' | 'gentle'
  | 'night_sleep' | 'eating' | 'nap' | 'wake_up';

export interface CompanionDisplayAsset {
  // Asset key inside the custom companion manifest.
  asset: string;
  // Ordered fallbacks used when a frame is missing from the asset bundle.
  fallbacks: string[];
  label: string;
}

// Display state -> asset. Six of them are the original 0.2.15 states (idle,
// upcoming/relaxed, busy_class, busy_work, reminder, gentle/happy) that keep
// their ids, triggers and business meaning; the four time states are the 0.2.20
// additions. Asset keys match the split ten-pose sheet, so business code never
// names an image file.
export const companionDisplayAssets: Record<CompanionDisplayState, CompanionDisplayAsset> = {
  idle: { asset: 'idle', fallbacks: [], label: '空闲' },
  upcoming: { asset: 'relaxed', fallbacks: ['idle'], label: '即将开始' },
  busy_class: { asset: 'busy_class', fallbacks: ['busy_work', 'idle'], label: '上课中' },
  busy_work: { asset: 'busy_work', fallbacks: ['busy_class', 'idle'], label: '忙碌中' },
  reminder: { asset: 'reminder', fallbacks: ['idle'], label: '待处理提醒' },
  gentle: { asset: 'happy', fallbacks: ['idle'], label: '完成' },
  night_sleep: { asset: 'night_sleep', fallbacks: ['idle'], label: '夜间睡觉' },
  eating: { asset: 'eating', fallbacks: ['relaxed', 'idle'], label: '吃饭中' },
  nap: { asset: 'nap', fallbacks: ['night_sleep', 'idle'], label: '午睡中' },
  wake_up: { asset: 'wake_up', fallbacks: ['relaxed', 'idle'], label: '刚睡醒' },
};

// 桌宠时间状态（四个有专属素材的作息姿态）。它是显示层的词汇，不是人物状态：
// 人物状态里对应的是 sleep / wake / meal / nap。
export type ScheduledPetState = 'night_sleep' | 'wake_up' | 'eating' | 'nap';

// 人物状态 kind → 桌宠姿态：**全项目唯一**的映射表。
// 没有可靠视觉表达的 kind（idle / commute / focus / custom）不在表里，返回 null，
// 由其它层级（提醒 / 即将开始 / 空闲）决定画面——不为"有个画面"伪造语义。
const petDisplayOfState: Partial<Record<CurrentState['kind'], CompanionDisplayState>> = {
  class: 'busy_class',
  research: 'busy_work',
  meeting: 'busy_work',
  sleep: 'night_sleep',
  wake: 'wake_up',
  meal: 'eating',
  nap: 'nap',
};

export function currentStateToPetDisplay(current: CurrentState): CompanionDisplayState | null {
  return petDisplayOfState[current.kind] ?? null;
}

// Routine kind 与人物状态 kind 同名（1:1），因此作息层复用同一张表，
// 只筛出四个有专属素材的时间姿态。
export function routineKindToPetState(kind: RoutineKind): ScheduledPetState | null {
  const display = petDisplayOfState[kind];
  return display === 'night_sleep' || display === 'wake_up' || display === 'eating' || display === 'nap' ? display : null;
}

/**
 * 作息层 → 时间姿态：只用于如实记录"业务状态暂时压过作息"这类分层事实
 * （例如：正在开会，但作息本来在午睡）。它不是对"现在在做什么"的回答。
 */
export function routineStateToPetVisual(routine: CurrentState | null | undefined): ScheduledPetState | null {
  if (!routine || routine.source !== 'routine') return null;
  return routineKindToPetState(routine.meta?.routineKind ?? 'custom');
}

// 设置页文案用的作息摘要：只列出真正会变成桌宠姿态的规则，文字由作息数据生成，
// 因此用户改了作息（或迁移自 0.2.x 的默认作息）时说明文字自动跟着变。
export interface PetRoutineSummary {
  /** 睡觉时段（HH:mm–HH:mm，多个用「、」连接）；没有则为空字符串。 */
  sleep: string;
  /** 其余会切换姿态的时段，形如「07:30–07:50 起床」；没有则为空字符串。 */
  states: string;
}

export function petRoutineSummary(routine: RoutineProfile | undefined): PetRoutineSummary {
  const rules: RoutineRule[] = (routine?.rules ?? []).filter(rule => rule.enabled && routineKindToPetState(rule.kind) !== null);
  const window = (rule: RoutineRule) => `${rule.start}–${rule.end}`;
  return {
    sleep: rules.filter(rule => rule.kind === 'sleep').map(window).join('、'),
    states: rules.filter(rule => rule.kind !== 'sleep').map(rule => `${window(rule)} ${rule.label}`).join('、'),
  };
}

// The reminder pose holds for a while, then the pet settles back into the real
// business state while the rail keeps showing the pending count.
export const reminderHoldMs = 10 * 60 * 1000;
// A second, very low frequency nudge while reminders stay unhandled.
export const reminderNudgeMs = 30 * 60 * 1000;
// "Just finished" window that maps to the gentle celebration frame.
export const gentleWindowMs = 3 * 60 * 1000;

export interface CompanionDisplay {
  state: CompanionDisplayState;
  // Display state without the reminder hold window applied.
  base: CompanionDisplayState;
  asset: string;
  fallbacks: string[];
  label: string;
  pending: number;
  // 当前是否处在夜间休息窗口（即使提醒姿态临时覆盖，也仍然为真）。
  nightly: boolean;
  // Bumped whenever the pet should play one light attention motion.
  nudgeId: number;
  // Timestamp of the current unhandled reminder run (0 when nothing is pending).
  reminderSince: number;
  holdingReminder: boolean;
  // 主体此刻命中的作息姿态（没有则为 null）：与人物状态分离——它在开会时
  // 依然如实记录"作息本来是午睡"，但绝不回答"现在在做什么"。
  scheduled: ScheduledPetState | null;
}

// Last finished occurrence of a person, used for the "done" reaction.
function lastFinishedEnd(status: PersonStatus | undefined, now: number): number | undefined {
  if (!status) return undefined;
  const finished = status.today.filter(o => !o.endUnknown && o.end <= now).map(o => o.end);
  return finished.length ? Math.max(...finished) : undefined;
}

// Compact wording for the low key status rail under the character.
//
// 文案来自统一 presentation 层：人物在做什么由 CurrentState 决定；
// 只有在"空闲"时，才用日程阶段（未开课 / 今天无课 / 本学期结束…）补充说明。
export function companionRailLabel(status?: PersonStatus): string {
  if (!status) return '未知';
  if (status.conflict) return '冲突';
  if (status.current.kind !== 'idle') return stateShortLabel(status.current);
  switch (status.code) {
    case 'UPCOMING': return '即将';
    case 'DAY_FINISHED': return '已下课';
    case 'NO_CLASS_TODAY': return '无课';
    case 'TERM_NOT_STARTED': return '未开课';
    case 'TERM_ENDED': return '学期结束';
    case 'NO_SCHEDULE': return '未录入';
    case 'UNKNOWN': return '未知';
    default: return '空闲';
  }
}

export interface CompanionDisplayInput {
  /** 工作区里每个人的状态投影；桌宠主体与另一位都只从 CurrentState 得出结论。 */
  people: PersonStatus[];
  pending: number;
  now: number;
  /** 桌宠代表谁；由 people.resolvePetSubject() 解析，运行时必经此参数。 */
  subjectId: PersonId;
  reminderSince?: number;
  nudgeId?: number;
  // 设置页开关：关闭后夜间不再进入睡觉姿态。
  nightRest?: boolean;
}

export interface PetStateResolution {
  state: CompanionDisplayState;
  // 这一轮真正生效的姿态（不含提醒保持窗口）。
  base: CompanionDisplayState;
  // 主体此刻命中的作息姿态（即使被业务状态覆盖也照实记录）。
  scheduled: ScheduledPetState | null;
  holdingReminder: boolean;
}

// 统一姿态解析入口。优先级从高到低：
//   1. 到点的待处理提醒（保持窗口内始终置顶，且只影响桌宠，不影响人物状态）；
//   2. 人物状态里的进行中事项：上课 / 教研 / 会议 / 活动（另一位在忙时，整个家也是忙碌的）；
//   3. 刚结束的轻庆祝（日程历史 + 当前状态得出的表现层装饰）；
//   4. 作息时间姿态：night_sleep / wake_up / eating / nap；
//   5. 即将开始 / 空闲。
// night_sleep 只会被真正的业务状态覆盖，不会被 idle 或普通装饰状态顶掉。
export function resolvePetState(input: CompanionDisplayInput): PetStateResolution {
  const subject = input.people.find(person => person.person === input.subjectId);
  const other = input.people.find(person => person.person !== input.subjectId);
  // 人物状态 → 姿态：这是唯一的"现在在做什么"判断入口。
  const subjectActivity = subject ? currentStateToPetDisplay(subject.current) : null;
  const otherActivity = other ? currentStateToPetDisplay(other.current) : null;
  const otherBusy = otherActivity === 'busy_class' || otherActivity === 'busy_work';
  // 显示层装饰：刚结束的轻庆祝与双方共享的"即将开始"。
  const finishedAt = lastFinishedEnd(subject, input.now);
  const gentle = finishedAt !== undefined && input.now - finishedAt <= gentleWindowMs;
  const upcoming = subject?.code === 'UPCOMING' || other?.code === 'UPCOMING';
  const business: CompanionDisplayState =
    subjectActivity === 'busy_class' ? 'busy_class'
    : subjectActivity === 'busy_work' ? 'busy_work'
    : otherBusy ? 'busy_work'
    : gentle ? 'gentle'
    : upcoming ? 'upcoming'
    : 'idle';
  // 作息时间层：nightRest 只影响视觉，不改动作息数据。
  const routineVisual = routineStateToPetVisual(subject?.routine);
  const planned = routineVisual === 'night_sleep' && input.nightRest === false ? null : routineVisual;
  // 业务忙碌（上课 / 教研 / 会议 / 活动）与刚结束的庆祝压过时间姿态；
  // 其余情况时间姿态优先于"即将开始 / 空闲"。
  const temporary = business === 'busy_class' || business === 'busy_work' || business === 'gentle';
  const base: CompanionDisplayState = temporary ? business : planned ?? business;
  const pending = Math.max(0, input.pending);
  const reminderSince = pending > 0 ? input.reminderSince ?? input.now : 0;
  const holdingReminder = pending > 0 && input.now - reminderSince <= reminderHoldMs;
  const state: CompanionDisplayState = holdingReminder ? 'reminder' : base;
  return { state, base, scheduled: planned, holdingReminder };
}

export function companionDisplay(input: CompanionDisplayInput): CompanionDisplay {
  const resolved = resolvePetState(input);
  const pending = Math.max(0, input.pending);
  const state = resolved.state;
  const meta = companionDisplayAssets[state];
  return {
    state,
    base: resolved.base,
    asset: meta.asset,
    fallbacks: meta.fallbacks,
    label: pending > 0 ? `${pending} 条待处理` : meta.label,
    pending,
    nightly: resolved.base === 'night_sleep',
    nudgeId: pending > 0 ? input.nudgeId ?? 0 : 0,
    reminderSince: pending > 0 ? input.reminderSince ?? input.now : 0,
    holdingReminder: resolved.holdingReminder,
    scheduled: resolved.scheduled,
  };
}

// Timing controller: decides when the one light attention motion plays. The
// renderer only replays whatever nudgeId it sees, so the pet can never nag on
// its own and the same nudge survives a window reload.
export class CompanionTimeline {
  private reminderSince = 0;
  private lastNudge = 0;
  private lastPending = 0;
  private nudgeId = 0;

  sync(pending: number, now: number) {
    if (pending > 0 && this.lastPending === 0) {
      this.reminderSince = now;
      this.lastNudge = now;
      this.nudgeId += 1;
    } else if (pending > 0 && now - this.lastNudge >= reminderNudgeMs) {
      this.lastNudge = now;
      this.nudgeId += 1;
    } else if (pending === 0 && this.lastPending > 0) {
      this.reminderSince = 0;
      this.lastNudge = 0;
    }
    this.lastPending = pending;
    return { reminderSince: this.reminderSince, nudgeId: this.nudgeId };
  }

  state() {
    return { reminderSince: this.reminderSince, nudgeId: this.nudgeId };
  }

  reset(now: number) {
    this.reminderSince = 0;
    this.lastNudge = now;
    this.lastPending = 0;
    this.nudgeId = 0;
  }
}
