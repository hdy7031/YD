// v0.3 Phase 1C：Solo UI / Pet compatibility 的领域与视图模型测试。
//
// 真实 DOM（导航、悬浮球、mini、tip、menu、tray）由
// runtime-audit-solo.cjs 在隔离的 Electron 环境里验收；这里覆盖它们消费的数据。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, epoch } from '../src/core.ts';
import { resolvePetState } from '../src/companion-display.ts';
import { personStatus, snapshot } from '../src/live.ts';
import { getCompanionProfile, getSelfProfile, resolvePetSubject } from '../src/people.ts';
import { personOptions, profileLabelFor, shellTabs, tabShortcuts } from '../src/ui/shell.ts';
import { syntheticState } from './fixtures/synthetic.ts';
import { soloClassTime, soloPersonId, v3SoloSynthetic } from './fixtures/v3-solo-synthetic.ts';

const solo = () => v3SoloSynthetic();
const together = () => syntheticState(epoch('2027-02-22T00:00'));

test('Solo 导航：只有本人页，没有同行者页，也没有空白的 Ta 页', () => {
  const state = solo(), tabs = shellTabs(state);
  assert.deepEqual(tabs.map(tab => tab.key), ['today', 'courses', 'tasks', 'inbox', 'reminders', 'settings']);
  assert.equal(tabs.some(tab => tab.kind === 'person'), false);
  assert.equal(tabs.some(tab => /Ta|TA|对方/.test(tab.label)), false);
  assert.equal(tabs[0].label, '我的安排');
  assert.deepEqual(tabShortcuts(tabs), { '1': 'today', '2': 'courses', '3': 'tasks', '4': 'inbox', '5': 'reminders' });
});

test('Together 导航保持旧结构，同行者页用档案名称', () => {
  const state = together(), tabs = shellTabs(state);
  assert.deepEqual(tabs.map(tab => tab.key), ['today', 'partner', 'courses', 'tasks', 'inbox', 'reminders', 'settings']);
  assert.deepEqual(tabs.map(tab => tab.kind), ['today', 'person', 'courses', 'tasks', 'inbox', 'reminders', 'settings']);
  assert.equal(tabs[1].label, `${getCompanionProfile(state)!.name}的课表`);
  assert.equal(tabs[1].personId, 'partner');
  assert.deepEqual(tabShortcuts(tabs), { '1': 'today', '2': 'partner', '3': 'courses', '4': 'tasks', '5': 'inbox' });
});

test('课表归属选项与文案全部来自实际档案', () => {
  assert.deepEqual(personOptions(solo()), [{ value: soloPersonId, label: '我的课表' }]);
  assert.deepEqual(personOptions(together()).map(option => option.label), ['我的课表', 'Sam的课表']);
  assert.equal(profileLabelFor(together(), 'partner'), 'Sam的课表');
  assert.equal(profileLabelFor(together(), 'me'), '我的课表');
  assert.equal(profileLabelFor(solo(), soloPersonId), '我的课表');
  assert.equal(profileLabelFor(together(), undefined), '未选择');
});

test('Solo 快照与状态投影：1 条状态、无幽灵同行者、代号非空', () => {
  const state = solo(), live = snapshot(state, soloClassTime);
  assert.equal(live.people.length, 1);
  assert.equal(live.subject, soloPersonId);
  assert.deepEqual(live.people.map(status => status.person), [soloPersonId]);
  assert.equal(live.people[0].role, 'self');
  assert.equal(live.people[0].name, 'Alex');
  assert.equal(live.people[0].alias, 'A');
  assert.equal(live.people[0].code, 'BUSY_CLASS');
  assert.ok(live.people.every(status => typeof status.alias === 'string' && status.alias.length > 0));
  // 询问不存在的同行者：返回不可用状态，不抛错、不产生 phantom。
  assert.equal(personStatus(state, soloClassTime, 'partner').code, 'UNKNOWN');
  assert.equal(personStatus(state, soloClassTime, 'partner').role, 'self');
});

test('Solo 桌宠主体=本人：姿态跟随本人业务状态', () => {
  const state = solo();
  assert.equal(getCompanionProfile(state), undefined);
  assert.equal(resolvePetSubject(state).id, soloPersonId);
  assert.equal(getSelfProfile(state)!.id, soloPersonId);
  assert.equal(snapshot(state, soloClassTime).display.state, 'busy_class', '第二节课 → 上课姿态');
  assert.equal(snapshot(state, epoch('2027-03-01T09:00')).display.state, 'busy_class', '第一节课 → 上课姿态');
  assert.equal(snapshot(state, epoch('2027-03-04T08:10')).display.state, 'busy_work', '教研时段 → 教研姿态');
  assert.equal(snapshot(state, epoch('2027-03-01T12:10')).display.state, 'idle', '无安排时回到空闲');
  // 主体之外的说明：没有任何人会被当成"另一个人的状态"。
  assert.equal(snapshot(state, soloClassTime).people.length, 1);
});

test('Together 桌宠主体仍是同行者，家庭忙碌与即将开始语义不变', () => {
  const state = together();
  assert.equal(resolvePetSubject(state).id, 'partner');
  const busy = epoch('2027-02-23T10:00');
  assert.equal(snapshot(state, busy).display.state, 'busy_class', '同行者上课 → 上课姿态');
  assert.equal(snapshot(state, epoch('2027-02-28T10:00')).display.state, 'idle');
  // 本人的会议让整个家显示忙碌（与 0.2.x 一致）。
  const withMeeting = apply(state, { type: 'save', entity: 'events', value: { id: 'solo-ui-meeting', title: '临时会议', start: '2027-02-28T10:00', end: '2027-02-28T11:00', place: '', notes: '', reminders: [], checklist: [] } }, epoch('2027-02-28T09:00'));
  assert.equal(snapshot(withMeeting, epoch('2027-02-28T10:20')).display.state, 'busy_work');
  assert.equal(withMeeting.events[0].person, 'me', '本人新建的会议归属本人');
  // 直接解析桌宠姿态时，主体显式传入；"在做什么"仍来自统一 StateEngine 的 CurrentState。
  const petBase = (subjectId: 'me' | 'partner') => resolvePetState({ people: snapshot(state, busy).people, subjectId, pending: 0, now: busy }).base;
  assert.equal(petBase('partner'), 'busy_class');
  // 同刻把主体换成本人：本人空闲，但另一位（同行者）正在上课 → 仍然是家庭忙碌。
  assert.equal(petBase('me'), 'busy_work');
});
