// Phase 5B1 · First-run onboarding + 桌宠主体（Pet Subject）的领域契约。
//
// onboarding 本身是 UI，但"完成首次使用"必须是一条可测试的领域命令：
// 校验 draft、一次性写入、拒绝重复完成、绝不重新创建本人身份。
// 桌宠主体偏好（settings.petSubjectRole）也在这条命令里一次落盘，
// 但它只决定"桌宠消费谁的 CurrentState + 谁的 Avatar"，不修改任何 Person。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, createCompanionProfile, createFreshState, epoch } from '../src/core.ts';
import { completeSetup, needsSetup, normalizeSetupName, setupNameProblem, type SetupInput } from '../src/setup.ts';
import { getAvatarPack, listAvatarPacks, DEFAULT_AVATAR_PACK_ID } from '../src/avatar.ts';
import { getCompanionProfile, getSelfProfile, petSubjectRoleOf, profileAlias, resolvePetSubject, roleCounts, type PetSubjectRole } from '../src/people.ts';
import { academicOf } from '../src/academic.ts';
import { resolvePetInstance } from '../src/pet-instance.ts';
import { DOMAIN_VERSION } from '../src/domain.ts';
import { getCurrentState } from '../src/state/engine.ts';
import { snapshot } from '../src/live.ts';
import { togetherWorkspace } from './helpers/workspaces.ts';
import type { State } from '../src/types.ts';

const NOW = epoch('2027-04-07T10:00');
const fresh = () => createFreshState(NOW);
/** 只补一项：Solo 默认 self、Together 默认 companion（与产品默认一致）。 */
const input = (value: Omit<SetupInput, 'petSubjectRole' | 'petEnabled'> & { petSubjectRole?: PetSubjectRole; petEnabled?: boolean }): SetupInput => ({
  // 既有用例默认表达"用了桌宠的用户"：桌宠相关断言才有意义。
  petEnabled: value.petEnabled ?? true,
  petSubjectRole: value.mode === 'solo' ? 'self' : 'companion',
  ...value,
});
const complete = (state: State, value: SetupInput, now = NOW) => apply(state, { type: 'completeSetup', value }, now);
const rejects = (run: () => unknown, pattern: RegExp) => {
  assert.throws(run, (error: unknown) => error instanceof Error && pattern.test(error.message));
};
const otherPack = () => listAvatarPacks().find(pack => pack.id !== DEFAULT_AVATAR_PACK_ID)!.id;

test('Solo：完成首次使用只改身份，不重新创建本人 PersonId', () => {
  const state = fresh();
  const before = state.profiles[0];
  const next = complete(state, input({ selfName: '  小宇  ', mode: 'solo' }));
  assert.equal(next.settings.setup, true);
  assert.equal(next.profiles.length, 1, 'Solo 不产生 companion');
  const self = getSelfProfile(next)!;
  assert.equal(self.id, before.id, '本人身份就是 5A 启动时生成的稳定 PersonId');
  assert.equal(self.name, '小宇', '名称前后空白被 trim');
  assert.equal(self.shortAlias, undefined, 'shortAlias 继续由显示规则派生，onboarding 不强迫用户填写');
  assert.equal(profileAlias(self, 0), '宇', '「小」只是称呼前缀，短代号取后面的字素');
  assert.deepEqual(self.avatar, { packId: DEFAULT_AVATAR_PACK_ID, source: 'default' }, '没动过的默认卡片不算用户选择');
  assert.deepEqual([next.courses, next.tasks, next.events, next.notices, next.reminders], [[], [], [], [], []], '完成 onboarding 不 seed 任何业务数据');
  assert.equal(self.routine?.rules.length, 0, '不 seed 作息');
  assert.equal(next.settings.domainVersion, DOMAIN_VERSION);
  assert.equal(DOMAIN_VERSION, 7, 'Phase 5B1 把 schema 升到 7（桌宠主体偏好）');
  assert.equal(next.settings.petSubjectRole, 'self', 'Solo 的桌宠主体恒为本人');
  assert.equal(petSubjectRoleOf(next), 'self');
});

test('Solo：完成后 CurrentState 仍然由状态引擎决定（idle），桌宠代表本人', () => {
  const next = complete(fresh(), input({ selfName: '小宇', mode: 'solo' }));
  const self = getSelfProfile(next)!;
  for (const at of [NOW, epoch('2027-04-07T12:30'), epoch('2027-04-08T03:00')]) {
    assert.deepEqual(
      { kind: getCurrentState(next, self.id, at).kind, source: getCurrentState(next, self.id, at).source },
      { kind: 'idle', source: 'idle' },
    );
  }
  assert.equal(resolvePetInstance(next).subjectId, self.id, 'Solo 完成后桌宠是本人');
  assert.equal(snapshot(next, NOW).people.length, 1);
});

test('Solo：即使 draft 偷偷带上 companion，主体仍被强制为本人', () => {
  // 不信任 UI 隐藏字段：Solo 没有第二个 Person，主体偏好只能落在 self。
  const next = complete(fresh(), input({ selfName: '小宇', mode: 'solo', petSubjectRole: 'companion' }));
  assert.equal(next.settings.petSubjectRole, 'self');
  assert.equal(getCompanionProfile(next), undefined);
  assert.equal(resolvePetSubject(next).id, getSelfProfile(next)!.id);
});

test('Together：只有明确选择双人才创建 companion，且数据完全通用', () => {
  const state = fresh(), selfId = state.profiles[0].id;
  const next = complete(state, input({ selfName: '小宇', mode: 'together', companion: { name: '  丹丹 ' } }));
  assert.equal(next.settings.setup, true);
  assert.equal(next.profiles.length, 2);
  assert.deepEqual(roleCounts(next.profiles), { self: 1, companion: 1 });
  const self = getSelfProfile(next)!, companion = getCompanionProfile(next)!;
  assert.equal(self.id, selfId);
  assert.notEqual(companion.id, selfId);
  assert.match(companion.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'companion 用现代 PersonId');
  assert.notEqual(companion.name, 'TA', '创建时就用用户填写的称呼');
  assert.equal(companion.name, '丹丹');
  assert.equal(companion.shortAlias, undefined);
  assert.equal(profileAlias(companion, 1), '丹');
  assert.deepEqual(companion.routine, { source: 'user', updatedAt: NOW, rules: [] }, '不继承任何作息');
  assert.deepEqual(companion.avatar, { packId: DEFAULT_AVATAR_PACK_ID, source: 'default' });
  // Phase 5B3：新同伴不继承、也不发明学业配置（学期 / 教学周 / 节次都不是身份的一部分）。
  assert.equal(academicOf(companion), undefined, 'companion 没有假学期');
  assert.equal(academicOf(getSelfProfile(next)!), undefined, '本人也没有被塞进假学期');
  assert.equal(companion.startDate, undefined);
  assert.equal(companion.weeks, undefined);
  assert.equal(companion.periods, undefined);
  assert.deepEqual(next.courses, []);
  assert.equal(resolvePetInstance(next).subjectId, companion.id, 'Together 默认桌宠仍代表 TA');
  assert.equal(snapshot(next, NOW).people.length, 2);
});

test('Together：主体可以选择本人，选择谁就用谁的状态与形象', () => {
  const packs = listAvatarPacks();
  assert.ok(packs.length >= 2, 'Avatar 列表来自 Registry，不写死');
  const [packA, packB] = packs;
  const next = complete(fresh(), input({
    selfName: '小宇', mode: 'together', selfAvatarPackId: packA.id,
    companion: { name: '丹丹', avatarPackId: packB.id }, petSubjectRole: 'self',
  }));
  const self = getSelfProfile(next)!, companion = getCompanionProfile(next)!;
  assert.equal(next.settings.petSubjectRole, 'self');
  assert.deepEqual(resolvePetInstance(next), { subjectId: self.id, avatarPackId: packA.id }, '主体=本人 → 本人的形象');
  assert.deepEqual([self.avatar, companion.avatar], [{ packId: packA.id, source: 'user' }, { packId: packB.id, source: 'user' }], '两个人的形象各自独立保留');
  // 换成 TA：立即变成同行者的状态与形象（PetInstance 不持久化，纯投影）。
  const switched = apply(next, { type: 'settings', petSubjectRole: 'companion' }, NOW);
  assert.deepEqual(resolvePetInstance(switched), { subjectId: companion.id, avatarPackId: packB.id });
  assert.deepEqual([switched.courses, switched.tasks, switched.reminders], [[], [], []], '切换主体不产生任何业务数据');
});

test('Together：self 与 companion 允许共用同一个 Avatar Pack', () => {
  const packId = otherPack();
  const next = complete(fresh(), input({
    selfName: '小宇', mode: 'together', selfAvatarPackId: packId,
    companion: { name: '丹丹', avatarPackId: packId }, petSubjectRole: 'companion',
  }));
  const self = getSelfProfile(next)!, companion = getCompanionProfile(next)!;
  assert.deepEqual(self.avatar, { packId, source: 'user' });
  assert.deepEqual(companion.avatar, { packId, source: 'user' });
  assert.deepEqual(resolvePetInstance(next), { subjectId: companion.id, avatarPackId: packId });
  assert.deepEqual(resolvePetInstance(apply(next, { type: 'settings', petSubjectRole: 'self' }, NOW)), { subjectId: self.id, avatarPackId: packId });
});

test('shape：companion 来自领域工厂，字段集合与模板同源', () => {
  const state = fresh();
  const template = createCompanionProfile(NOW, state.profiles[0]);
  const next = complete(state, input({ selfName: '小宇', mode: 'together', companion: { name: '丹丹' } }));
  const created = getCompanionProfile(next)!;
  // 除身份与名称外，字段集合必须与领域模板一致（同源，不复制字段清单）。
  assert.deepEqual(Object.keys(created).sort(), Object.keys(template).sort());
  const shape = (profile: typeof created) => ({ role: profile.role, weeks: profile.weeks, periods: profile.periods, startDate: profile.startDate, routine: profile.routine, avatar: profile.avatar });
  assert.deepEqual(shape(created), shape(template));
});

test('draft：Solo → Together → Solo 后完成，不产生 ghost companion', () => {
  const state = fresh();
  // UI 里的 draft 不会写 Store：这里只断言最终提交的语义。
  const next = complete(state, input({ selfName: '小宇', mode: 'solo', petSubjectRole: 'companion' }));
  assert.equal(next.profiles.length, 1);
  assert.equal(getCompanionProfile(next), undefined);
  assert.equal(next.settings.setup, true);
  assert.equal(next.settings.petSubjectRole, 'self', '回退到 Solo 后主体偏好不残留 companion');
  assert.deepEqual(state.profiles.length, 1, '原始 state 不被就地改写');
});

test('失败不留痕：非法 draft 被拒绝时 State 完全不变（含 companion 半创建）', () => {
  const state = fresh();
  const before = structuredClone(state);
  rejects(() => complete(state, input({ selfName: '小宇', mode: 'together', companion: { name: '   ' } })), /请填写/);
  rejects(() => complete(state, input({ selfName: '  ', mode: 'together', companion: { name: '丹丹' } })), /请填写/);
  rejects(() => complete(state, input({ selfName: '小宇', mode: 'together', companion: { name: '丹丹', avatarPackId: 'yd-unknown' as never } })), /不可用/);
  rejects(() => complete(state, input({ selfName: '小宇', mode: 'solo', selfAvatarPackId: 'yd-unknown' as never })), /不可用/);
  rejects(() => complete(state, input({ selfName: '小宇', mode: 'pair' as never })), /使用方式/);
  rejects(() => complete(state, input({ selfName: '小宇', mode: 'together', companion: { name: '丹丹' }, petSubjectRole: 'partner' as never })), /桌宠表示/);
  assert.deepEqual(state, before, '被拒绝的完成命令不留下任何痕迹');
  assert.equal(state.settings.setup, false);
  assert.deepEqual(roleCounts(state.profiles), { self: 1, companion: 0 });
});

test('幂等边界：settings.setup=true 之后再次 completeSetup 一律拒绝且不改写 State', () => {
  const done = complete(fresh(), input({ selfName: '小宇', mode: 'solo' }));
  const before = structuredClone(done);
  rejects(() => complete(done, input({ selfName: '别人', mode: 'together', companion: { name: '丹丹' } })), /已经完成/);
  assert.deepEqual(done, before);
  // 老用户（setup=true）的启动语义：不需要 onboarding。
  assert.equal(needsSetup(done), false);
  const existingUser = togetherWorkspace(NOW);
  existingUser.settings.setup = true;
  assert.equal(needsSetup(existingUser), false);
  assert.equal(needsSetup(fresh()), true);
});

test('Avatar：显式选择记 source=user，未改动的默认保持 source=default', () => {
  const packs = listAvatarPacks();
  assert.ok(packs.length >= 2, 'Avatar 列表来自 Registry，不写死');
  const pixel = packs.find(pack => pack.id !== DEFAULT_AVATAR_PACK_ID)!;
  const next = complete(fresh(), input({ selfName: '小宇', mode: 'together', selfAvatarPackId: pixel.id, companion: { name: '丹丹' } }));
  assert.deepEqual(getSelfProfile(next)!.avatar, { packId: pixel.id, source: 'user' });
  assert.deepEqual(getCompanionProfile(next)!.avatar, { packId: DEFAULT_AVATAR_PACK_ID, source: 'default' });
  // 主动点过默认卡片 = 用户明确的自定义选择（Phase 4 的 setAvatarPack 语义）；
  // 而"没点过卡片"才不会写 —— 后者才是 §24 要防的"默认选中被记成用户选择"。
  const again = complete(fresh(), input({ selfName: '小宇', mode: 'solo', selfAvatarPackId: DEFAULT_AVATAR_PACK_ID }));
  assert.deepEqual(getSelfProfile(again)!.avatar, { packId: DEFAULT_AVATAR_PACK_ID, source: 'user' });
  assert.ok(getAvatarPack(pixel.id));
});

test('Avatar：Together 下把 companion 换成另一个 Pack 也走同一套校验与来源语义', () => {
  const pixel = otherPack();
  const next = complete(fresh(), input({ selfName: '小宇', mode: 'together', companion: { name: '丹丹', avatarPackId: pixel } }));
  assert.deepEqual(getCompanionProfile(next)!.avatar, { packId: pixel, source: 'user' });
  assert.deepEqual(getSelfProfile(next)!.avatar, { packId: DEFAULT_AVATAR_PACK_ID, source: 'default' });
});

test('名称校验：Unicode / emoji 安全，纯空白与超长被拒绝', () => {
  for (const name of ['小宇', 'Alex', '🌙', '👨‍👩‍👧', '丹 丹', 'Zoë', '山田太郎']) {
    assert.equal(setupNameProblem(name), '', name);
    assert.equal(normalizeSetupName(name), name.trim());
  }
  assert.match(setupNameProblem('   '), /请填写/);
  assert.match(setupNameProblem(''), /请填写/);
  assert.match(setupNameProblem('\u200b\u200b'), /可见字符/);
  assert.match(setupNameProblem('两\n行'), /控制字符/);
  assert.match(setupNameProblem('x'.repeat(41)), /最多 40/);
  assert.equal(setupNameProblem('x'.repeat(40)), '');
  assert.match(setupNameProblem(undefined), /请填写/);
  rejects(() => normalizeSetupName('   ', 'TA 的称呼'), /TA 的称呼/);
  // emoji 不会被代理对切坏：派生代号仍然是完整的第一个字素。
  const emojiState = complete(fresh(), input({ selfName: '👨‍👩‍👧', mode: 'solo' }));
  assert.equal(profileAlias(getSelfProfile(emojiState)!, 0), '👨‍👩‍👧');
});

test('显示代号：跟随新名字重新派生，用户自己设置过的代号不被覆盖', () => {
  // 启动归一化会把派生代号写进 shortAlias（migrateLive 的 ??=），
  // 因此改名字时"系统填的"代号必须跟着走，否则 Dock / 状态行会一直显示旧代号。
  const auto = fresh();
  auto.profiles[0].shortAlias = '我';
  const renamed = complete(auto, input({ selfName: '小宇', mode: 'solo' }));
  assert.equal(getSelfProfile(renamed)!.shortAlias, undefined);
  assert.equal(profileAlias(getSelfProfile(renamed)!, 0), '宇');
  // 用户显式设置的代号（历史 Y / D）属于用户数据：改名也不动它。
  const explicit = fresh();
  explicit.profiles[0].shortAlias = 'D';
  const kept = complete(explicit, input({ selfName: '小宇', mode: 'solo' }));
  assert.equal(profileAlias(getSelfProfile(kept)!, 0), 'D');
});

test('已经有陪伴对象的工作区：不能借首次设置删除或重建 TA（5B2 边界）', () => {
  const legacy = togetherWorkspace(NOW);
  legacy.settings.setup = false;
  const companionId = getCompanionProfile(legacy)!.id;
  rejects(() => complete(legacy, input({ selfName: '小宇', mode: 'solo' })), /已经有陪伴对象/);
  rejects(() => complete(legacy, input({ selfName: '小宇', mode: 'together', companion: { name: '丹丹' } })), /已经有陪伴对象/);
  const next = complete(legacy, input({ selfName: '小宇', mode: 'together' }));
  assert.equal(next.settings.setup, true);
  assert.equal(next.profiles.length, 2);
  assert.equal(getCompanionProfile(next)!.id, companionId, '既有 companion 原样保留');
  assert.equal(getSelfProfile(next)!.name, '小宇');
  assert.deepEqual(academicOf(getSelfProfile(next)!), academicOf(legacy.profiles[0]), '既有学期 / 课程范围不被 onboarding 改写');
  assert.equal(next.settings.petSubjectRole, 'companion', '既有 Together 的桌宠主体保持同行者');
});

test('不用桌宠（Solo）：完成 setup 只写身份，petEnabled=false 且不需要形象 / 主体 / 作息', () => {
  const next = complete(fresh(), input({ selfName: '小宇', mode: 'solo', petEnabled: false }));
  assert.equal(next.settings.setup, true);
  assert.equal(next.settings.petEnabled, false, '用户没有选择桌宠');
  assert.equal(next.settings.petSubjectRole, 'self', '主体留一个合法默认值，但不代表桌宠启用');
  const self = getSelfProfile(next)!;
  assert.deepEqual(self.avatar, { packId: DEFAULT_AVATAR_PACK_ID, source: 'default' }, '没选形象就是合法内部默认');
  assert.equal(self.routine?.rules.length, 0, '不 seed 作息');
  assert.equal(next.profiles.length, 1);
  // 核心能力照常：状态由引擎给出，投影仍然完整（桌宠窗口不显示而已）。
  assert.equal(getCurrentState(next, self.id, NOW).kind, 'idle');
  assert.equal(snapshot(next, NOW).people.length, 1);
  assert.equal(resolvePetInstance(next).subjectId, self.id, '主体解析仍然合法（只是不会被显示）');
});

test('不用桌宠（Together）：创建 companion 但不启用桌宠，也不写入形象选择', () => {
  const next = complete(fresh(), input({
    selfName: '小宇', mode: 'together', petEnabled: false, petSubjectRole: 'companion',
    companion: { name: '丹丹', avatarPackId: otherPack() },
  }));
  assert.equal(next.settings.petEnabled, false);
  assert.equal(next.settings.petSubjectRole, 'companion', '主体偏好保留，重新打开桌宠就恢复');
  const self = getSelfProfile(next)!, companion = getCompanionProfile(next)!;
  assert.equal(next.profiles.length, 2);
  assert.deepEqual([self.avatar, companion.avatar], [
    { packId: DEFAULT_AVATAR_PACK_ID, source: 'default' },
    { packId: DEFAULT_AVATAR_PACK_ID, source: 'default' },
  ], '关闭桌宠时形象选择不是用户输入，保持合法默认');
  assert.equal(snapshot(next, NOW).people.length, 2, '两个人的状态照常投影');
  assert.ok(next.profiles.every(profile => (profile.routine?.rules || []).length === 0), '不 seed 任何作息');
});
