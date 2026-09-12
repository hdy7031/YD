# 0.2.8 验收记录

日期：2026-09-09。基线为现有 0.2.7，按本轮要求开发下一版本。

## 工程审查与修改范围

- Electron 44.2.0 + React 19 + TypeScript；页面路由为主窗口 tab 状态和独立窗口 hash。
- 真实持久化是 sql.js SQLite 的 app_state.body JSON。Store 串行队列校验后原子替换文件，并保留上一副本。前端通过 IPC 获取和订阅，无独立页面数据库。
- Course 是周期模板，exceptions 按 courseId + 原日期覆盖；occurrences 是实际实例的唯一展开入口。周次数组表达单双周。原有网格绕过实例，现已改用同一展开结果并拆分跨午夜展示。
- Task/Event/Notice/Reminder 沿用现有存储字段；提醒 pending/fired/ack 与待办 done 分离。收件箱 state 是处理状态，不存在可当作未读的字段。
- live.ts 提供统一状态引擎，selectors.ts 提供未处理提醒、待办及网格派生集合。首页状态不再使用另一条独立异步快照拼装。
- companion.ts/main.ts 复用状态码、alias 和同一提醒定义，悬停状态随时钟更新。托盘使用同一状态快照。
- 日期与编辑时间按北京时间解析，epoch 毫秒用于提醒与比较；ISO 带偏移的输入按其明确偏移解析。

## 验证结果

- npm test：56/56 通过（含本轮新增 7 项）。
- npm run typecheck：通过。
- npm run build：通过；esbuild 需要沙箱外读取父目录解析依赖。
- runtime-audit.cjs：59/59 真实 Electron 检查通过。报告：test-data/v02-runtime-1788906791874/report.json。
- 已核对该目录 main.png：首页 D 学期未开始、Y 预计空闲，保留下一安排和推测依据。
- 实际到时提醒在侧栏、首页、提醒页均为 1；点击已处理后均为 0；待办仍未完成。气泡关闭也不确认提醒、不完成待办。
- NSIS x64 安装包构建通过。首次远程下载失败后，使用相同版本的本地 Electron 完成：`electron-builder --win nsis --x64 --config.electronDist=node_modules/electron/dist`。
- 打包版独立启动确认日志：`启动 0.2.8 packaged=true`，所有页面加载成功。
- 使用历史真实备份副本验证自动迁移：40 条课程、128 条提醒编号完整保留，0 待办/会议/通知；迁移到 liveVersion=3，默认 D/Y，迁移前自动备份存在。报告：test-data/v028-packaged-smoke/verification.json。
- 未覆盖安装正式应用、未修改正式用户数据。

## 安装包

release/DayHub-Setup-0.2.8.exe，119197798 字节。

SHA-256：D4A061A43CAE710F56ECAC246C808D833EF4FB21CEE3297479C40316A440FEE9

## 兼容性与剩余边界

SQLite 表与备份 version=1 保持不变；Profile.shortAlias 是可选增量字段，迁移标记 liveVersion 从 2 到 3。不持久化状态码或计数。

未引入实时状态确认、手动覆盖或联网节假日来源；节假日需用现有本次调课/停课维护。非标准时间的课程在节次网格显示准确时间并靠近对应节次，不是按分钟比例布局。操作系统通知是否真正可见仍依赖 Windows 设置；本轮确认的是调度、应用内提醒及气泡。正式覆盖安装流程未执行。
