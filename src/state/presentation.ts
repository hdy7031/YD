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
    case 'class': case 'meeting': return 'busy';
    case 'research': case 'focus': return 'focus';
    default: return 'calm';
  }
}
