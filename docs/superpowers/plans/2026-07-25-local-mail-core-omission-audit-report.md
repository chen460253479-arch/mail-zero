# Zero 本地邮箱内核规模化疏漏审计报告

日期：2026-07-26
分支：`codex/local-mail-core`

## 1. 审计结论

本轮“本地邮箱内核规模化改进”八项任务的代码、迁移和自动化测试均已落地。Zero
当前已经具备服务商无关的本地 Email、Mailbox、Thread、Keyword、Draft、
Submission、Blob、Changes 数据模型，以及本轮新增的有界查询、索引线程匹配、
增量聚合和聚合校验/修复能力。

本结论不表示 Gmail 插件、真实发件 Worker、前端切换或 JMAP HTTP 服务已经完成。
这些仍是后续独立阶段。

## 2. 从参考项目吸收并转换的机制

### Stalwart

- 学习规范化主题、Message-ID 引用索引缩小 Thread 候选集的方式。
- 学习查询索引与完整 Email 内容分离、派生状态可重建的方式。
- 学习 JMAP Email、Mailbox、Thread、Keyword、Changes 的领域语义。

Zero 的实现是独立的 TypeScript 领域端口、PostgreSQL 关系表、SHA-256 索引键和
Vitest 行为测试，不复制 Rust/KV/Bitmap 实现。

### Sync Engine

- 学习 Message、Thread、Category 关系分离和本地 ID/服务商 ID 分离。
- 学习 Thread 作为一等本地聚合以及 MIME 内容关系化组织。

Zero 保留 JMAP 兼容多 Mailbox 归属和独立 Blob Store，不把 Gmail 等服务商字段
混入 Email 权威模型。

### EmailEngine 与 Postal

本轮只保留其 Provider 边界、运行状态、队列租约、重试分类等设计经验；由于尚未
进入 Gmail 插件和真实发件阶段，没有把这些运行机制提前混入本地邮箱内核。

## 3. 本轮交付核对

| 交付项                   | 状态 | 证据                                                             |
| ------------------------ | ---- | ---------------------------------------------------------------- |
| 有界 Thread 查询         | 完成 | `ThreadQueryRepository`、PostgreSQL keyset 查询、页内批量投影    |
| Thread Reference 索引    | 完成 | `mail0_thread_reference`、账户/主题/引用哈希索引                 |
| 索引化导入与 Thread 合并 | 完成 | 候选点查、有界 Email 迁移、引用同步迁移                          |
| 增量聚合                 | 完成 | `EmailAggregateProjection`、`mail0_mailbox_thread`、受影响行更新 |
| 查询规范化字段           | 完成 | `normalized_subject`、`normalized_email` 及账户前缀索引          |
| 聚合审计与修复           | 完成 | 只审计、显式修复、账户锁、重复执行零差异                         |
| 规模回归                 | 完成 | 100,000 Email、20,000 Thread、30 Mailbox                         |
| 全量扫描疏漏审查         | 完成 | 正常 Thread/聚合/Mailbox 删除路径均为有界查询                    |

## 4. 规模测试发现并修复的问题

最初的 Mailbox Thread 过滤仍从 Email 与 Email-Mailbox 事实表执行 `EXISTS`。
PostgreSQL 在 10 万 Email 数据上将其改写为哈希连接和账户级显式 Sort，导致已有
Thread 索引未被使用。

最终实现改为：

```text
Thread 索引顺序扫描
-> MailboxThread 主键/账户线程索引存在性点查
-> 只装配请求页的 Email/Mailbox ID
```

同时查询显式指定 `DESC NULLS LAST`，与 Drizzle 生成的
`thread_account_latest_id_idx` 完全匹配。最终 `EXPLAIN` 使用该索引且不存在
账户级显式 Sort。

审计还发现 PostgreSQL 增量聚合曾按地址类型字母序生成参与者摘要，会产生
`cc, from, to`。现已统一为 JMAP/邮件显示语义需要的 `from, to, cc`，并增加回归
断言，使增量维护和全量重算一致。

## 5. 剩余账户级列表调用分类

生产内核中的剩余调用如下：

- `listMailboxes`：公共 API 本来就返回账户全部 Mailbox，属于预期读取。
- Draft 配额检查：用于计算去重 Blob、冻结 Submission Blob 和附件总占用。
- Email 导入 Blob 解析：用于当前内容寻址 Blob 去重与配额计算。
- Blob GC：用于确认 Email/Submission Blob 引用和候选对象。

后三项属于已明确延后的 Blob/Quota 外部 I/O 事务边界项目。本轮没有误删这些安全
校验。Thread 查询、Thread 匹配、常规 Email 聚合更新和 Mailbox 删除校验中已无
账户级 Email/Thread/Mailbox 列表扫描。

## 6. 验证记录

已执行并通过：

- `pnpm --filter=@zero/mail-core typecheck`
- `pnpm test:mail-core` 中纯内核 28 个文件、270 项测试
- Server MailCore 20 个文件、81 项测试；规模测试在普通回归中按设计跳过
- PostgreSQL 维护、Thread 查询、增量聚合、Mailbox 并发和迁移从空 Schema 应用
- `MAIL_CORE_SCALE_TEST=1` 显式规模测试
- 变更文件格式检查与 `git diff --check`

仓库级 `pnpm --dir apps/server exec tsc --noEmit` 仍会报告既有非 MailCore
诊断，主要位于 Cloudflare Env、旧 Chat/Agent 路由、Microsoft Driver 和
Thread Workflow。过滤本轮变更文件后无诊断。本轮未越权修改这些无关模块，因此
不能把“整个 Server TypeScript 零错误”记录为已通过。

提交前最后一次验证中，上述 MailCore 测试、显式规模测试、包级类型检查和变更
文件格式检查均通过。

## 7. 明确延后的独立项目

- Submission 对 Sent、Outbox、Scheduled 的投影和持久化 Worker。
- 发件任务领取、租约、退避和 Provider 错误标准化。
- Blob/Quota 有界引用查询、外部对象 I/O 事务边界和大账号 GC。
- Changes 保留策略、queryState 与历史裁剪。
- 服务商无关同步状态、断点和重放。
- Gmail 全量/History 导入与 Gmail API 发件插件。
- Outlook、Zoho、通用 IMAP/SMTP 插件。
- JMAP HTTP 接口、tRPC 切换、前端逐功能迁移。

这些能力必须继续遵循“学习成熟项目已验证的机制，转换成适合 Zero 的
TypeScript + PostgreSQL + 插件架构”，并分别建立设计、实施计划和验收门槛。
