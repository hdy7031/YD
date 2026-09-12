// 领域语义版本（与 SQLite 封装版本 `State.version = 1` 无关）。
//
// 1 = v0.2.x：profiles 是"固定的 me + partner"，档案上没有角色字段。
// 2 = v0.3 Phase 1A：profiles 是"工作区内 1—2 个个人档案"，每个档案显式带 role。
//
// 任何语义变化都必须先经过 src/migration.ts 的备份闸门，再提升这个数字。
// 这里保持为无依赖的叶子模块，避免 core ↔ migration ↔ backup 形成循环。
import type { State } from './types.ts';

export const DOMAIN_VERSION = 2;

// 从未迁移过的安装（以及 v0.2.x 的备份文件）没有该字段，一律视为 1。
export function stateDomainVersion(state: Pick<State, 'settings'>): number {
  const value = (state.settings as { domainVersion?: unknown }).domainVersion;
  return Number.isInteger(value) && (value as number) >= 1 ? (value as number) : 1;
}
