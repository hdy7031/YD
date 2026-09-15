// Phase 5B2 · Profile 生命周期与可逆的 Solo / Together 切换。
//
// 两条必须被锁死的领域事实：
//   1) 模式切换 ≠ 删除人物：Together → Solo 只是"当前怎么用 YD"，companion 的
//      Profile / PersonId / 课表 / 作息 / Avatar / person-scoped 数据全部保留；
//      再次 Together 恢复的是**同一个**人，绝不新建第二个 companion。
//   2) 档案身份只有一个写入路径：PersonId 与 role 不可修改，只允许改 name / shortAlias。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, createCompanionProfile, createFreshState, epoch, validateState } from '../src/core.ts';
import { PROFILE_ALIAS_LIMIT, switchUsageMode, updateProfileIdentity } from '../src/profile-lifecycle.ts';
import { activeCompanionProfile, activeProfiles, getCompanionProfile, getSelfProfile, petSubjectRoleOf, profileAlias, resolvePetSubject, usageModeOf } from '../src/people.ts';
import { resolvePetInstance } from '../src/pet-instance.ts';
import { snapshot } from '../src/live.ts';
import { getCurrentState } from '../src/state/engine.ts';
import { listAvatarPacks } from '../src/avatar.ts';
import { emptyRoutine } from '../src/routine.ts';
import { personOptions, shellTabs } from '../src/ui/shell.ts';
import { togetherWorkspace } from './helpers/workspaces.ts';
import type { Command, Profile, State } from '../src/types.ts';

const NOW = epoch('2027-05-10T09:00');
const self = (state: State): Profile => getSelfProfile(state)!;
const companion = (state: State): Profile => getCompanionProfile(state)!;
const change = (state: State, command: Command, now = NOW): State => apply(state, command, now);
const rejects = (run: () => unknown, pattern: RegExp) => {
  assert.throws(run, (error: unknown) => error instanceof Error && pattern.test(error.message));
};

/** Solo 工作区：生产 fresh state（只有本人、没有 companion、没有任何业务数据）。 */
const solo = (now = NOW): State => createFreshState(now);

/**
 * Together 工作区 + 同行者的 person-scoped 数据（课表 / 作息 / Avatar / 临时状态）。
 * 所有写入都走正式命令，不直接改 State。
 */
function together(now = NOW): State {
  let state = change(solo(now), { type: 'usageMode', mode: 'together', companionName: 'Sam', petSubjectRole: 'companion' }, now);
  const sam = companion(state);
  const [packA, packB] = listAvatarPacks();
  state = change(state, { type: 'avatarSet', personId: sam.id, packId: packB.id }, now);
  state = change(state, { type: 'save', entity: 'profiles', value: { ...sam, routine: { source: 'user', updatedAt: now, rules: [{ id: 'sam-lunch', kind: 'meal', label: '午饭', start: '12:00', end: '13:00', days: [1, 2, 3, 4, 5], enabled: true, priority: 20 }] } } }, now);
  state = change(state, { type: 'save', entity: 'courses', value: { id: 'sam-course', person: sam.id, title: 'Sam 的课', place: 'B-201', notes: '', activity: 'teaching', weekday: 1, first: 1, last: 2, weeks: [1, 2, 3], reminders: [], checklist: [], updatedAt: now } }, now);
  state = change(state, { type: 'manual', kind: 'focus', label: '写论文', endAt: null }, now);
  assert.deepEqual(self(state).avatar, { packId: packA.id, source: 'default' }, '本人形象保持默认（没有被顺手改写）');
  return state;
}

// ---------------------------------------------------------------------------
// §36 数量约束
// ---------------------------------------------------------------------------
test('invariant：Solo 允许 0 或 1 个 companion，Together 必须恰好 1 个，最多 1 个', () => {
  // Solo + 1 self + 0 companion：合法（fresh install 的形态）。
  validateState(solo());
  // Together + 1 self + 1 companion：合法。
  validateState(change(solo(), { type: 'usageMode', mode: 'together', companionName: 'Sam' }, NOW));

  const retained = together();
  const backToSolo = change(retained, { type: 'usageMode', mode: 'solo' }, NOW);
  assert.equal(usageModeOf(backToSolo), 'solo');
  assert.equal(backToSolo.profiles.length, 2, 'Solo 下 companion 仍在（inactive）');
  validateState(backToSolo);

  // Together 却没有 companion：状态自相矛盾。
  const broken = structuredClone(solo());
  broken.settings.usageMode = 'together';
  rejects(() => validateState(broken), /双人模式/);

  // 多余的第二个人：档案数量上限与"恰好一个本人"一起把它挡住
  // （没有"添加第二个 companion"的旁路命令，因此这一层是最后的兜底）。
  const extra = structuredClone(retained);
  extra.profiles = [...extra.profiles, { ...companion(extra), id: 'second-companion', name: '第二个人' }];
  rejects(() => validateState(extra), /1—2 个个人档案/);
  const twoCompanions = { ...structuredClone(retained), profiles: [companion(retained), { ...companion(retained), id: 'second-companion' }] };
  rejects(() => validateState(twoCompanions), /只能有一个本人档案/);

  const badMode = structuredClone(solo());
  (badMode.settings as { usageMode?: unknown }).usageMode = 'pair';
  rejects(() => validateState(badMode), /使用方式设置无效/);
});

test('推导：没有 settings.usageMode 的旧数据按档案事实得到模式（有 companion → Together）', () => {
  const fresh = solo();
  assert.equal('usageMode' in fresh.settings, false, 'fresh install 不需要写这个字段');
  assert.equal(usageModeOf(fresh), 'solo');
  assert.deepEqual(activeProfiles(fresh).map(profile => profile.id), [fresh.profiles[0].id]);

  const legacyTogether = togetherWorkspace(NOW);
  assert.equal('usageMode' in legacyTogether.settings, false);
  assert.equal(usageModeOf(legacyTogether), 'together');
  assert.equal(activeProfiles(legacyTogether).length, 2);
});

// ---------------------------------------------------------------------------
// §37 可逆生命周期：切换前后逐字段相同
// ---------------------------------------------------------------------------
test('Together → Solo → Together：companion 的 PersonId / 档案 / 课表 / 作息 / Avatar 逐字段不变', () => {
  const togetherState = together();
  const before = structuredClone(companion(togetherState));
  const beforeCourses = structuredClone(togetherState.courses);
  const beforeOverrides = structuredClone(togetherState.manualOverrides);
  const samStateBefore = getCurrentState(togetherState, before.id, NOW);

  const soloState = change(togetherState, { type: 'usageMode', mode: 'solo' }, NOW);
  assert.equal(usageModeOf(soloState), 'solo', '切换后模式落盘');
  assert.deepEqual(companion(soloState), before, 'companion 档案逐字段不变');
  assert.deepEqual(soloState.courses, beforeCourses, '课表逐字段不变');
  assert.deepEqual(soloState.manualOverrides, beforeOverrides, '临时状态不被模式切换清理');
  assert.equal(companion(soloState).id, before.id);
  assert.equal(companion(soloState).name, before.name);
  assert.equal(companion(soloState).shortAlias, before.shortAlias);
  assert.deepEqual(companion(soloState).avatar, before.avatar);
  assert.deepEqual(companion(soloState).routine, before.routine);
  assert.deepEqual(getCurrentState(soloState, before.id, NOW), samStateBefore, 'CurrentState 架构与结果不变（只是不再投影到界面）');

  const back = change(soloState, { type: 'usageMode', mode: 'together' }, NOW);
  assert.equal(usageModeOf(back), 'together');
  assert.equal(back.profiles.length, 2, '恢复的是原人物，没有第二个 companion');
  assert.deepEqual(companion(back), before, '恢复后逐字段相同（不是"值差不多"）');
  assert.deepEqual(back.courses, beforeCourses);
  assert.deepEqual(back.manualOverrides, beforeOverrides);
});

test('Solo → Together：反复切换 10 次也不产生重复人物，且 switchToSolo 幂等', () => {
  let state = together();
  const ids = state.profiles.map(profile => profile.id).sort();
  for (let i = 0; i < 10; i++) {
    state = change(state, { type: 'usageMode', mode: 'solo' }, NOW);
    state = change(state, { type: 'usageMode', mode: 'together' }, NOW);
  }
  assert.equal(state.profiles.length, 2, `10 次往返后仍然只有两个人：${state.profiles.map(profile => profile.name).join(' / ')}`);
  assert.deepEqual(state.profiles.map(profile => profile.id).sort(), ids);
  // 幂等：已经 Solo 时再来一次不报错、不改写任何状态。
  const alreadySolo = change(state, { type: 'usageMode', mode: 'solo' }, NOW);
  const again = change(alreadySolo, { type: 'usageMode', mode: 'solo' }, NOW);
  assert.deepEqual(again, alreadySolo);
  // 有 retained companion 时不允许再"创建"第二个人。
  rejects(() => change(alreadySolo, { type: 'usageMode', mode: 'together', companionName: '别人' }, NOW), /已经有陪伴对象/);
  rejects(() => change(alreadySolo, { type: 'usageMode', mode: 'pair' as never }, NOW), /请选择使用方式/);
});

// ---------------------------------------------------------------------------
// §38 第一次 Together：新 companion 必须是通用默认
// ---------------------------------------------------------------------------
test('第一次进入双人模式：新 companion 用现代 UUID、空作息 / 空课表、默认形象', () => {
  const state = change(solo(), { type: 'usageMode', mode: 'together', companionName: '  阿丁  ' }, NOW);
  validateState(state);
  const selfProfile = self(state), created = companion(state);
  assert.equal(state.profiles.length, 2);
  assert.match(created.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'commercial UUID');
  assert.notEqual(created.id, selfProfile.id);
  assert.equal(created.role, 'companion');
  assert.equal(created.name, '阿丁', '称呼前后空白被 trim');
  assert.deepEqual(created.routine, { source: 'user', updatedAt: NOW, rules: [] }, '不复制本人的作息');
  assert.deepEqual(created.avatar, { packId: 'yd-default', source: 'default' }, '先用默认形象，之后由 Picker 改');
  assert.deepEqual(state.courses, [], '不复制本人的课表');
  assert.equal(created.startDate, selfProfile.startDate, '沿用中性学期占位，不发明第二个学期');
  assert.equal(usageModeOf(state), 'together');
  assert.equal(state.settings.petSubjectRole, 'companion', '第一次 Together 的桌宠默认表示 TA');
  // 缺名字 / 非法名字都被拒绝，且不留下半个 companion。
  const untouched = solo();
  const before = structuredClone(untouched);
  rejects(() => change(untouched, { type: 'usageMode', mode: 'together', companionName: '   ' }, NOW), /请填写/);
  rejects(() => change(untouched, { type: 'usageMode', mode: 'together', companionName: 'x'.repeat(41) }, NOW), /最多 40/);
  assert.deepEqual(untouched, before, '被拒绝的命令不改写 State');
  assert.equal(getCompanionProfile(untouched), undefined);
});

test('Together：关闭桌宠时进入双人模式不偷偷打开桌宠，主体偏好仍取默认', () => {
  let state = solo();
  state = change(state, { type: 'settings', petEnabled: false }, NOW);
  assert.equal(state.settings.petEnabled, false);
  state = change(state, { type: 'usageMode', mode: 'together', companionName: 'Sam' }, NOW);
  assert.equal(state.settings.petEnabled, false, '模式切换不打开桌宠');
  assert.equal(state.profiles.length, 2);
  assert.equal(state.settings.petSubjectRole, 'companion', '偏好可以先保存，重新打开桌宠时生效');
});

// ---------------------------------------------------------------------------
// §40 档案编辑
// ---------------------------------------------------------------------------
test('档案编辑：name / shortAlias 可改可清空，PersonId 与 role 不可改', () => {
  let state = together();
  const selfId = self(state).id, companionId = companion(state).id;
  const selfBefore = structuredClone(self(state)), companionBefore = structuredClone(companion(state));

  state = change(state, { type: 'profileIdentity', personId: selfId, name: '  小宇  ', shortAlias: '宇' }, NOW + 1000);
  assert.equal(self(state).name, '小宇');
  assert.equal(self(state).shortAlias, '宇');
  assert.equal(self(state).id, selfId, 'PersonId 不变');
  assert.equal(self(state).role, 'self', 'role 不变');
  assert.deepEqual(self(state).avatar, selfBefore.avatar);
  assert.deepEqual(self(state).routine, selfBefore.routine);
  assert.deepEqual(self(state).periods, selfBefore.periods);
  assert.equal(self(state).updatedAt, NOW + 1000, '真的改了才刷新 updatedAt');

  // 改成 emoji / 中文混排的名称：Unicode 字素不会被切开。
  state = change(state, { type: 'profileIdentity', personId: companionId, name: '👨‍👩‍👧 家', shortAlias: undefined }, NOW + 2000);
  assert.equal(companion(state).name, '👨‍👩‍👧 家');
  assert.equal(companion(state).shortAlias, companionBefore.shortAlias, 'undefined = 不改动');
  assert.equal(profileAlias(companion(state), 1), '👨‍👩‍👧', '没有显式代号时按名称首字素派生');

  // 清空短代号 → 回到派生规则（不写死一个新的值）。
  state = change(state, { type: 'profileIdentity', personId: companionId, name: '👨‍👩‍👧 家', shortAlias: '' }, NOW + 3000);
  assert.equal(companion(state).shortAlias, undefined, '清空后字段消失');
  assert.equal(profileAlias(companion(state), 1), '👨‍👩‍👧', '显示代号重新按名称派生');
  state = change(state, { type: 'profileIdentity', personId: companionId, name: '丹丹', shortAlias: null }, NOW + 4000);
  assert.equal(profileAlias(companion(state), 1), '丹');

  // 改名不会偷偷覆盖用户自己设置的短代号。
  state = change(state, { type: 'profileIdentity', personId: selfId, name: '另一个名字', shortAlias: undefined }, NOW + 5000);
  assert.equal(self(state).shortAlias, '宇', '改名不覆盖已存在的短代号');
  assert.equal(companion(state).id, companionId);
});

test('档案编辑：空白 / 超长 / 非法短代号被拒绝，且不改写 State', () => {
  const state = together();
  const before = structuredClone(state);
  rejects(() => change(state, { type: 'profileIdentity', personId: self(state).id, name: '   ' }, NOW), /请填写/);
  rejects(() => change(state, { type: 'profileIdentity', personId: self(state).id, name: 'x'.repeat(41) }, NOW), /最多 40/);
  rejects(() => change(state, { type: 'profileIdentity', personId: self(state).id, name: '小宇', shortAlias: 'x'.repeat(PROFILE_ALIAS_LIMIT + 1) }, NOW), /短代号最多/);
  rejects(() => change(state, { type: 'profileIdentity', personId: self(state).id, name: '小宇', shortAlias: '两\n行' }, NOW), /控制字符/);
  rejects(() => change(state, { type: 'profileIdentity', personId: 'not-a-person', name: '小宇' }, NOW), /档案不存在/);
  assert.deepEqual(state, before, '被拒绝的编辑不留下痕迹');
  // 没有变化时不制造无意义的更新。
  const same = change(state, { type: 'profileIdentity', personId: self(state).id, name: self(state).name, shortAlias: self(state).shortAlias }, NOW + 9000);
  assert.equal(self(same).updatedAt, self(state).updatedAt);
});

test('档案编辑：Solo 下保留的 companion 仍然可以改名（数据没丢）', () => {
  let state = change(together(), { type: 'usageMode', mode: 'solo' }, NOW);
  const companionId = companion(state).id;
  state = updateIdentityInPlace(state, companionId, '小丹');
  assert.equal(companion(state).name, '小丹');
  assert.equal(usageModeOf(state), 'solo', '编辑保留档案不会把它重新激活');
  assert.equal(activeCompanionProfile(state), undefined);
  const back = change(state, { type: 'usageMode', mode: 'together' }, NOW);
  assert.equal(companion(back).name, '小丹');
  assert.equal(companion(back).id, companionId);
});
function updateIdentityInPlace(state: State, personId: string, name: string): State {
  updateProfileIdentity(state, { personId, name }, NOW);
  validateState(state);
  return state;
}

// ---------------------------------------------------------------------------
// §41 / §42 桌宠偏好与开关
// ---------------------------------------------------------------------------
test('桌宠主体：Solo 下存储偏好保留、运行时恒为本人；恢复 Together 后回到原偏好', () => {
  const togetherState = together();
  assert.equal(petSubjectRoleOf(togetherState), 'companion');
  assert.equal(resolvePetInstance(togetherState).subjectId, companion(togetherState).id);
  const companionPack = companion(togetherState).avatar!.packId;

  const soloState = change(togetherState, { type: 'usageMode', mode: 'solo' }, NOW);
  assert.equal(soloState.settings.petSubjectRole, 'companion', '存储偏好不被改写');
  assert.equal(petSubjectRoleOf(soloState), 'companion', '偏好本身仍然是用户的 Together 选择');
  assert.equal(resolvePetSubject(soloState).id, self(soloState).id, 'Solo 下运行时主体恒为本人');
  assert.deepEqual(resolvePetInstance(soloState), { subjectId: self(soloState).id, avatarPackId: self(soloState).avatar!.packId }, 'Solo 用本人的形象，不用 TA 的');
  assert.notEqual(resolvePetInstance(soloState).avatarPackId, companionPack);

  const back = change(soloState, { type: 'usageMode', mode: 'together' }, NOW);
  assert.equal(resolvePetSubject(back).id, companion(back).id, '恢复 Together 后原偏好立即生效（无需重启）');
  assert.equal(resolvePetInstance(back).avatarPackId, companionPack);
  assert.equal(back.settings.petSubjectRole, 'companion');
});

test('桌宠开关：模式切换不改写 petEnabled（关着的不会偷偷打开，开着的不受影响）', () => {
  const off = change(together(), { type: 'settings', petEnabled: false }, NOW);
  const offSolo = change(off, { type: 'usageMode', mode: 'solo' }, NOW);
  const offAgain = change(offSolo, { type: 'usageMode', mode: 'together' }, NOW);
  assert.deepEqual([off.settings.petEnabled, offSolo.settings.petEnabled, offAgain.settings.petEnabled], [false, false, false]);
  const on = change(together(), { type: 'settings', petEnabled: true }, NOW);
  assert.deepEqual([change(on, { type: 'usageMode', mode: 'solo' }, NOW).settings.petEnabled, on.settings.petEnabled], [true, true]);
});

// ---------------------------------------------------------------------------
// §24 / §25 / §43 活跃人物投影（导航 / 首页 / Dock / 桌宠共用）
// ---------------------------------------------------------------------------
test('活跃人物：Solo 下保留的 companion 不投影进 live / 导航 / 人员选项', () => {
  const togetherState = together();
  const soloState = change(togetherState, { type: 'usageMode', mode: 'solo' }, NOW);
  const samId = companion(soloState).id;

  assert.deepEqual(snapshot(soloState, NOW).people.map(status => status.person), [self(soloState).id], 'Solo：live.people 只有本人');
  assert.equal(snapshot(togetherState, NOW).people.length, 2, 'Together：仍然是两条');
  assert.deepEqual(shellTabs(soloState).map(tab => tab.key), ['today', 'courses', 'tasks', 'inbox', 'reminders', 'settings']);
  assert.equal(shellTabs(soloState).some(tab => tab.personId === samId), false, '导航里没有 TA 的安排');
  assert.deepEqual(personOptions(soloState).map(option => option.label), ['我的安排'], '课表归属也不会出现被停用的人');
  assert.deepEqual(shellTabs(togetherState).map(tab => tab.key)[1], samId, '恢复 Together 后 TA 的安排立刻回来');
  assert.deepEqual(personOptions(togetherState).map(option => option.label), ['我的安排', 'Sam的安排']);
});
