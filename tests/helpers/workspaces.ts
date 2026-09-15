// 测试用的工作区构造器（合成数据，**不进入生产初始化路径**）。
//
// Phase 5A 起，生产 fresh install 只有一个 self 档案（src/core.ts 的 createFreshState）。
// 历史测试大量依赖"默认工作区就是 me + partner"的旧 bootstrap；那些用例真正表达的是
// legacy 身份证号兼容与 Together 契约，因此在这里显式种出两个人，让生产默认值不再背这份责任。
import { createFreshState } from '../../src/core.ts';
import { DEFAULT_AVATAR_PACK_ID } from '../../src/avatar.ts';
import { emptyRoutine, legacyDefaultRoutine } from '../../src/routine.ts';
import type { Profile, State } from '../../src/types.ts';

/**
 * 旧 bootstrap 的等价物：本人 `me`（我，空作息）+ 同行者 `partner`（Ta，0.2.x 默认桌宠作息）。
 *
 * 只用于覆盖 legacy / Together 契约；不要把生产代码或新的 fixture 指向它。
 */
export function togetherWorkspace(now = 0): State {
  const state = createFreshState(now);
  const { startDate, weeks, periods } = state.profiles[0];
  const base = {
    startDate, weeks, periods: structuredClone(periods),
    avatar: { packId: DEFAULT_AVATAR_PACK_ID, source: 'default' as const },
    updatedAt: now,
  };
  const profiles: Profile[] = [
    { ...base, id: 'me', role: 'self', name: '我', routine: emptyRoutine(now) },
    { ...base, id: 'partner', role: 'companion', name: 'Ta', routine: legacyDefaultRoutine(now) },
  ];
  state.profiles = profiles;
  return state;
}

/** 单人工作区：直接复用生产 fresh state（只有一个 self）。 */
export function soloWorkspace(now = 0): State {
  return createFreshState(now);
}
