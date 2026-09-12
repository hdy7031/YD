// v0.3 Phase 3A：统一人物状态引擎（Person State Engine）。
//
// 这个模块只回答一个问题：**这个人现在实际上在做什么**（上课 / 教研 / 会议 /
// 吃饭 / 午睡 / 睡觉 / 通勤 / 专注 / 空闲…）。它是纯函数集合：不读数据库、不走
// IPC、不碰 Electron / Store / DOM，也不认识任何桌宠素材。
//
// 与桌宠的边界（Phase 3A 的核心约定）：
//
//   PersonState（本模块）        = schedule > routine > idle 的领域语义
//   CompanionDisplayState        = PersonState + 提醒保持 + 交互动画 + 素材映射
//
// 因此 reminding / click / drag / celebration / "刚下课" / upcoming 这类表现
// 永远不进入 CurrentState —— 它们要么是叠加上去的表现层，要么是独立的 next 信息。
//
// 本阶段消费者尚未迁移：live.personStatus()、companion-display.resolvePetState()
// 与 PetScheduleClock 继续按原逻辑运行，引擎只新增能力，并用测试证明两者在
// Schedule 场景下语义一致（迁移清单见 Phase 3B）。
import { occurrences } from '../core.ts';
import { getProfileById } from '../people.ts';
import { activeRoutine, routineDayStart, routineOccurrences, type RoutineKind } from '../routine.ts';
import type { Course, Occurrence, PersonId, Profile, State } from '../types.ts';
import type { CurrentState, CurrentStateMeta, PersonStateKind, PersonStateSource } from './types.ts';

/**
 * 来源层的固定优先级：数值越大越优先。
 * Manual 为 Phase 3C 预留（当前没有任何写入路径）；Routine 整体低于 Schedule，
 * Routine 规则之间的重叠仍由 RoutineRule.priority 在 routine.ts 内部解决，
 * 状态引擎不重新处理作息内部冲突。
 */
export const STATE_SOURCE_PRIORITY: Record<PersonStateSource, number> = {
  manual: 100,
  schedule: 80,
  routine: 40,
  idle: 10,
};

// "空闲从什么时候开始"的回看窗口：只需要覆盖最近几天的日程与作息。
const SCHEDULE_LOOKBACK_MS = 7 * 86400000;
const ROUTINE_LOOKBACK_MS = 8 * 86400000;

/** Routine kind → 人物状态 kind：七个作息类型都是真实的人状态（1:1，不伪造映射）。 */
export function routineStateKind(kind: RoutineKind): PersonStateKind {
  return kind;
}

/** 课程 activity → 人物状态 kind：只有 research 是教研，其余（含未标注）都是上课。 */
export function courseStateKind(activity: Course['activity']): PersonStateKind {
  return activity === 'research' ? 'research' : 'class';
}

// 会议/活动（Event）在同刻与课程重叠时的确定性裁决顺序与 live.personStatus 一致：
// 课程（BUSY_CLASS）压过会议（BUSY_EVENT）。
const scheduleRank = (occurrence: Occurrence): number => (occurrence.kind === 'course' ? 0 : 1);

/**
 * 日程候选：只消费 occurrences() 已经过 DailyException 修饰后的**实际** occurrence，
 * 因此停课不产生候选、调课只在新的时间产生候选，不会与 Exception 竞争。
 */
function scheduleCandidate(state: State, profile: Profile, now: number): CurrentState | null {
  const current = occurrences(state, now, now + 1, profile.id);
  if (!current.length) return null;
  const hit = [...current].sort((a, b) => scheduleRank(a) - scheduleRank(b) || b.start - a.start || a.id.localeCompare(b.id))[0];
  const course = hit.kind === 'course' ? state.courses.find(candidate => candidate.id === hit.courseId) : undefined;
  const meta: CurrentStateMeta = { title: hit.title, scheduleKind: hit.kind };
  if (hit.place) meta.place = hit.place;
  if (course) meta.activity = course.activity === 'research' ? 'research' : 'teaching';
  if (current.length > 1) meta.conflict = true;
  return {
    personId: profile.id,
    kind: hit.kind === 'event' ? 'meeting' : courseStateKind(course?.activity),
    // 领域 label 就是事项标题：不拼人物称呼，也不做"她正在…"这类表现层文案。
    label: hit.title,
    source: 'schedule',
    sourceId: hit.id,
    startAt: hit.start,
    endAt: hit.end,
    priority: STATE_SOURCE_PRIORITY.schedule,
    ...(profile.tentative === true ? { tentative: true } : {}),
    meta,
  };
}

/** 作息候选：直接取 routine.ts 已经裁决好的命中规则，引擎不重算作息内部冲突。 */
function routineCandidate(profile: Profile, now: number): CurrentState | null {
  const hit = activeRoutine(profile.routine, now);
  if (!hit) return null;
  return {
    personId: profile.id,
    kind: routineStateKind(hit.kind),
    label: hit.label,
    source: 'routine',
    sourceId: hit.ruleId,
    startAt: hit.startAt,
    endAt: hit.endAt,
    priority: STATE_SOURCE_PRIORITY.routine,
    meta: { routineKind: hit.kind },
  };
}

function lastScheduleEnd(state: State, personId: PersonId, now: number): number | undefined {
  let last: number | undefined;
  for (const occurrence of occurrences(state, now - SCHEDULE_LOOKBACK_MS, now, personId)) {
    // 结束时间未填写的会议不参与锚点（它们本来也不构成"当前状态"）。
    if (occurrence.endUnknown || occurrence.end > now) continue;
    if (last === undefined || occurrence.end > last) last = occurrence.end;
  }
  return last;
}

function lastRoutineEnd(profile: Profile, now: number): number | undefined {
  let last: number | undefined;
  for (const occurrence of routineOccurrences(profile.routine, now - ROUTINE_LOOKBACK_MS, now)) {
    if (occurrence.endAt > now) continue;
    if (last === undefined || occurrence.endAt > last) last = occurrence.endAt;
  }
  return last;
}

/**
 * 空闲的开始时刻 = 最近一次日程 / 作息结束的时刻；都没有时退回北京时间当天 00:00。
 * 这样 idle 是一个稳定的状态（不会每次调用都变成 now），同时仍然有明确含义。
 */
function idleStartAt(state: State, profile: Profile, now: number): number {
  const last = Math.max(
    lastScheduleEnd(state, profile.id, now) ?? Number.NEGATIVE_INFINITY,
    lastRoutineEnd(profile, now) ?? Number.NEGATIVE_INFINITY,
  );
  return Number.isFinite(last) ? last : routineDayStart(now);
}

/** 兜底候选："现在没有安排也没有作息"同样是一个真实答案，因此不返回 null。 */
function idleState(state: State, profile: Profile, now: number): CurrentState {
  return {
    personId: profile.id,
    kind: 'idle',
    label: '空闲',
    source: 'idle',
    startAt: idleStartAt(state, profile, now),
    priority: STATE_SOURCE_PRIORITY.idle,
  };
}

/**
 * 这个人此刻的实际状态。优先级：schedule (80) > routine (40) > idle (10)。
 *
 * 查询不存在的档案会明确失败（而不是静默给一个假状态）；需要遍历工作区时用
 * getWorkspaceCurrentStates()，它只投影真实存在的档案。
 */
export function getCurrentState(state: State, personId: PersonId, now: number): CurrentState {
  const profile = getProfileById(state, personId);
  if (!profile) throw new Error('状态查询的档案不存在');
  return scheduleCandidate(state, profile, now) ?? routineCandidate(profile, now) ?? idleState(state, profile, now);
}

/**
 * 作息层候选：只回答"这个人的作息此刻命中的是哪一段"，**不做任何优先级裁决**。
 *
 * 用途只有一个：让显示层如实记录分层事实——例如"正在开会（人物状态）"的同时，
 * "作息本来是午睡"。CurrentState 仍然是唯一的人物状态真相，这个候选不能被
 * 任何消费方当成"现在在做什么"的答案。
 */
export function getRoutineState(state: State, personId: PersonId, now: number): CurrentState | null {
  const profile = getProfileById(state, personId);
  if (!profile) throw new Error('作息查询的档案不存在');
  return routineCandidate(profile, now);
}

/**
 * 工作区里每个人的当前状态：1 个档案 1 条、2 个档案 2 条。
 * 顺序取 profiles 的显示顺序，但身份语义来自档案自身（role / id），从不来自数组位置。
 */
export function getWorkspaceCurrentStates(state: State, now: number): CurrentState[] {
  return state.profiles.map(profile => getCurrentState(state, profile.id, now));
}
