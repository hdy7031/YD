// v3 双人工作区 fixture（Phase 1B 之后、Phase 2A 之前）。
//
// 用途：v3 → v4 迁移测试的输入 —— 证明 Routine 迁移只给桌宠主体种下默认作息，
// 不替其他人虚构作息，也不碰任何业务集合。
//
// 构造方式：从合成的 v0.2 fixture 出发，跑真实注册过的 v1 → v2 → v3 两步迁移，
// 因此它表示的正是"一个真实数据库在上一版的样子"：档案有 role、会议有 person、
// domainVersion = 3，但**没有** routine。
import { identityRoleMigration, personAwareMigrationV3, ROUTINE_DOMAIN_VERSION } from '../../src/migration.ts';
import type { State } from '../../src/types.ts';
import { v020Now, v020Synthetic } from './v020-synthetic.ts';

/** 这份 fixture 固定表示的领域版本：Phase 2A（v4 / Routine）之前。 */
export const v3DomainVersion = ROUTINE_DOMAIN_VERSION - 1;

export function v3TogetherSynthetic(now = v020Now): State {
  const state = personAwareMigrationV3(identityRoleMigration(v020Synthetic(now)));
  // v4 才引入 profile.routine：这里明确保持在迁移前的形态。
  for (const profile of state.profiles) delete profile.routine;
  state.settings.domainVersion = v3DomainVersion;
  return state;
}
