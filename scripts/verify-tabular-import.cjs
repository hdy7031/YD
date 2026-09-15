// Phase 6B2 scoped Electron verifier.
//
// The verifier creates disposable CSV/XLSX inputs, then runs the real app in
// isolated processes. The first process imports CSV, the second imports XLSX,
// and the third is a fresh restart that checks both records and projections.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');

const root = path.join(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-tabular-import-'));
const csvFixture = path.join(dataDir, 'schedule.csv');
const xlsxFixture = path.join(dataDir, 'schedule.xlsx');

fs.writeFileSync(csvFixture, '\uFEFF地点,标题,结束时间,日期,备注,开始时间\r\n会议室 A,项目评审 CSV,10:30,2026-09-18,审阅材料,09:00\r\n', 'utf8');

async function writeXlsxFixture() {
  const workbook = new ExcelJS.Workbook();
  const first = workbook.addWorksheet('不要导入');
  first.addRow(['标题', '日期', '开始时间', '结束时间']);
  first.addRow(['错误 Sheet', '2026-09-19', '12:00', '13:00']);

  const selected = workbook.addWorksheet('目标会议');
  selected.addRow(['教务系统导出']);
  selected.addRow([]);
  selected.addRow(['地点', '标题', '结束时间', '日期', '备注', '开始时间']);
  selected.addRow(['会议室 B', '项目复盘 XLSX', '11:00', new Date(Date.UTC(2026, 8, 19)), '整理结论', '09:30']);

  const course = workbook.addWorksheet('课程表');
  course.addRow(['本学期课程导出']);
  course.addRow(['课程名', '星期', '周次', '节次', '地点']);
  course.addRow(['计算机视觉', '星期五', '1-16', '3-4', '研楼201']);

  const hidden = workbook.addWorksheet('隐藏数据');
  hidden.state = 'hidden';
  hidden.addRow(['标题', '日期', '开始时间', '结束时间']);
  hidden.addRow(['不应显示', '2026-09-19', '14:00', '15:00']);
  await workbook.xlsx.writeFile(xlsxFixture);
}

function electronPath() {
  try { return require('electron'); } catch {
    console.error('未找到本地 electron 依赖；先运行 npm ci。');
    process.exit(1);
  }
}

(async () => {
  await writeXlsxFixture();
  const electron = electronPath();
  const run = phase => spawnSync(electron, [
    path.join(__dirname, 'verify-tabular-import-runner.cjs'),
    '--phase', phase,
    '--data-dir', dataDir,
    '--csv', csvFixture,
    '--xlsx', xlsxFixture,
  ], { cwd: root, stdio: 'inherit' });

  console.log(`YD Phase 6B2 tabular Electron verifier · isolated data: ${dataDir}`);
  for (const phase of ['csv', 'xlsx', 'course', 'restart']) {
    const result = run(phase);
    const code = result.error ? 1 : result.status === null ? 1 : result.status;
    if (code !== 0) process.exit(code);
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
