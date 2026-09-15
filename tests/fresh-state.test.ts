// Fresh Install Contract（Phase 5A）：全新安装的语义必须是可测试的回归契约。
//
// 这里断言的是"一个从未用过 YD 的陌生用户第一次启动"时得到的状态：
// 默认 Solo、只有本人、没有任何私人默认值、没有假课程 / 假待办 / 私人作息。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCompanionProfile, createFreshState, epoch, validateState, apply } from '../src/core.ts';
import { getCurrentState } from '../src/state/engine.ts';
import { migrateLive, petDefaults, snapshot } from '../src/live.ts';
import { emptyRoutine, legacyDefaultRoutine } from '../src/routine.ts';
import { DOMAIN_VERSION } from '../src/domain.ts';
import { DEFAULT_AVATAR_PACK_ID } from '../src/avatar.ts';
import { LEGACY_COMPANION_ID, LEGACY_SELF_ID, profileAlias } from '../src/people.ts';

const now = epoch('2027-03-03T09:00');
// 私有默认哨兵：fresh state 与派生投影里都不允许出现（合成 fixture 的名字也不允许）。
const PRIVATE_SENTINELS = ['黄德宇', '喻丹', '研究生英语', '高二', '湖南大学', 'Users\\hdy', 'Alex', 'Sam', 'Computer Vision'];

test('fresh install：DOMAIN_VERSION=7、默认 Solo、只有一个 self、没有 companion', () => {
  const state = createFreshState(now);
  validateState(state);
  assert.equal(state.settings.domainVersion, DOMAIN_VERSION);
  assert.equal(DOMAIN_VERSION, 7, 'Phase 5B1 把 schema 升到 7（桌宠主体偏好）');
  assert.equal(state.settings.petSubjectRole, 'self', 'fresh install 是 Solo，桌宠主体直接是本人');
  assert.equal(state.settings.petEnabled, false, 'fresh install 不静默创建桌面悬浮物：桌宠要用户选择');
  assert.equal(state.profiles.length, 1, '全新安装只有一个人');
  const [self] = state.profiles;
  assert.equal(self.role, 'self');
  assert.equal(state.profiles.filter(profile => profile.role === 'companion').length, 0, '不创建假 companion');
  assert.ok(!state.profiles.some(profile => profile.id === LEGACY_COMPANION_ID));
});

test('fresh install：三个业务集合与临时状态全空，作息为空，Avatar 用官方默认 Pack', () => {
  const state = createFreshState(now);
  assert.deepEqual(state.courses, []);
  assert.deepEqual(state.exceptions, []);
  assert.deepEqual(state.events, []);
  assert.deepEqual(state.tasks, []);
  assert.deepEqual(state.notices, []);
  assert.deepEqual(state.reminders, []);
  assert.deepEqual(state.manualOverrides, []);
  assert.deepEqual(state.profiles[0].routine, { source: 'user', updatedAt: now, rules: [] }, '不继承任何私人作息');
  assert.deepEqual(state.profiles[0].avatar, { packId: DEFAULT_AVATAR_PACK_ID, source: 'default' });
  assert.equal(state.settings.setup, false, '校历尚未核对，由 onboarding 负责');
});

test('fresh install：PersonId 用正式生成器，不使用 legacy me / partner', () => {
  const first = createFreshState(now), second = createFreshState(now);
  for (const state of [first, second]) {
    const id = state.profiles[0].id;
    assert.notEqual(id, LEGACY_SELF_ID);
    assert.notEqual(id, LEGACY_COMPANION_ID);
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, '现代身份证号是 UUID');
  }
  assert.notEqual(first.profiles[0].id, second.profiles[0].id, '每次初始化都生成新的合法 PersonId');
});

test('fresh install：中性身份与中性校历占位（没有私人姓名 / 学校 / 真实开学日）', () => {
  const state = createFreshState(now);
  const self = state.profiles[0];
  assert.equal(self.name, '我', 'Phase 5B 之前用中性临时身份');
  assert.equal(self.shortAlias, undefined, '不把 Y / D 之类代号写进新用户档案');
  assert.equal(profileAlias(self, 0), '我', '显示代号从名称派生');
  // 校历占位：本周周一（2027-03-03 是周三 → 2027-03-01），与任何真实学校无关。
  assert.equal(self.startDate, '2027-03-01');
  assert.equal(new Date(self.startDate + 'T12:00:00Z').getUTCDay(), 1, '学期起始日必须是周一');
  const json = JSON.stringify(state);
  for (const sentinel of PRIVATE_SENTINELS) assert.ok(!json.includes(sentinel), `fresh state 不含私人/合成哨兵：${sentinel}`);
});

test('fresh state 直接通过 validateState，并且确定性字段可复现', () => {
  const a = createFreshState(now), b = createFreshState(now);
  validateState(a); validateState(b);
  assert.deepEqual(
    { startDate: a.profiles[0].startDate, weeks: a.profiles[0].weeks, periods: a.profiles[0].periods, updatedAt: a.profiles[0].updatedAt },
    { startDate: b.profiles[0].startDate, weeks: b.profiles[0].weeks, periods: b.profiles[0].periods, updatedAt: b.profiles[0].updatedAt }
  );
  assert.deepEqual({ ...a, profiles: [] }, { ...b, profiles: [] }, '除人以外的一切都由 now 决定');
});

test('fresh install：任何时刻都自然回落到 idle（不猜用户在睡觉 / 吃饭 / 上课）', () => {
  const state = createFreshState(now);
  // 12:30 与 23:30 是旧版"私人默认作息"的午睡与夜间睡眠窗口：新用户不该被塞进这些状态。
  for (const at of [epoch('2027-03-03T09:00'), epoch('2027-03-03T12:30'), epoch('2027-03-03T23:30'), epoch('2027-03-04T03:00')]) {
    const current = getCurrentState(state, state.profiles[0].id, at);
    assert.equal(current.kind, 'idle', new Date(at).toISOString());
    assert.equal(current.source, 'idle');
  }
  const live = snapshot(state, now);
  assert.equal(live.pending, 0);
  assert.equal(live.people.length, 1);
  assert.equal(live.people[0].current.kind, 'idle');
  assert.equal(live.display.state, 'idle', '桌宠显示层同样只是空闲，不需要 first-run 状态');
});

test('用户主动添加同行者时才出现第二个人，模板本身仍是中性的', () => {
  const state = createFreshState(now);
  const template = createCompanionProfile(now, state.profiles[0]);
  assert.equal(template.role, 'companion');
  assert.equal(template.name, 'TA');
  assert.equal(template.shortAlias, undefined);
  assert.deepEqual(template.routine, { source: 'user', updatedAt: now, rules: [] }, '不替同行者猜作息');
  assert.deepEqual(template.avatar, { packId: DEFAULT_AVATAR_PACK_ID, source: 'default' });
  assert.notEqual(template.id, state.profiles[0].id);
  const together = apply(state, { type: 'save', entity: 'profiles', value: template }, now);
  validateState(together);
  assert.equal(together.profiles.length, 2);
});

// §25 Existing-user regression：泛化只影响 fresh install，绝不"顺手修正"老用户数据。
test('现有 v6 用户的启动归一化逐字段保持：自定义名 / Y D / 作息 / 课表 / 待办 / Avatar / 临时状态', () => {
  const base = createFreshState(now);
  const self = base.profiles[0];
  const companion = createCompanionProfile(now, self);
  const course = {
    id: 'keep-course', person: companion.id, title: '既有课程', place: '教学楼', notes: '', activity: 'teaching' as const,
    weekday: 1, first: 1, last: 1, weeks: [1], reminders: [10], checklist: [], updatedAt: now, createdAt: now,
  };
  const task = { id: 'keep-task', title: '既有待办', notes: '', due: '', done: false, checklist: [], reminders: [], updatedAt: now, createdAt: now };
  const existing = {
    ...base,
    profiles: [
      { ...self, name: '自定义名字', shortAlias: 'Y', routine: legacyDefaultRoutine(now) },
      { ...companion, name: '同行者名字', shortAlias: 'D', routine: emptyRoutine(now) },
    ],
    courses: [course],
    tasks: [task],
    manualOverrides: [{ id: 'keep-manual', personId: self.id, kind: 'focus' as const, label: '写东西', startAt: now, endAt: now + 3600000, createdAt: now }],
    // 顶层字段：体积历史由 app 自己维护（老用户的库里已经有）。 
    bubbleHistory: [],
    settings: {
      domainVersion: DOMAIN_VERSION, launch: false, setup: true, trayResident: true, liveVersion: 5,
      pet: { ...petDefaults }, orb: { x: 1200, y: 700, w: 300, h: 64 },
    },
  };
  validateState(existing);
  const before = structuredClone(existing);
  const after = migrateLive(structuredClone(existing));
  assert.deepEqual(after, before, '启动归一化不得改写任何已有字段');
  // 泛化之后 Y / D 仍然是"用户存过的值"，显示代号的派生规则不会覆盖它。
  assert.deepEqual(after.profiles.map(profile => profile.shortAlias), ['Y', 'D']);
  assert.deepEqual(snapshot(after, now).people.map(status => status.alias), ['Y', 'D']);
  assert.equal(after.profiles[1].name, '同行者名字');
  assert.equal(after.courses[0].title, '既有课程');
  // 老用户的课表照常驱动 CurrentState（第一教学周周一第 1 节）。
  assert.equal(getCurrentState(after, companion.id, epoch('2027-03-01T08:10')).kind, 'class');
});
