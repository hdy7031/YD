// Companion display model.
//
// The desk pet never derives its own state: this module is the single place that
// turns business status (from the shared selectors/projection) plus the local
// clock into one of ten display states, and the only place that decides when a
// gentle attention nudge may play. Both the main process and the renderer import
// it, so the pet, the bubble and the mini panel can never disagree.
import type { PersonStatus } from './live.ts';
import type { PersonId } from './types.ts';

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

// 桌宠时间状态：全部按本机 LOCAL TIME 判断，区间左闭右开 [start, end)。
export type ScheduledPetState = 'night_sleep' | 'wake_up' | 'eating' | 'nap';
export interface PetScheduleSlot { state: ScheduledPetState; startMinutes: number; endMinutes: number }

export const companionSchedule: PetScheduleSlot[] = [
  // 夜间跨日，拆成两段写法而不是 hour 比较：[23:30,24:00) + [00:00,07:30)
  { state: 'night_sleep', startMinutes: 23 * 60 + 30, endMinutes: 24 * 60 },
  { state: 'night_sleep', startMinutes: 0, endMinutes: 7 * 60 + 30 },
  // 刚睡醒 / 伸懒腰
  { state: 'wake_up', startMinutes: 7 * 60 + 30, endMinutes: 7 * 60 + 50 },
  // 吃饭
  { state: 'eating', startMinutes: 11 * 60 + 30, endMinutes: 12 * 60 },
  // 午睡
  { state: 'nap', startMinutes: 12 * 60 + 30, endMinutes: 14 * 60 },
  // 午睡后的“刚睡醒”：复用同一个 wake_up 姿态与素材，不新增状态，
  // 避免状态表里出现两个语义相同的刚睡醒。
  { state: 'wake_up', startMinutes: 14 * 60, endMinutes: 14 * 60 + 20 },
];

// 把当前时间标准化为“当天分钟数”，跨午夜区间因此不需要特殊分支。
export function localMinutes(now: number): number {
  const date = new Date(now);
  return date.getHours() * 60 + date.getMinutes();
}

// 唯一的时间状态判断入口：组件、useEffect、窗口都只调用它。
export function getScheduledPetState(now: number): ScheduledPetState | null {
  const minutes = localMinutes(now);
  return scheduledStateAtMinutes(minutes);
}

function scheduledStateAtMinutes(minutes: number): ScheduledPetState | null {
  for (const slot of companionSchedule) if (minutes >= slot.startMinutes && minutes < slot.endMinutes) return slot.state;
  return null;
}

// 真正会“换姿态”的分钟点：区间起点与终点里只有状态发生变化的那些
// （例如 24:00 与 00:00 同属夜间睡觉，不算切换点）。
export const petStateChangeMinutes: number[] = [...new Set(
  companionSchedule.flatMap(slot => [slot.startMinutes % 1440, slot.endMinutes % 1440]),
)].filter(minute => scheduledStateAtMinutes((minute + 1439) % 1440) !== scheduledStateAtMinutes(minute))
  .sort((a, b) => a - b);

// 下一个时间边界的本机时间戳。主进程只在跨过边界、时钟明显跳变或系统从睡眠
// 恢复时重算时间状态，不用秒级定时器反复重建，也不会被 stale timer 卡住。
export function nextPetScheduleBoundary(now: number): number {
  const date = new Date(now);
  const dayStart = (offset: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset).getTime();
  let next = Number.POSITIVE_INFINITY;
  for (const offset of [0, 1]) for (const minute of petStateChangeMinutes) {
    const at = dayStart(offset) + minute * 60000;
    if (at > now && at < next) next = at;
  }
  return next;
}

// 夜间的“自动休息”只覆盖 night_sleep（23:30–07:30）；起床、吃饭、午睡属于
// 日常作息，始终按时间生效。
export const nightRestWindow = { startMinutes: 23 * 60 + 30, endMinutes: 7 * 60 + 30 };
export const nightRestText = '23:30–07:30';

export function withinNightRest(now: number, window = nightRestWindow): boolean {
  const minutes = localMinutes(now);
  const { startMinutes, endMinutes } = window;
  return startMinutes <= endMinutes
    ? minutes >= startMinutes && minutes < endMinutes
    : minutes >= startMinutes || minutes < endMinutes;
}

// 只在需要时重算的轻量时钟：启动立即算一次，之后跨边界 / 时钟跳变 / 恢复时算。
export class PetScheduleClock {
  private state: ScheduledPetState | null = null;
  private next = 0;
  private last = 0;
  private ready = false;

  read(now: number, options: { force?: boolean; maxAgeMs?: number } = {}): ScheduledPetState | null {
    const maxAge = options.maxAgeMs ?? 30000;
    if (!this.ready || options.force === true || now >= this.next || now < this.last || now - this.last >= maxAge) {
      this.state = getScheduledPetState(now);
      this.next = nextPetScheduleBoundary(now);
      this.last = now;
      this.ready = true;
    }
    return this.state;
  }

  reset() { this.ready = false; this.state = null; this.next = 0; this.last = 0; }
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
  // 主进程缓存的时间状态；缺省时按当前时间现算（纯函数，测试与托盘直接可用）。
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
  const scheduled = input.scheduled === undefined ? getScheduledPetState(input.now) : input.scheduled;
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
