# 0.2.9 持久化修复验收

日期：2026-09-09。

- 修复升级时旧驻留实例持有空内存状态、磁盘已有课程但界面显示空白的问题。
- 正式数据源固定为当前 Windows 用户的 `%APPDATA%\事务助手\dayhub.sqlite`。
- 数据读取与修改前重新加载 SQLite，避免旧实例覆盖新磁盘状态。
- 启动日志记录实际数据源及课程、待办、提醒数量。
- 桌面快捷方式已由 Windows 资源管理器进程重建，指向 `C:\Users\hdy\AppData\Local\Programs\dayhub\事务助手.exe`。
- 安装前数据库已复制到 `ingest/restart-investigation/before-v029-install`。
- TypeScript 检查通过；57 项测试通过，包含双实例交错写入回归。
- 0.2.9 已安装。

## 2026-09-09 交接复核

- 旧驻留实例收到 `second-instance` 事件时先重新读取 SQLite，再通知界面刷新；隔离回归确认主界面无需手动操作即可显示外部更新。
- `npm run typecheck` 通过；`npm test` 57/57 通过。
- `npm run build` 通过；隔离 UI 审计 33/33 通过；隔离运行时审计 59/59 通过。
- `npm run dist` 首次因网络下载 Electron 失败，随后按项目既有方式使用本地 Electron 44.2.0 运行时完成 NSIS x64 安装包重建。
- 更新后的 0.2.9 已覆盖安装并从用户桌面环境启动；沙箱外真实日志记录 `课程=40 待办=0 提醒=128`。

安装包：`release/DayHub-Setup-0.2.9.exe`，119198071 字节。

SHA-256：`3349D50251120B696381500CFB85CAC03232DB078B2E402CCEDE46DE5EAFE78B`

## 2026-09-09 数据目录不对齐复查

先前的“连续启动成功”发生在 Codex 桌面应用的 Windows 包沙箱中。该环境会把 `%APPDATA%` 文件访问重定向到
`%LOCALAPPDATA%\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Roaming`，因此命令行看到的 40 门课程并不是用户从桌面启动时读取的真实数据库。

使用由 Windows Explorer.exe 启动的沙箱外探针重新检查后确认：

- 用户真实数据库在修复前为 8 KB，课程 0、待办 0、提醒 0；真实日志也记录了两次 `课程=0` 启动。
- Codex 包沙箱的镜像数据库为 45 KB，课程 40、待办 0、提醒 128。
- 已先把真实空库备份到真实数据目录的 `migration-backups`，再把已核对的 40 门课程数据库迁移到真实 `%APPDATA%\事务助手`。
- 迁移后通过用户桌面快捷方式启动，沙箱外日志记录 `启动 0.2.9` 和 `课程=40 待办=0 提醒=128`；沙箱外探针再次读取数据库，计数一致。

后续验收不得再把 Codex shell 直接读取的 `%APPDATA%` 当作用户真实目录。生产数据核对应由 Windows Explorer 启动的沙箱外探针或用户实际启动程序产生的日志完成；自动化测试继续只使用项目内的 `test-data`。
