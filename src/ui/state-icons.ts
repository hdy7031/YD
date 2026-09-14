// Asset 03 语义图标在界面里的唯一映射入口（**只属于 presentation 层**）。
//
// 规矩：
//   * 图标语义由 CurrentState / 日程投影推导，绝不写进领域模型（CurrentState 没有 icon 字段）；
//   * 找不到准确映射时返回 null —— 调用方只显示状态点 + 文字，不用 emoji、不用随机
//     第三方图标、不猜。
//   * 文件路径固定在 src/ui/assets/dock-icons/（构建时整体复制进 dist/assets）。
import type { CurrentState } from '../state/types.ts';
import type { Occurrence } from '../types.ts';

export type StateIconName = 'calendar' | 'meeting' | 'task' | 'reading' | 'commute' | 'meal' | 'sleep';

/** 当前状态 → 语义图标。 */
export function iconForCurrent(current: CurrentState | null | undefined): StateIconName | null {
  if (!current) return null;
  switch (current.kind) {
    case 'class':
      return 'calendar';
    case 'meeting':
      return 'meeting';
    case 'research':
    case 'busy':
    case 'focus':
      return 'task';
    case 'commute':
      return 'commute';
    case 'meal':
      return 'meal';
    case 'sleep':
    case 'nap':
      return 'sleep';
    case 'rest':
      return 'reading';
    // 'custom' 的动词由用户自己写（如「阅读」「遛狗」），系统不猜图标；
    // 'wake' 与 'idle' 没有对应语义，同样不显示图标。
    default:
      return null;
  }
}

/** 下一项安排 → 语义图标：课程用日历，会议 / 活动用「人」。 */
export function iconForNext(next: Occurrence | null | undefined): StateIconName | null {
  if (!next) return null;
  return next.kind === 'event' ? 'meeting' : 'calendar';
}

/** 图标文件路径（renderer 侧相对 dist 的 assets 目录）。 */
export function iconSrc(name: StateIconName): string {
  return `assets/dock-icons/${name}.png`;
}
