// 生成 tests/fixtures 下的 v0.2 迁移回归 fixture（dayhub 备份格式 + SQLite 存储格式）。
// 只在人工维护 fixture 时运行：npm run fixtures:build
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { pack } from '../src/backup.ts';
import { v020Synthetic } from '../tests/fixtures/v020-synthetic.ts';
import { v3SoloSynthetic } from '../tests/fixtures/v3-solo-synthetic.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'tests', 'fixtures');
const SQL = await initSqlJs({ wasmBinary: Uint8Array.from(fs.readFileSync(path.join(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'))).buffer });
const summary = {};
for (const [name, state] of [['v020-synthetic', v020Synthetic()], ['v3-solo-synthetic', v3SoloSynthetic()]]) {
  const dayhub = path.join(fixtures, `${name}.dayhub`);
  fs.writeFileSync(dayhub, pack(state, fixtures), 'utf8');
  const db = new SQL.Database();
  db.run('CREATE TABLE app_state (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, body TEXT NOT NULL)');
  db.run('INSERT INTO app_state (id,version,body) VALUES (1,1,?)', [JSON.stringify(state)]);
  const sqlite = path.join(fixtures, `${name}.sqlite`);
  fs.writeFileSync(sqlite, Buffer.from(db.export()));
  db.close();
  summary[name] = {
    dayhub, sqlite, profiles: state.profiles.length, courses: state.courses.length,
    tasks: state.tasks.length, events: state.events.length, reminders: state.reminders.length,
    exceptions: state.exceptions.length, notices: state.notices.length, domainVersion: state.settings.domainVersion,
  };
}
console.log(JSON.stringify(summary, null, 2));
