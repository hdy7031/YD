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
 * 桌宠主体偏好：桌面桌宠"主要代表谁的状态"（Phase 5B1 / schema v7）。
 *
 * 它是**呈现偏好**，不是身份：不修改 Profile.role、不修改 PersonId、不复制档案。
 * 因为要跨重启保持，所以正式持久化在 settings.petSubjectRole。
 */
export type PetSubjectRole = 'self' | 'companion';

export const isPetSubjectRole = (value: unknown): value is PetSubjectRole => value === PROFILE_SELF || value === PROFILE_COMPANION;

/**
 * 读取桌宠主体偏好。没有该字段的安装（未迁移的旧库、构造出来的测试状态）
 * 沿用 0.2.x 的视觉行为：有同行者 → 同行者，Solo → 本人。
 */
export function petSubjectRoleOf(state: Pick<State, 'profiles'> & { settings?: State['settings'] }): PetSubjectRole {
  const raw = (state.settings as { petSubjectRole?: unknown } | undefined)?.petSubjectRole;
  if (isPetSubjectRole(raw)) return raw;
  return getCompanionProfile(state) ? PROFILE_COMPANION : PROFILE_SELF;
}

/**
 * 桌宠代表谁 —— 当前桌宠主体的**唯一**解析层（其它模块不得各自推导）。
 *
 *   Solo              → 一定是本人（Solo 没有第二个 Person，也没有歧义）
 *   Together          → settings.petSubjectRole 对应的 Person
 *   目标 Person 不存在 → 安全回落到本人（legacy / 损坏数据也不崩）
 */
export function resolvePetSubject(state: Pick<State, 'profiles'> & { settings?: State['settings'] }): Profile {
  if (petSubjectRoleOf(state) === PROFILE_COMPANION) {
    const companion = getCompanionProfile(state);
    if (companion) return companion;
  }
  return requireSelfProfile(state);
}

/**
 * 显示代号派生（Phase 5A 泛化）：
 *
 *   1. 用户显式设置过 shortAlias → 用它（既有用户已持久化的 Y / D 一字不改）；
 *   2. 否则取显示名称的第一个字素（中文 / 英文 / emoji / 代理对都不会被切坏）；
 *   3. 名称为空 → 本人「我」、同行者「TA」。
 *
 * Y / D 不再是系统身份机制；它只是"用户自己存过这两个字母"时的合法取值。
 */
export function firstVisibleGrapheme(value?: string): string {
  const text = (value ?? '').trim();
  if (!text) return '';
  const constructor = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: string }) => { segment(input: string): Iterable<{ segment: string }> } }).Segmenter;
  if (constructor) {
    const segmenter = new constructor('zh-CN', { granularity: 'grapheme' });
    for (const part of segmenter.segment(text)) return part.segment;
    return '';
  }
  // 兜底：按码位取第一个字素，绝不用 name[0]（会切开代理对 / emoji）。
  return Array.from(text)[0] ?? '';
}

export function defaultAliasFor(profile: Pick<Profile, 'id' | 'role'> & { name?: string }, index = 0): string {
  const derived = firstVisibleGrapheme(profile.name);
  if (derived) return derived;
  return effectiveRole(profile, index) === PROFILE_COMPANION ? 'TA' : '我';
}

export function profileAlias(profile: Pick<Profile, 'id' | 'role' | 'name'> & { shortAlias?: string }, index = 0): string {
  const explicit = profile.shortAlias?.trim();
  return explicit ? explicit : defaultAliasFor(profile, index);
}

export function personAlias(state: Pick<State, 'profiles'>, id: PersonId): string {
  const index = state.profiles.findIndex(profile => profile.id === id);
  return index < 0 ? defaultAliasFor({ id }, 0) : profileAlias(state.profiles[index], index);
}
