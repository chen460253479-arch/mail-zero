# S3 Raw MIME Blob Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Zero 邮件内容存储改为 S3 兼容的单一完整 MIME 对象，并以 PostgreSQL
BlobSection 元数据读取正文、附件和内联资源，同时修复 Blob HTTP 路由边界。

**Architecture:** `postal-mime` 保留语义解析职责，新的字节索引器负责 MIME Part 原始区间；
`mail.email` 指向不可变 Raw MIME，正文作为 PostgreSQL 查询投影，Part 只引用 Raw MIME
区间；Submission 冻结唯一 Raw Blob；Server 通过必填环境变量创建 `S3BlobStore`，
Docker 不内置对象存储服务。开发库直接清空重建，不实现旧字段迁移或双读。

**Tech Stack:** TypeScript、PostgreSQL 17、Drizzle ORM、AWS SDK v3、Hono、
postal-mime、Vitest、Docker Compose

## Global Constraints

- 不修改 `apps/mail` 中文本地化工作；
- 不创建 Git worktree；
- 不保留 LocalBlobStore 生产回退或旧数据兼容层；
- 每项实现先增加失败测试，再编写最小实现；
- 测试文件只放在现有 `tests/` 目录；
- 不把 S3 凭据、邮件正文或附件内容写入日志；
- 不自行执行依赖安装或 Docker 构建，需要安装/构建时明确交给用户；
- 以 `docs/superpowers/specs/2026-07-30-s3-raw-mime-blob-sections-design.md`
  为架构事实来源。

---

## Task 1：隔离 tRPC 与 Blob HTTP 路由

**Files:**

- Modify: `apps/server/src/runtime/node/application.ts`
- Modify: `apps/server/tests/unit/runtime/node/application.test.ts`
- Modify: `apps/server/tests/unit/modules/mail-api/http/blob-routes.test.ts`

- [ ] 增加回归测试：`/api/mail/**` 进入 Blob 路由，`/api/trpc/**` 才进入 tRPC。
- [ ] 将 tRPC middleware 显式限制在 `/api/trpc/*`。
- [ ] 保留 Auth、Webhook、OAuth 和健康检查现有路由顺序。
- [ ] 运行：
      `pnpm --dir apps/server exec vitest run tests/unit/runtime/node/application.test.ts tests/unit/modules/mail-api/http/blob-routes.test.ts`

## Task 2：实现原始 MIME BlobSection 索引器

**Files:**

- Create: `packages/mail-core/src/message/mime-section-index.ts`
- Modify: `packages/mail-core/src/message/types.ts`
- Modify: `packages/mail-core/src/message/mime.ts`
- Modify: `packages/mail-core/src/index.ts`
- Create: `packages/mail-core/tests/message/mime-section-index.test.ts`
- Modify: `packages/mail-core/tests/message/mime.test.ts`

- [ ] 用 fixtures 建立 CRLF/LF、mixed、alternative、related、嵌套 multipart 测试。
- [ ] 覆盖 `7bit`、`8bit`、`binary`、`base64`、`quoted-printable`。
- [ ] 定义 `TransferEncoding` 与 `BlobSection`，所有偏移按原始字节计算。
- [ ] 实现安全 header 扫描、boundary 递归和叶子 Part 编号。
- [ ] 将 Section 与 `postal-mime` 结果按 `partPath` 对齐。
- [ ] 增加越界、错误 boundary、解码长度不一致的失败测试。
- [ ] 运行：
      `pnpm --filter @zero/mail-core exec vitest run tests/message/mime-section-index.test.ts tests/message/mime.test.ts`

## Task 3：改造 PostgreSQL 最终初始化模板

**Files:**

- Modify: `apps/server/src/modules/mail/postgres/schema/emails.ts`
- Modify: `apps/server/src/modules/mail/postgres/schema/submissions.ts`
- Modify: `apps/server/src/modules/mail/postgres/repositories/email-record-mapper.ts`
- Modify: `apps/server/src/modules/mail/postgres/repositories/email-repository.ts`
- Modify: `apps/server/src/modules/mail/postgres/repositories/submission-repository.ts`
- Modify: `apps/server/tests/helpers/mail-core/schema-contract.ts`
- Modify: `apps/server/tests/unit/mail-core/schema-definition.test.ts`
- Modify: `apps/server/tests/unit/mail-core/schema-structure-parity.test.ts`
- Modify: `apps/server/tests/unit/mail-core/__snapshots__/schema-structure-parity.test.ts.snap`
- Modify: `apps/server/tests/integration/mail-core/constraints.integration.test.ts`
- Modify: `apps/server/tests/integration/mail-core/drafts.integration.test.ts`
- Modify: `apps/server/tests/integration/mail-core/submissions.integration.test.ts`

- [ ] 先让 Schema 测试断言不存在 `text_blob_id`、`html_blob_id`、Part `blob_id`
      和 `submission_blob`。
- [ ] 为 `email_content` 增加 `text_body`、`html_body`。
- [ ] 为 `email_part` 增加 Raw BlobSection 字段、复合外键和非负/编码约束。
- [ ] 将 Submission 改成单一冻结 Raw Blob 快照。
- [ ] 更新 Repository 映射和模板快照，不创建时间线迁移。
- [ ] 运行：
      `pnpm --dir apps/server exec vitest run tests/unit/mail-core/schema-definition.test.ts tests/unit/mail-core/schema-structure-parity.test.ts`

## Task 4：收敛收件导入为唯一 Raw MIME

**Files:**

- Modify: `packages/mail-core/src/message/import-email.ts`
- Modify: `packages/mail-core/src/message/types.ts`
- Modify: `packages/mail-core/src/store/records.ts`
- Modify: `packages/mail-core/src/store/repositories.ts`
- Modify: `packages/mail-core/tests/message/import-email.test.ts`
- Modify: `apps/server/tests/integration/mail-core/import-email.integration.test.ts`
- Modify: `apps/server/tests/integration/mail-sync/import.integration.test.ts`

- [ ] 增加测试：一次导入只产生一个 Ready 永久对象。
- [ ] 保存正文投影和每个 Part 的 BlobSection，不保存正文/附件 Blob。
- [ ] 验证每个 Section 在 Raw Blob 范围内且可正确解码。
- [ ] 保持远端邮件幂等映射、线程计算和本地 Inbox 状态不变。
- [ ] 运行：
      `pnpm --filter @zero/mail-core exec vitest run tests/message/import-email.test.ts`

## Task 5：收敛草稿修订与临时附件生命周期

**Files:**

- Modify: `packages/mail-core/src/message/create-draft.ts`
- Modify: `packages/mail-core/src/message/update-draft.ts`
- Modify: `packages/mail-core/src/message/render-draft.ts`
- Modify: `packages/mail-core/src/message/destroy-email.ts`
- Modify: `packages/mail-core/tests/message/draft.test.ts`
- Modify: `packages/mail-core/tests/message/destroy-email.test.ts`
- Modify: `apps/server/tests/integration/mail-core/drafts.integration.test.ts`

- [ ] 测试每次内容修改只生成一个新的完整 MIME 对象并递增修订号。
- [ ] 上传附件只作为暂存输入；完成 Raw MIME 后不再成为 Email Part 的永久 Blob。
- [ ] `email_content` 保存新正文投影，Part 保存新 Raw Section。
- [ ] Bcc 保留为私有投递元数据，最终待发送 MIME 不输出 Bcc header。
- [ ] 旧草稿 Raw Blob 只有在无 Submission 引用后才允许 GC。
- [ ] 运行：
      `pnpm --filter @zero/mail-core exec vitest run tests/message/draft.test.ts tests/message/destroy-email.test.ts`

## Task 6：将 EmailSubmission 收敛为冻结 Raw Blob

**Files:**

- Modify: `packages/mail-core/src/submission/create-submission.ts`
- Modify: `packages/mail-core/src/submission/finalize-submission-sent.ts`
- Modify: `packages/mail-core/src/submission/types.ts`
- Modify: `packages/mail-core/src/store/records.ts`
- Modify: `packages/mail-core/tests/submission/submission.test.ts`
- Modify: `packages/mail-core/tests/submission/finalize-submission-sent.test.ts`
- Modify: `apps/server/src/modules/mail-outbound/application/deliver.ts`
- Modify: `apps/server/tests/unit/modules/mail-outbound/application/deliver.test.ts`

- [ ] 测试 Submission 只冻结当前修订的一个 Raw Blob。
- [ ] 投递 Worker 只读取冻结 Raw MIME，不从当前 Draft 重新渲染。
- [ ] 发送成功复用同一 Blob，将 Draft 转为 Sent 并记录服务商 ID。
- [ ] 草稿后续修改不得改变已排队 Submission 的发送内容。
- [ ] 运行 Mail Core Submission 与 Outbound 定向测试。

## Task 7：重写 GC、配额和 Part 读取

**Files:**

- Modify: `packages/mail-core/src/message/garbage-collect-blobs.ts`
- Modify: `packages/mail-core/src/blob/read-blob-range.ts`
- Create: `packages/mail-core/src/message/read-email-part.ts`
- Modify: `packages/mail-core/src/index.ts`
- Modify: `packages/mail-core/tests/message/garbage-collect-blobs.test.ts`
- Create: `packages/mail-core/tests/message/read-email-part.test.ts`
- Modify: `apps/server/src/modules/mail-api/http/blob-routes.ts`
- Modify: `apps/server/tests/unit/modules/mail-api/http/blob-routes.test.ts`

- [ ] GC 只统计 Raw MIME、Submission 和有效暂存引用。
- [ ] Part 读取使用 `getRange`，按传输编码解码并校验长度。
- [ ] 正文读取改用 PostgreSQL 投影，不再读取正文 Blob。
- [ ] 附件 HTTP 响应使用安全 Content-Type/Disposition。
- [ ] 测试标签、已读和移动邮箱操作不会产生 BlobStore 写入。

## Task 8：实现 S3BlobStore

**Files:**

- Modify: `apps/server/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/server/src/modules/mail/blob/s3-blob-store.ts`
- Create: `apps/server/src/modules/mail/blob/s3-client.ts`
- Create: `apps/server/tests/unit/mail-core/s3-blob-store.test.ts`
- Modify: `apps/server/tests/unit/mail-core/runtime-boundary.test.ts`

- [ ] 先使用 Mock S3 client 测试临时写入、提交、幂等重复提交、Get、Range、
      Delete 和分页 List。
- [ ] 使用 AWS SDK v3 实现自定义 Endpoint、Region、Bucket、Prefix 和 Path Style。
- [ ] 提交采用服务端 Copy + 校验 + 删除临时对象，目标对象保持内容寻址。
- [ ] 区分 Not Found、完整性错误和存储服务故障，不泄漏凭据。
- [ ] 增加启动探针所需的 Bucket 访问与临时对象往返验证。
- [ ] 依赖安装由用户显式执行；代码完成后只给出命令。

## Task 9：接入运行时环境与外部 S3

**Files:**

- Modify: `apps/server/src/runtime/node/config.ts`
- Modify: `apps/server/src/runtime/node/main.ts`
- Modify: `apps/server/src/runtime/node/lifecycle.ts`
- Modify: `apps/server/tests/unit/runtime/node/config.test.ts`
- Modify: `apps/server/tests/unit/runtime/node/lifecycle.test.ts`
- Modify: `compose.yaml`
- Modify: `.env.example`
- Modify: `apps/server/tests/architecture/docker-development-stack.test.ts`
- Modify: `apps/server/tests/architecture/docker-server-immutable-runtime.test.ts`

- [ ] 配置测试要求 `MAIL_BLOB_STORE=s3` 和完整 S3 参数。
- [ ] Server 启动时创建并验证 S3BlobStore；失败直接终止启动。
- [ ] Compose 仅透传必填 S3 参数，不增加本地对象存储或 Bucket 初始化服务。
- [ ] 移除 `MAIL_BLOB_ROOT`、Local Blob 卷和生产 LocalBlobStore 装配。
- [ ] 保留 LocalBlobStore 仅作单元测试夹具；运行时不可选择本地回退。
- [ ] 用户配置已有私有 S3、完成镜像构建后执行外部 S3 集成验收。

## Task 10：全链路回归与死代码清理

**Files:**

- Modify: `packages/mail-core/tests/mail-core.test.ts`
- Modify: `apps/server/tests/integration/mail-core/final-review-invariants.integration.test.ts`
- Modify: `apps/server/tests/integration/mail-core/blob-maintenance.integration.test.ts`
- Modify: `apps/server/tests/integration/mail-core/search.integration.test.ts`
- Modify: `apps/server/tests/architecture/mail-architecture.test.ts`
- Delete/Modify: 所有只服务于正文 Blob、附件永久 Blob、`submission_blob` 的实现和测试

- [ ] 收件、草稿多修订、发送成功、发送失败重试、附件 Range、状态修改、永久删除、
      GC 和搜索形成完整验收矩阵。
- [ ] 搜索源码中旧字段和旧模型标识，确保零运行时代码引用。
- [ ] 运行：
      `pnpm --filter @zero/mail-core test`
- [ ] 运行：
      `pnpm --dir apps/server test:mail-core`
- [ ] 运行：
      `pnpm --dir apps/server typecheck`（如无脚本则使用仓库现有 TypeScript 检查命令）。
- [ ] 运行相关 lint/格式检查，不修改无关前端文件。
- [ ] 报告需要用户执行的 `pnpm install --frozen-lockfile`、`db:push` 和 Docker
      构建/验收命令；不代替用户执行。
