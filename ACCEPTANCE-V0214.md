# 0.2.14 收敛、稳定与交互打磨验收

验证日期：2026-09-10。自动测试与 Electron 运行审计使用项目内隔离数据目录；不删除或覆盖正式用户数据库。

## 测试环境

- Windows，Asia/Shanghai（北京时间）。
- Node.js 25.9.0；Electron 44.2.0；TypeScript 5.8。
- 主窗口基准尺寸 1050×780，窄窗下限 750×550；运行审计覆盖主窗口、桌宠/悬浮球、气泡、tooltip 和迷你状态窗口。
- 构建使用项目锁定依赖；受限沙箱中的 esbuild 父目录访问失败不作为产品失败，改在正常本机权限下构建。

## 测试数据

- 单元测试使用内存状态、临时 SQLite、实际 0.2.12 空库 fixture 和历史 40 门课程课表数据。
- Electron 审计使用 `test-data` 下独立数据库，不读写 `%APPDATA%\事务助手\dayhub.sqlite`。
- 备份测试包含课程、调停课、Todo、Event、通知、Reminder、设置和按 SHA-256 命名的 PNG 附件。

## 验证流程与结果

1. 创建课程后检查 CourseOccurrence、首页/状态快照和计划提醒来源一致。
2. 单次调课后检查原实例时间移除、新时间出现、状态和提醒重算；单次停课后当日实例消失并取消对应提醒。
3. 修改或恢复课程实例时检查失效 Reminder 标为 cancelled，相同实例恢复后不会生成重复提醒。
4. 到时提醒由 scheduled 进入 due；10/30/60 分钟延后将原提醒标为 snoozed，并只生成一条新的 scheduled 提醒；确认后为 acknowledged，Todo 保持未完成。
5. 读取旧 pending/fired/ack 提醒时执行兼容迁移，不改变 SQLite 和备份主版本。
6. 通知按“原始证据 + 可编辑草稿 + 人工确认”转换为正式事务，正式事务保留来源 ID；已确认或仍有关联的原通知不能删除。
7. 首页只在存在问题时显示“需要处理”，其计数由统一 selector 汇总；日程与管理页低频操作进入“⋯”。
8. 完整备份先解析并校验状态与附件哈希，确认后才替换状态；恢复前自动导出当前完整备份。
9. `npm test`：78/78 通过；`npm run typecheck`：通过；`npm run build`：通过。
10. `verify-v0213.cjs` 通知主链路回归：28 项通过，包含 750/1050/1366 宽度、原图/OCR、来源回看、忽略/恢复/删除和五窗口加载。
11. `verify-v0214.cjs`：125% 与 150% 两轮各 13 项通过，`devicePixelRatio` 分别为 1.25/1.5；1920×1080、1050×780、750×600 无横向溢出，窄窗编辑器和 footer 可达，控制台错误为 0。
12. `electron-builder` 使用本地 Electron 44.2.0 生成 `release/DayHub-Setup-0.2.14.exe`；加入 EPIPE 稳定性补丁后重新生成，大小 119,214,561 字节，SHA-256 为 `8EC6C694B2DEF9635B8FFFF243B7E5F7C09CFC789B4A71E91C63D40D2A799165`。
13. `release/win-unpacked/事务助手.exe` 使用隔离数据目录启动，日志确认 `启动 0.2.14 packaged=true`，主界面、桌宠与气泡页面完成加载。
14. `verify-v0214-reminder.cjs` 真实时钟提醒验收：8 项通过，未来提醒为 scheduled、到点气泡可见、状态进入 due、30 分钟延后生成从处理时刻起算的 scheduled 提醒、未处理提醒归零，且待办未被自动完成。
15. `runtime-audit.cjs` 真实窗口运行审计：59/59 通过；其中“返回首页”一项按 0.2.14 的统一 selector 语义修正为提醒归零、处理区只保留逾期待办（提醒确认不会自动完成待办）。
16. `verify-epipe-stdio.cjs` 四个场景：开发模式（等价 `npm start` 的 `electron .`，终端保持存在）控制台镜像正常且不降级；运行中关闭管道后主进程没有未捕获异常、继续工作 9 秒，运行日志记录 `控制台输出管道已断开（EPIPE），日志改为只写文件`，之后的 `主界面、桌宠与气泡页面已加载`、`启动显示` 仍正常落盘；对照组（不加载主进程入口、仅裸 `console.log`）在同一场景下复现未捕获的 `EPIPE: broken pipe, write`，说明该场景能真正复现原弹窗问题。
17. 打包版 `release/win-unpacked/事务助手.exe` 在 stdout/stderr 管道断开后未退出，并继续写入运行日志；打包配置关闭控制台镜像，正式日志只写应用数据目录的 `dayhub.log`。

运行报告：

- `test-data/v0213-1789016569974/report.json`
- `test-data/v0214-125-1789016907720/report.json`
- `test-data/v0214-150-1789016948644/report.json`
- `test-data/v0214-reminder-1789019724511/report.json`
- `test-data/v02-runtime-1789020368449/report.json`
- `test-data/epipe-report-1789020665465.json`
- `test-data/epipe-report-1789020766832.json`
- `test-data/epipe-packaged-1789020648192/dayhub.log`
- `test-data/packaged-v0214-1789017248595/dayhub.log`

## 数据库迁移与旧数据兼容

- `State.version` 保持 1，SQLite 继续保存完整状态，不删除未知扩展字段。
- `migrateInbox` 以增量方式将旧 reminder 状态映射到新生命周期，并补齐时间戳。
- Notice、Course、Exception、Task、Event 的 ID 与来源关联保持不变。
- 正式安装版验收必须以安装程序实际启动日志和真实 `%APPDATA%\事务助手\dayhub.sqlite` 为证据；Codex 沙箱映射目录不能代替生产数据结论。

## 已知限制

- 没有独立 lint 脚本，因此不能声称 ESLint 已运行；typecheck 与测试不等同于完整 lint。
- 已用 Electron 强制设备缩放验证 125%/150% 的布局与点击区域；没有实际切换 Windows 系统设置或覆盖不同显卡/多显示器组合，仍需目标机器长期观察。
- Windows 通知是否可见受系统勿扰、通知权限、休眠与厂商驱动影响。
- 0.2.14 不实现自动外部信息接入、在线解析、账号、云同步或移动端。
