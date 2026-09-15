// Phase 5B2 · Profile lifecycle（使用方式切换 + 档案身份编辑）。
//
// 两条领域事实，其余实现都必须遵守：
//
//   1) 模式切换 ≠ 删除人物（Mode switch ≠ Person deletion）
//      `Together → Solo` 只把 `settings.usageMode` 改成 `solo`：companion 的
//      Profile / PersonId / 课表 / 作息 / Avatar / 临时状态 与其它 person-scoped
//      数据全部原样保留。因此再次选择 Together 时恢复的是**同一个**人，
//      绝不新建第二个 companion —— 这也是本阶段不做"永久删除陪伴对象"的原因。
//
//   2) 档案身份只有一个写入路径
//      `updateProfileIdentity` 只接受 `name` 与 `shortAlias`：PersonId 与 role
//      不可修改，Avatar 走 Phase 4 的 avatarSet / avatarReset，作息走 Routine
//      设置。这里刻意不提供任意 patch，避免界面越过领域边界改写身份。
//
// 就地的写入风格与 setAvatarPack / completeSetup 一致：调用方（core.apply）已经在
// 克隆出来的 State 上工作，抛错时整份克隆会被丢弃，不会留下半配置数据。
import { createCompanionProfile } from './core.ts';
import { normalizeSetupName } from './setup.ts';
import { getCompanionProfile, getProfileById, isPetSubjectRole, isUsageMode, requireSelfProfile, roleCounts, usageModeOf, type PetSubjectRole, type UsageMode } from './people.ts';
import type { PersonId, Profile, State } from './types.ts';

/** 桌面短代号上限：与核心 validate('profiles') 的 shortAlias 规则一致（1—8 字）。 */
export const PROFILE_ALIAS_LIMIT = 8;
/** 控制字符（换行 / 制表 / DEL）会破坏一行式展示，与名称规则保持同一条边界。 */
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F-\u009F]/;

export interface UsageModeInput {
  mode: UsageMode;
  /**
   * 只在"从来没有过陪伴对象、现在第一次打开双人模式"时使用：
   * 新 companion 由领域工厂创建，界面不许自己拼 Profile。
   */
  companionName?: string;
  /**
   * 桌宠主体偏好。省略时：保留既有偏好（恢复场景），新建 companion 则取产品默认
   * `companion`（Together 的特色用法是用桌宠低打扰查看对方状态）。
   * 它只决定桌宠消费谁的 CurrentState + Avatar，不修改任何 Person。
   */
  petSubjectRole?: PetSubjectRole;
}

/**
 * 切换使用方式（唯一入口；core.apply 的 `usageMode` 命令）。
 *
 *   Together → Solo   幂等：只改运行方式，companion 与它的全部数据保留
 *   Solo → Together   已有 retained companion → 直接恢复原人物
 *                     没有 companion          → 用 createCompanionProfile 正式创建
 */
export function switchUsageMode(state: State, input: UsageModeInput, now: number): void {
  const draft = (input ?? {}) as Partial<UsageModeInput>;
  if (!isUsageMode(draft.mode)) throw new Error('请选择使用方式');
  if (draft.petSubjectRole !== undefined && !isPetSubjectRole(draft.petSubjectRole)) throw new Error('桌宠表示无效');
  const roles = roleCounts(state.profiles);
  if (roles.self !== 1) throw new Error('工作区必须且只能有一个本人档案');
  if (roles.companion > 1) throw new Error('工作区存在多余的陪伴对象，请先从备份恢复');
  const existing = getCompanionProfile(state);

  if (draft.mode === 'solo') {
    // 已经处于 Solo 时按既有 command 风格接受 no-op（不产生无意义的 updatedAt / 写入）。
    if (usageModeOf(state) === 'solo') return;
    state.settings.usageMode = 'solo';
    return;
  }

  if (existing) {
    // 恢复：不重新填写姓名，也不允许借这次调用给既有 companion 改名。
    if (draft.companionName !== undefined) throw new Error('工作区里已经有陪伴对象，请直接在档案里修改');
  } else {
    if (draft.companionName === undefined) throw new Error('请填写 TA 的称呼');
    const companion = createCompanionProfile(now, requireSelfProfile(state));
    companion.name = normalizeSetupName(draft.companionName, 'TA 的称呼');
    state.profiles = [...state.profiles, companion];
  }
  state.settings.usageMode = 'together';
  // 存储的主体偏好：恢复场景原样保留（用户在 Together 下的旧选择），新建场景取默认。
  if (draft.petSubjectRole !== undefined) state.settings.petSubjectRole = draft.petSubjectRole;
  else if (!existing) state.settings.petSubjectRole = 'companion';
}

export interface ProfileIdentityInput {
  personId: PersonId;
  name: string;
  /**
   * `undefined` = 不改动；`null` 或纯空白 = 用户主动清空，显示代号回到
   * people.ts 的派生规则（name 首字素 → 我 / TA），不会被写成一个新值。
   */
  shortAlias?: string | null;
}

/**
 * 编辑档案身份（唯一入口；core.apply 的 `profileIdentity` 命令）。
 *
 * 名称规则复用 5B1 onboarding 的 `normalizeSetupName`：中文 / 英文 / emoji /
 * Unicode 字素都合法，纯空白与超长被拒绝 —— 不创建第二套名字规则。
 */
export function updateProfileIdentity(state: State, input: ProfileIdentityInput, now: number): void {
  const draft = (input ?? {}) as Partial<ProfileIdentityInput>;
  const profile: Profile | undefined = typeof draft.personId === 'string' ? getProfileById(state, draft.personId) : undefined;
  if (!profile) throw new Error('档案不存在');
  const name = normalizeSetupName(draft.name, '称呼');
  const alias = resolveAlias(draft.shortAlias, profile);
  // 没有任何变化时不动 updatedAt：确认一次不等于修改。
  if (profile.name === name && profile.shortAlias === alias) return;
  profile.name = name;
  if (alias === undefined) delete profile.shortAlias;
  else profile.shortAlias = alias;
  // role / id / avatar / routine / 学期与节次都不在这里出现：改名的副作用必须为零。
  profile.updatedAt = now;
}

/** 短代号的解析：undefined 保持、null / 空白清空、其余按 1—8 字校验后写入。 */
function resolveAlias(value: string | null | undefined, profile: Profile): string | undefined {
  if (value === undefined) return profile.shortAlias;
  if (value === null) return undefined;
  if (typeof value !== 'string') throw new Error('桌面短代号无效');
  const alias = value.trim();
  if (!alias) return undefined;
  if (CONTROL_CHARACTER.test(alias)) throw new Error('桌面短代号不能包含换行或控制字符');
  if (alias.length > PROFILE_ALIAS_LIMIT) throw new Error(`桌面短代号最多 ${PROFILE_ALIAS_LIMIT} 个字符`);
  return alias;
}
