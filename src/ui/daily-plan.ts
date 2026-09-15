// v0.3 Phase 1：Self / Companion 共用的「一天安排」视图模型。
//
// 这是一个纯投影模块：只把 occurrences() 已经算好的一天事项整理成稳定的结构，
// **不重新判断任何人物状态**。当前状态仍只来自 CurrentState（src/state/engine.ts）。
// 它不认识 React / DOM / Electron，因此可以在 Node 测试里直接断言。
import { courseTone } from '../selectors.ts';
import { dateOf } from '../core.ts';
import type { Course, Occurrence } from '../types.ts';

/** 一天的合法表示：0 项仍然是完整的 DailyPlan，而不是"没有数据"。 */
export interface DailyPlan {
  /** 北京时间自然日（YYYY-MM-DD）。 */
  date: string;
  /** 当天 00:00 的北京时间毫秒时间戳（Timeline 用它定位色带）。 */
  dayStart: number;
  /** 未被取消 / 停课的事项数量；「今天 N 项安排」用它。 */
  activeCount: number;
  /** 被取消（停课）但仍需要如实展示的事项数量。 */
  cancelledCount: number;
  /** 当天出现过的全部事项（含停课），已按开始时间排序。 */
  items: DailyAgendaItem[];
  /** 当天最早开始、最晚结束（未取消事项优先；全部停课时退回全部事项）。 */
  firstStart?: number;
  lastEnd?: number;
  /** 当天第一项 / 最后一项时间；没有任何事项时为 undefined。 */
  rangeText?: string;
  /** 从 now 起的第一项未取消事项（不再从课表重新推导"当前状态"）。 */
  next?: DailyAgendaItem;
}

export interface DailyAgendaItem {
  id: string;
  kind: 'course' | 'event';
  /**
   * kind === 'course' 时的课程 id。
   *
   * `id` 是 occurrence 的稳定标识（课程是 `c:<courseId>:<date>`），**不等于** course.id；
   * 列表行必须用这个字段回查课程实体，否则语义（授课 / 教研 / 编辑入口）会退化成事件。
   */
  courseId?: string;
  title: string;
  place: string;
  notes: string;
  start: number;
  end: number;
  endUnknown: boolean;
  /** 统一低饱和课程/类别 palette 的 tone 名（与 selectors.courseTone 同源）。 */
  tone: string;
  cancelled: boolean;
  rescheduled: boolean;
}

/** 时间带的粒度：00:00—24:00 的稳定刻度，避免不同日期之间轨道长度乱跳。 */
export const DAY_MS = 24 * 3600000;
export const TIMELINE_TICKS: { at: number; label: string }[] = [
  { at: 0, label: '00:00' },
  { at: 6 * 3600000, label: '06:00' },
  { at: 12 * 3600000, label: '12:00' },
  { at: 18 * 3600000, label: '18:00' },
  { at: 24 * 3600000, label: '24:00' },
];

/** 时间带占位：返回 [startPercent, widthPercent]，永远落在 0—100 之间。 */
export function timelinePlacement(dayStart: number, start: number, end: number): { left: number; width: number } {
  const from = Math.min(Math.max(start - dayStart, 0), DAY_MS);
  const to = Math.min(Math.max(Math.max(end, start + 60000) - dayStart, 0), DAY_MS);
  return { left: (from / DAY_MS) * 100, width: Math.max(0.4, ((to - from) / DAY_MS) * 100) };
}

export interface DailyPlanInput {
  /** 当天 00:00 的毫秒时间戳。 */
  dayStart: number;
  /** 已经过 DailyException 修饰的当天 occurrence（含 cancelled）。 */
  occurrences: Occurrence[];
  /** 取 tone / 活动类型时用；只读取，不修改。 */
  courses: Course[];
  now: number;
}

/** 把一天的事项整理成 Self / Companion 共用的 DailyPlan。 */
export function dailyPlanFrom({ dayStart, occurrences, courses, now }: DailyPlanInput): DailyPlan {
  const date = dateOf(dayStart);
  const items: DailyAgendaItem[] = [...occurrences]
    .sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id))
    .map(occurrence => {
      const course = occurrence.kind === 'course' ? courses.find(item => item.id === occurrence.courseId) : undefined;
      return {
        id: occurrence.id,
        kind: occurrence.kind,
        ...(occurrence.courseId === undefined ? {} : { courseId: occurrence.courseId }),
        title: occurrence.title,
        place: occurrence.place,
        notes: occurrence.notes,
        start: occurrence.start,
        end: occurrence.end,
        endUnknown: occurrence.endUnknown === true,
        tone: courseTone({ id: occurrence.courseId ?? occurrence.id, person: occurrence.person, title: occurrence.title }),
        cancelled: occurrence.cancelled === true,
        rescheduled: occurrence.rescheduled === true,
      };
    });
  const active = items.filter(item => !item.cancelled);
  const basis = active.length ? active : items;
  const firstStart = basis.length ? Math.min(...basis.map(item => item.start)) : undefined;
  const lastEnd = basis.length ? Math.max(...basis.map(item => item.end)) : undefined;
  const next = items.find(item => !item.cancelled && item.start > now);
  return {
    date,
    dayStart,
    activeCount: active.length,
    cancelledCount: items.length - active.length,
    items,
    ...(firstStart === undefined ? {} : { firstStart }),
    ...(lastEnd === undefined ? {} : { lastEnd }),
    // 摘要只报时间范围本身：`09:50–17:30`（en dash，无前后空格）。
    ...(firstStart === undefined || lastEnd === undefined ? {} : { rangeText: `${clockText(firstStart)}–${clockText(lastEnd)}` }),
    ...(next === undefined ? {} : { next }),
  };
}

/** 北京时间的 HH:MM（不自带时区库，保持与现有界面一致）。 */
export function clockText(at: number): string {
  return new Date(at + 8 * 3600000).toISOString().slice(11, 16);
}

/** 摘要数量文案：Self 说「3 项安排」，Companion 说「8 节课」；前缀由调用方决定。 */
export function dailyCountText(plan: DailyPlan, unit: string): string {
  return `${plan.activeCount} ${unit}`;
}

/** 下一项文案：没有未来事项时给出诚实的空结论，不编造数据。 */
export function dailyNextText(plan: DailyPlan): string {
  if (!plan.next) return '今天暂无后续安排';
  return `下一项 ${clockText(plan.next.start)} · ${plan.next.title}`;
}

/**
 * 事项状态文案（表现层词汇，供列表行使用）。这里只描述事项本身的时间关系，
 * 不推导"这个人在做什么"——那是 CurrentState 的职责。
 */
export function dailyItemState(item: DailyAgendaItem, now: number): string | null {
  if (item.cancelled) return '已停课';
  if (item.rescheduled) return '已调课';
  if (item.start <= now && now < item.end) return item.kind === 'course' ? '上课中' : '进行中';
  if (item.end <= now) return '已结束';
  return null;
}
