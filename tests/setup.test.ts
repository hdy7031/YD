// Phase 5B1 · First-run onboarding 的领域契约。
//
// onboarding 本身是 UI，但"完成首次使用"必须是一条可测试的领域命令：
// 校验 draft、一次性写入、拒绝重复完成、绝不重新创建本人身份。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, createCompanionProfile, createFreshState, epoch } from '../src/core.ts';
import { completeSetup, needsSetup, normalizeSetupName, setupNameProblem, type SetupInput } from '../src/setup.ts';
import { getAvatarPack, listAvatarPacks, DEFAULT_AVATAR_PACK_ID } from '../src/avatar.ts';
import { getCompanionProfile, getSelfProfile, profileAlias, roleCounts } from '../src/people.ts';
import { resolvePetInstance } from '../src/pet-instance.ts';
import { DOMAIN_VERSION } from '../src/domain.ts';
import { getCurrentState } from '../src/state/engine.ts';
import { snapshot } from '../src/live.ts';
import { togetherWorkspace } from './helpers/workspaces.ts';
import type { State } from '../src/types.ts';

const NOW = epoch('2027-04-07T10:00');
const fresh = () => createFreshState(NOW);
const complete = (state: State, input: SetupInput, now = NOW) => apply(state, { type: 'completeSetup', value: input }, now);
const rejects = (run: () => unknown, pattern: RegExp) => {
  assert.throws(run, (error: unknown) => error instanceof Error && pattern.test(error.message));
};

test('Solo：完成首次使用只改身份，不重新创建本人 PersonId', () => {
  const state = fresh();
  const before = state.profiles[0];
  const next = complete(state, { selfName: '  小宇  ', mode: 'solo' });
  assert.equal(next.settings.setup, true);
  assert.equal(next.profiles.length, 1, 'Solo 不产生 companion');
  const self = getSelfProfile(next)!;
  assert.equal(self.id, before.id, '本人身份就是 5A 启动时生成的稳定 PersonId');
  assert.equal(self.name, '小宇', '名称前后空白被 trim');
  assert.equal(self.shortAlias, undefined, 'shortAlias 继续由显示规则派生，onboarding 不强迫用户填写');
  assert.equal(profileAlias(self, 0), '小');
  assert.deepEqual(self.avatar, { packId: DEFAULT_AVATAR_PACK_ID, source: 'default' }, '没动过的默认卡片不算用户选择');
  assert.deepEqual([next.courses, next.tasks, next.events, next.notices, next.reminders], [[], [], [], [], []], '完成 onboarding 不 seed 任何业务数据');
  assert.equal(self.routine?.rules.length, 0, '不 seed 作息');
  assert.equal(next.settings.domainVersion, DOMAIN_VERSION);
  assert.equal(DOMAIN_VERSION, 6, 'Phase 5B1 不升级 schema');
});

test('Solo：完成后 CurrentState 仍然由状态引擎决定（idle），桌宠代表本人', () => {
  const next = complete(fresh(), { selfName: '小宇', mode: 'solo' });
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

test('Together：只有明确选择双人才创建 companion，且数据完全通用', () => {
  const state = fresh(), selfId = state.profiles[0].id, startDate = state.profiles[0].startDate;
  const next = complete(state, { selfName: '小宇', mode: 'together', companion: { name: '  丹丹 ' } });
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
  assert.deepEqual(companion.periods, state.profiles[0].periods, '沿用中性学期占位，不继承课程');
  assert.equal(companion.startDate, startDate);
  assert.deepEqual(next.courses, []);
  assert.equal(resolvePetInstance(next).subjectId, companion.id, 'Together 完成后桌宠仍代表 TA');
  assert.equal(snapshot(next, NOW).people.length, 2);
});

test('shape：companion 来自领域工厂，字段集合与模板同源', () => {
  const state = fresh();
  const template = createCompanionProfile(NOW, state.profiles[0]);
  const next = complete(state, { selfName: '小宇', mode: 'together', companion: { name: '丹丹' } });
  const created = getCompanionProfile(next)!;
  // 除身份与名称外，字段集合必须与领域模板一致（同源，不复制字段清单）。
  assert.deepEqual(Object.keys(created).sort(), Object.keys(template).sort());
  const shape = (profile: typeof created) => ({ role: profile.role, weeks: profile.weeks, periods: profile.periods, startDate: profile.startDate, routine: profile.routine, avatar: profile.avatar });
  assert.deepEqual(shape(created), shape(template));
});

test('draft：Solo → Together → Solo 后完成，不产生 ghost companion', () => {
  const state = fresh();
  // UI 里的 draft 不会写 Store：这里只断言最终提交的语义。
  const next = complete(state, { selfName: '小宇', mode: 'solo' });
  assert.equal(next.profiles.length, 1);
  assert.equal(getCompanionProfile(next), undefined);
  assert.equal(next.settings.setup, true);
  assert.deepEqual(state.profiles.length, 1, '原始 state 不被就地改写');
});

test('失败不留痕：非法 draft 被拒绝时 State 完全不变（含 companion 半创建）', () => {
  const state = fresh();
  const before = structuredClone(state);
  rejects(() => complete(state, { selfName: '小宇', mode: 'together', companion: { name: '   ' } }), /请填写/);
  rejects(() => complete(state, { selfName: '  ', mode: 'together', companion: { name: '丹丹' } }), /请填写/);
  rejects(() => complete(state, { selfName: '小宇', mode: 'together', companion: { name: '丹丹', avatarPackId: 'yd-unknown' as never } }), /不可用/);
  rejects(() => complete(state, { selfName: '小宇', mode: 'solo', selfAvatarPackId: 'yd-unknown' as never }), /不可用/);
  rejects(() => complete(state, { selfName: '小宇', mode: 'pair' as never }), /使用方式/);
  assert.deepEqual(state, before, '被拒绝的完成命令不留下任何痕迹');
  assert.equal(state.settings.setup, false);
  assert.deepEqual(roleCounts(state.profiles), { self: 1, companion: 0 });
});

test('幂等边界：settings.setup=true 之后再次 completeSetup 一律拒绝且不改写 State', () => {
  const done = complete(fresh(), { selfName: '小宇', mode: 'solo' });
  const before = structuredClone(done);
  rejects(() => complete(done, { selfName: '别人', mode: 'together', companion: { name: '丹丹' } }), /已经完成/);
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
  const next = complete(fresh(), { selfName: '小宇', mode: 'together', selfAvatarPackId: pixel.id, companion: { name: '丹丹' } });
  assert.deepEqual(getSelfProfile(next)!.avatar, { packId: pixel.id, source: 'user' });
  assert.deepEqual(getCompanionProfile(next)!.avatar, { packId: DEFAULT_AVATAR_PACK_ID, source: 'default' });
  // 选择默认 Pack 本身也是合法选择：不变更即不写。
  const again = complete(fresh(), { selfName: '小宇', mode: 'solo', selfAvatarPackId: DEFAULT_AVATAR_PACK_ID });
  assert.deepEqual(getSelfProfile(again)!.avatar, { packId: DEFAULT_AVATAR_PACK_ID, source: 'default' });
  assert.ok(getAvatarPack(pixel.id));
});

test('Avatar：Together 下把 companion 换成另一个 Pack 也走同一套校验与来源语义', () => {
  const pixel = listAvatarPacks().find(pack => pack.id !== DEFAULT_AVATAR_PACK_ID)!;
  const next = complete(fresh(), { selfName: '小宇', mode: 'together', companion: { name: '丹丹', avatarPackId: pixel.id } });
  assert.deepEqual(getCompanionProfile(next)!.avatar, { packId: pixel.id, source: 'user' });
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
  const emojiState = complete(fresh(), { selfName: '👨‍👩‍👧', mode: 'solo' });
  assert.equal(profileAlias(getSelfProfile(emojiState)!, 0), '👨‍👩‍👧');
});

test('显示代号：跟随新名字重新派生，用户自己设置过的代号不被覆盖', () => {
  // 启动归一化会把派生代号写进 shortAlias（migrateLive 的 ??=），
  // 因此改名字时"系统填的"代号必须跟着走，否则 Dock / 状态行会一直显示旧代号。
  const auto = fresh();
  auto.profiles[0].shortAlias = '我';
  const renamed = complete(auto, { selfName: '小宇', mode: 'solo' });
  assert.equal(getSelfProfile(renamed)!.shortAlias, undefined);
  assert.equal(profileAlias(getSelfProfile(renamed)!, 0), '小');
  // 用户显式设置的代号（历史 Y / D）属于用户数据：改名也不动它。
  const explicit = fresh();
  explicit.profiles[0].shortAlias = 'D';
  const kept = complete(explicit, { selfName: '小宇', mode: 'solo' });
  assert.equal(profileAlias(getSelfProfile(kept)!, 0), 'D');
});

test('已经有陪伴对象的工作区：不能借首次设置删除或重建 TA（5B2 边界）', () => {
  const legacy = togetherWorkspace(NOW);
  legacy.settings.setup = false;
  const companionId = getCompanionProfile(legacy)!.id;
  rejects(() => complete(legacy, { selfName: '小宇', mode: 'solo' }), /已经有陪伴对象/);
  rejects(() => complete(legacy, { selfName: '小宇', mode: 'together', companion: { name: '丹丹' } }), /已经有陪伴对象/);
  const next = complete(legacy, { selfName: '小宇', mode: 'together' });
  assert.equal(next.settings.setup, true);
  assert.equal(next.profiles.length, 2);
  assert.equal(getCompanionProfile(next)!.id, companionId, '既有 companion 原样保留');
  assert.equal(getSelfProfile(next)!.name, '小宇');
  assert.equal(getSelfProfile(next)!.startDate, legacy.profiles[0].startDate, '既有校历 / 课程范围不被 onboarding 改写');
});
