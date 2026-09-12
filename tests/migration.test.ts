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
import { DOMAIN_VERSION, IDENTITY_DOMAIN_VERSION, createMigrationBackup, domainVersion, migrationStamp, migrationSteps, restoreMigrationBackup, runMigrations, type MigrationStep } from '../src/migration.ts';
import type { State } from '../src/types.ts';
import { v020Now, v020Synthetic } from './fixtures/v020-synthetic.ts';

const digest = (bytes: Uint8Array | Buffer) => createHash('sha256').update(bytes).digest('hex');
const fileDigest = (file: string) => digest(fs.readFileSync(file));

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

async function seeded() {
  const space = workspace();
  const store = new Store(space.dir, space.open, v020Now);
  await store.update(() => v020Synthetic());
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
    const run = await runMigrations(store, {
      target: DOMAIN_VERSION, version: domainVersion, steps: migrationSteps, backupDirectory: backups, attachments: dir, now: v020Now,
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
    assert.equal(domainVersion(migrated), IDENTITY_DOMAIN_VERSION);
    assert.ok(migrated.profiles.every(profile => profile.role !== undefined));
    restoreMigrationBackup(backup, store.file);
    assert.equal(fileDigest(store.file), digest(bytes), '还原后必须逐字节等于迁移前');
    assert.equal(domainVersion(store.snapshot()), 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('身份迁移 v1 → v2：补角色、保 id、保业务数据、生成备份', async () => {
  const { dir, store, backups } = await seeded();
  try {
    const before = store.snapshot();
    assert.equal(domainVersion(before), 1);
    assert.ok(before.profiles.every(profile => profile.role === undefined));
    const run = await runMigrations(store, { target: DOMAIN_VERSION, version: domainVersion, steps: migrationSteps, backupDirectory: backups, attachments: dir, now: v020Now });
    assert.equal(run.migrated, true);
    assert.deepEqual(run.steps, ['identity-roles']);
    for (const file of [run.backup!.dayhub, run.backup!.sqlite, run.backup!.receipt]) assert.ok(fs.existsSync(file), file);
    const receipt = JSON.parse(fs.readFileSync(run.backup!.receipt, 'utf8'));
    assert.equal(receipt.fromDomainVersion, 1);
    assert.equal(receipt.targetDomainVersion, IDENTITY_DOMAIN_VERSION);
    assert.equal(receipt.counts.courses, before.courses.length);

    const after = store.snapshot();
    // 身份：legacy id 不变，角色按 self / companion 补齐。
    assert.deepEqual(after.profiles.map(p => p.id), before.profiles.map(p => p.id));
    assert.deepEqual(after.profiles.map(p => p.role), ['self', 'companion']);
    assert.ok(after.profiles.every(p => p.role !== undefined));
    // 档案上的其它字段逐字段保持（只有 role 是新增的）。
    after.profiles.forEach((profile, index) => {
      const { role, ...rest } = profile;
      assert.ok(role, `profile ${index} 应带上角色`);
      assert.deepEqual(rest, before.profiles[index]);
    });
    // 业务集合数量与内容都不变；课程仍然引用原来的 person id。
    for (const key of ['courses', 'exceptions', 'events', 'tasks', 'notices', 'reminders'] as const) assert.deepEqual(after[key], before[key], key);
    assert.deepEqual([...new Set(after.courses.map(c => c.person))].sort(), ['me', 'partner']);
    // 设置：只多了 domainVersion。
    for (const key of Object.keys(before.settings) as (keyof typeof after.settings)[]) assert.deepEqual(after.settings[key], before.settings[key], key);
    assert.equal(after.settings.domainVersion, IDENTITY_DOMAIN_VERSION);
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
    assert.equal(domainVersion(settled), IDENTITY_DOMAIN_VERSION);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('身份迁移失败仍然回滚：v2 之后的步骤抛错时数据库回到迁移前', async () => {
  const { dir, store, backups, bytes, state } = await seeded();
  try {
    const boom: MigrationStep = { from: 2, to: 3, id: 'phase-later', migrate() { throw new Error('later step exploded'); } };
    await assert.rejects(
      () => runMigrations(store, { target: 3, version: domainVersion, steps: [...migrationSteps, boom], backupDirectory: backups, attachments: dir, now: v020Now }),
      /已恢复迁移前的数据库/,
    );
    assert.equal(fileDigest(store.file), digest(bytes), '回滚必须逐字节等于迁移前');
    assert.deepEqual(store.snapshot(), state);
    assert.ok(fs.readdirSync(backups).some(name => name.endsWith('.dayhub')), '备份必须保留');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
