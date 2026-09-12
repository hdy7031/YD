// v0.3 Phase 1A：身份基础（ProfileRole / PersonId / 唯一身份查询层 / 校验不变式）。
//
// 本轮不改变任何界面行为：这里只证明领域层第一次能合法表达 1—2 个档案，
// 且历史 id 'me' / 'partner' 仍然沿用同一条兼容路径。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, initial, validateState } from '../src/core.ts';
import { personStatus, profileAlias, snapshot } from '../src/live.ts';
import { companionId, effectiveRole, getCompanionProfile, getProfileById, getSelfProfile, personAlias, requireSelfProfile, roleCounts } from '../src/people.ts';
import { DOMAIN_VERSION, IDENTITY_DOMAIN_VERSION, identityRoleMigration, migrationSteps } from '../src/migration.ts';
import type { Course, PersonId, Profile, ProfileRole, State } from '../src/types.ts';
import { v020Synthetic } from './fixtures/v020-synthetic.ts';

const clone = <T>(value: T): T => structuredClone(value);
const profile = (id: PersonId, role?: ProfileRole, name = id): Profile => ({
  id, ...(role ? { role } : {}), name, startDate: '2027-03-01', weeks: 16,
  periods: [{ start: '08:00', end: '08:45' }], updatedAt: 0,
});
// domainVersion: v2 = 已迁移（要求显式 role）；省略 = v1 旧数据。
function stateWith(profiles: Profile[], options: { domainVersion?: number } = {}): State {
  const state = initial(0);
  state.profiles = profiles;
  if (options.domainVersion === undefined) delete state.settings.domainVersion;
  else state.settings.domainVersion = options.domainVersion;
  return state;
}
const course = (id: string, person: PersonId): Course => ({
  id, person, title: 'Computer Vision', place: 'Building A 301', notes: '', weekday: 1,
  first: 1, last: 1, weeks: [1], reminders: [], checklist: [], updatedAt: 0,
});
const accepts = (state: State) => assert.doesNotThrow(() => validateState(clone(state)));
const rejects = (state: State, pattern: RegExp) => assert.throws(() => validateState(clone(state)), pattern);

test('PersonId 放宽：任意合法编号与历史 id 都合法，非法编号仍然拒绝', () => {
  accepts(stateWith([profile('alex', 'self'), profile('sam', 'companion')], { domainVersion: 2 }));
  accepts(stateWith([profile('6f1a3c88-1f0e-4a5b-9f4c-7c2b2a9d51e0', 'self')], { domainVersion: 2 }));
  // 历史 id 保持合法（不重写旧数据库里的 id）。
  accepts(stateWith([profile('me'), profile('partner')]));
  rejects(stateWith([profile('有 空格', 'self')], { domainVersion: 2 }), /记录编号|编号无效/);
});

test('身份查询：role 优先、历史 id 兜底、数组位置只作为极端旧数据的最后手段', () => {
  // 数组顺序反转也必须解析正确：身份来自 role / id，而不是下标。
  const reversed = stateWith([profile('partner', 'companion'), profile('me', 'self')], { domainVersion: 2 });
  assert.equal(getSelfProfile(reversed)?.id, 'me');
  assert.equal(getCompanionProfile(reversed)?.id, 'partner');
  assert.equal(getProfileById(reversed, 'partner')?.id, 'partner');
  // 显式 role 优先于历史 id。
  const swapped = stateWith([profile('me', 'companion'), profile('partner', 'self')], { domainVersion: 2 });
  assert.equal(effectiveRole(swapped.profiles[0], 0), 'companion');
  assert.equal(getSelfProfile(swapped)?.id, 'partner');
  assert.equal(getCompanionProfile(swapped)?.id, 'me');
  // v1 旧数据没有 role：按历史 id 解析。
  const legacy = stateWith([profile('partner'), profile('me')]);
  assert.equal(getSelfProfile(legacy)?.id, 'me');
  assert.equal(getCompanionProfile(legacy)?.id, 'partner');
  // 既没有 role 也没有历史 id 的极端旧数据才退回数组位置。
  const unknown = stateWith([profile('a'), profile('b')]);
  assert.equal(getSelfProfile(unknown)?.id, 'a');
  assert.equal(getCompanionProfile(unknown)?.id, 'b');
  // 单人工作区：同行者是可选结果，不是错误。
  const solo = stateWith([profile('alex', 'self')], { domainVersion: 2 });
  assert.equal(getCompanionProfile(solo), undefined);
  assert.equal(companionId(solo), undefined);
  assert.equal(requireSelfProfile(solo).id, 'alex');
  assert.throws(() => requireSelfProfile(stateWith([])), /缺少本人档案/);
});

test('Validator 不变式：1—2 个档案、恰好一个 self、最多一个 companion', () => {
  accepts(stateWith([profile('alex', 'self')], { domainVersion: 2 }));
  accepts(stateWith([profile('alex', 'self'), profile('sam', 'companion')], { domainVersion: 2 }));
  rejects(stateWith([]), /1—2 个个人档案/);
  rejects(stateWith([profile('a', 'self'), profile('b', 'self')], { domainVersion: 2 }), /本人档案/);
  rejects(stateWith([profile('a', 'companion'), profile('b', 'companion')], { domainVersion: 2 }), /本人档案/);
  rejects(stateWith([profile('dup', 'self'), profile('dup', 'companion')], { domainVersion: 2 }), /记录编号重复/);
  rejects(stateWith([profile('a', 'self'), profile('b', 'companion'), profile('c', 'companion')], { domainVersion: 2 }), /1—2 个个人档案/);
  // v2 数据必须显式带角色；v1 旧数据仍按兼容顺序解析。
  rejects(stateWith([profile('alex')], { domainVersion: 2 }), /缺少角色/);
  accepts(stateWith([profile('me'), profile('partner')]));
  accepts(stateWith([profile('a')]));
  assert.deepEqual(roleCounts([profile('me'), profile('partner')]), { self: 1, companion: 1 });
});

test('课程仍然按 id 引用档案：自定义 id 可用，不存在的人被拒绝', () => {
  const solo = stateWith([profile('alex', 'self')], { domainVersion: 2 });
  solo.courses = [course('c-cv', 'alex')];
  accepts(solo);
  const broken = clone(solo);
  broken.courses[0].person = 'ghost';
  rejects(broken, /课表所属人/);
});

test('课表导入按工作区现有档案校验人员：自定义 id 可导入，未知 id 不会被写成越界槽位', () => {
  const workspace = stateWith([profile('alex', 'self')], { domainVersion: 2 });
  const base = { format: 'dayhub-schedule' as const, version: 1 as const, termName: 'Synthetic Term', courses: [] };
  const soloProfile = { id: 'alex', name: 'Alex', startDate: '2027-03-01', weeks: 16, periods: [{ start: '09:00', end: '09:45' }] };
  const imported = apply(workspace, { type: 'importSchedule', value: { ...base, profiles: [soloProfile] } }, 0);
  assert.equal(imported.profiles.length, 1);
  assert.equal(imported.profiles[0].id, 'alex');
  assert.equal(imported.profiles[0].role, 'self', '导入不应丢掉已有角色');
  assert.equal(imported.settings.setup, true);
  accepts(imported);
  // 未知 id：明确拒绝，且不会在数组上留下 -1 之类的越界槽位。
  assert.throws(() => apply(workspace, { type: 'importSchedule', value: { ...base, profiles: [{ ...soloProfile, id: 'ghost' }] } }, 0), /人员重复或无效/);
  assert.equal(Object.keys(workspace.profiles).some(key => !/^\d+$/.test(key)), false);
});

test('短代号默认值跟随角色：本人 D、同行者 Y，显式设置优先', () => {
  assert.equal(profileAlias(profile('alex', 'self')), 'D');
  assert.equal(profileAlias(profile('sam', 'companion')), 'Y');
  assert.equal(profileAlias(profile('me')), 'D');
  assert.equal(profileAlias(profile('partner')), 'Y');
  assert.equal(profileAlias({ ...profile('sam', 'companion'), shortAlias: 'S' }), 'S');
  const reversed = stateWith([profile('partner', 'companion'), profile('me', 'self')], { domainVersion: 2 });
  assert.equal(personAlias(reversed, 'me'), 'D');
  assert.equal(personAlias(reversed, 'partner'), 'Y');
  assert.equal(personAlias(reversed, 'ghost'), 'D');
});

// 投影按档案数量输出：单人一条、双人两条；顺序取 profiles 顺序，身份语义来自 role。
// 查询不存在的档案不再抛错（否则主进程的 live 快照会崩）。
test('状态投影按档案数量：单人一条、双人两条，缺失档案不抛错', () => {
  const solo = stateWith([profile('alex', 'self')], { domainVersion: 3 });
  const missing = personStatus(solo, 0, 'partner');
  assert.equal(missing.code, 'UNKNOWN');
  assert.deepEqual(missing.current, []);
  const soloLive = snapshot(solo, 0);
  assert.deepEqual(soloLive.people.map(p => p.person), ['alex'], '单人工作区不产生幽灵同行者');
  assert.deepEqual(soloLive.people.map(p => p.code), ['NO_SCHEDULE'], '存在但没有课表的档案是 NO_SCHEDULE，而不是 UNKNOWN');
  const together = stateWith([profile('partner', 'companion'), profile('me', 'self')], { domainVersion: 3 });
  assert.deepEqual(snapshot(together, 0).people.map(p => p.person), ['partner', 'me']);
});

test('迁移注册与领域版本一致：步骤连续、无重复、最后一步到达 DOMAIN_VERSION', () => {
  let expected = 1;
  for (const step of migrationSteps) {
    assert.equal(step.from, expected, `${step.id} 的起点必须接上上一版`);
    assert.ok(step.to > step.from, step.id);
    expected = step.to;
  }
  assert.equal(expected, DOMAIN_VERSION);
  assert.equal(IDENTITY_DOMAIN_VERSION, 2);
  assert.equal(new Set(migrationSteps.map(step => step.id)).size, migrationSteps.length);
});

test('identityRoleMigration 只补角色与 domainVersion，不碰业务数据', () => {
  const before = v020Synthetic();
  assert.ok(before.profiles.every(p => p.role === undefined));
  const after = identityRoleMigration(clone(before));
  assert.deepEqual(after.profiles.map(p => p.role), ['self', 'companion']);
  assert.deepEqual(after.profiles.map(p => p.id), before.profiles.map(p => p.id));
  assert.equal(after.settings.domainVersion, IDENTITY_DOMAIN_VERSION);
  for (const key of ['courses', 'exceptions', 'events', 'tasks', 'notices', 'reminders'] as const) assert.deepEqual(after[key], before[key], key);
  assert.deepEqual(after.settings.pet, before.settings.pet);
  assert.equal(after.settings.liveVersion, before.settings.liveVersion);
  assert.equal(after.lastTick, before.lastTick);
  accepts(after);
});
