# Multi-Channel Mail Connectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Gmail 插件成功链路上，为 Zero 增加 Outlook、Zoho Mail 和通用 IMAP/SMTP 插件，并保持邮件入站、出站、本地存储及凭据解析均只有一套公共链路。

**Architecture:** Outlook、Zoho 和 IMAP/SMTP 都遵循“凭据来源可替换、Provider 插件唯一”的结构。Zero OAuth/本地加密凭据和 Nango 托管凭据先解析成统一 `ResolvedCredential`，再进入同一个渠道插件；入站统一写入 `mail-sync`，出站统一走 EmailSubmission/Spool，Webhook 只负责验证通知并触发增量发现。Outlook 使用 Microsoft Graph Delta + MIME，Zoho 使用复合游标分页 + original message，IMAP/SMTP 在独立 Node 协议 Worker 中使用 UID 状态和 SMTP DATA 结果。

**Tech Stack:** TypeScript、Hono、tRPC、Drizzle ORM、PostgreSQL、Vitest、Microsoft Graph REST、Zoho Mail REST、ImapFlow、Nodemailer、MailParser。

**Implementation constraints:**

- 直接在 `codex/local-mail-core` 分支工作，不创建 Git worktree。
- 不自动安装依赖、不自动启动或重建 Docker、不自动提交或推送。
- 保留无关的 `node-compile-cache/`、`update-check/` 工作区文件。
- 所有渠道只同步 Inbox 新邮件；绑定时建立基线，不导入历史邮件。
- Provider 文件夹、标签、已读、删除等状态不反向同步，本地邮件模型是唯一业务数据源。
- Nango 只托管凭据，不执行第二套同步或发件 Action。
- Outlook、Zoho 使用 Webhook 加定时增量兜底；IMAP 只使用定时增量同步。
- 数据库继续维护唯一开发初始化模板，不新增时间线 migration。
- 每项实现先写失败测试，再写最小实现并运行聚焦测试。

## 当前实施状态（2026-07-28）

本节是执行状态摘要；下方逐项清单保留作为设计与审计依据。

- [x] Task 1–15 的源码、数据库模板、API、前端配置入口与自动化单元/架构测试已实现。
- [x] Outlook、Zoho Mail、IMAP/SMTP 都接入同一凭据解析、`mail-sync` 入站、EmailSubmission/Spool 出站链路。
- [x] Outlook/Zoho Provider 请求固定可信域名，并增加 30 秒超时与 32 MiB 响应上限。
- [x] IMAP/SMTP 协议 Worker 仅暴露 Docker 内网端口，使用共享密钥、TLS 校验、SSRF 地址策略和 25 MiB MIME 上限。
- [x] Server 类型检查、改动文件 lint、136 个单元/架构测试文件共 594 项测试通过。
- [ ] 用户执行 `pnpm install` 更新 `pnpm-lock.yaml`；代理未擅自安装依赖。
- [ ] Docker/PostgreSQL 集成测试、Mail 全量构建及四个真实 Provider dry-run。

---

### Task 1: 扩展统一渠道与凭据契约

**Files:**

- Modify: `apps/server/src/mail-channel/contracts/credentials.ts`
- Modify: `apps/server/src/mail-channel/contracts/channel.ts`
- Modify: `apps/server/src/mail-channel/contracts/outbound.ts`
- Modify: `apps/server/src/mail-channel/contracts/index.ts`
- Modify: `apps/server/src/mail-channel/registry/default.ts`
- Test: `apps/server/tests/unit/mail-channel/registry/registry.test.ts`
- Test: `apps/server/tests/unit/modules/mail-accounts/credentials/resolve.test.ts`

- [ ] 为 IMAP/SMTP 增加明确分离的入站和出站端点凭据，并保持 OAuth2/Basic 现有调用兼容。
- [ ] 为渠道描述增加受支持凭据类型、Webhook 类型、定时同步能力元数据。
- [ ] 为冻结出站消息增加可选的远端父消息标识，支持 Zoho reply 语义。
- [ ] 先通过测试证明 Gmail 兼容、四个渠道标识可注册、无重复插件。
- [ ] Run: `pnpm --filter @zero/server exec vitest run tests/unit/mail-channel/registry/registry.test.ts tests/unit/modules/mail-accounts/credentials/resolve.test.ts`

### Task 2: 将 Gmail 专用运行时收敛为渠道无关运行时

**Files:**

- Create: `apps/server/src/runtime/mail/channel-credential-context.ts`
- Create: `apps/server/src/runtime/mail/channel-inbound.ts`
- Modify: `apps/server/src/runtime/mail/gmail-credential-context.ts`
- Modify: `apps/server/src/runtime/mail/gmail-inbound.ts`
- Modify: `apps/server/src/runtime/mail/outbound.ts`
- Modify: `apps/server/src/runtime/mail/core.ts`
- Test: `apps/server/tests/unit/runtime/mail/channel-credential-context.test.ts`
- Test: `apps/server/tests/unit/runtime/mail/channel-inbound.test.ts`
- Test: `apps/server/tests/unit/runtime/mail/outbound.test.ts`

- [ ] 抽取按 `connection.channelId` 解析插件和凭据的公共上下文。
- [ ] 保留 Gmail 文件作为薄适配器，禁止复制同步/出站编排。
- [ ] 出站路由由连接的 `channelId` 选择插件，不再硬编码 Gmail。
- [ ] Run: `pnpm --filter @zero/server exec vitest run tests/unit/runtime/mail/channel-credential-context.test.ts tests/unit/runtime/mail/channel-inbound.test.ts tests/unit/runtime/mail/outbound.test.ts`

### Task 3: 扩展订阅持久化与公共 Webhook 信号入口

**Files:**

- Modify: `apps/server/src/modules/mail-sync/domain/ingress-adapter.ts`
- Modify: `apps/server/src/modules/mail-sync/postgres/schema.ts`
- Modify: `apps/server/src/modules/mail-sync/postgres/types.ts`
- Modify: `apps/server/src/modules/mail-sync/postgres/sync-repository.ts`
- Modify: `apps/server/src/modules/mail-sync/application/renew-subscription.ts`
- Modify: `apps/server/src/db/schema.ts`
- Modify: `apps/server/src/db/template.sql`
- Create: `apps/server/src/modules/mail-sync/application/receive-provider-signal.ts`
- Test: `apps/server/tests/unit/modules/mail-sync/application/renew-subscription.test.ts`
- Test: `apps/server/tests/unit/modules/mail-sync/application/receive-provider-signal.test.ts`
- Test: `apps/server/tests/integration/mail-sync/schema.integration.test.ts`

- [ ] 在 `integration.inbound_sync` 增加外部订阅 ID、端点令牌哈希、加密订阅密钥和建立时间。
- [ ] 订阅适配器返回统一订阅资料，续订过程原子更新，不把密钥写入日志。
- [ ] 公共信号入口只增加 `requestedGeneration` 并合并重复信号，避免 Webhook 与定时任务并发重复同步。
- [ ] Run: `pnpm --filter @zero/server exec vitest run tests/unit/modules/mail-sync/application/renew-subscription.test.ts tests/unit/modules/mail-sync/application/receive-provider-signal.test.ts tests/integration/mail-sync/schema.integration.test.ts`

### Task 4: 实现 Outlook 插件身份解析与固定 Graph 客户端

**Files:**

- Create: `apps/server/src/mail-channel/outlook/metadata.ts`
- Create: `apps/server/src/mail-channel/outlook/config.ts`
- Create: `apps/server/src/mail-channel/outlook/index.ts`
- Create: `apps/server/src/mail-channel/outlook/plugin.ts`
- Create: `apps/server/src/mail-channel/outlook/shared/errors.ts`
- Create: `apps/server/src/mail-channel/outlook/shared/graph-transport.ts`
- Create: `apps/server/src/mail-channel/outlook/shared/graph-client.ts`
- Modify: `apps/server/src/mail-channel/registry/default.ts`
- Test: `apps/server/tests/unit/mail-channel/outlook/plugin.test.ts`
- Test: `apps/server/tests/unit/mail-channel/outlook/shared/graph-client.test.ts`

- [ ] Graph 主机固定为 `graph.microsoft.com`，禁止由账户配置覆盖。
- [ ] 使用 `/me` 解析稳定身份和邮箱；OAuth 凭据无论来自 Zero 还是 Nango 都进入同一客户端。
- [ ] 所有消息请求发送 `Prefer: IdType="ImmutableId"`。
- [ ] Run: `pnpm --filter @zero/server exec vitest run tests/unit/mail-channel/outlook/plugin.test.ts tests/unit/mail-channel/outlook/shared/graph-client.test.ts`

### Task 5: 实现 Outlook Inbox Delta 与原始 MIME 入站

**Files:**

- Create: `apps/server/src/mail-channel/outlook/inbound/checkpoint.ts`
- Create: `apps/server/src/mail-channel/outlook/inbound/delta-mapper.ts`
- Create: `apps/server/src/mail-channel/outlook/inbound/adapter.ts`
- Create: `apps/server/src/runtime/mail/outlook-api-executor.ts`
- Modify: `apps/server/src/runtime/mail/channel-inbound.ts`
- Test: `apps/server/tests/unit/mail-channel/outlook/inbound/checkpoint.test.ts`
- Test: `apps/server/tests/unit/mail-channel/outlook/inbound/delta-mapper.test.ts`
- Test: `apps/server/tests/unit/mail-channel/outlook/inbound/adapter.test.ts`

- [ ] 绑定时从当前 Inbox 建立不含历史数据的基线 Delta 游标。
- [ ] 增量发现跟随 `@odata.nextLink`，只在完整页链成功后提交 `@odata.deltaLink`。
- [ ] 只导入新增消息；删除、移动、已读变化不进入本地邮件状态。
- [ ] 通过 `messages/{immutableId}/$value` 获取 RFC 822，交给现有 importer。
- [ ] Delta 失效时以 `lastSuccessfulAt` 有限重建，并依赖本地外部 ID/Message-ID 幂等。
- [ ] Run: `pnpm --filter @zero/server exec vitest run tests/unit/mail-channel/outlook/inbound`

### Task 6: 实现 Outlook Webhook 订阅与生命周期处理

**Files:**

- Create: `apps/server/src/mail-channel/outlook/inbound/subscription.ts`
- Create: `apps/server/src/mail-channel/outlook/inbound/webhook.ts`
- Create: `apps/server/src/mail-channel/outlook/inbound/handle-push.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/runtime/mail/channel-inbound.ts`
- Test: `apps/server/tests/unit/mail-channel/outlook/inbound/subscription.test.ts`
- Test: `apps/server/tests/unit/mail-channel/outlook/inbound/webhook.test.ts`
- Test: `apps/server/tests/unit/mail-channel/outlook/inbound/handle-push.test.ts`

- [ ] 暴露 `POST /api/webhooks/mail/outlook`，正确返回 Graph 验证令牌。
- [ ] 对通知验证 clientState、subscriptionId、资源类型和请求体上限。
- [ ] 普通通知与 lifecycle notification 都只触发合并后的 Delta 扫描。
- [ ] 自动续订保存外部订阅 ID 和过期时间。
- [ ] Run: `pnpm --filter @zero/server exec vitest run tests/unit/mail-channel/outlook/inbound`

### Task 7: 实现 Outlook MIME 草稿发送与不确定状态核对

**Files:**

- Create: `apps/server/src/mail-channel/outlook/outbound/adapter.ts`
- Create: `apps/server/src/mail-channel/outlook/outbound/mime-request.ts`
- Create: `apps/server/src/mail-channel/outlook/outbound/reconciliation.ts`
- Create: `apps/server/src/mail-channel/outlook/outbound/result-mapper.ts`
- Modify: `apps/server/src/mail-channel/outlook/plugin.ts`
- Test: `apps/server/tests/unit/mail-channel/outlook/outbound/adapter.test.ts`
- Test: `apps/server/tests/unit/mail-channel/outlook/outbound/reconciliation.test.ts`

- [ ] 用冻结 MIME 创建远端草稿，再发送草稿，避免结构化 API 改写消息内容。
- [ ] Graph 接受后保存 immutable message ID、conversation ID 和 RFC Message-ID。
- [ ] DATA 等价边界断连时进入 uncertain，通过 RFC Message-ID 核对，不盲目重发。
- [ ] Run: `pnpm --filter @zero/server exec vitest run tests/unit/mail-channel/outlook/outbound`

### Task 8: 实现 Zoho 插件、数据中心白名单和账户引导

**Files:**

- Create: `apps/server/src/mail-channel/zoho-mail/metadata.ts`
- Create: `apps/server/src/mail-channel/zoho-mail/config.ts`
- Create: `apps/server/src/mail-channel/zoho-mail/index.ts`
- Create: `apps/server/src/mail-channel/zoho-mail/plugin.ts`
- Create: `apps/server/src/mail-channel/zoho-mail/shared/errors.ts`
- Create: `apps/server/src/mail-channel/zoho-mail/shared/zoho-transport.ts`
- Create: `apps/server/src/mail-channel/zoho-mail/shared/zoho-client.ts`
- Modify: `apps/server/src/mail-channel/registry/default.ts`
- Test: `apps/server/tests/unit/mail-channel/zoho-mail/plugin.test.ts`
- Test: `apps/server/tests/unit/mail-channel/zoho-mail/shared/zoho-client.test.ts`

- [ ] 只允许已知 Zoho 数据中心 API 主机，不接受任意 Base URL。
- [ ] 通过账户和文件夹 API 解析 accountId、Inbox folderId 和邮箱身份。
- [ ] Zero OAuth 与 Nango OAuth 使用完全相同的 Zoho 客户端。
- [ ] Run: `pnpm --filter @zero/server exec vitest run tests/unit/mail-channel/zoho-mail/plugin.test.ts tests/unit/mail-channel/zoho-mail/shared/zoho-client.test.ts`

### Task 9: 实现 Zoho 复合游标增量同步和原始消息导入

**Files:**

- Create: `apps/server/src/mail-channel/zoho-mail/inbound/checkpoint.ts`
- Create: `apps/server/src/mail-channel/zoho-mail/inbound/message-mapper.ts`
- Create: `apps/server/src/mail-channel/zoho-mail/inbound/adapter.ts`
- Create: `apps/server/src/runtime/mail/zoho-api-executor.ts`
- Modify: `apps/server/src/runtime/mail/channel-inbound.ts`
- Test: `apps/server/tests/unit/mail-channel/zoho-mail/inbound/checkpoint.test.ts`
- Test: `apps/server/tests/unit/mail-channel/zoho-mail/inbound/adapter.test.ts`

- [ ] 使用 `(receivedTime, messageId)` 复合游标和有限重叠窗口，解决同毫秒消息和分页竞态。
- [ ] 列表按时间倒序分页，发现早于重叠窗口的边界后停止。
- [ ] 通过 original message API 获取原始 RFC 822；本地外部 ID/Message-ID 双重幂等。
- [ ] 只有本批次事件全部持久化后才推进复合游标。
- [ ] Run: `pnpm --filter @zero/server exec vitest run tests/unit/mail-channel/zoho-mail/inbound`

### Task 10: 实现 Zoho Webhook 令牌入口和扫描触发

**Files:**

- Create: `apps/server/src/mail-channel/zoho-mail/inbound/subscription.ts`
- Create: `apps/server/src/mail-channel/zoho-mail/inbound/webhook.ts`
- Create: `apps/server/src/runtime/mail/zoho-webhook-setup.ts`
- Modify: `apps/server/src/main.ts`
- Test: `apps/server/tests/unit/mail-channel/zoho-mail/inbound/webhook.test.ts`

- [x] 暴露 `POST /api/webhooks/mail/zoho/:endpointToken`，数据库只存 token 哈希。
- [x] 按 Zoho Mail 官方 Outgoing Webhook 能力使用逐邮箱不可猜测 URL；不虚构服务商未声明的签名请求头。
- [x] Webhook payload 不作为邮件事实来源，只触发合并后的 Zoho 增量扫描。
- [x] 提供管理员可复制的逐邮箱回调 URL 和 Zoho 配置说明。
- [x] Run: `pnpm --filter @zero/server exec vitest run tests/unit/mail-channel/zoho-mail/inbound`

### Task 11: 实现 Zoho 结构化发送和 reply 关联

**Files:**

- Create: `apps/server/src/mail-channel/zoho-mail/outbound/adapter.ts`
- Create: `apps/server/src/mail-channel/zoho-mail/outbound/mime-projection.ts`
- Create: `apps/server/src/mail-channel/zoho-mail/outbound/reconciliation.ts`
- Create: `apps/server/src/mail-channel/zoho-mail/outbound/result-mapper.ts`
- Modify: `apps/server/src/mail-channel/zoho-mail/plugin.ts`
- Test: `apps/server/tests/unit/mail-channel/zoho-mail/outbound/adapter.test.ts`
- Test: `apps/server/tests/unit/mail-channel/zoho-mail/outbound/result-mapper.test.ts`

- [ ] 从冻结 MIME 解析结构化发送参数，附件只来自本地冻结字节，禁止下载任意 URL。
- [ ] 普通发送保存 Zoho `messageId`/`mailId`；回复使用本地保存的远端父 messageId。
- [ ] 边界断连且无法可靠查询时保持 uncertain，不盲目重试。
- [ ] Run: `pnpm --filter @zero/server exec vitest run tests/unit/mail-channel/zoho-mail/outbound`

### Task 12: 实现 IMAP/SMTP 凭据、端点校验与进程边界

**Files:**

- Create: `apps/server/src/mail-channel/imap-smtp/metadata.ts`
- Create: `apps/server/src/mail-channel/imap-smtp/config.ts`
- Create: `apps/server/src/mail-channel/imap-smtp/index.ts`
- Create: `apps/server/src/mail-channel/imap-smtp/plugin.ts`
- Create: `apps/server/src/mail-channel/imap-smtp/shared/endpoint-policy.ts`
- Create: `apps/server/src/mail-channel/imap-smtp/shared/protocol-client.ts`
- Modify: `apps/server/src/mail-channel/registry/default.ts`
- Modify: `apps/server/package.json`
- Modify: `pnpm-lock.yaml`
- Test: `apps/server/tests/unit/mail-channel/imap-smtp/plugin.test.ts`
- Test: `apps/server/tests/unit/mail-channel/imap-smtp/shared/endpoint-policy.test.ts`

- [ ] 本地或 Nango 凭据都解析成统一 IMAP/SMTP 双端点凭据。
- [ ] 默认阻止 loopback、link-local、私网和元数据地址，管理员显式白名单可放行内部邮件服务器。
- [ ] 强制 TLS 证书校验、连接/命令超时和消息大小上限。
- [ ] 将 `imapflow@1.5.0`、`nodemailer@9.0.3`、`mailparser@3.9.14` 固定到参考项目已验证版本；依赖安装命令由用户执行。
- [ ] Run: `pnpm --filter @zero/server exec vitest run tests/unit/mail-channel/imap-smtp/plugin.test.ts tests/unit/mail-channel/imap-smtp/shared/endpoint-policy.test.ts`

### Task 13: 实现 Node 协议 Worker 与 IMAP UID 增量同步

**Files:**

- Create: `apps/server/src/protocol-worker/contracts.ts`
- Create: `apps/server/src/protocol-worker/server.ts`
- Create: `apps/server/src/protocol-worker/imap/client.ts`
- Create: `apps/server/src/mail-channel/imap-smtp/inbound/checkpoint.ts`
- Create: `apps/server/src/mail-channel/imap-smtp/inbound/adapter.ts`
- Modify: `apps/server/src/runtime/mail/channel-inbound.ts`
- Modify: `apps/server/package.json`
- Modify: `docker-compose.yml`
- Test: `apps/server/tests/unit/mail-channel/imap-smtp/inbound/checkpoint.test.ts`
- Test: `apps/server/tests/unit/mail-channel/imap-smtp/inbound/adapter.test.ts`
- Test: `apps/server/tests/unit/protocol-worker/contracts.test.ts`

- [ ] Worker 只在内部网络提供带共享密钥认证的协议 RPC，不暴露公网。
- [ ] 绑定时 SELECT INBOX 并保存 UIDVALIDITY/UIDNEXT/HIGHESTMODSEQ，不读取旧 UID。
- [ ] 定时任务从 `uidNext` 起分批获取 raw RFC 822，入库成功后才推进状态。
- [ ] UIDVALIDITY 变化时从 `lastSuccessfulAt` 有限窗口恢复，并使用 Message-ID/内容哈希去重，不全量回灌历史。
- [ ] 不启用 IMAP IDLE；同步互斥和现有 requested/completed generation 合并机制保持唯一。
- [ ] Run: `pnpm --filter @zero/server exec vitest run tests/unit/mail-channel/imap-smtp/inbound tests/unit/protocol-worker`

### Task 14: 实现 SMTP 冻结 MIME 发送与 uncertain 语义

**Files:**

- Create: `apps/server/src/protocol-worker/smtp/client.ts`
- Create: `apps/server/src/mail-channel/imap-smtp/outbound/adapter.ts`
- Create: `apps/server/src/mail-channel/imap-smtp/outbound/reconciliation.ts`
- Modify: `apps/server/src/mail-channel/imap-smtp/plugin.ts`
- Test: `apps/server/tests/unit/mail-channel/imap-smtp/outbound/adapter.test.ts`
- Test: `apps/server/tests/unit/mail-channel/imap-smtp/outbound/reconciliation.test.ts`

- [ ] 使用现有冻结 envelope 和 MIME 调用 Nodemailer，不重新生成邮件正文。
- [ ] 只有最终 SMTP 2xx/250 响应标记成功；远端标识使用 RFC Message-ID。
- [ ] DATA 之后断连标记 uncertain，默认不盲目重发，由人工或服务商 sent lookup 扩展处理。
- [ ] Run: `pnpm --filter @zero/server exec vitest run tests/unit/mail-channel/imap-smtp/outbound`

### Task 15: 增加渠道全局配置、账户绑定 API 与前端卡片

**Files:**

- Modify: `apps/server/src/db/schema.ts`
- Modify: `apps/server/src/db/template.sql`
- Modify: `apps/server/src/modules/integrations/core/types.ts`
- Modify: `apps/server/src/modules/integrations/core/channel-config-service.ts`
- Modify: `apps/server/src/trpc/routes/integrations.ts`
- Modify: `apps/server/src/trpc/routes/connections.ts`
- Modify: `apps/mail/app/(routes)/settings/integrations/route.tsx`
- Create: `apps/mail/components/integrations/outlook-configuration-dialog.tsx`
- Create: `apps/mail/components/integrations/zoho-mail-configuration-dialog.tsx`
- Create: `apps/mail/components/integrations/imap-smtp-configuration-dialog.tsx`
- Modify: `apps/mail/components/integrations/integration-card.tsx`
- Test: `apps/server/tests/unit/trpc/routes/integrations.test.ts`
- Test: `apps/server/tests/unit/modules/mail-accounts/application/list-nango-channels.test.ts`
- Test: `apps/server/tests/architecture/integrations-ui-boundary.test.ts`

- [ ] 为 Outlook、Zoho 增加全局唯一授权方式选择、Webhook 开关、定时增量开关和间隔。
- [ ] IMAP/SMTP 只提供定时增量配置，不显示 Webhook/Watch。
- [ ] 集成列表只展示 Gmail、Outlook、Zoho Mail、IMAP/SMTP 渠道卡片，不展示 Nango 为独立渠道。
- [ ] 渠道弹窗根据全局授权方式显示 Zero OAuth/Nango integration ID 或本地协议凭据配置。
- [ ] 健康状态来自后端启动验证和渠道配置，不由浏览器直接验证 Nango。
- [ ] Run: `pnpm --filter @zero/server exec vitest run tests/unit/trpc/routes/integrations.test.ts tests/unit/modules/mail-accounts/application/list-nango-channels.test.ts tests/architecture/integrations-ui-boundary.test.ts`

### Task 16: 完整验证与疏漏审查

**Files:**

- Modify as required by failures: `apps/server/src/**`
- Modify as required by failures: `apps/server/tests/**`
- Modify as required by failures: `apps/mail/**`
- Modify: `docs/superpowers/plans/2026-07-28-multi-channel-mail-connectors.md`

- [ ] 运行四渠道插件、凭据、同步、Webhook、出站聚焦测试。
- [ ] 运行 Server 类型检查、lint 和完整 Vitest。
- [ ] 运行 Mail 类型检查、lint 和构建。
- [x] 审查外部请求白名单、日志脱敏、无任意 URL 下载、无第二套同步/发送链路。
- [x] 对照 EmailEngine、sync-engine、Stalwart、Postal 和 Nango integration 行为逐项记录采用/未采用原因。
- [ ] 将本计划完成项全部勾选，并给出仍需真实 Provider 凭据 dry-run 的明确清单。

## 参考项目机制取舍

| 参考来源           | Zero 采用的机制                                                                       | 未直接复制的内容及原因                                                              |
| ------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Stalwart           | 统一邮件领域模型、Provider 与本地邮箱内核分离、投递队列与提交状态分离、幂等与租约思路 | Rust 服务端协议栈、完整 JMAP 服务器和自建 SMTP/MTA；Zero 当前定位是托管外部邮箱账号 |
| EmailEngine        | 连接生命周期、凭据与同步状态分离、IMAP UID/UIDVALIDITY 增量、失败分类                 | 单进程常驻 IMAP/IDLE；Zero 当前仅使用定时增量，并将 TCP/TLS 放入隔离 Node Worker    |
| sync-engine        | 增量游标、断点推进、重叠窗口和 Provider 状态恢复                                      | 旧产品专用数据模型与 Provider 特化业务层；Zero 统一写入本地 mail-core               |
| Postal             | Submission、投递 Spool、成功/失败/不确定状态边界                                      | 自建 SMTP 投递网络；Zero 仅调用 Gmail、Graph、Zoho 或用户 SMTP                      |
| Nango integrations | Provider 标识、凭据形状和通用邮件 `connection_config` 字段                            | Nango Actions/同步脚本/发件脚本；Nango 在 Zero 中只负责凭据托管                     |

## 真实环境验收清单

- [ ] 用户执行 `pnpm install`，确认 `imapflow@1.5.0` 与 `nodemailer@9.0.3` 写入锁文件。
- [ ] 启动 PostgreSQL 后执行数据库模板初始化及 `mail-sync` 集成测试。
- [ ] Outlook：Zero OAuth、Nango OAuth、Inbox Delta、Webhook 验证/通知、MIME 草稿发送和 uncertain 核对。
- [ ] Zoho Mail：各目标数据中心 OAuth/Nango、逐邮箱 Outgoing Webhook、复合游标同步、结构化发送/回复。
- [ ] IMAP/SMTP：公有邮件服务器、显式允许的内网服务器、UIDVALIDITY 恢复、STARTTLS/隐式 TLS 和 SMTP 部分接收。
- [ ] 前端依赖树更新后运行 Mail `tsc --noEmit`、生产构建和真实浏览器连接流程。
