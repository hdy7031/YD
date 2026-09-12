// v0.3 Phase 0：迁移安全基线的回归测试。
//
// 覆盖：不需要迁移时不写盘、迁移前的 before-v030 备份、迁移失败还原字节、
// 还原时保留失败产物、缺少步骤时中止、以及"回滚不能依赖旧版读新库"的设计约束。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { Store } from '../src/store.ts';
import { validateState } from '../src/core.ts';
import { unpack } from '../src/backup.ts';
import { getCompanionProfile, getSelfProfile } from '../src/people.ts';
import { legacyDefaultRoutine } from '../src/routine.ts';
import { DOMAIN_VERSION, IDENTITY_DOMAIN_VERSION, MANUAL_STATUS_DOMAIN_VERSION, PERSON_AWARE_DOMAIN_VERSION, ROUTINE_DOMAIN_VERSION, createMigrationBackup, domainVersion, migrationStamp, migrationSteps, manualStatusMigrationV5, personAwareMigrationV3, restoreMigrationBackup, routineProfileMigrationV4, runMigrations, type MigrationStep } from '../src/migration.ts';
import type { State } from '../src/types.ts';
import { v020Now, v020Synthetic } from './fixtures/v020-synthetic.ts';
import { v2LegacySynthetic } from './fixtures/v2-legacy-synthetic.ts';
import { v3TogetherSynthetic } from './fixtures/v3-together-synthetic.ts';
import { soloPersonId, v3SoloSynthetic } from './fixtures/v3-solo-synthetic.ts';

const digest = (bytes: Uint8Array | Buffer) => createHash('sha256').update(bytes).digest('hex');
const fileDigest = (file: string) => digest(fs.readFileSync(file));
const omit = (value: object, keys: string[]) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

// 与 store.test.ts 相同：使用 Node 自带 SQLite 引擎作为 Store 的适配器。
function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayhub-migration-'));
  const dbDir = path.join(dir, 'adapter');
  fs.mkdirSync(dbDir);
  const open = (bytes?: Uint8Array) => {
    const file = path.join(dbDir, crypto.randomUUID() + '.sqlite');
    if (bytes) fs.writeFileSync(file, bytes);
    const db = new DatabaseSync(file);
    return {
      run(sql: string, params: unknown[] = []) { db.prepare(sql).run(...params as any[]); },
      exec(sql: string) { const rows = db.prepare(sql).all(); return rows.length ? [{ columns: Object.keys(rows[0]), values: rows.map(Object.values) }] : []; },
      export() { return fs.readFileSync(file); },
      close() { db.close(); fs.unlinkSync(file); },
    };
  };
  return { dir, open, backups: path.join(dir, 'backups') };
}

async function seeded(state: State = v020Synthetic()) {
  const space = workspace();
  const store = new Store(space.dir, space.open, v020Now);
  await store.update(() => state);
  return { ...space, store, state: store.snapshot(), bytes: fs.readFileSync(store.file) };
}

const upgradeStep = (patch: (state: State) => State, id = 'test-domain'): MigrationStep => ({ from: 1, to: 2, id, migrate: patch });
const setDomainVersion = (state: State, value: number): State => ({ ...state, settings: { ...state.settings, ...(value === 1 ? {} : { domainVersion: value }) } });

test('目标版本等于当前版本时不写任何备份，也不改动数据库', async () => {
  const { dir, store, backups, bytes } = await seeded();
  try {
    const current = domainVersion(store.snapshot());
    const run = await runMigrations(store, { target: current, version: domainVersion, steps: migrationSteps, backupDirectory: backups, attachments: dir, now: v020Now });
    assert.deepEqual(run, { migrated: false, from: current, to: current, steps: [] });
    assert.equal(fs.existsSync(backups), false, '无迁移时不应创建备份目录');
    assert.equal(fileDigest(store.file), digest(bytes), '数据库字节不应改变');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('迁移成功：先写 before-v030 备份，再原子升级，备份可被现有恢复流程读取', async () => {
  const { dir, store, backups, bytes, state } = await seeded();
  try {
    // 直接使用真实注册的迁移步骤：闸门的意义就是跑真实迁移。
    // 这里只升到 v2，单独验证身份步骤。
    const run = await runMigrations(store, {
      target: IDENTITY_DOMAIN_VERSION, version: domainVersion, steps: migrationSteps, backupDirectory: backups, attachments: dir, now: v020Now,
    });
    assert.equal(run.migrated, true);
    assert.deepEqual(run.steps, ['identity-roles']);
    assert.ok(run.backup, '应返回备份信息');
    const backup = run.backup!;
    for (const file of [backup.dayhub, backup.sqlite, backup.receipt]) assert.ok(fs.existsSync(file), `${file} 应存在`);
    assert.match(path.basename(backup.dayhub), new RegExp(`^before-v030-${migrationStamp(v020Now).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.dayhub$`));
    // .sqlite 是迁移前的原始字节；.dayhub 与产品备份同格式，可解包且状态等于迁移前。
    assert.equal(fileDigest(backup.sqlite), digest(bytes));
    assert.equal(backup.sha256, digest(bytes));
    const restored = unpack(fs.readFileSync(backup.dayhub, 'utf8'));
    assert.deepEqual(restored.state, state);
    assert.doesNotThrow(() => validateState(restored.state));
    // 迁移后的数据：领域版本变了，业务记录没有增减。
    const after = store.snapshot();
    assert.equal(domainVersion(after), IDENTITY_DOMAIN_VERSION);
    for (const key of ['courses', 'exceptions', 'events', 'tasks', 'notices', 'reminders'] as const) assert.equal(after[key].length, state[key].length, key);
    // 回执记录版本与集合数量，便于验收"没有静默丢失"。
    const receipt = JSON.parse(fs.readFileSync(backup.receipt, 'utf8'));
    assert.equal(receipt.kind, 'dayhub-migration-backup');
    assert.equal(receipt.fromDomainVersion, 1);
    assert.equal(receipt.targetDomainVersion, 2);
    assert.equal(receipt.counts.courses, state.courses.length);
    assert.equal(receipt.counts.reminders, state.reminders.length);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('迁移抛错：还原迁移前的数据库字节、保留备份，并给出可读错误', async () => {
  const { dir, store, backups, bytes, state } = await seeded();
  try {
    const boom = upgradeStep(() => { throw new Error('migration exploded'); }, 'boom');
    await assert.rejects(
      () => runMigrations(store, { target: 2, version: domainVersion, steps: [boom], backupDirectory: backups, attachments: dir, now: v020Now }),
      /已恢复迁移前的数据库/,
    );
    assert.equal(fileDigest(store.file), digest(bytes), '迁移失败后数据库必须与迁移前逐字节一致');
    assert.deepEqual(store.snapshot(), state, '迁移失败后内存视图回到迁移前');
    const files = fs.readdirSync(backups);
    assert.ok(files.some(name => name.startsWith('before-v030-') && name.endsWith('.dayhub')), '备份必须保留');
    assert.ok(files.some(name => name.startsWith('before-v030-') && name.endsWith('.sqlite')), '原始数据库字节必须保留');
    // 还原之后仍然可以正常保存，不需要用户重做录入。
    await store.update(current => { current.settings.setup = true; return current; });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('迁移产出非法身份（同一工作区两个 self）时同样还原，不留中间版本', async () => {
  const { dir, store, backups, bytes } = await seeded();
  try {
    // 把两个档案都标成 self：v2 不变式要求恰好一个本人，因此一定在 Store.update 内失败。
    const twoSelf = upgradeStep(s => ({ ...s, profiles: s.profiles.map(profile => ({ ...profile, role: 'self' as const })) }), 'two-self');
    await assert.rejects(
      () => runMigrations(store, { target: 2, version: domainVersion, steps: [twoSelf], backupDirectory: backups, attachments: dir, now: v020Now }),
      /已恢复迁移前的数据库/,
    );
    assert.equal(fileDigest(store.file), digest(bytes));
    assert.equal(store.snapshot().profiles.length, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('还原会保留失败的迁移结果用于诊断，同时把数据库写回备份字节', async () => {
  const { dir, store, backups, bytes } = await seeded();
  try {
    const run = await runMigrations(store, {
      target: DOMAIN_VERSION, version: domainVersion, steps: migrationSteps, backupDirectory: backups, attachments: dir, now: v020Now,
    });
    const backup = run.backup!;
    assert.notEqual(fileDigest(store.file), digest(bytes), '迁移后字节应已变化');
    restoreMigrationBackup(backup, store.file);
    assert.equal(fileDigest(store.file), digest(bytes), '还原后必须等于备份字节');
    const failed = backup.sqlite.replace(/\.sqlite$/, '.failed.sqlite');
    assert.ok(fs.existsSync(failed), '失败的迁移结果应被另存用于诊断');
    assert.equal(domainVersion(store.snapshot()), 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('缺少中间迁移步骤时中止，且不产生任何备份或写入', async () => {
  const { dir, store, backups, bytes } = await seeded();
  try {
    const far = upgradeStep(s => setDomainVersion(s, 3), 'v2-to-v3');
    far.from = 2; far.to = 3;
    await assert.rejects(
      () => runMigrations(store, { target: 3, version: domainVersion, steps: [far], backupDirectory: backups, attachments: dir, now: v020Now }),
      /缺少从 v1 到 v2/,
    );
    assert.equal(fs.existsSync(backups), false);
    assert.equal(fileDigest(store.file), digest(bytes));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// 设计约束（v0.3 决议）：回滚 = 恢复迁移前的数据库字节，
// 不是"让旧版本直接读已经进入 v0.3 语义的数据库"。
// Phase 1A 之后 1 人工作区本身是合法的，所以这条约束改为用可观测事实表达：
// 备份文件必须保持 v1 形态（没有 role / domainVersion），旧版才能读回；
// 迁移后的数据库才带 v2 语义，要回到旧版只能还原文件。
test('回滚路径是字节还原：备份保持 v1 形态，不依赖旧版读新数据', async () => {
  const { dir, store, backups, bytes } = await seeded();
  try {
    const backup = createMigrationBackup({ directory: backups, attachments: dir, state: store.snapshot(), storeFile: store.file, version: 1, target: 2, now: v020Now });
    const restored = unpack(fs.readFileSync(backup.dayhub, 'utf8'));
    assert.ok(restored.state.profiles.every(profile => profile.role === undefined), '备份不应包含 v2 的 role');
    assert.equal(restored.state.settings.domainVersion, undefined, '备份不应包含 v2 的 domainVersion');
    assert.doesNotThrow(() => validateState(restored.state), '备份文件必须能被旧版校验通过');
    // 迁移后的数据库带 v2 语义；回滚只能靠还原字节。
    await runMigrations(store, { target: DOMAIN_VERSION, version: domainVersion, steps: migrationSteps, backupDirectory: backups, attachments: dir, now: v020Now });
    const migrated = store.snapshot();
    assert.equal(domainVersion(migrated), DOMAIN_VERSION);
    assert.ok(migrated.profiles.every(profile => profile.role !== undefined));
    restoreMigrationBackup(backup, store.file);
    assert.equal(fileDigest(store.file), digest(bytes), '还原后必须逐字节等于迁移前');
    assert.equal(domainVersion(store.snapshot()), 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('身份 / 归属 / 作息 / 手动状态迁移 v1 → v5：补角色、会议归属、作息与空手动状态，保 id、保业务数据、生成备份', async () => {
  const { dir, store, backups } = await seeded();
  try {
    const before = store.snapshot();
    assert.equal(domainVersion(before), 1);
    assert.ok(before.profiles.every(profile => profile.role === undefined));
    const run = await runMigrations(store, { target: DOMAIN_VERSION, version: domainVersion, steps: migrationSteps, backupDirectory: backups, attachments: dir, now: v020Now });
    assert.equal(run.migrated, true);
    assert.deepEqual(run.steps, ['identity-roles', 'person-aware', 'routine-profile', 'manual-status']);
    for (const file of [run.backup!.dayhub, run.backup!.sqlite, run.backup!.receipt]) assert.ok(fs.existsSync(file), file);
    const receipt = JSON.parse(fs.readFileSync(run.backup!.receipt, 'utf8'));
    assert.equal(receipt.fromDomainVersion, 1);
    assert.equal(receipt.targetDomainVersion, DOMAIN_VERSION);
    assert.equal(receipt.counts.courses, before.courses.length);

    const after = store.snapshot();
    // 身份：legacy id 不变，角色按 self / companion 补齐。
    assert.deepEqual(after.profiles.map(p => p.id), before.profiles.map(p => p.id));
    assert.deepEqual(after.profiles.map(p => p.role), ['self', 'companion']);
    assert.ok(after.profiles.every(p => p.role !== undefined));
    // 档案上的其它字段逐字段保持（只有 role 与 routine 是新增的）。
    after.profiles.forEach((profile, index) => {
      const { role, routine, ...rest } = profile;
      assert.ok(role, `profile ${index} 应带上角色`);
      assert.ok(routine, `profile ${index} 应带上作息`);
      assert.deepEqual(rest, before.profiles[index]);
    });
    // 会议：唯一的变化是补上归属，其余字段逐字段保持。
    assert.equal(after.events.length, before.events.length);
    after.events.forEach((event, index) => {
      const { person, ...rest } = event;
      assert.equal(person, after.profiles[0].id, '旧会议必须归工作区本人');
      assert.deepEqual(rest, before.events[index]);
    });
    // 其它集合数量与内容都不变；课程仍然引用原来的 person id。
    for (const key of ['courses', 'exceptions', 'tasks', 'notices', 'reminders'] as const) assert.deepEqual(after[key], before[key], key);
    // 临时状态：旧数据没有这一层，迁移只补一个空数组。
    assert.deepEqual(after.manualOverrides, [], '旧数据不应凭空出现手动状态');
    assert.deepEqual([...new Set(after.courses.map(c => c.person))].sort(), ['me', 'partner']);
    // 设置：只多了 domainVersion。
    for (const key of Object.keys(before.settings) as (keyof typeof after.settings)[]) assert.deepEqual(after.settings[key], before.settings[key], key);
    assert.equal(after.settings.domainVersion, DOMAIN_VERSION);
    assert.equal(after.version, 1);
    assert.equal(after.lastTick, before.lastTick);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('身份迁移幂等：已是 v2 的状态不再写备份', async () => {
  const { dir, store, backups } = await seeded();
  try {
    await runMigrations(store, { target: DOMAIN_VERSION, version: domainVersion, steps: migrationSteps, backupDirectory: backups, attachments: dir, now: v020Now });
    const first = fs.readdirSync(backups).filter(name => name.startsWith('before-v030'));
    const again = await runMigrations(store, { target: DOMAIN_VERSION, version: domainVersion, steps: migrationSteps, backupDirectory: backups, attachments: dir, now: v020Now + 1000 });
    assert.equal(again.migrated, false);
    assert.deepEqual(fs.readdirSync(backups).filter(name => name.startsWith('before-v030')), first, '第二次运行不应产生新备份');
    const settled = store.snapshot();
    assert.deepEqual(settled.profiles.map(p => p.role), ['self', 'companion']);
    assert.equal(domainVersion(settled), DOMAIN_VERSION);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('迁移失败仍然回滚：后续版本的步骤抛错时数据库回到迁移前', async () => {
  const { dir, store, backups, bytes, state } = await seeded();
  try {
    const boom: MigrationStep = { from: DOMAIN_VERSION, to: DOMAIN_VERSION + 1, id: 'phase-later', migrate() { throw new Error('later step exploded'); } };
    await assert.rejects(
      () => runMigrations(store, { target: DOMAIN_VERSION + 1, version: domainVersion, steps: [...migrationSteps, boom], backupDirectory: backups, attachments: dir, now: v020Now }),
      /已恢复迁移前的数据库/,
    );
    assert.equal(fileDigest(store.file), digest(bytes), '回滚必须逐字节等于迁移前');
    assert.deepEqual(store.snapshot(), state);
    assert.ok(fs.readdirSync(backups).some(name => name.endsWith('.dayhub')), '备份必须保留');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('v2 → v5：旧会议归本人、课程 activity 补全、v0.2 一次性归一化只发生在迁移里，并补齐作息与手动状态', async () => {
  const { dir, store, backups } = await seeded(v2LegacySynthetic());
  try {
    const before = store.snapshot();
    assert.equal(domainVersion(before), IDENTITY_DOMAIN_VERSION);
    assert.ok(before.events.length > 0 && before.events.every(event => event.person === undefined), 'v2 数据没有会议归属');
    const legacyCompanionName = before.profiles.find(profile => profile.role === 'companion')!.name;

    const run = await runMigrations(store, { target: DOMAIN_VERSION, version: domainVersion, steps: migrationSteps, backupDirectory: backups, attachments: dir, now: v020Now });
    assert.equal(run.migrated, true);
    assert.deepEqual(run.steps, ['person-aware', 'routine-profile', 'manual-status'], 'v2 需要跑归属、作息与手动状态三步');
    for (const file of [run.backup!.dayhub, run.backup!.sqlite, run.backup!.receipt]) assert.ok(fs.existsSync(file), file);
    const receipt = JSON.parse(fs.readFileSync(run.backup!.receipt, 'utf8'));
    assert.equal(receipt.fromDomainVersion, IDENTITY_DOMAIN_VERSION);
    assert.equal(receipt.targetDomainVersion, DOMAIN_VERSION);
    assert.equal(receipt.counts.courses, before.courses.length);
    assert.equal(receipt.counts.reminders, before.reminders.length);

    const after = store.snapshot();
    const self = after.profiles.find(profile => profile.role === 'self')!;
    const companion = after.profiles.find(profile => profile.role === 'companion')!;
    assert.equal(domainVersion(after), DOMAIN_VERSION);
    assert.equal(self.id, 'me', 'legacy id 保持不变');
    assert.equal(companion.id, 'partner', 'legacy id 保持不变');

    // 1) 会议归工作区本人，其它字段逐字段保持。
    assert.equal(after.events.length, before.events.length);
    after.events.forEach((event, index) => {
      assert.equal(event.person, self.id);
      assert.deepEqual(omit(event, ['person']), omit(before.events[index], ['person']));
    });
    // 2) 课程 activity：旧教研课名 → research，普通课程 → teaching；已有 activity 不被改写。
    const research = after.courses.find(course => course.person === companion.id && course.title.replace(/\s/g, '') === '高一高二语文教研');
    assert.equal(research?.activity, 'research');
    assert.ok(after.courses.every(course => course.activity === 'teaching' || course.activity === 'research'));
    after.courses.forEach((course, index) => {
      const previous = before.courses[index];
      assert.deepEqual(omit(course, ['activity']), omit(previous, ['activity']), course.id);
      if (previous.activity !== undefined) assert.equal(course.activity, previous.activity, `${course.id} 的 activity 不应被改写`);
    });
    // 3) v0.2 一次性归一化：同行者旧称呼 → Ta，旧暂定学期 → tentative。
    assert.notEqual(legacyCompanionName, 'Ta');
    assert.equal(companion.name, 'Ta');
    assert.equal(companion.tentative, true);
    assert.deepEqual(omit(companion, ['role', 'name', 'tentative', 'routine']), omit(before.profiles[1], ['role', 'name', 'tentative']));
    // 4) 其它集合、设置与时钟不变。
    for (const key of ['tasks', 'notices', 'exceptions', 'reminders'] as const) assert.deepEqual(after[key], before[key], key);
    assert.equal(after.lastTick, before.lastTick);
    assert.equal(after.version, before.version);
    // domainVersion 是这一步唯一允许变化的设置项（2 → 4）。
    for (const key of Object.keys(before.settings) as (keyof typeof after.settings)[]) if (key !== 'domainVersion') assert.deepEqual(after.settings[key], before.settings[key], key);
    assert.equal(after.settings.domainVersion, DOMAIN_VERSION);
    // 5) 幂等：每一步在自己的输入版本上都不改变结果。
    const v3Once = personAwareMigrationV3(structuredClone(v2LegacySynthetic()));
    assert.deepEqual(personAwareMigrationV3(structuredClone(v3Once)), v3Once);
    const v4Shape = { ...structuredClone(after), settings: { ...after.settings, domainVersion: ROUTINE_DOMAIN_VERSION } };
    assert.deepEqual(routineProfileMigrationV4(v4Shape, v020Now).settings.domainVersion, ROUTINE_DOMAIN_VERSION);
    assert.deepEqual(manualStatusMigrationV5(structuredClone(after)), after, '手动状态步骤幂等');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('v3 → v5（Together）：只有桌宠主体获得 legacy 默认作息，其他人不被虚构作息，业务数据不动', async () => {
  const { dir, store, backups } = await seeded(v3TogetherSynthetic());
  try {
    const before = store.snapshot();
    assert.equal(domainVersion(before), ROUTINE_DOMAIN_VERSION - 1);
    assert.ok(before.profiles.every(profile => profile.routine === undefined), 'v3 数据没有 routine');
    assert.ok(before.settings.domainVersion === PERSON_AWARE_DOMAIN_VERSION);

    const run = await runMigrations(store, { target: DOMAIN_VERSION, version: domainVersion, steps: migrationSteps, backupDirectory: backups, attachments: dir, now: v020Now });
    assert.equal(run.migrated, true);
    assert.deepEqual(run.steps, ['routine-profile', 'manual-status']);
    for (const file of [run.backup!.dayhub, run.backup!.sqlite, run.backup!.receipt]) assert.ok(fs.existsSync(file), file);
    const receipt = JSON.parse(fs.readFileSync(run.backup!.receipt, 'utf8'));
    assert.equal(receipt.fromDomainVersion, ROUTINE_DOMAIN_VERSION - 1);
    assert.equal(receipt.targetDomainVersion, DOMAIN_VERSION);
    assert.equal(receipt.counts.courses, before.courses.length);
    assert.equal(receipt.counts.reminders, before.reminders.length);
    // 备份仍是迁移前的 v3 形态：回滚靠字节还原，而不是让旧版读新库。
    const restored = unpack(fs.readFileSync(run.backup!.dayhub, 'utf8'));
    assert.ok(restored.state.profiles.every(profile => profile.routine === undefined));
    assert.equal(restored.state.settings.domainVersion, ROUTINE_DOMAIN_VERSION - 1);

    const after = store.snapshot();
    assert.equal(domainVersion(after), DOMAIN_VERSION);
    const subject = getCompanionProfile(after)!;   // Together：桌宠主体是同行者
    const self = getSelfProfile(after)!;
    assert.equal(subject.routine?.source, 'legacy-default');
    assert.deepEqual(subject.routine?.rules, legacyDefaultRoutine(v020Now).rules);
    assert.deepEqual(self.routine, { source: 'user', updatedAt: v020Now, rules: [] }, '本人不被种入任何作息');
    // 除 routine 与 domainVersion 外，档案、业务集合与设置逐字段保持。
    after.profiles.forEach((profile, index) => assert.deepEqual(omit(profile, ['routine']), before.profiles[index], profile.id));
    for (const key of ['courses', 'exceptions', 'events', 'tasks', 'notices', 'reminders'] as const) assert.deepEqual(after[key], before[key], key);
    for (const key of Object.keys(before.settings) as (keyof typeof after.settings)[]) if (key !== 'domainVersion') assert.deepEqual(after.settings[key], before.settings[key], key);
    assert.equal(after.lastTick, before.lastTick);
    assert.equal(after.version, before.version);
    assert.doesNotThrow(() => validateState(structuredClone(after)), 'v4 不变式要求每个档案都有合法作息');
    // 作息步骤幂等：在 v4 版本号的状态上重复执行不改变任何字段。
    const v4Shape = structuredClone(after);
    v4Shape.settings.domainVersion = ROUTINE_DOMAIN_VERSION;
    const v4Again = routineProfileMigrationV4(structuredClone(v4Shape), v020Now);
    assert.deepEqual(omit(v4Again, ['settings']), omit(v4Shape, ['settings']), '作息步骤不应改变档案与业务数据');
    assert.deepEqual(v4Again.settings.domainVersion, ROUTINE_DOMAIN_VERSION);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('v3 → v5（Solo）：主体是本人，本人获得 legacy 作息，且不产生幽灵同行者', async () => {
  const { dir, store, backups } = await seeded(v3SoloSynthetic());
  try {
    const before = store.snapshot();
    assert.equal(domainVersion(before), ROUTINE_DOMAIN_VERSION - 1);
    assert.equal(before.profiles.length, 1);
    assert.equal(getCompanionProfile(before), undefined);

    const run = await runMigrations(store, { target: DOMAIN_VERSION, version: domainVersion, steps: migrationSteps, backupDirectory: backups, attachments: dir, now: v020Now });
    assert.deepEqual(run.steps, ['routine-profile', 'manual-status']);

    const after = store.snapshot();
    assert.equal(after.profiles.length, 1, '迁移不会凭空增加档案');
    assert.equal(getCompanionProfile(after), undefined, '迁移不虚构同行者');
    const self = getSelfProfile(after)!;
    assert.equal(self.id, soloPersonId, 'Solo fixture 使用自定义 id，不被改写');
    assert.equal(self.routine?.source, 'legacy-default', 'Solo 的桌宠主体就是本人');
    assert.deepEqual(self.routine?.rules, legacyDefaultRoutine(v020Now).rules);
    for (const key of ['courses', 'exceptions', 'events', 'tasks', 'notices', 'reminders'] as const) assert.deepEqual(after[key], before[key], key);
    assert.doesNotThrow(() => validateState(structuredClone(after)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('v4 → v5：只补空的临时状态集合，档案 / 作息 / 业务数据与设置逐字段不变', async () => {
  // 用 v3 的 Together fixture 先跑一次 v4 的作息步骤，得到真正的 v4 形态输入。
  const v4State = routineProfileMigrationV4(v3TogetherSynthetic(), v020Now);
  assert.equal(domainVersion(v4State), ROUTINE_DOMAIN_VERSION);
  assert.equal((v4State as { manualOverrides?: unknown }).manualOverrides, undefined, 'v4 数据没有临时状态字段');
  const { dir, store, backups } = await seeded(v4State);
  try {
    const before = store.snapshot();
    const run = await runMigrations(store, { target: DOMAIN_VERSION, version: domainVersion, steps: migrationSteps, backupDirectory: backups, attachments: dir, now: v020Now });
    assert.equal(run.migrated, true);
    assert.deepEqual(run.steps, ['manual-status'], 'v4 只需要跑手动状态一步');
    // 迁移前的备份保持 v4 形态：回滚靠字节还原，而不是让旧版读新库。
    const restored = unpack(fs.readFileSync(run.backup!.dayhub, 'utf8'));
    assert.equal((restored.state as { manualOverrides?: unknown }).manualOverrides, undefined);
    assert.equal(restored.state.settings.domainVersion, ROUTINE_DOMAIN_VERSION);

    const after = store.snapshot();
    assert.equal(domainVersion(after), MANUAL_STATUS_DOMAIN_VERSION);
    assert.deepEqual(after.manualOverrides, [], '旧数据补空数组');
    // 除新集合与 domainVersion 外，其它字段逐字段保持。
    assert.deepEqual(omit(after, ['manualOverrides', 'settings']), omit(before, ['settings']));
    assert.deepEqual(after.profiles, before.profiles);
    for (const key of ['courses', 'exceptions', 'events', 'tasks', 'notices', 'reminders'] as const) assert.deepEqual(after[key], before[key], key);
    for (const key of Object.keys(before.settings) as (keyof typeof after.settings)[]) if (key !== 'domainVersion') assert.deepEqual(after.settings[key], before.settings[key], key);
    assert.doesNotThrow(() => validateState(structuredClone(after)));
    // 幂等：再跑一次不写盘、不改变任何字段。
    const again = await runMigrations(store, { target: DOMAIN_VERSION, version: domainVersion, steps: migrationSteps, backupDirectory: backups, attachments: dir, now: v020Now + 1000 });
    assert.equal(again.migrated, false);
    assert.deepEqual(store.snapshot(), after);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
