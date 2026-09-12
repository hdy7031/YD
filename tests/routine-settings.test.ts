// v0.3 Phase 2C：可编辑的日常节奏（设置页的纯视图模型 + 写入链路）。
//
// 覆盖：CRUD（新增 / 修改 / 停用 / 删除）、Solo 与 Together 的按人隔离、
// UI 与领域双层校验、跨午夜保存与重载、备份往返、默认模板与空作息、
// 以及 legacy-default 提示在用户第一次修改后消失。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply, epoch, validateState } from '../src/core.ts';
import { pack, unpack } from '../src/backup.ts';
import { routineProfileMigrationV4 } from '../src/migration.ts';
import { resolvePetSubject } from '../src/people.ts';
import { assertRoutineProfile, createDefaultRoutine, emptyRoutine, legacyDefaultRoutine, type RoutineRule } from '../src/routine.ts';
import {
  routineDaysText, routineDraft, routineDraftError, routineForRules, routineIsEmpty, routineNeedsConfirmation,
  routinePersonLabel, routinePersonOptions, routineRuleFromDraft, routineRulesToggled, routineRulesWith,
  routineRulesWithout, routineWindowText,
} from '../src/ui/routine-settings.ts';
import type { State } from '../src/types.ts';
import { syntheticState } from './fixtures/synthetic.ts';
import { v3SoloSynthetic } from './fixtures/v3-solo-synthetic.ts';

const together = () => syntheticState(epoch('2027-02-22T00:00'));
const solo = () => routineProfileMigrationV4(structuredClone(v3SoloSynthetic()), 0);
const rule = (over: Partial<RoutineRule> & { id: string }): RoutineRule => ({
  kind: 'meal', label: '吃饭', start: '12:00', end: '12:30',
  days: [1, 2, 3, 4, 5, 6, 7], enabled: true, priority: 30, ...over,
});
// 与设置页完全相同的写入路径：Command → core apply → validate → Store。
const saveRules = (state: State, personId: string, rules: RoutineRule[], now = 1) =>
  apply(state, { type: 'save', entity: 'profiles', value: { ...state.profiles.find(profile => profile.id === personId)!, routine: routineForRules(rules, now) } }, now);

test('CRUD：新增 / 修改 / 停用 / 删除都只改规则数组，且写入来源变为用户', () => {
  const before = legacyDefaultRoutine(0);
  assert.equal(before.rules.length, 5);

  // 新增（设置页的"添加一条"）：草稿 → 规则 → 追加。
  const added = routineRuleFromDraft(routineDraft(), 'r-dinner');
  assert.equal(added.id, 'r-dinner');
  assert.equal(added.label, '午饭');
  assert.deepEqual(added.days, [1, 2, 3, 4, 5, 6, 7]);
  const withDinner = routineRulesWith(before.rules, { ...added, id: 'r-dinner', label: '晚饭', start: '18:00', end: '18:30' });
  assert.equal(withDinner.length, 6);
  assert.equal(withDinner.at(-1)?.label, '晚饭');

  // 修改：同 id 原位替换，顺序不变。
  const edited = routineRulesWith(withDinner, { ...withDinner[2], label: '午饭（食堂）', start: '11:40', end: '12:10' });
  assert.equal(edited.length, 6);
  assert.equal(edited[2].label, '午饭（食堂）');
  assert.equal(edited[2].start, '11:40');
  assert.deepEqual(edited.map(item => item.id), withDinner.map(item => item.id));

  // 停用：数据保留，只翻开关（以后可以恢复）。
  const disabled = routineRulesToggled(edited, 'legacy-nap', false);
  const nap = disabled.find(item => item.id === 'legacy-nap')!;
  assert.equal(nap.enabled, false);
  assert.deepEqual([nap.start, nap.end, nap.label], ['12:30', '14:00', '午睡']);
  assert.equal(routineRulesToggled(disabled, 'legacy-nap', true).find(item => item.id === 'legacy-nap')!.enabled, true);

  // 删除：真正移除。
  const removed = routineRulesWithout(disabled, 'legacy-afternoon-wake');
  assert.equal(removed.length, 5);
  assert.equal(removed.some(item => item.id === 'legacy-afternoon-wake'), false);

  // 写回档案：来源变用户、updatedAt 刷新、领域校验通过。
  const routine = routineForRules(removed, 1699999999999);
  assert.equal(routine.source, 'user');
  assert.equal(routine.updatedAt, 1699999999999);
  assert.doesNotThrow(() => assertRoutineProfile(routine));
});

test('UI 侧校验先拦下非法输入，领域层再兜底（两层都不写库）', () => {
  assert.equal(routineDraftError(routineDraft()), null);
  assert.match(routineDraftError({ ...routineDraft(), start: '11:30', end: '11:30' })!, /不能相同|次日/);
  assert.match(routineDraftError({ ...routineDraft(), start: '8:00' })!, /HH:mm/);
  assert.match(routineDraftError({ ...routineDraft(), end: '24:00' })!, /HH:mm/);
  assert.match(routineDraftError({ ...routineDraft(), days: [] })!, /至少选择一天/);
  assert.match(routineDraftError({ ...routineDraft(), label: '   ' })!, /名称/);
  // 领域层同样拒绝（即使有人绕过 UI 直接调用 Command）。
  const state = together();
  const invalid = rule({ id: 'bad', start: '12:00', end: '12:00' });
  assert.throws(() => saveRules(state, 'partner', [invalid]), /作息|时间无效/);
  assert.equal(state.profiles.find(profile => profile.id === 'partner')!.routine!.rules.length, 5, '失败的写入不会改动内存状态');
});

test('Together：本人与同行者各自编辑，互不串数据', () => {
  const state = together();
  assert.deepEqual(routinePersonOptions(state.profiles), [
    { id: 'me', label: '我的' },
    { id: 'partner', label: 'Sam' },
  ]);
  assert.equal(routinePersonLabel(state.profiles[0], 0), '我的');

  const beforeSelf = structuredClone(state.profiles.find(profile => profile.id === 'me')!.routine);
  const beforeCompanion = structuredClone(state.profiles.find(profile => profile.id === 'partner')!.routine);

  // 只改本人：同行者逐字段不变。
  const afterSelf = saveRules(state, 'me', [rule({ id: 'self-focus', kind: 'focus', label: '专注工作', start: '09:00', end: '11:00', days: [1, 2, 3, 4, 5] })]);
  assert.equal(afterSelf.profiles.find(profile => profile.id === 'me')!.routine!.rules.length, 1);
  assert.deepEqual(afterSelf.profiles.find(profile => profile.id === 'partner')!.routine, beforeCompanion);
  assert.equal(afterSelf.profiles.find(profile => profile.id === 'me')!.routine!.source, 'user');

  // 再只改同行者：本人保持上一步的结果。
  const afterCompanion = saveRules(afterSelf, 'partner', [rule({ id: 'companion-nap', kind: 'nap', label: '午睡', start: '13:30', end: '14:30' })]);
  assert.deepEqual(afterCompanion.profiles.find(profile => profile.id === 'me')!.routine, afterSelf.profiles.find(profile => profile.id === 'me')!.routine);
  assert.equal(afterCompanion.profiles.find(profile => profile.id === 'partner')!.routine!.rules[0].start, '13:30');
  assert.notDeepEqual(afterCompanion.profiles.find(profile => profile.id === 'partner')!.routine, beforeCompanion);
  assert.doesNotThrow(() => validateState(structuredClone(afterCompanion)));
});

test('Solo：只有本人可以编辑，桌宠主体就是本人', () => {
  const state = solo();
  assert.equal(state.profiles.length, 1);
  assert.deepEqual(routinePersonOptions(state.profiles), [{ id: 'alex', label: '我的' }]);
  assert.equal(resolvePetSubject(state).id, 'alex');
  assert.equal(state.profiles[0].routine!.source, 'legacy-default');

  const edited = saveRules(state, 'alex', [rule({ id: 'my-sleep', kind: 'sleep', label: '睡觉', start: '01:00', end: '09:00' })]);
  assert.equal(edited.profiles.length, 1);
  assert.equal(edited.profiles[0].routine!.rules.length, 1);
  assert.equal(edited.profiles[0].routine!.source, 'user');
  assert.ok(!routineNeedsConfirmation(edited.profiles[0].routine), '用户改过之后不再提示"旧默认作息未确认"');
  assert.doesNotThrow(() => validateState(structuredClone(edited)));
});

test('跨午夜：保存与重载后仍然是一条规则，并明确显示"次日"', () => {
  const state = together();
  const sleep = rule({ id: 'night', kind: 'sleep', label: '夜间睡觉', start: '23:30', end: '07:30', priority: 40 });
  assert.equal(routineWindowText(sleep), '23:30 → 次日 07:30');
  assert.equal(routineWindowText(rule({ id: 'lunch', start: '11:30', end: '12:00' })), '11:30 → 12:00');

  const saved = saveRules(state, 'partner', [sleep]);
  assert.equal(saved.profiles.find(profile => profile.id === 'partner')!.routine!.rules.length, 1, '跨午夜不拆成两条');
  // 落盘 → 重新读入（模拟重启）后语义不变。
  const reloaded = validateState(JSON.parse(JSON.stringify(saved)));
  const restored = reloaded.profiles.find(profile => profile.id === 'partner')!.routine!.rules[0];
  assert.deepEqual([restored.start, restored.end], ['23:30', '07:30']);
});

test('备份往返：Routine 完整保留', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayhub-routine-backup-'));
  try {
    const state = saveRules(together(), 'partner', [rule({ id: 'night', kind: 'sleep', label: '睡觉', start: '23:30', end: '07:30', days: [1, 2, 3, 4, 5] , priority: 40 })]);
    const restored = unpack(pack(state, dir));
    assert.deepEqual(restored.state.profiles.map(profile => profile.routine), state.profiles.map(profile => profile.routine));
    assert.doesNotThrow(() => validateState(structuredClone(restored.state)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('默认模板与空作息：模板来自统一 factory，描述文案与 legacy 提示一致', () => {
  const template = createDefaultRoutine(1);
  assert.equal(template.source, 'user', '用户主动选择默认作息后不再标记为 legacy');
  assert.deepEqual(template.rules, legacyDefaultRoutine(1).rules);
  // 两个 factory 各自返回独立对象。
  template.rules[0].days.push(1);
  assert.equal(legacyDefaultRoutine(1).rules[0].days.length, 7);

  assert.equal(routineIsEmpty(emptyRoutine(1)), true);
  assert.equal(routineIsEmpty(undefined), true);
  assert.equal(routineIsEmpty(createDefaultRoutine(1)), false);
  assert.equal(routineNeedsConfirmation(legacyDefaultRoutine(1)), true);
  assert.equal(routineNeedsConfirmation(createDefaultRoutine(1)), false);
  assert.equal(routineNeedsConfirmation(emptyRoutine(1)), false);

  assert.equal(routineDaysText([1, 2, 3, 4, 5, 6, 7]), '每天');
  assert.equal(routineDaysText([1, 2, 3, 4, 5]), '周一至周五');
  assert.equal(routineDaysText([6, 7]), '周末');
  assert.equal(routineDaysText([1, 3]), '周一、周三');
  assert.equal(routineDaysText([]), '未选择');
});
