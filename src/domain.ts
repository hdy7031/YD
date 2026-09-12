// 领域语义版本（与 SQLite 封装版本 `State.version = 1` 无关）。
//
// 1 = v0.2.x：profiles 是"固定的 me + partner"，档案上没有角色字段。
// 2 = v0.3 Phase 1A：profiles 是"工作区内 1—2 个个人档案"，每个档案显式带 role。
// 3 = v0.3 Phase 1B：会议/活动归属到人（Event.person），并完成 v0.2 的一次性归一化。
// 4 = v0.3 Phase 2A：每个档案拥有自己的 RoutineProfile（纯领域模型；
//     桌宠消费方仍在 Phase 2B 才切换，迁移只种下 0.2.x 的默认时间表）。
// 5 = v0.3 Phase 3C：临时手动状态（ManualOverride[]，每人最多一条），
//     优先级 Manual > Schedule > Routine > Idle；旧数据补空数组即可。
//
// 任何语义变化都必须先经过 src/migration.ts 的备份闸门，再提升这个数字。
// 这里保持为无依赖的叶子模块，避免 core ↔ migration ↔ backup 形成循环。
import type { State } from './types.ts';

export const DOMAIN_VERSION = 5;

// 从未迁移过的安装（以及 v0.2.x 的备份文件）没有该字段，一律视为 1。
export function stateDomainVersion(state: Pick<State, 'settings'>): number {
  const value = (state.settings as { domainVersion?: unknown }).domainVersion;
  return Number.isInteger(value) && (value as number) >= 1 ? (value as number) : 1;
}
