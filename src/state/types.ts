// v0.3 Phase 3A：统一人物状态（Person State）的稳定运行时类型。
//
// 这里描述的是**人此刻实际上在做什么**（class / meeting / meal / sleep / idle…），
// 不是桌宠播放什么动作。桌宠姿态（busy_class / night_sleep / wake_up…）属于
// Companion Display，由 companion-display.ts 在人物状态之上叠加提醒与交互动画得出。
//
// 因此本文件里永远不允许出现桌宠视觉命名（busy_class、night_sleep、eating…），
// 也不允许出现人物称呼（"她"、"我的"），人物是谁由消费方按 Profile 决定。
import type { PersonId } from '../types.ts';
import type { RoutineKind } from '../routine.ts';
import type { ManualStateKind } from './manual.ts';

/**
 * 状态的来源层。Phase 3A 只有 schedule / routine / idle 会真正产生；
 * manual（手动覆盖）为 Phase 3C 预留，优先级表先把它固定在最高一层。
 */
export type PersonStateSource = 'manual' | 'schedule' | 'routine' | 'idle';

/**
 * 领域状态类型：七个 Routine kind 与它们同名（不伪造映射），
 * 日程课程映射到 class / research，会议与活动统一映射到 meeting。
 */
export type PersonStateKind =
  | 'class'
  | 'research'
  | 'meeting'
  | 'sleep'
  | 'wake'
  | 'meal'
  | 'nap'
  | 'commute'
  | 'focus'
  | 'custom'
  // 日程推导不会产生、但手动确认会出现的现实状态（Phase 3C）。
  | 'busy'
  | 'rest'
  | 'idle';

/** 消费方不必再回头查 Course / Routine / Event 就能知道的基本语义。 */
export interface CurrentStateMeta {
  /** 日程事项标题（课程名 / 会议名）；Routine 时为 undefined。 */
  title?: string;
  /** 地点（课程或会议填写过时）。 */
  place?: string;
  /** 日程来源实体：课程模板（course）或会议/活动（event）。 */
  scheduleKind?: 'course' | 'event';
  /** 课程活动类型；未标注视为 teaching（与 live.activity 的既有语义一致）。 */
  activity?: 'teaching' | 'research';
  /** Routine 规则类型（kind 的同义字段，便于前端取图标 / 分组）。 */
  routineKind?: RoutineKind;
  /** 手动状态的类型（source === 'manual' 时由用户选择）。 */
  manualKind?: ManualStateKind;
  /**
   * 同一时刻这个人还有其它并行的日程事项（现有产品的「安排冲突」语义）。
   * 只记录事实，不改变选出的主状态。
   */
  conflict?: boolean;
}

/**
 * 某个人的当前状态；"现在"永远有答案（没有安排与作息时是 idle，不是 null）。
 *
 * startAt / endAt 描述这段状态的区间（左闭右开，北京时间毫秒时间戳）：
 *   * schedule：来自经过 DailyException 修饰后的实际 occurrence，恒有 endAt；
 *   * routine：来自命中的作息规则，恒有 endAt（跨午夜规则也是一条区间）；
 *   * idle：startAt 锚在最近一次结束上，endAt 未知（没有下一条安排时留空）。
 */
export interface CurrentState {
  personId: PersonId;
  kind: PersonStateKind;
  /** 领域文案：课程名 / 会议名 / 作息规则名称 / 「空闲」。不含人物称呼。 */
  label: string;
  source: PersonStateSource;
  /** 产生这段状态的实体编号：occurrence id 或 Routine 规则 id。 */
  sourceId?: string;
  startAt: number;
  endAt?: number;
  /** 来源层优先级（见 STATE_SOURCE_PRIORITY），不是 Routine 内部优先级。 */
  priority: number;
  /** 该人的学期设置仍是"暂定"（未与校历核对）时为 true。 */
  tentative?: boolean;
  /** 保留给导入 / 识别链路：尚未有数据来源，因此 Phase 3A 恒为空。 */
  confidence?: number;
  meta?: CurrentStateMeta;
}
