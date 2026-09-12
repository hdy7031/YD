# Transaction Hub 0.2.13

## 实际架构

当前仍为 Electron + React + TypeScript + SQL.js。SQLite 的 `app_state` 保存 version 1 JSON 状态，本版不重建数据层。

`InboundPayload → InboxService.receive → Notice（InboxItem） → ParserAdapter → ParsedDraft → 人工核对 → confirmDraft → apply → Store.update`

- `src/inbox-types.ts`：InboundAdapter、InboundPayload、来源元数据、ParserAdapter、ParseContext、OcrAdapter、草稿结构与运行时校验。
- `src/inbox-service.ts`：先持久化输入；解析前保存 PARSING；解析失败保存 FAILED；启动时恢复被中断的解析。Parser 仅取得副本，不获得数据库写权限。
- `src/parser.ts`：当前唯一默认实现 LocalRuleParser，无网络依赖。
- `src/inbox.ts`：迁移、来源入库、候选查找、确认前校验和事务确认服务。
- `src/delivery.ts`：ReminderDelivery 与 DesktopDelivery。领域提醒只记录对象、时间和处理状态；Windows Notification 由主进程投递。
- `src/ui/inbox.ts`：原始通知、图片、核对表单、来源与重复候选。页面只消费 ParsedDraft，不认识具体 Parser。

## 数据与迁移

保留 `notices/tasks/events/exceptions` 等现有集合名；InboxItem/Todo 仍为兼容类型别名。

Notice 增加 createdAt、sourceType/sourceLabel、externalSourceId/externalConversationId/externalMessageId、receivedAt、parseStatus、detectedType、parsedData、confidence、parseError、targetEntityType/targetEntityId、processedAt、ocrText。外部元数据可为空，手工输入不要求填写。原始文字保存于 originalText，text 为可校对的解析输入，image 为本地内容哈希附件名。

Todo、Event 和单次课程覆盖增加 sourceInboxItemId；Todo/Event 同时保留旧 sourceId，兼容旧来源入口。旧 sourceId 迁移到新字段。历史已转待办/活动的通知迁移为 CONFIRMED，保留旧实体。

草稿 schemaVersion=1；结构不合法或不支持的历史草稿清除并转为可恢复失败状态，不丢原文，不信任任意 JSON。保存和确认均重新检查。

`inboxVersion=1` 是本地迁移版本，不是同步版本。迁移补齐 createdAt/updatedAt：旧 createdAt 缺失时用原 updatedAt；历史真实首次创建时间不可恢复，不假装能恢复。Store 首次提交仍保留旧 SQLite `.bak`，采用临时文件、fsync 和替换，不清空旧集合或设置。确认在单个 Store.update 内完成；任何校验、提醒生成或落盘失败均不提交半成品。

## 实体标识与未来同步边界

新 Inbox、Todo、Event、单次覆盖继续使用 crypto.randomUUID；不重写历史 ID。CourseOccurrence 是投影，使用课程稳定 ID + 原日期的确定性 ID，调课到别日仍保持原 ID；createdAt 来自课程创建时间，updatedAt 来自最新单次覆盖/课程。Reminder 保持事务 ID、实例 ID 和提醒时间构成的确定性 ID，延后提醒使用 UUID；重算相同 ID 时保留 createdAt。均不使用数组下标、页面位置或 SQLite 行序号作为领域身份。

没有加入 serverId、deviceId、syncQueue、cloudVersion 等字段。迁移、来源和草稿版本不代表已经实现同步引擎。

## 解析能力与人工确认

支持待办、会议活动、单次停课、调课/补课、换地点、普通通知、UNKNOWN。支持今天/明天/后天、本周/这周/下周/最近星期、中文年月日/号、月底、上午/中午/下午/晚上、阿拉伯与常见中文数字、半点、时间区间。相对日期只基于 Inbox.createdAt，北京时间计算；过去的裸星期推到下一次并给出 warning。没有日期的活动禁止确认；没有结束时间不猜时长，Event.end=null，状态引擎只将其作为开始时点，不宣称持续忙碌或结束。

没有截止时刻的有日期待办建议 23:59，并显式提示用户核对；活动默认建议提前 20 分钟。用户可更改或关闭。课程调整通常不新增独立提醒，复用课程自己的提醒重排策略。

课程匹配只查询已有模板及教学周；多候选必须选择。调课节次按选中课程所属人的作息换算。正式确认只写现有 exceptions 单次覆盖，不创建新课程模板。首页、双方课表、课表网格与悬浮球仍消费同一 occurrences/snapshot。

重复检测：Event 的规范化标题 + 开始时间 + 地点；Todo 的标题 + 截止；课程调整的课程 ID + 原日期（保守提示任何已有覆盖）。不自动合并；用户明确选择继续创建或覆盖单次调整。外部来源的 sourceType + externalMessageId 在统一入口作幂等判断；手工内容相同仍允许入 Inbox，在确认前提示正式事务重复。

更正通知仅提供活动候选（按日期，缺日期时列出现有活动）；选择候选补齐日期和标题后人工确认更新。原通知和更正通知均保留目标关联。

## OCR 与扩展限制

复用 native/ocr.ps1 的 Windows.Media.Ocr，图片不上传。原图先保存；OCR 提取文字另存 ocrText；规则解析兼容汉字之间的 OCR 空格，不修改原文。系统缺少中文语言包、执行策略限制或超时，都允许看图补充文字继续处理。

复杂多事务长文、跨句指代、跨年省略年份、节假日/农历、复杂课程别名、多次补课以及跨午夜活动需要人工核对/拆分。表单的活动结束时间目前限定为同一天，旧数据与既有编辑器仍支持跨日活动。更正候选使用简单规则，缺日期时可能较多。

未来 QQ/Mobile Adapter 只能产生 InboundPayload；未来 LLMParser 只能产生 ParsedDraft。ParseContext 已提供创建时刻、现有课表作息、课程、待办、活动与来源副本；没有开发偏好学习、embedding 或 Vector DB。未实现 QQ 登录/监听、云服务、手机客户端、APNs、同步或在线 LLM 调用。

## 保留的技术债务

整份状态的 SQLite JSON 保存适合当前本地规模，尚非多进程/多设备并发数据库；未实现跨进程锁和同步冲突解决。旧日期时间字段仍使用 start/end/due 的北京时间字符串。历史类型的 createdAt 在 TypeScript 中保持 optional 以接纳旧备份，运行时迁移补齐。没有配置独立 lint 工具。安装包沿用现有默认 Electron 图标与未配置的发行签名；本版不修改悬浮球资产。

## 0.2.13 同版本补丁（2026-09-10）

后续用户要求覆盖初版“通知不可删除”的规则：未确认且无正式事务关联的通知允许删除；已忽略通知也可删除。删除再次检查来源关联与解析状态，避免破坏来源或与正在执行的 Parser 竞争。已确认来源继续保留。共享图片附件不在删除单条通知时直接清理，防止删除其他通知复用的原图。

收件箱默认整页大厅；选中时宽窗左右分栏，窄窗仅显示详情；同项再次点击取消选中，详情提供返回大厅。使用分类色条和带文字的红/绿/灰状态，避免仅凭颜色判断。
