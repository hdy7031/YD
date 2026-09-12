// v0.3 领域迁移闸门（Phase 0 基线；本文件不实现任何产品功能迁移）。
//
// 为什么需要它：v0.3 会改变身份的语义（Person / profiles 数量 / Event.person /
// Routine / Avatar / settings）。一旦这些语义变化落盘，"旧版本能读回新数据" 就不再是
// 可依赖的性质：
//
//   * 旧版 `validateState` 强制 profiles.length===2，而 v0.3 允许 1 个 Person；
//   * 旧版把 Event 视为 "me" 的、把提醒只发给 "me"，理解不了新的归属语义；
//   * 旧版忽略未知字段，只是"没有报错"，不等于"语义正确"。
//
// 因此回滚模型是字节级还原，而不是让旧版直接读新库：
//
//   v0.2 数据库 --(本模块先落 before-v030 备份)--> v0.3 迁移
//        ^                                              |
//        |________________ 迁移失败：还原迁移前的字节 ____|
//
// 规则（Phase 1 起必须遵守）：
//   1. 任何迁移前必须先写 `before-v030-<stamp>.dayhub`（与现有备份格式一致，可被
//      「从备份恢复」读取）与 `before-v030-<stamp>.sqlite`（原始字节，回滚用）。
//   2. 迁移在单个 Store.update 内完成：磁盘上只会存在迁移前或迁移后的状态。
//   3. 失败时还原原始数据库字节，备份文件永远保留，绝不 drop、绝不删除用户数据。
//   4. 成功了也不代表可以就地回滚：要回到 v0.2 必须恢复备份文件，而不是用旧版打开新库。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pack } from './backup.ts';
import { DOMAIN_VERSION, stateDomainVersion } from './domain.ts';
import { effectiveRole, getCompanionProfile, requireSelfProfile, resolvePetSubject } from './people.ts';
import { emptyRoutine, legacyDefaultRoutine } from './routine.ts';
import { DEFAULT_AVATAR_PACK_ID } from './avatar.ts';
import type { Store } from './store.ts';
import type { Course, State } from './types.ts';

export const MIGRATION_BACKUP_PREFIX = 'before-v030';
export { DOMAIN_VERSION, stateDomainVersion as domainVersion };

/** v1 → v2：身份基础（Profile.role）。 */
export const IDENTITY_DOMAIN_VERSION = 2;
/** v2 → v3：会议归属到人 + v0.2 时代的一次性历史归一化。 */
export const PERSON_AWARE_DOMAIN_VERSION = 3;
/** v3 → v4：每个档案拥有自己的 RoutineProfile（Phase 2A；桌宠消费方仍在 2B 切换）。 */
export const ROUTINE_DOMAIN_VERSION = 4;
/** v4 → v5：临时手动状态（Phase 3C）。旧数据补空数组，其它字段逐字段不变。 */
export const MANUAL_STATUS_DOMAIN_VERSION = 5;
/** v5 → v6：每个档案持有 Avatar Pack 选择。 */
export const AVATAR_SELECTION_DOMAIN_VERSION = 6;

/**
 * v0.2 时代的一次性兼容规则（原先散落在 migrateLive() 里的私人业务分支）。
 *
 * 这些条件与具体用户数据有关（旧称呼、旧学期日期、旧课程名），因此**只允许**
 * 在版本化迁移里出现一次，正常领域运行时不得再引用它们驱动业务语义。
 */
export const LEGACY_V2_RULES = {
  companionNames: ['她', '女朋友', '伴侣'],
  researchCourseTitle: '高一高二语文教研',
  tentativeTerm: { startDate: '2026-09-07', weeks: 20 },
} as const;

/**
 * v1 → v2：给每个档案补上角色，其它内容一律不动。
 *
 * 解析沿用 people.ts 的兼容顺序（显式 role → 历史 id → 数组位置），
 * 因此 me → self、partner → companion，未知 id 的旧档案也不会丢。
 * 不重写 id、不碰课程 / 待办 / 会议 / 提醒 / 调课 / 通知 / 设置。
 */
export function identityRoleMigration(state: State): State {
  state.profiles = state.profiles.map((profile, index) => ({ ...profile, role: effectiveRole(profile, index) }));
  state.settings.domainVersion = IDENTITY_DOMAIN_VERSION;
  return state;
}

/** v0.2 的教研课名规则：同行者、缺少 activity、标题匹配时才视为教研。 */
export function isLegacyResearchCourse(state: State, course: Course): boolean {
  return course.person === getCompanionProfile(state)?.id && course.title.replace(/\s/g, '') === LEGACY_V2_RULES.researchCourseTitle;
}

/**
 * v2 → v3：
 *   1. 旧会议归属到工作区本人（通过身份层解析，不写死 'me'）；
 *   2. 课程 activity 缺省补 teaching，v0.2 的教研课名规则在此一次性生效；
 *   3. v0.2 的暂定学期与同行者旧称呼归一化。
 * 其余字段（id / 时间 / 标题 / 提醒 / 关联 / 设置）全部原样保留，且幂等。
 */
export function personAwareMigrationV3(state: State): State {
  const selfId = requireSelfProfile(state).id;
  state.events = state.events.map(event => event.person === undefined ? { ...event, person: selfId } : event);
  for (const course of state.courses) if (!course.activity) course.activity = isLegacyResearchCourse(state, course) ? 'research' : 'teaching';
  const companion = getCompanionProfile(state);
  if (companion) {
    if (companion.tentative === undefined && companion.startDate === LEGACY_V2_RULES.tentativeTerm.startDate && companion.weeks === LEGACY_V2_RULES.tentativeTerm.weeks) companion.tentative = true;
    if ((LEGACY_V2_RULES.companionNames as readonly string[]).includes(companion.name.trim())) companion.name = 'Ta';
  }
  state.settings.domainVersion = PERSON_AWARE_DOMAIN_VERSION;
  return state;
}

/**
 * v3 → v4：给每个档案补上 RoutineProfile。
 *
 * 只有当前桌宠主体（resolvePetSubject：有同行者 → 同行者；Solo → 本人）会拿到
 * 0.2.x 桌宠写死的时间表，作为 source = 'legacy-default' 的默认作息；其他人的规则为空。
 * 这一步不虚构"所有人的真实作息"，不碰课程 / 会议 / 待办 / 提醒 / 调课 / 通知 / 设置，
 * 且幂等：已经有 routine 的档案原样保留。
 */
export function routineProfileMigrationV4(state: State, now: number): State {
  const subjectId = resolvePetSubject(state).id;
  state.profiles = state.profiles.map(profile => ({
    ...profile,
    routine: profile.routine ?? (profile.id === subjectId ? legacyDefaultRoutine(now) : emptyRoutine(now)),
  }));
  state.settings.domainVersion = ROUTINE_DOMAIN_VERSION;
  return state;
}

/**
 * v4 → v5：临时手动状态。
 *
 * 旧安装没有任何手动覆盖，因此只需要补一个空数组；课程 / 会议 / 待办 / 提醒 /
 * 调课 / 通知 / 作息 / 设置全部逐字段保留，且幂等（已有的覆盖原样保留，
 * 只有真的过期记录会在保存路径里被清理，见 src/state/manual.ts）。
 */
export function manualStatusMigrationV5(state: State): State {
  state.manualOverrides = state.manualOverrides ?? [];
  state.settings.domainVersion = MANUAL_STATUS_DOMAIN_VERSION;
  return state;
}

export function avatarSelectionMigrationV6(state: State): State {
  state.profiles = state.profiles.map(profile => ({
    ...profile,
    avatar: profile.avatar ?? { packId: DEFAULT_AVATAR_PACK_ID, source: 'default' },
  }));
  state.settings.domainVersion = AVATAR_SELECTION_DOMAIN_VERSION;
  return state;
}

// 每一步的 `to` 写成字面量：提升 DOMAIN_VERSION 时必须追加新步骤，
// 由 tests/identity.test.ts 守住“最后一个步骤的 to === DOMAIN_VERSION”。
export const migrationSteps: MigrationStep[] = [
  { from: 1, to: IDENTITY_DOMAIN_VERSION, id: 'identity-roles', migrate: identityRoleMigration },
  { from: IDENTITY_DOMAIN_VERSION, to: PERSON_AWARE_DOMAIN_VERSION, id: 'person-aware', migrate: personAwareMigrationV3 },
  { from: PERSON_AWARE_DOMAIN_VERSION, to: ROUTINE_DOMAIN_VERSION, id: 'routine-profile', migrate: routineProfileMigrationV4 },
  { from: ROUTINE_DOMAIN_VERSION, to: MANUAL_STATUS_DOMAIN_VERSION, id: 'manual-status', migrate: manualStatusMigrationV5 },
  { from: MANUAL_STATUS_DOMAIN_VERSION, to: AVATAR_SELECTION_DOMAIN_VERSION, id: 'avatar-selection', migrate: avatarSelectionMigrationV6 },
];

export interface MigrationStep {
  from: number;
  to: number;
  id: string;
  migrate(state: State, now: number): State;
}

export interface MigrationBackup {
  stamp: string;
  dayhub: string;
  sqlite: string;
  receipt: string;
  sha256: string;
}

export interface MigrationRun {
  migrated: boolean;
  from: number;
  to: number;
  steps: string[];
  backup?: MigrationBackup;
}

export interface MigrationOptions {
  target: number;
  /** 读取状态的领域版本；未写入过该字段的安装一律视为 1。 */
  version(state: State): number;
  steps: MigrationStep[];
  backupDirectory: string;
  attachments: string;
  now?: number;
  log?(message: string): void;
}

export function migrationStamp(now: number): string {
  return new Date(now).toISOString().replace(/[:.]/g, '-');
}

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * 在任何迁移发生之前调用。写入两份备份 + 一份回执：
 * - `.dayhub`：与产品「导出完整备份」同格式，可由界面恢复，含附件内容；
 * - `.sqlite`：迁移前数据库的原始字节，迁移失败时原样写回；
 * - `.json`：版本与各集合计数，便于验收"没有静默丢失"。
 */
export function createMigrationBackup(options: { directory: string; attachments: string; state: State; storeFile: string; version: number; target: number; now: number }): MigrationBackup {
  const { directory, attachments, state, storeFile, version, target, now } = options;
  fs.mkdirSync(directory, { recursive: true });
  const stamp = migrationStamp(now);
  const base = path.join(directory, `${MIGRATION_BACKUP_PREFIX}-${stamp}`);
  const dayhub = `${base}.dayhub`;
  const sqlite = `${base}.sqlite`;
  const receipt = `${base}.json`;
  // pack() 会读取通知附件；附件缺失时直接抛错，迁移不会开始。
  fs.writeFileSync(dayhub, pack(state, attachments), 'utf8');
  fs.copyFileSync(storeFile, sqlite);
  const digest = sha256(sqlite);
  fs.writeFileSync(receipt, `${JSON.stringify({
    kind: 'dayhub-migration-backup',
    createdAt: new Date(now).toISOString(),
    fromDomainVersion: version,
    targetDomainVersion: target,
    storeFile,
    sqliteSha256: digest,
    counts: {
      profiles: state.profiles.length,
      courses: state.courses.length,
      exceptions: state.exceptions.length,
      events: state.events.length,
      tasks: state.tasks.length,
      notices: state.notices.length,
      reminders: state.reminders.length,
    },
  }, null, 2)}\n`, 'utf8');
  return { stamp, dayhub, sqlite, receipt, sha256: digest };
}

/**
 * 把迁移前的数据库字节写回。失败的迁移结果会被另存为 `.failed.sqlite`，
 * 便于事后诊断，同时保证 store.file 一定回到迁移前的状态。
 */
export function restoreMigrationBackup(backup: MigrationBackup, storeFile: string): void {
  if (fs.existsSync(storeFile) && sha256(storeFile) !== backup.sha256) {
    const failed = backup.sqlite.replace(/\.sqlite$/, '.failed.sqlite');
    if (!fs.existsSync(failed)) fs.copyFileSync(storeFile, failed);
  }
  fs.copyFileSync(backup.sqlite, storeFile);
}

/**
 * 按顺序执行待处理的领域迁移。Phase 0 没有注册任何步骤，因此这是完全惰性的，
 * 只在版本落后且存在连续迁移步骤时才写盘。
 */
export async function runMigrations(store: Store, options: MigrationOptions): Promise<MigrationRun> {
  const { target, version, steps, backupDirectory, attachments } = options;
  const now = options.now ?? Date.now();
  const before = store.snapshot();
  const from = version(before);
  if (!Number.isInteger(from) || from < 1) throw new Error(`领域版本无效：${String(from)}`);
  if (from >= target) return { migrated: false, from, to: from, steps: [] };

  const pending = steps.filter(step => step.from >= from && step.to <= target).sort((a, b) => a.from - b.from);
  let expected = from;
  for (const step of pending) {
    if (step.from !== expected) throw new Error(`缺少从 v${expected} 到 v${step.from} 的领域迁移步骤，已中止且未写入任何数据。`);
    expected = step.to;
  }
  if (expected !== target) throw new Error(`缺少从 v${expected} 到 v${target} 的领域迁移步骤，已中止且未写入任何数据。`);

  const backup = createMigrationBackup({ directory: backupDirectory, attachments, state: before, storeFile: store.file, version: from, target, now });
  options.log?.(`迁移前备份：${backup.dayhub}`);
  try {
    // 单个 update：校验或落盘任一步失败都不会留下中间版本。
    await store.update(state => {
      let next = state;
      for (const step of pending) next = step.migrate(next, now);
      return next;
    });
  } catch (error) {
    restoreMigrationBackup(backup, store.file);
    store.snapshot();
    throw new Error(`从 v${from} 迁移到 v${target} 失败，已恢复迁移前的数据库。备份保留在：${backup.dayhub}`, { cause: error });
  }
  return { migrated: true, from, to: target, steps: pending.map(step => step.id), backup };
}
