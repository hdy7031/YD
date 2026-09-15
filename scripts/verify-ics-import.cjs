// Phase 6B1 targeted Electron verifier.
//
// It runs two isolated real Electron processes against the same temporary
// userData directory: first import/review/commit, then a fresh restart. The
// runner patches only the native file picker in the first process so the
// product still exercises the real IPC, renderer, importer, review and Store.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-ics-import-'));
const fixture = path.join(root, 'tests', 'fixtures', 'import', 'basic.ics');
let electron;
try { electron = require('electron'); } catch { console.error('未找到本地 electron 依赖；先运行 npm ci。'); process.exit(1); }

const run = (phase) => spawnSync(electron, [
  path.join(__dirname, 'verify-ics-import-runner.cjs'),
  '--phase', phase,
  '--data-dir', dataDir,
  '--fixture', fixture,
], { cwd: root, stdio: 'inherit' });

console.log(`YD Phase 6B1 ICS Electron verifier · isolated data: ${dataDir}`);
const first = run('first');
const firstCode = first.error ? 1 : first.status === null ? 1 : first.status;
if (firstCode !== 0) process.exit(firstCode);
const restart = run('restart');
const restartCode = restart.error ? 1 : restart.status === null ? 1 : restart.status;
process.exit(restartCode);
