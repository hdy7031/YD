// Sequential runner for the maintained v0.3 release gates.
//
// It only orchestrates existing verifiers: no check is reimplemented here, no
// exit code is rewritten, and a green run never comes from a skipped assertion.
// Any step that exits non-zero fails the whole run.
//
// See docs/verification-release.md for what each gate covers and for the list of
// historical verifiers that are deliberately NOT part of this run.
//
// VS2 视觉 / 运行时门禁（scripts/visual-vs2.cjs + 两个 runtime audit + Dock）
// 有独立入口 `npm run verify:vs2`；这里把视觉脚本插在同一条链里，保持
// "一次运行覆盖全部维护中的门禁"这一语义。
//
// Usage:
//   node scripts/verify-current-release.cjs
//   node scripts/verify-current-release.cjs --with-aux
//   node scripts/verify-current-release.cjs --skip-packaged
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const packagedExe = path.join(root, 'release', 'win-unpacked', 'YD.exe');

const withAux = process.argv.includes('--with-aux');
const skipPackaged = process.argv.includes('--skip-packaged');

let electron;
try {
  electron = require('electron'); // path to the local Electron binary
} catch {
  console.error('未找到本地 electron 依赖；先运行 npm ci。');
  process.exit(1);
}

const npmStep = (name, args) => ({ name, command: npm, args, shell: process.platform === 'win32' });
const electronStep = (script) => ({ name: script, command: electron, args: [path.join(root, script)] });

const gates = [
  npmStep('npm test', ['test']),
  npmStep('npm run typecheck', ['run', 'typecheck']),
  npmStep('npm run build', ['run', 'build']),
  electronStep(path.join('scripts', 'visual-vs2.cjs')),
  electronStep('runtime-audit.cjs'),
  electronStep('runtime-audit-solo.cjs'),
  electronStep('verify-v0220.cjs'),
  electronStep('verify-v030-identity-migration.cjs'),
  electronStep('verify-v030-routine-pet.cjs'),
  electronStep('verify-v030-routine-settings.cjs'),
  electronStep('verify-v030-current-state.cjs'),
  electronStep('verify-v030-manual-status.cjs'),
  electronStep('verify-v030-avatar-pack.cjs'),
  electronStep('verify-v030-avatar-person.cjs'),
  electronStep('verify-v030-avatar-runtime.cjs'),
  electronStep('verify-v030-avatar-picker.cjs'),
];

const auxiliary = [
  electronStep('verify-v0214.cjs'),
  electronStep('verify-v0214-reminder.cjs'),
  electronStep('verify-epipe-stdio.cjs'),
  electronStep(path.join('scripts', 'visual-mist.cjs')),
];

const nodeStep = (script) => ({ name: script, command: process.execPath, args: [path.join(root, script)] });
// Phase 5A：全新安装契约（空 userData → 两次启动）。它自己管理子进程，因此用 node 运行。
const freshInstall = nodeStep('verify-v050-generalization.cjs');
// Phase 5B1：首次使用 onboarding（空 userData → 真实点击完成 Solo / Together / 中途关闭）。
const onboarding = nodeStep('verify-v051-onboarding.cjs');
// Phase 5B1 P0：桌面交互（主窗口 viewport 不变量 / 命中区 / hover / 拖动清理，真实光标）。
const desktopInteraction = electronStep('verify-v051-desktop-interaction.cjs');
// Phase 5B1：一天安排列表的信息密度与语义（provenance 只留详情层 / 课程不退化 / 摘要只报范围）。
const dayDensity = electronStep('verify-v051-day-density.cjs');
const packaged = nodeStep('verify-v0220-packaged.cjs');

if (!skipPackaged && !fs.existsSync(packagedExe)) {
  console.error('缺少打包产物 release/win-unpacked/YD.exe。');
  console.error('先运行 npm run dist -- --config.electronDist=node_modules/electron/dist，或用 --skip-packaged 只做源码级检查。');
  process.exit(1);
}

// fresh install 契约与 onboarding 都是源码级的，即使 --skip-packaged 也照跑；
// 打包版清房验证跟随打包产物。（打包版 onboarding 路径另见 verify-v051-onboarding.cjs --packaged）
const steps = [...gates, ...(withAux ? auxiliary : []), freshInstall, onboarding, desktopInteraction, dayDensity, ...(skipPackaged ? [] : [packaged])];
const results = [];

console.log(`YD v0.3 release gates · ${steps.length} 个步骤${withAux ? '（含辅助验证）' : ''}${skipPackaged ? '（跳过打包版验证）' : ''}`);

for (const step of steps) {
  console.log(`\n=== ${step.name} ===`);
  const startedAt = Date.now();
  const result = spawnSync(step.command, step.args, { cwd: root, stdio: 'inherit', shell: Boolean(step.shell) });
  const code = result.error ? 1 : (result.status === null ? 1 : result.status);
  results.push({ name: step.name, code, seconds: (Date.now() - startedAt) / 1000 });
  if (code !== 0) {
    if (result.error) console.error(String(result.error.message || result.error));
    console.error(`\n失败：${step.name} 退出码 ${code}。其余步骤未运行。`);
    break;
  }
}

const failed = results.filter((entry) => entry.code !== 0);
console.log('\n=== 汇总 ===');
for (const entry of results) {
  console.log(`${entry.code === 0 ? 'PASS' : 'FAIL'}  ${entry.name}  (${entry.seconds.toFixed(1)}s)`);
}
if (failed.length === 0 && results.length === steps.length) console.log('\n全部 release gate 通过。');
else if (failed.length === 0) console.log(`\n已完成 ${results.length}/${steps.length} 个步骤（提前结束）。`);

process.exit(failed.length === 0 && results.length === steps.length ? 0 : 1);
