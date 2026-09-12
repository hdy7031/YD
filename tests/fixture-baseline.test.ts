// fixture 自身的一致性守卫（v0.3 Phase 0）。
//
// 1. 合成 fixture 必须是完全虚构的：不能出现私人课表的课程名、地点或人物；
// 2. 提交到仓库的 v020-synthetic.dayhub / .sqlite 必须与构造器一致，
//    否则 Phase 1 改了构造器而忘记重新生成时，迁移测试会用过期数据；
// 3. 正式测试与公共验收脚本不得再读取 ingest/（开发者私人运行数据）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { unpack } from '../src/backup.ts';
import { validateState } from '../src/core.ts';
import { v020Synthetic } from './fixtures/v020-synthetic.ts';
import { syntheticSchedule, syntheticScheduleFile } from './fixtures/synthetic.ts';
import { v3SoloSynthetic } from './fixtures/v3-solo-synthetic.ts';
import { getCompanionProfile } from '../src/people.ts';
import { DOMAIN_VERSION } from '../src/domain.ts';

const testsDir = fileURLToPath(new URL('./', import.meta.url));
const root = path.join(testsDir, '..');
const fixturesDir = path.join(testsDir, 'fixtures');
// fixture 是 JSON 落盘产物：用 JSON 形态比较，避免 validateState 里的 `??=`
// 为可选字段写入 undefined 造成假差异。
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

test('合成课表完全虚构：Alex / Sam、无真实课程名与地点', () => {
  const raw = fs.readFileSync(syntheticScheduleFile, 'utf8');
  for (const token of ['研究生', '语文', '高二', '高一', '信息楼', '大学物理', 'D109', 'D205', 'D103', 'D106', '她']) {
    assert.doesNotMatch(raw, new RegExp(token), `fixture 不应包含「${token}」`);
  }
  const schedule = syntheticSchedule();
  assert.deepEqual(schedule.profiles.map(p => p.name), ['Alex', 'Sam']);
  assert.deepEqual(schedule.profiles.map(p => p.id), ['me', 'partner'], 'legacy id 保留到 Phase 1 的 Person 迁移');
  assert.equal(schedule.profiles[1].tentative, true);
  assert.ok(schedule.courses.every(c => ['me', 'partner'].includes(c.person)));
  assert.deepEqual([...new Set(schedule.courses.map(c => c.title))].sort(), [
    'Academic English', 'Academic Writing', 'Class 1 Literature', 'Class 1 Seminar',
    'Class 2 Literature', 'Class 2 Seminar', 'Computer Vision', 'Data Structures',
    'Language Lab', 'Machine Learning', 'Reading Club', 'Research Seminar',
    'Staff Meeting', 'Teaching Practicum',
  ]);
});

test('提交的 v0.2 迁移 fixture 与构造器一致，并覆盖关键旧字段', async () => {
  const state = v020Synthetic();
  assert.doesNotThrow(() => validateState(structuredClone(state)));
  // 磁盘上的 fixture 是 JSON，`??=` 产生的 undefined 属性不会落盘，
  // 因此比较前先把内存状态规范化成同一形态。
  const normalized = JSON.parse(JSON.stringify(state));

  const packed = unpack(fs.readFileSync(path.join(fixturesDir, 'v020-synthetic.dayhub'), 'utf8'));
  assert.ok(sameJson(packed.state, normalized), 'dayhub fixture 过期：请运行 npm run fixtures:build');

  const SQL = await initSqlJs({ wasmBinary: Uint8Array.from(fs.readFileSync(path.join(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'))).buffer });
  const db = new SQL.Database(fs.readFileSync(path.join(fixturesDir, 'v020-synthetic.sqlite')));
  try {
    const body = JSON.parse(String(db.exec('SELECT body FROM app_state WHERE id = 1')[0].values[0][0]));
    assert.ok(sameJson(body, normalized), 'sqlite fixture 过期：请运行 npm run fixtures:build');
  } finally { db.close(); }

  // 迁移测试关心的旧结构都要在 fixture 里出现。
  assert.equal(state.profiles.length, 2);
  assert.equal(state.profiles[1].tentative, true);
  assert.ok(state.courses.some(c => c.person === 'partner'));
  assert.ok(state.courses.some(c => c.activity === 'research'));
  assert.ok(state.exceptions.length > 0);
  assert.ok(state.events.length > 0 && state.tasks.length > 0 && state.notices.length > 0);
  for (const status of ['scheduled', 'due', 'acknowledged']) assert.ok(state.reminders.some(r => r.status === status), status);
  assert.ok(state.reminders.every(r => Number.isFinite(r.due)));
  assert.equal(state.settings.setup, true);
  assert.ok(state.settings.pet && state.settings.orb);
  assert.ok(state.tasks[0].sourceId && state.notices.some(n => n.id === state.tasks[0].sourceId), '来源关联必须保留');
});

test('正式测试与公共验收脚本不再读取 ingest/ 私人数据', () => {
  const testFiles = fs.readdirSync(testsDir).filter(name => name.endsWith('.test.ts'));
  assert.ok(testFiles.length >= 8, '测试文件清单异常');
  // 本文件自身在注释与断言里提到该路径，跳过它。
  const self = 'fixture-baseline.test.ts';
  for (const name of testFiles) if (name !== self) assert.doesNotMatch(fs.readFileSync(path.join(testsDir, name), 'utf8'), /ingest\//, `tests/${name}`);
  const publicScripts = ['runtime-audit.cjs', 'ui-shots.cjs', 'ui-catalog.cjs', 'verify-v0216.cjs', 'scripts/visual-v021.cjs', 'scripts/visual-v0217.cjs', 'scripts/visual-v022.cjs'];
  for (const name of publicScripts) assert.doesNotMatch(fs.readFileSync(path.join(root, name), 'utf8'), /ingest\//, name);
});

test('提交的 Solo fixture 与构造器一致，且确实是 1 人工作区', async () => {
  const state = v3SoloSynthetic();
  const normalized = JSON.parse(JSON.stringify(state));
  const packed = unpack(fs.readFileSync(path.join(fixturesDir, 'v3-solo-synthetic.dayhub'), 'utf8'));
  assert.ok(sameJson(packed.state, normalized), 'solo dayhub fixture 过期：请运行 npm run fixtures:build');
  const SQL = await initSqlJs({ wasmBinary: Uint8Array.from(fs.readFileSync(path.join(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'))).buffer });
  const db = new SQL.Database(fs.readFileSync(path.join(fixturesDir, 'v3-solo-synthetic.sqlite')));
  try {
    const body = JSON.parse(String(db.exec('SELECT body FROM app_state WHERE id = 1')[0].values[0][0]));
    assert.ok(sameJson(body, normalized), 'solo sqlite fixture 过期：请运行 npm run fixtures:build');
  } finally { db.close(); }
  // 结构：只有本人、没有同行者，并且课程 / 会议 / 待办 / 提醒都有内容。
  assert.equal(state.profiles.length, 1);
  assert.equal(state.profiles[0].role, 'self');
  assert.equal(state.profiles[0].id, 'alex', 'Solo fixture 刻意使用自定义 id（不是 me）');
  assert.equal(getCompanionProfile(state), undefined);
  assert.equal(state.settings.domainVersion, DOMAIN_VERSION);
  assert.ok(state.courses.length > 0 && state.events.length > 0 && state.tasks.length > 0 && state.reminders.length > 0);
  assert.ok(state.events.every(event => event.person === 'alex'), '会议归属本人');
});
