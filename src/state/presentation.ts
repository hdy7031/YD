// v0.3 Phase 3B：人物状态唯一的 presentation 层。
//
// 分工（不允许再有第三处）：
//   领域（src/state/types.ts）  只描述事实：kind = meal、label = 午饭；
//   本文件                       决定用户看到的词（「吃饭中」）、短词（「吃饭」）与颜色 tone；
//   消费方（Home / Orb / Mini / Tip / Tray / 桌宠状态条 / 伙伴页）
//                               只做取用与排版，禁止再各写一套状态表。
//
// 这里不读取 Course / Routine / Store / DOM：输入永远是 CurrentState。
import type { CompanionTone } from '../companion-colors.ts';
import type { CurrentState } from './types.ts';
import type { StatusCode } from '../live.ts';
import { DAY, dateOf, epoch, weekday } from '../core.ts';

/** 下一项的最小投影：日程层的 Occurrence 只透出显示需要的字段。 */
export interface PresentationNextItem {
  start: number;
  title: string;
  place?: string;
}

/** 北京时间的 HH:MM（与 live.clockText 同一实现，避免两处格式化）。 */
export function clockText(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value);
}

/** 下一项在时间轴上的相对说法：今天 / 明天 / 后天 / 周三 / 9月21日。 */
export function relativeDayLabel(start: number, now: number): string {
  const diff = Math.round((epoch(dateOf(start)) - epoch(dateOf(now))) / DAY);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  if (diff > 2 && diff < 7) return `周${'一二三四五六日'[weekday(dateOf(start)) - 1]}`;
  const date = new Date(start + 8 * 3600000);
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
}

/**
 * 「下一项」永远带相对日期：只给裸时间时，晚上的用户会把明天的课读成"今天稍后"。
 */
export function nextItemText(next: PresentationNextItem | undefined | null, now: number): string {
  if (!next) return '';
  const day = relativeDayLabel(next.start, now);
  return day === '今天' ? `${clockText(next.start)} · ${next.title}` : `${day} ${clockText(next.start)} · ${next.title}`;
}

/** 剩余 / 已持续时长的口语说法：35 分钟、2 小时、1 小时 20 分。 */
function durationText(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

export interface PersonStatusPresentationInput {
  now: number;
  current: CurrentState;
  /** 日程阶段码：只在 CurrentState 是 idle 时补充上下文，不参与状态竞争。 */
  code: StatusCode;
  conflict?: boolean;
  todayCourseCount?: number;
  next?: PresentationNextItem | null;
}

/**
 * 一个人此刻的状态投影（首页状态卡 / Dock compact / Dock hover / Detail 共用一份）。
 *
 * 分层是这里唯一要守住的东西：一行只说一件事，不写口语连接词。
 *   primaryLabel   = 此刻在做什么（永远来自 CurrentState，空闲就是「空闲」）
 *   statusNote     = 这件事自身的补充（12:30 结束 / 按作息 · 13:10 结束 / 今天无课）
 *   nextLine       = 下一件事的短写法（明天 08:00 · 研究生英语），已经隐含"接下来"，
 *                    因此不再写「下一项」；没有下一项就是空字符串。
 *   secondaryLabel = 单行上下文（Dock hover / 详情卡用）：状态注优先，其次下一件事。
 *
 * 「今日课程已结束」是日程阶段，只能出现在 statusNote；它以前占着 compact 的主文案位，
 * 才会出现"文字说结束、圆点还是兴奋的颜色"这种自相矛盾。
 */
export interface PersonStatusPresentation {
  primaryLabel: string;
  /** 状态自身的短注（结束时间 / 来源 / 日程阶段），可为空。 */
  statusNote: string;
  /** 下一件事：`明天 08:00 · 研究生英语`，无下一项时为空。 */
  nextLine: string;
  secondaryLabel: string;
  tone: CompanionTone;
  /** 状态指示灯：绿 = 空闲，红 = 忙碌，灰 = 下线（睡眠）。见 statusLight。 */
  light: StatusLight;
  /** 状态点语义色：只由 light 决定，与 statusLight 一一对应。 */
  dotTone: CompanionTone;
  /** 日程阶段已经走完（今日结束 / 学期结束）时为 true，只用于更安静的排版。 */
  finished: boolean;
  remainingText: string;
  scheduleContext: string;
  nextItem?: PresentationNextItem & { relativeDay: string; time: string; text: string };
}

/**
 * 指示灯只有三种含义（产品口径）：
 *   绿 available —— 空闲：此刻没有任何进行中的安排
 *   红 busy      —— 忙碌：上课 / 会议 / 教研 / 专注 / 用餐 / 通勤 / 手动忙碌…
 *   灰 offline   —— 下线：正在睡觉（与桌宠的夜间睡眠同源，默认作息 23:30–次日 07:30）
 *
 * 灰色只跟"人物状态是睡眠"绑定，不跟"今天课程已结束"绑定：
 * 课程结束后仍然是空闲（绿），而不是下线。睡眠时段来自每个人的 Routine
 * sleep 规则——也就是桌宠显示夜间睡眠姿态的同一个来源。
 */
export type StatusLight = 'available' | 'busy' | 'offline';

export function statusLight(current: CurrentState, code?: StatusCode): StatusLight {
  switch (current.kind) {
    case 'idle': return 'available';
    // 睡眠（含刚睡醒与午睡 / 休息）是与桌宠一致的"下线"时刻。
    case 'sleep': case 'wake': case 'nap': case 'rest': return 'offline';
    default:
      // 没有档案 / 状态不可用时也按"离线"显示，而不是伪装成空闲或忙碌。
      if (code === 'UNKNOWN') return 'offline';
      return 'busy';
  }
}

const LIGHT_TONE: Record<StatusLight, CompanionTone> = { available: 'calm', busy: 'busy', offline: 'neutral' };

export function buildPersonStatusPresentation(input: PersonStatusPresentationInput): PersonStatusPresentation {
  const { now, current, code } = input;
  const conflict = input.conflict === true || current.meta?.conflict === true;
  const primaryLabel = stateLabel(current);
  const tone: CompanionTone = conflict ? 'alert' : stateTone(current);
  const light = statusLight(current, code);
  const nextItem = input.next
    ? { ...input.next, relativeDay: relativeDayLabel(input.next.start, now), time: clockText(input.next.start), text: nextItemText(input.next, now) }
    : undefined;
  const endAt = current.endAt, endText = endAt ? clockText(endAt) : '';
  const remaining = endAt && endAt > now ? Math.max(1, Math.ceil((endAt - now) / 60000)) : 0;
  const elapsed = current.startAt ? Math.max(1, Math.ceil((now - current.startAt) / 60000)) : 0;
  const remainingText = current.kind === 'idle' ? '' : remaining ? `还有 ${durationText(remaining)}` : current.kind === 'focus' && elapsed ? `已专注 ${durationText(elapsed)}` : '进行中';

  // 日程阶段：只在"空闲"时解释这一天，不再把"下一项"塞进这句话（下一件事有自己的字段）。
  const scheduleContext = (() => {
    switch (code) {
      case 'DAY_FINISHED': return '今日课程已结束';
      case 'NO_CLASS_TODAY': return '今天无课';
      case 'TERM_NOT_STARTED': return '课表尚未开始';
      case 'TERM_ENDED': return '本学期课程已结束';
      case 'NO_SCHEDULE': return '尚未录入课表';
      case 'UNKNOWN': return '状态暂不可用';
      // 其余码（即将开始 / 空闲）由下一件事那一行说明，这里不重复。
      default: return '';
    }
  })();
  // 来源说明只留一个词（按作息 / 本人设置）：它是注释，不是主信息。
  const sourceNote = current.source === 'routine' ? '按作息' : current.source === 'manual' ? '本人设置' : '';
  // 有结束时刻就说结束时刻（不写"预计"），没有才退回剩余时长。
  const endNote = endText ? `${endText} ${current.kind === 'sleep' ? '起床' : '结束'}` : remainingText;
  const statusNote = conflict ? '安排冲突'
    : current.kind === 'idle' ? scheduleContext
    : [sourceNote, endNote].filter(Boolean).join(' · ');
  const nextLine = nextItem?.text ?? '';
  const secondaryLabel = statusNote || nextLine || '暂无后续安排';

  return {
    primaryLabel,
    statusNote,
    nextLine,
    secondaryLabel,
    tone,
    light,
    // 状态点只表达"绿 / 红 / 灰"这三件事，不表达今天上过什么课、也不表达人物身份。
    dotTone: LIGHT_TONE[light],
    finished: code === 'DAY_FINISHED' || code === 'TERM_ENDED',
    remainingText,
    scheduleContext,
    ...(nextItem ? { nextItem } : {}),
  };
}

/**
 * 完整状态文案：出现在首页状态行、迷你面板、悬停提示与托盘 tooltip。
 * 只描述行为本身，不带人物称呼（"她正在…"由消费方按 Profile 决定）。
 */
export function stateLabel(current: CurrentState): string {
  switch (current.kind) {
    case 'class': return '上课中';
    case 'research': return '教研中';
    // 会议与活动在产品里是同一个 Event 实体，沿用既有默认文案「活动中」。
    case 'meeting': return '活动中';
    case 'sleep': return '睡觉中';
    case 'wake': return '刚睡醒';
    case 'meal': return '吃饭中';
    case 'nap': return '午睡中';
    case 'commute': return '通勤中';
    case 'focus': return '专注中';
    // 手动状态里"忙碌 / 休息"是现实状态，不是日程推导出来的。
    case 'busy': return '忙碌中';
    case 'rest': return '休息中';
    // 自定义作息的动词无法由 kind 推断，直接用用户自己写的名字（如「阅读」）。
    case 'custom': return current.label;
    default: return '空闲';
  }
}

/**
 * 短文案：桌宠底部状态条、紧凑标签这类只有几个字的位置。
 */
export function stateShortLabel(current: CurrentState): string {
  switch (current.kind) {
    case 'class': return '上课';
    case 'research': return '教研';
    case 'meeting': return '活动';
    case 'sleep': return '睡觉';
    case 'wake': return '刚醒';
    case 'meal': return '吃饭';
    case 'nap': return '午睡';
    case 'commute': return '通勤';
    case 'focus': return '专注';
    case 'busy': return '忙碌';
    case 'rest': return '休息';
    case 'custom': return current.label;
    default: return '空闲';
  }
}

/**
 * 颜色语义：沿用 companion-colors.ts 的六色，不新增调色板。
 *   class / meeting → busy      进行中的重要事项
 *   research / focus → focus    教研与专注
 *   冲突（meta.conflict）→ alert 只留给真正的警示
 *   其余（含睡觉 / 吃饭 / 通勤 / 空闲）→ calm
 */
export function stateTone(current: CurrentState): CompanionTone {
  if (current.meta?.conflict) return 'alert';
  switch (current.kind) {
    case 'class': case 'meeting': case 'busy': return 'busy';
    case 'research': case 'focus': return 'focus';
    default: return 'calm';
  }
}

/**
 * 状态来源的说明文字（Phase 3C §11）：区分"本人确认"与"推导"。
 *
 *   manual   本人设置      用户刚刚确认过的现实状态
 *   schedule 按课表推测    由课程 / 会议推导
 *   routine  按作息推测    由日常规律推导
 *   idle     空字符串      空闲没有需要解释的来源
 */
export function stateSourceLabel(current: CurrentState): string {
  switch (current.source) {
    case 'manual': return '本人设置';
    case 'schedule': return '按课表推测';
    case 'routine': return '按作息推测';
    default: return '';
  }
}
