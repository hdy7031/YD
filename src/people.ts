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
 * 工作区使用方式（Phase 5B2）。
 *
 *   solo     —— 当前只使用本人作为活跃人物界面；
 *   together —— 本人 + 同行者当前都参与产品体验。
 *
 * **模式切换不是删除人物**：`solo` 允许数据库里继续保存一个 inactive companion
 * （档案 / PersonId / 课表 / 作息 / Avatar / 其它 person-scoped 数据全部保留），
 * 所以这个字段是"运行方式偏好"，不是档案清单。
 *
 * 它随其它呈现偏好一起存放在 `settings.usageMode`；没有该字段的安装（旧库、
 * 构造出来的测试状态、v1 备份）不需要迁移，直接按档案事实推导：
 * 有 companion → Together，只有本人 → Solo。
 */
export type UsageMode = 'solo' | 'together';

export const isUsageMode = (value: unknown): value is UsageMode => value === 'solo' || value === 'together';

/** 使用方式的**唯一**解析层：显式持久化优先，旧数据按档案事实推导。 */
export function usageModeOf(state: Pick<State, 'profiles'> & { settings?: State['settings'] }): UsageMode {
  const raw = (state.settings as { usageMode?: unknown } | undefined)?.usageMode;
  if (isUsageMode(raw)) return raw;
  return getCompanionProfile(state) ? 'together' : 'solo';
}

export const isTogether = (state: Pick<State, 'profiles'> & { settings?: State['settings'] }): boolean => usageModeOf(state) === 'together';

/**
 * 当前**活跃人物**（导航 / 首页 / Dock / 桌宠 / 人员选项共用的唯一投影）：
 *
 *   Solo     → 只有本人（即使数据库里保留着一个 inactive companion）
 *   Together → 全部档案（保持 profiles 的显示顺序）
 *
 * UI 不许自己写 `if (mode === 'solo')`：活跃边界只在这里判定。
 */
export function activeProfiles(state: Pick<State, 'profiles'> & { settings?: State['settings'] }): Profile[] {
  if (usageModeOf(state) === 'together') return state.profiles;
  const self = getSelfProfile(state);
  return self ? [self] : [];
}

/** 当前活跃的同行者：Solo 下保留的 companion **不算**活跃人物。 */
export function activeCompanionProfile(state: Pick<State, 'profiles'> & { settings?: State['settings'] }): Profile | undefined {
  return isTogether(state) ? getCompanionProfile(state) : undefined;
}

/**
 * 读取桌宠主体偏好。没有该字段的安装（未迁移的旧库、构造出来的测试状态）
 * 沿用 0.2.x 的视觉行为：有同行者 → 同行者，Solo → 本人。
 *
 * 注意这是**存储的偏好**，不是"此刻生效的主体"：切到 Solo 时它原样保留
 * （代表用户在 Together 下的选择），运行时由 resolvePetSubject 判定。
 */
export function petSubjectRoleOf(state: Pick<State, 'profiles'> & { settings?: State['settings'] }): PetSubjectRole {
  const raw = (state.settings as { petSubjectRole?: unknown } | undefined)?.petSubjectRole;
  if (isPetSubjectRole(raw)) return raw;
  return isTogether(state) && getCompanionProfile(state) ? PROFILE_COMPANION : PROFILE_SELF;
}

/**
 * 桌宠代表谁 —— 当前桌宠主体的**唯一**解析层（其它模块不得各自推导）。
 *
 *   Solo              → 一定是本人（即使数据库里保留了 companion：Solo 下桌宠没有第二个主体）
 *   Together          → settings.petSubjectRole 对应的 Person
 *   目标 Person 不存在 → 安全回落到本人（legacy / 损坏数据也不崩）
 */
export function resolvePetSubject(state: Pick<State, 'profiles'> & { settings?: State['settings'] }): Profile {
  if (isTogether(state) && petSubjectRoleOf(state) === PROFILE_COMPANION) {
    const companion = getCompanionProfile(state);
    if (companion) return companion;
  }
  return requireSelfProfile(state);
}

/**
 * 显示代号派生（Phase 5A 泛化）：
 *
 *   1. 用户显式设置过 shortAlias → 用它（既有用户已持久化的 Y / D 一字不改）；
 *   2. 否则取显示名称的第一个"有身份信息"的字素（见 aliasSeedFromName）；
 *   3. 名称为空 → 本人「我」、同行者「TA」。
 *
 * Y / D 不再是系统身份机制；它只是"用户自己存过这两个字母"时的合法取值。
 */
// 常见称呼前缀：它们只表示亲近或年龄（小宇 / 老王 / 阿丁），不是身份信息，
// 因此不能占用桌面短代号 —— 否则 Dock 与状态行上会出现一个毫无区分度的小字。
const ADDRESS_PREFIXES = new Set(['小', '老', '阿']);

/** 按 Unicode 字素切分：中文 / 英文 / emoji / 代理对 / ZWJ 序列都不会被切坏。 */
export function graphemes(value?: string): string[] {
  const text = (value ?? '').trim();
  if (!text) return [];
  const constructor = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: string }) => { segment(input: string): Iterable<{ segment: string }> } }).Segmenter;
  if (constructor) {
    const segmenter = new constructor('zh-CN', { granularity: 'grapheme' });
    return [...segmenter.segment(text)].map(part => part.segment);
  }
  // 兜底：按码位取第一个字素，绝不用 name[0]（会切开代理对 / emoji）。
  return Array.from(text);
}

export function firstVisibleGrapheme(value?: string): string {
  return graphemes(value)[0] ?? '';
}

/**
 * 派生短代号的种子字素（Phase 5B2 细化的显示规则）：
 *
 *   '小宇' → '宇'      '老张' → '张'      '阿丁' → '丁'
 *   '丹丹' → '丹'      '小'   → '小'      'Alex' → 'A'      '👨‍👩‍👧 家' → '👨‍👩‍👧'
 *
 * 只有"前缀 + 至少一个字素"时才跳过前缀：单个「小」仍然是它自己。
 * 这条规则只影响**派生显示代号**，不改写用户显式保存过的 shortAlias。
 */
export function aliasSeedFromName(value?: string): string {
  const parts = graphemes(value);
  if (parts.length >= 2 && ADDRESS_PREFIXES.has(parts[0])) return parts[1];
  return parts[0] ?? '';
}

export function defaultAliasFor(profile: Pick<Profile, 'id' | 'role'> & { name?: string }, index = 0): string {
  const derived = aliasSeedFromName(profile.name);
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
