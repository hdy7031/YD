// Phase 5B1 · 桌宠主体（Pet Subject）的领域契约。
//
// 三层必须彻底解耦：
//   ① Person      —— 这个人是谁（Profile.role）
//   ② Avatar      —— 这个人用什么形象（profile.avatar.packId）
//   ③ Pet Subject —— 桌面桌宠代表谁（settings.petSubjectRole）
//
// 桌宠 = resolvePetSubject → Person → (CurrentState + Avatar) → PetInstance。
// PetInstance 不持久化：主体或状态一变，下一个投影立刻是新结果，不需要重启。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, createCompanionProfile, createFreshState, epoch } from '../src/core.ts';
import { listAvatarPacks } from '../src/avatar.ts';
import { getCompanionProfile, getSelfProfile, petSubjectRoleOf, resolvePetSubject } from '../src/people.ts';
import { resolvePetInstance } from '../src/pet-instance.ts';
import { snapshot } from '../src/live.ts';
import { getCurrentState } from '../src/state/engine.ts';
import type { RoutineProfile, RoutineRule } from '../src/routine.ts';
import type { Profile, State } from '../src/types.ts';

// 北京时间 2027-05-03（周一）15:10 —— 两个人的作息在同一分钟给出不同状态。
const NOW = epoch('2027-05-03T15:10');

const rule = (over: Partial<RoutineRule> & { id: string }): RoutineRule =>
  ({ kind: 'nap', label: '午睡', start: '15:00', end: '15:30', days: [1, 2, 3, 4, 5, 6, 7], enabled: true, priority: 10, ...over });
const routineOf = (...rules: RoutineRule[]): RoutineProfile => ({ source: 'user', updatedAt: 1, rules });
const withRoutine = (state: State, role: 'self' | 'companion', routine: RoutineProfile): State =>
  ({ ...state, profiles: state.profiles.map(profile => (profile.role === role ? { ...profile, routine } : profile)) });

/** Solo：只有本人。pref 省略 = 字段缺失（等价于未迁移的旧库 / 老构造）。 */
function solo(pref?: 'self' | 'companion'): State {
  const state = createFreshState(NOW);
  if (pref) state.settings.petSubjectRole = pref;
  return state;
}

/** Together：本人 + 同行者，可分别指定形象与主体偏好。 */
function together(options: { pref?: 'self' | 'companion'; selfAvatar?: string; companionAvatar?: string; reverse?: boolean } = {}): State {
  const state = createFreshState(NOW);
  const self = state.profiles[0];
  const companion: Profile = { ...createCompanionProfile(NOW, self), name: '丹丹' };
  if (options.selfAvatar) self.avatar = { packId: options.selfAvatar, source: 'user' };
  if (options.companionAvatar) companion.avatar = { packId: options.companionAvatar, source: 'user' };
  state.profiles = options.reverse ? [companion, self] : [self, companion];
  if (options.pref) state.settings.petSubjectRole = options.pref;
  // 这份工作区表达"升级前就已经在用桌宠的用户"：迁移后 petEnabled=true。
  state.settings.petEnabled = true;
  return state;
}

test('Solo：主体恒为本人，偏好里的 companion 也不会改变结果', () => {
  for (const pref of [undefined, 'self', 'companion'] as const) {
    const state = solo(pref);
    const subject = resolvePetSubject(state);
    assert.equal(subject.id, getSelfProfile(state)!.id, `pref=${String(pref)}`);
    assert.equal(subject.role, 'self');
    assert.equal(resolvePetInstance(state).subjectId, getSelfProfile(state)!.id);
  }
});

test('Together：偏好 self → 本人，pref companion → 同行者', () => {
  const self = together({ pref: 'self' });
  assert.equal(resolvePetSubject(self).id, getSelfProfile(self)!.id);
  assert.equal(petSubjectRoleOf(self), 'self');
  const companion = together({ pref: 'companion' });
  assert.equal(resolvePetSubject(companion).id, getCompanionProfile(companion)!.id);
  assert.equal(petSubjectRoleOf(companion), 'companion');
});

test('Together：偏好 companion 但同行者缺失 → 安全回落到本人，不抛错', () => {
  // 损坏 / legacy 数据：偏好指向一个不存在的 Person 时，桌宠不能崩，也不能空白。
  const broken = solo('companion');
  assert.equal(getCompanionProfile(broken), undefined);
  assert.equal(resolvePetSubject(broken).id, getSelfProfile(broken)!.id);
  assert.equal(resolvePetInstance(broken).subjectId, getSelfProfile(broken)!.id);
});

test('未迁移的旧数据（没有 petSubjectRole）沿用旧行为：有一个同行者就代表同行者', () => {
  const legacyTogether = together();
  delete (legacyTogether.settings as { petSubjectRole?: unknown }).petSubjectRole;
  assert.equal(petSubjectRoleOf(legacyTogether), 'companion');
  assert.equal(resolvePetSubject(legacyTogether).id, getCompanionProfile(legacyTogether)!.id);
  const legacySolo = solo();
  delete (legacySolo.settings as { petSubjectRole?: unknown }).petSubjectRole;
  assert.equal(petSubjectRoleOf(legacySolo), 'self');
  assert.equal(resolvePetSubject(legacySolo).id, getSelfProfile(legacySolo)!.id);
});

test('主体解析只看 role，不看数组顺序（同行者排在前面也一样）', () => {
  const state = together({ pref: 'companion', reverse: true });
  assert.equal(state.profiles[0].role, 'companion', '同行者确实排在 profiles[0]');
  assert.equal(resolvePetSubject(state).id, getCompanionProfile(state)!.id);
  assert.equal(resolvePetSubject(apply(state, { type: 'settings', petSubjectRole: 'self' }, NOW)).id, getSelfProfile(state)!.id);
});

test('PetInstance：主体 → Person → Person.avatar（两边形象各自独立）', () => {
  const packs = listAvatarPacks();
  assert.ok(packs.length >= 2, 'Avatar 列表来自 Registry');
  const [packA, packB] = packs;
  const state = together({ pref: 'self', selfAvatar: packA.id, companionAvatar: packB.id });
  const self = getSelfProfile(state)!, companion = getCompanionProfile(state)!;
  assert.deepEqual(resolvePetInstance(state), { subjectId: self.id, avatarPackId: packA.id }, '主体=本人 → 本人的形象');
  const switched = apply(state, { type: 'settings', petSubjectRole: 'companion' }, NOW);
  assert.deepEqual(resolvePetInstance(switched), { subjectId: companion.id, avatarPackId: packB.id }, '主体=同行者 → 同行者的形象');
  // 没有独立的 petAvatarPackId：形象永远跟着人走，切换主体不会产生第二份映射。
  assert.deepEqual(getSelfProfile(switched)!.avatar, self.avatar);
  assert.deepEqual(getCompanionProfile(switched)!.avatar, companion.avatar);
});

test('PetInstance：主体没有可用 Pack 时回落到官方默认形象（不崩、不空白）', () => {
  const state = together({ pref: 'self' });
  state.profiles[0].avatar = { packId: '' as never, source: 'default' };
  const instance = resolvePetInstance(state);
  assert.equal(instance.subjectId, getSelfProfile(state)!.id);
  assert.ok(instance.avatarPackId, '始终给出一个可加载的 Pack');
});

test('运行时热切换：改主体立刻换人、换形象、换姿态，且两个人的 CurrentState 都不变', () => {
  const packs = listAvatarPacks();
  const selfPack = packs[1].id, companionPack = packs[0].id;
  let state = together({ pref: 'self', selfAvatar: selfPack, companionAvatar: companionPack });
  // 同一分钟两个人的作息不同：本人午睡，同行者吃午饭。
  state = withRoutine(state, 'self', routineOf(rule({ id: 'self-nap', kind: 'nap', label: '午睡' })));
  state = withRoutine(state, 'companion', routineOf(rule({ id: 'companion-meal', kind: 'meal', label: '午饭' })));
  const self = getSelfProfile(state)!, companion = getCompanionProfile(state)!;
  const selfState = () => getCurrentState(state, self.id, NOW);
  const companionState = () => getCurrentState(state, companion.id, NOW);
  assert.deepEqual([selfState().kind, companionState().kind], ['nap', 'meal'], '两个人的状态本来就不一样');

  const before = snapshot(state, NOW);
  assert.deepEqual(before.petInstance, { subjectId: self.id, avatarPackId: selfPack }, 'Together 选择本人');
  assert.equal(before.display.state, 'nap', '桌宠用本人的姿态');

  // 不需要重启：一条 settings 命令之后，同一份 State 的下一个投影直接换人换形象。
  state = apply(state, { type: 'settings', petSubjectRole: 'companion' }, NOW);
  const after = snapshot(state, NOW);
  assert.deepEqual(after.petInstance, { subjectId: companion.id, avatarPackId: companionPack }, 'Together 选择 TA');
  assert.equal(after.display.state, 'eating', '桌宠改用同行者的姿态');
  assert.deepEqual([selfState().kind, companionState().kind], ['nap', 'meal'], '切换主体不修改任何人的 CurrentState');

  // 快速来回切换：每一步都是纯投影，没有旧结果残留。
  for (const [pref, expected] of [['self', 'nap'], ['companion', 'eating'], ['self', 'nap']] as const) {
    state = apply(state, { type: 'settings', petSubjectRole: pref }, NOW);
    const live = snapshot(state, NOW);
    assert.equal(live.petInstance.subjectId, pref === 'self' ? self.id : companion.id);
    assert.equal(live.display.state, expected);
  }
  assert.deepEqual([selfState().kind, companionState().kind], ['nap', 'meal']);
});

test('主体只影响桌宠消费，不影响任何业务集合与状态来源', () => {
  const state = together({ pref: 'self' });
  const switched = apply(state, { type: 'settings', petSubjectRole: 'companion' }, NOW);
  for (const key of ['profiles', 'courses', 'events', 'tasks', 'notices', 'reminders', 'manualOverrides'] as const) {
    assert.deepEqual(switched[key], state[key], `${key} 逐字段不变`);
  }
  assert.deepEqual(switched.profiles.map(profile => profile.routine), state.profiles.map(profile => profile.routine), '作息仍按人独立保存');
  assert.equal(switched.settings.setup, state.settings.setup);
});

test('桌宠开关：关掉只隐藏呈现，不删除任何档案 / 形象 / 作息，重新打开完整恢复', () => {
  const packs = listAvatarPacks();
  let state = together({ pref: 'companion', selfAvatar: packs[0].id, companionAvatar: packs[1].id });
  state = withRoutine(state, 'companion', routineOf(rule({ id: 'meal', kind: 'meal', label: '午饭', start: '12:00', end: '13:00' })));
  assert.equal(state.settings.petEnabled, true, '种子工作区（旧用户）默认启用桌宠');
  const before = structuredClone(state);
  const beforeInstance = resolvePetInstance(state);

  const off = apply(state, { type: 'settings', petEnabled: false }, NOW);
  assert.equal(off.settings.petEnabled, false);
  // 关掉桌宠不改变任何 Person / Avatar / Routine / CurrentState。
  assert.deepEqual(off.profiles, before.profiles, '档案逐字段不变（含形象与作息）');
  assert.equal(off.settings.petSubjectRole, before.settings.petSubjectRole, '主体偏好保留');
  assert.deepEqual(resolvePetInstance(off), beforeInstance, '主体与形象的解析结果不变，只是不再显示窗口');
  for (const key of ['courses', 'events', 'tasks', 'notices', 'reminders', 'manualOverrides'] as const) assert.deepEqual(off[key], before[key], key);
  assert.deepEqual(getCurrentState(off, getCompanionProfile(off)!.id, NOW), getCurrentState(before, getCompanionProfile(before)!.id, NOW), 'CurrentState 仍由状态引擎决定');

  const back = apply(off, { type: 'settings', petEnabled: true }, NOW);
  assert.equal(back.settings.petEnabled, true);
  assert.deepEqual(resolvePetInstance(back), beforeInstance, '重新打开恢复同一个主体与形象');
  assert.deepEqual(back.profiles, before.profiles);

  // 快速来回切换：只是布尔偏好，不产生任何持久化副作用。
  let toggled = off;
  for (const value of [true, false, true]) toggled = apply(toggled, { type: 'settings', petEnabled: value }, NOW);
  assert.equal(toggled.settings.petEnabled, true);
  assert.deepEqual(toggled.profiles, before.profiles);
});

test('桌宠开关的非法值被拒绝', () => {
  const state = solo('self');
  assert.throws(() => apply(state, { type: 'settings', petEnabled: 'yes' as never }, NOW), /设置无效/);
});
