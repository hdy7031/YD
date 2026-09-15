// Phase 5B1 · First-run setup lifecycle（首次使用）。
//
// `settings.setup` 是"首次使用是否完成"的唯一真相：
//
//   false → 主窗口显示 onboarding（产品设置还没有完成）
//   true  → 正常使用；再次调用 completeSetup 一律拒绝，之后改资料走设置页
//
// 这里只做纯领域工作：校验 SetupInput + 一次性应用完成结果。
// 不碰 DOM / React / Electron 窗口 / Avatar 图片加载。
//
// 两个边界必须保持：
//   * draft（用户正在输入的名字、临时切换的使用方式、待选 Avatar）只存在于 UI 内存，
//     不逐字写 Store；只有"开始使用 YD"才通过这一条命令落盘。
//   * 完成是一次原子的状态提交：要么全部写入（含 companion 创建），要么全部不写。
//     因此 companion 创建也走领域 factory（createCompanionProfile），
//     Avatar 写入走 Phase 4 的领域路径（setAvatarPack），不绕过 Registry 校验。
//   * 桌宠主体偏好（settings.petSubjectRole）也在这里一次写入：它是呈现偏好，
//     Solo 恒为本人，Together 才允许选择同行者；写入不会改动任何 Person。
import { createCompanionProfile } from './core.ts';
import { getAvatarPack, type AvatarPackId } from './avatar.ts';
import { setAvatarPack } from './avatar-selection.ts';
import { defaultAliasFor, getCompanionProfile, isPetSubjectRole, requireSelfProfile, roleCounts, type PetSubjectRole } from './people.ts';
import type { State } from './types.ts';

/** 名称上限与核心 validate('profiles') 的姓名上限保持一致（最多 40 个字符）。 */
export const SETUP_NAME_LIMIT = 40;

export type SetupMode = 'solo' | 'together';

export interface SetupCompanionInput {
  name: string;
  /** 省略 = 保持默认 Pack（source 语义不变，不会被记成用户选择）。 */
  avatarPackId?: AvatarPackId;
}

export interface SetupInput {
  selfName: string;
  mode: SetupMode;
  selfAvatarPackId?: AvatarPackId;
  companion?: SetupCompanionInput;
  /**
   * 是否启用桌面桌宠（Phase 5B1）。关闭时形象 / 主体都不是必填输入，
   * 档案上的 Avatar 保持合法默认值，也不 seed 任何作息。
   */
  petEnabled: boolean;
  /**
   * 桌面桌宠主要代表谁。Solo 一律被强制为 `self`（不信任 UI 隐藏字段）；
   * Together 允许 `self` / `companion`，省略时按产品默认取同行者。
   */
  petSubjectRole?: PetSubjectRole;
}

/** 首次使用是否需要 onboarding：只有这一条判断，不用姓名 / 档案数量 / 课程猜。 */
export function needsSetup(state: Pick<State, 'settings'>): boolean {
  return state.settings.setup === false;
}

// 控制字符（换行 / 制表 / DEL）会破坏一行式展示。
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F-\u009F]/;
// 只有空白与不可见格式字符（零宽空格、方向控制、BOM…）时视为没有填写。
const INVISIBLE_ONLY = /^[\s\u00A0\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\uFEFF]*$/u;

/**
 * 名称校验的唯一实现：返回 '' 表示合法，否则返回给用户看的说明。
 *
 * 规则刻意保持小而稳定：trim 前后空白、不允许纯空白、限制长度、拒绝控制字符，
 * 但**不**过滤正常 Unicode——中文、拉丁文、emoji（含 ZWJ 组合）都原样通过。
 */
export function setupNameProblem(value: unknown, label = '称呼'): string {
  if (typeof value !== 'string') return `请填写${label}`;
  const name = value.trim();
  if (!name) return `请填写${label}`;
  if (INVISIBLE_ONLY.test(name)) return `${label}需要至少一个可见字符`;
  if (CONTROL_CHARACTER.test(name)) return `${label}不能包含换行或控制字符`;
  if (name.length > SETUP_NAME_LIMIT) return `${label}最多 ${SETUP_NAME_LIMIT} 个字符`;
  return '';
}

/** 校验并返回写入 Store 的规范名称（已完成 trim）。 */
export function normalizeSetupName(value: unknown, label = '称呼'): string {
  const problem = setupNameProblem(value, label);
  if (problem) throw new Error(problem);
  return (value as string).trim();
}

/**
 * 完成首次使用：校验 draft 后一次性写入档案身份、使用方式与 Avatar。
 *
 * 就地的写入风格与 setAvatarPack / resetAvatarPack 一致：调用方（core.apply）已经在
 * 克隆出来的 State 上工作，抛错时整份克隆会被丢弃，不会留下半配置数据。
 */
export function completeSetup(state: State, input: unknown, now: number): void {
  const draft = (input ?? {}) as Partial<SetupInput>;
  if (state.settings.setup) throw new Error('首次设置已经完成，请到设置里修改');
  const roles = roleCounts(state.profiles);
  if (roles.self !== 1) throw new Error('工作区必须且只能有一个本人档案');
  if (roles.companion > 1) throw new Error('工作区存在多余的陪伴对象，请先从备份恢复');
  const self = requireSelfProfile(state);
  const existing = getCompanionProfile(state);
  if (draft.mode !== 'solo' && draft.mode !== 'together') throw new Error('请选择使用方式');
  if (typeof draft.petEnabled !== 'boolean') throw new Error('请选择是否使用桌面桌宠');
  if (draft.petSubjectRole !== undefined && !isPetSubjectRole(draft.petSubjectRole)) throw new Error('桌宠表示无效');
  const petEnabled = draft.petEnabled;
  const selfName = normalizeSetupName(draft.selfName, '称呼');
  // 先把整份输入校验完，再动 State：任何非法 Pack 都不允许留下半个 setup 结果。
  // 桌宠关闭时，形象只是"合法内部默认"，不接收用户选择（也不写 source: 'user'）。
  const selfPack = !petEnabled || draft.selfAvatarPackId === undefined ? undefined : requireRegisteredPack(draft.selfAvatarPackId, '桌宠形象');
  let companionName: string | null = null;
  let companionPack: AvatarPackId | undefined;
  if (draft.mode === 'solo') {
    // 单人模式不删除任何东西：移除陪伴对象是 Profile 生命周期（Phase 5B2）。
    if (existing) throw new Error('工作区里已经有陪伴对象，暂不支持在首次设置里移除');
  } else if (existing) {
    // 已经有陪伴对象时只完成身份设置（改名 / 换形象在设置页做，这里是 5B1 的边界）。
    if (draft.companion !== undefined) throw new Error('工作区里已经有陪伴对象，请到设置里修改');
  } else {
    if (!draft.companion) throw new Error('请填写 TA 的称呼');
    companionName = normalizeSetupName(draft.companion.name, 'TA 的称呼');
    companionPack = !petEnabled || draft.companion.avatarPackId === undefined ? undefined : requireRegisteredPack(draft.companion.avatarPackId, 'TA 的桌宠形象');
  }

  // 名称：只有真的改了才更新 updatedAt，不给"确认一次"制造无意义的写入。
  if (self.name !== selfName) {
    // 改名字顺手更新"系统自己填的"代号：启动归一化会把派生代号写进 shortAlias，
    // 如果它恰好等于旧名字派生出来的值，说明它不是用户挑的（用户自己设置过的
    // Y / D 一字不改），清掉后显示规则自然按新名字派生。
    const index = state.profiles.findIndex(profile => profile.id === self.id);
    if (self.shortAlias === defaultAliasFor(self, index)) delete self.shortAlias;
    self.name = selfName;
    self.updatedAt = now;
  }
  // Avatar：字段只在用户真的点过卡片时才出现（UI 的 draft 语义），因此
  //   * 没点过 → 不动，默认卡片保持 source: 'default'（默认选中 ≠ 用户选择）；
  //   * 点过   → 走 Phase 4 的 setAvatarPack 语义：显式选择记 source: 'user'，
  //              包括"主动把默认形象当作自己的选择"。
  // 只有"已经是用户选择、且 Pack 没变"才跳过，避免无意义的 updatedAt 写入。
  if (selfPack !== undefined && !(selfPack === self.avatar?.packId && self.avatar?.source === 'user')) setAvatarPack(state, self.id, selfPack, now);
  if (companionName !== null) {
    const companion = createCompanionProfile(now, self);
    companion.name = companionName;
    state.profiles = [...state.profiles, companion];
    if (companionPack !== undefined) setAvatarPack(state, companion.id, companionPack, now);
  }
  // 桌宠主体偏好：Solo 恒为本人；Together 由用户选择（省略时取产品默认：同行者）。
  // 它只影响"桌宠消费谁的 CurrentState + Avatar"，不修改任何 Person。
  state.settings.petEnabled = petEnabled;
  state.settings.petSubjectRole = draft.mode === 'solo' ? 'self' : draft.petSubjectRole ?? 'companion';
  // Phase 5B2：首次使用不需要显式写 settings.usageMode —— Together 刚创建了 companion、
  // Solo 分支在上面拒绝了"带着既有 companion 选 Solo"，因此档案事实与使用方式天然一致
  // （people.ts 的推导规则给出的就是这里选择的模式）。
  state.settings.setup = true;
}

function requireRegisteredPack(packId: unknown, label: string): AvatarPackId {
  if (typeof packId !== 'string' || !packId.trim()) throw new Error(`${label}无效`);
  if (!getAvatarPack(packId)) throw new Error(`${label}不可用，请重新选择`);
  return packId;
}
