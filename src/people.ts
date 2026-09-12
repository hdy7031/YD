// 唯一的身份查询层。
//
// v0.3 起身份语义是 `role`（self / companion），历史 id（me / partner）只作为兼容别名。
// 兼容解析顺序**只在这里实现**，业务代码不得散落 "profiles[0] 就是本人" 之类的假设：
//
//   1. 显式 role（v2 数据一定走这一条）
//   2. 历史 id：me → self，partner → companion（v1 旧安装、v1 备份）
//   3. 数组位置：第 0 个 → self，第 1 个 → companion（仅用于迁移前的极端旧数据）

import type { PersonId, Profile, ProfileRole, State } from './types.ts';

export const PROFILE_SELF: ProfileRole = 'self';
export const PROFILE_COMPANION: ProfileRole = 'companion';
export const LEGACY_SELF_ID: PersonId = 'me';
export const LEGACY_COMPANION_ID: PersonId = 'partner';

export const isProfileRole = (value: unknown): value is ProfileRole => value === PROFILE_SELF || value === PROFILE_COMPANION;

export function effectiveRole(profile: Pick<Profile, 'id' | 'role'>, index = 0): ProfileRole {
  if (isProfileRole(profile.role)) return profile.role;
  if (profile.id === LEGACY_SELF_ID) return PROFILE_SELF;
  if (profile.id === LEGACY_COMPANION_ID) return PROFILE_COMPANION;
  return index === 0 ? PROFILE_SELF : PROFILE_COMPANION;
}

export function roleCounts(profiles: Pick<Profile, 'id' | 'role'>[]): { self: number; companion: number } {
  let self = 0, companion = 0;
  profiles.forEach((profile, index) => { if (effectiveRole(profile, index) === PROFILE_SELF) self += 1; else companion += 1; });
  return { self, companion };
}

export function findByRole(profiles: Profile[], role: ProfileRole): Profile | undefined {
  return profiles.find((profile, index) => effectiveRole(profile, index) === role);
}

export const getProfileById = (state: Pick<State, 'profiles'>, id: PersonId): Profile | undefined => state.profiles.find(profile => profile.id === id);
export const getSelfProfile = (state: Pick<State, 'profiles'>): Profile | undefined => findByRole(state.profiles, PROFILE_SELF);
export const getCompanionProfile = (state: Pick<State, 'profiles'>): Profile | undefined => findByRole(state.profiles, PROFILE_COMPANION);

export function requireSelfProfile(state: Pick<State, 'profiles'>): Profile {
  const profile = getSelfProfile(state);
  if (!profile) throw new Error('工作区缺少本人档案');
  return profile;
}

export const selfId = (state: Pick<State, 'profiles'>): PersonId => requireSelfProfile(state).id;
export const companionId = (state: Pick<State, 'profiles'>): PersonId | undefined => getCompanionProfile(state)?.id;
export const isSelfId = (state: Pick<State, 'profiles'>, id: PersonId): boolean => getSelfProfile(state)?.id === id;
export const isCompanionId = (state: Pick<State, 'profiles'>, id: PersonId): boolean => getCompanionProfile(state)?.id === id;

/**
 * 桌宠代表谁：有同行者时继续代表同行者（当前产品体验不变）；
 * 没有同行者（Solo）时代表本人。以后 Phase 4 的 PetInstance 会把它变成用户配置。
 */
export function resolvePetSubject(state: Pick<State, 'profiles'>): Profile {
  return getCompanionProfile(state) ?? requireSelfProfile(state);
}

// 状态短代号的默认值：本人 D、同行者 Y。用户显式设置过 shortAlias 时不会被覆盖。
export function defaultAliasFor(profile: Pick<Profile, 'id' | 'role'>, index = 0): string {
  return effectiveRole(profile, index) === PROFILE_COMPANION ? 'Y' : 'D';
}

export function profileAlias(profile: Pick<Profile, 'id' | 'role'> & { shortAlias?: string }, index = 0): string {
  return profile.shortAlias ?? defaultAliasFor(profile, index);
}

export function personAlias(state: Pick<State, 'profiles'>, id: PersonId): string {
  const index = state.profiles.findIndex(profile => profile.id === id);
  return index < 0 ? defaultAliasFor({ id }, 0) : profileAlias(state.profiles[index], index);
}
