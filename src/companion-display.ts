// Companion display model.
//
// The desk pet never derives its own state: this module is the single place that
// turns business status (from the shared selectors/projection) plus the local
// clock into one of ten display states, and the only place that decides when a
// gentle attention nudge may play. Both the main process and the renderer import
// it, so the pet, the bubble and the mini panel can never disagree.
import type { PersonStatus } from './live.ts';
import type { PersonId } from './types.ts';
import { activeRoutine, nextRoutineBoundary, type RoutineKind, type RoutineProfile, type RoutineRule } from './routine.ts';

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

// 桌宠时间状态。数据来源只有一个：当前桌宠主体（people.resolvePetSubject）
// 自己的 Profile.routine —— 这里不再有任何写死的生活作息时间表。
// 时间语义（左闭右开、跨午夜、跨周、时区）全部由 src/routine.ts 决定。
export type ScheduledPetState = 'night_sleep' | 'wake_up' | 'eating' | 'nap';

// Routine kind → 桌宠时间状态的**唯一**映射。没有可靠视觉表达的 kind
// （commute / focus / custom）返回 null：不为“有个画面”伪造语义，
// 这些时段继续交给 business / reminder / idle 决定姿态。
export function routineKindToPetState(kind: RoutineKind): ScheduledPetState | null {
  switch (kind) {
    case 'sleep': return 'night_sleep';
    case 'wake': return 'wake_up';
    case 'meal': return 'eating';
    case 'nap': return 'nap';
    default: return null;
  }
}

/**
 * 某个人此刻的时间状态：只读他自己的 Routine，不再读任何全局常量。
 * 没有规则、规则被停用或 kind 没有对应姿态时返回 null。
 */
export function getScheduledPetState(routine: RoutineProfile | undefined, now: number): ScheduledPetState | null {
  const hit = activeRoutine(routine, now);
  return hit ? routineKindToPetState(hit.kind) : null;
}

/**
 * 下一个需要重算的时刻（规则区间的起点或终点）。只统计真正会切换姿态的 kind：
 * 只有 focus / commute / custom 的作息不会产生边界，桌宠也就不会为它们空转。
 */
export function nextPetScheduleBoundary(routine: RoutineProfile | undefined, now: number): number {
  if (!routine) return Number.POSITIVE_INFINITY;
  const visual: RoutineProfile = { ...routine, rules: routine.rules.filter(rule => routineKindToPetState(rule.kind) !== null) };
  return nextRoutineBoundary(visual, now) ?? Number.POSITIVE_INFINITY;
}

// 缓存键包含规则内容本身：运行中改掉作息（同一次会话里保存档案，不重启应用）
// 会让下一次 read 立即重算，而不是沿用旧规则算出的边界。
function routineScheduleKey(routine: RoutineProfile | undefined): string {
  if (!routine) return 'none';
  const rules = routine.rules.map(rule => `${rule.id},${rule.kind},${rule.start},${rule.end},${rule.days.join('.')},${rule.enabled ? 1 : 0},${rule.priority}`).join(';');
  return `${routine.updatedAt}|${rules}`;
}

// 只在需要时重算的轻量时钟：启动立即算一次，之后跨边界 / 作息变化 / 时钟跳变 /
// 系统恢复时重算。rules=[] 时 next 是 Infinity，不会空转。
export class PetScheduleClock {
  private state: ScheduledPetState | null = null;
  private next = Number.POSITIVE_INFINITY;
  private last = 0;
  private key = '';
  private ready = false;

  read(routine: RoutineProfile | undefined, now: number, options: { force?: boolean; maxAgeMs?: number } = {}): ScheduledPetState | null {
    const maxAge = options.maxAgeMs ?? 30000;
    const key = routineScheduleKey(routine);
    if (!this.ready || options.force === true || key !== this.key || now >= this.next || now < this.last || now - this.last >= maxAge) {
      this.state = getScheduledPetState(routine, now);
      this.next = nextPetScheduleBoundary(routine, now);
      this.last = now;
      this.key = key;
      this.ready = true;
    }
    return this.state;
  }

  reset() { this.ready = false; this.state = null; this.next = Number.POSITIVE_INFINITY; this.last = 0; this.key = ''; }
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
  // 当前生效的时间状态（没有则为 null），便于主进程缓存与验收断言。
  scheduled: ScheduledPetState | null;
}

const busyCodes = ['BUSY_CLASS', 'BUSY_EVENT', 'BUSY_MEETING'];
const offlineCodes = ['UNKNOWN', 'NO_SCHEDULE', 'TERM_ENDED'];

// Last finished occurrence of a person, used for the "done" reaction.
function lastFinishedEnd(status: PersonStatus | undefined, now: number): number | undefined {
  if (!status) return undefined;
  const finished = status.today.filter(o => !o.endUnknown && o.end <= now).map(o => o.end);
  return finished.length ? Math.max(...finished) : undefined;
}

// Business-only state: reminders and the clock are handled outside this function.
// The character represents one person at a time (the "pet subject"): with a
// companion present that is still the companion (current product behaviour),
// and in a solo workspace it is the person themselves — resolved once by
// people.resolvePetSubject() and passed in as `subjectId`. Nothing here may
// assume that a companion (or 'partner') exists.
//
// 桌宠主体（subject）的状态优先；另一位正在忙碌时，整个家仍是忙碌的；
// "即将开始" 由双方共享。状态条会说明这个姿态描述的是谁。
//
// 业务优先级（与产品约定一致）：
//   进行中的重要事项（上课 / 会议 / 活动 / 教研）
//   > 刚结束的轻庆祝
//   > 即将开始
//   > 空闲
// 时间状态（night_sleep / wake_up / eating / nap）与待处理提醒由
// resolvePetState 按统一优先级叠加，业务忙碌永远压过时间状态。
export function companionBusinessState(people: PersonStatus[], now: number, subjectId: PersonId): CompanionDisplayState {
  const subject = people.find(p => p.person === subjectId);
  const other = people.find(p => p.person !== subjectId);
  const subjectKnown = !!subject && !offlineCodes.includes(subject.code);
  if (subjectKnown && subject) {
    // 教研同样是“在上课”，但用抱教案的教研姿态，不戴眼镜持教鞭。
    if (subject.code === 'BUSY_CLASS') return subject.research ? 'busy_work' : 'busy_class';
    if (busyCodes.includes(subject.code) || subject.research) return 'busy_work';
  }
  if (busyCodes.includes(other?.code ?? '')) return 'busy_work';
  const finished = lastFinishedEnd(subject, now);
  if (finished !== undefined && now - finished <= gentleWindowMs) return 'gentle';
  if (subject?.code === 'UPCOMING' || other?.code === 'UPCOMING') return 'upcoming';
  return 'idle';
}

// Compact wording for the low key status rail under the character.
export function companionRailLabel(status?: Pick<PersonStatus, 'code' | 'research' | 'conflict'>): string {
  if (!status) return '未知';
  if (status.conflict) return '冲突';
  switch (status.code) {
    case 'BUSY_CLASS': return status.research ? '教研' : '上课';
    case 'BUSY_MEETING': return '会议';
    case 'BUSY_EVENT': return '活动';
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
  people: PersonStatus[];
  pending: number;
  now: number;
  /** 桌宠代表谁；由 people.resolvePetSubject() 解析，运行时必经此参数。 */
  subjectId: PersonId;
  reminderSince?: number;
  nudgeId?: number;
  // 设置页开关：关闭后夜间不再进入睡觉姿态。
  nightRest?: boolean;
  // 时间状态由调用方传入：live.snapshot() 按桌宠主体的 Routine 计算，
  // 主进程传入的是同一个纯函数的缓存。缺省表示这条投影没有时间状态。
  scheduled?: ScheduledPetState | null;
}

export interface PetStateResolution {
  state: CompanionDisplayState;
  // 这一轮真正生效的姿态（不含提醒保持窗口）。
  base: CompanionDisplayState;
  // 当前时间落在哪个时间状态上（即使被业务状态覆盖也照实记录）。
  scheduled: ScheduledPetState | null;
  holdingReminder: boolean;
}

// 统一状态解析入口。优先级从高到低：
//   1. 短暂用户交互反馈 / 一次性动画（点击、拖动、提醒轻提示）——由渲染层叠加，
//      时间状态不会把它瞬间盖掉；
//   2. 明确业务触发的临时状态：正在进行的上课 / 教研 / 会议，以及刚结束的轻庆祝；
//   3. 到点的待处理提醒（保持窗口内始终置顶）；
//   4. 时间计划状态：night_sleep / wake_up / eating / nap；
//   5. 普通即将开始 / 空闲。
// night_sleep 只会被真正的业务状态覆盖，不会被 idle 或普通装饰状态顶掉。
export function resolvePetState(input: CompanionDisplayInput): PetStateResolution {
  // 这里不再自己读时间表：没有传入 scheduled 就没有时间状态。
  const scheduled = input.scheduled === undefined ? null : input.scheduled;
  const business = companionBusinessState(input.people, input.now, input.subjectId);
  const planned = scheduled && (scheduled !== 'night_sleep' || input.nightRest !== false) ? scheduled : null;
  // 业务忙碌（上课 / 教研 / 会议 / 活动）与刚结束的庆祝压过时间状态；
  // 其余情况时间状态优先于“即将开始 / 空闲”。
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
