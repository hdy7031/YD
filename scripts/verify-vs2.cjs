// VS2 视觉 / 运行时验收编排器（npm run verify:vs2）。
//
// 顺序执行四个真实 Electron 进程；每一步都用 scripts/electron-test-profile.cjs
// 提供的临时 userData，绝不读写 %APPDATA%\事务助手。
// 任何一步非零退出都会让整轮失败；编排器只做编排，不重写任何断言或退出码。
//
//   npx electron scripts/visual-vs2.cjs      # 三档宽度 × 六页 + Solo / Together Dock
//   npx electron runtime-audit.cjs           # Together 完整运行时（导航 / 桌宠 / 提醒 / 托盘）
//   npx electron runtime-audit-solo.cjs      # Solo 运行时
//   npx electron verify-v030-dock.cjs        # Dock 拖动与重启位置
//
// 用法：
//   node scripts/verify-vs2.cjs
//   node scripts/verify-vs2.cjs --skip-dock   # 只跑视觉与运行时（调试用）
//
// 已删除的历史脚本：scripts/visual-v022.cjs（旧悬浮球视觉）、scripts/ui-audit.cjs（刷新前
// 的按钮走查）。两者已被本编排覆盖，见 docs/verification-release.md。
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const skipDock = process.argv.includes('--skip-dock');

let electron;
try {
  electron = require('electron'); // 本地 Electron 可执行文件路径
} catch {
  console.error('未找到本地 electron 依赖；先运行 npm ci。');
  process.exit(1);
}

const step = (script, args = []) => ({
  name: script,
  command: electron,
  args: [path.join(root, script), ...args],
});

const steps = [
  step(path.join('scripts', 'visual-vs2.cjs')),
  step('runtime-audit.cjs'),
  step('runtime-audit-solo.cjs'),
  ...(skipDock ? [] : [step('verify-v030-dock.cjs')]),
];

const results = [];
console.log(`YD VS2 视觉 / 运行时验收 · ${steps.length} 个步骤`);

for (const entry of steps) {
  console.log(`\n=== ${entry.name} ===`);
  const startedAt = Date.now();
  const result = spawnSync(entry.command, entry.args, { cwd: root, stdio: 'inherit' });
  const code = result.error ? 1 : result.status === null ? 1 : result.status;
  results.push({ name: entry.name, code, seconds: (Date.now() - startedAt) / 1000 });
  if (code !== 0) {
    if (result.error) console.error(String(result.error.message || result.error));
    console.error(`\n失败：${entry.name} 退出码 ${code}。其余步骤未运行。`);
    break;
  }
}

console.log('\n=== VS2 汇总 ===');
for (const entry of results) {
  console.log(`${entry.code === 0 ? 'PASS' : 'FAIL'}  ${entry.name}  (${entry.seconds.toFixed(1)}s)`);
}
const failed = results.filter((entry) => entry.code !== 0);
if (failed.length === 0 && results.length === steps.length) console.log('\nVS2 验收全部通过。');
else if (failed.length === 0) console.log(`\n已完成 ${results.length}/${steps.length} 个步骤（提前结束）。`);

process.exit(failed.length === 0 && results.length === steps.length ? 0 : 1);
