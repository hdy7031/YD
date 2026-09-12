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
import { DOMAIN_VERSION, createMigrationBackup, domainVersion, migrationStamp, restoreMigrationBackup, runMigrations, type MigrationStep } from '../src/migration.ts';
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

test('没有待迁移步骤时不写任何备份，也不改动数据库', async () => {
  const { dir, store, backups, bytes } = await seeded();
  try {
    const run = await runMigrations(store, { target: DOMAIN_VERSION, version: domainVersion, steps: [], backupDirectory: backups, attachments: dir, now: v020Now });
    assert.deepEqual(run, { migrated: false, from: 1, to: 1, steps: [] });
    assert.equal(fs.existsSync(backups), false, '无迁移时不应创建备份目录');
    assert.equal(fileDigest(store.file), digest(bytes), '数据库字节不应改变');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('迁移成功：先写 before-v030 备份，再原子升级，备份可被现有恢复流程读取', async () => {
  const { dir, store, backups, bytes, state } = await seeded();
  try {
    const run = await runMigrations(store, {
      target: 2, version: domainVersion, steps: [upgradeStep(s => setDomainVersion(s, 2))], backupDirectory: backups, attachments: dir, now: v020Now,
    });
    assert.equal(run.migrated, true);
    assert.deepEqual(run.steps, ['test-domain']);
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
    assert.equal(domainVersion(after), 2);
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

test('迁移产出非法状态（校验失败）时同样还原，不留中间版本', async () => {
  const { dir, store, backups, bytes } = await seeded();
  try {
    // 0.2.20 的 validateState 要求两个人：把状态改成单人会被拒绝，
    // 因此这个步骤一定在 Store.update 内失败（与磁盘写失败等价处理）。
    const shrink = upgradeStep(s => ({ ...s, profiles: [s.profiles[0]] }), 'shrink-profiles');
    await assert.rejects(
      () => runMigrations(store, { target: 2, version: domainVersion, steps: [shrink], backupDirectory: backups, attachments: dir, now: v020Now }),
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
      target: 2, version: domainVersion, steps: [upgradeStep(s => setDomainVersion(s, 2))], backupDirectory: backups, attachments: dir, now: v020Now,
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

// 设计约束（v0.3 Phase 0 决议）：回滚 = 恢复迁移前的数据库字节，
// 不是"让 0.2.20 直接读已经进入 v0.3 语义的数据库"。
// 0.2.20 的 validateState 强制两人，所以一个 v0.3 的单人工作区对旧版来说是非法状态：
// "旧版忽略未知字段" 只能说明它不会立刻报错，不能说明语义仍然正确。
// Phase 1 允许 1 人之后，本用例的第一条断言会失败——那是刻意的信号：
// 届时必须显式更新这条约束，并确认回滚路径仍然是字节还原。
test('回滚不依赖旧版读取新数据：备份必须保持旧版可读', async () => {
  const { dir, store, backups } = await seeded();
  try {
    const backup = createMigrationBackup({ directory: backups, attachments: dir, state: store.snapshot(), storeFile: store.file, version: 1, target: 2, now: v020Now });
    const solo = { ...store.snapshot(), profiles: [store.snapshot().profiles[0]] } as State;
    assert.throws(() => validateState(solo), /备份缺少双方作息/, 'v0.2.20 无法把单人工作区当作合法状态读取');
    const restored = unpack(fs.readFileSync(backup.dayhub, 'utf8'));
    assert.doesNotThrow(() => validateState(restored.state), '备份文件必须能被旧版校验通过');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
