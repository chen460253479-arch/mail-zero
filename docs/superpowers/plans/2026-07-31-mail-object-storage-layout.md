# Mail Object Storage Layout Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将附件、草稿 MIME 和真实邮件 MIME 按用户、邮箱账户和业务类别存入对象存储。

**Architecture:** Blob 元数据新增业务类别；对象键统一由用户 ID、邮箱账户 ID、类别和
SHA-256 构造。附件上传、草稿、入站邮件和出站投递分别显式选择类别，对账与垃圾回收
使用同一对象键规则。

**Tech Stack:** TypeScript、PostgreSQL/Drizzle、S3-compatible object storage、Vitest。

---

### Task 1: 固定对象键与 Blob 类别契约

**Files:**

- Modify: `packages/mail-core/src/store/blob-store.ts`
- Modify: `apps/server/src/modules/mail/blob/blob-key.ts`
- Test: `apps/server/tests/unit/mail-core/blob-key.test.ts`

1. 先增加三类持久对象键和分类临时键的失败测试。
2. 定义 `BlobKind`，实现构造、解析和账户边界校验。
3. 运行对象键单元测试。

### Task 2: 接入附件、草稿和入站邮件

**Files:**

- Modify: `packages/mail-core/src/blob/blob-lifecycle.ts`
- Modify: `packages/mail-core/src/blob/upload-blob.ts`
- Modify: `packages/mail-core/src/message/create-draft.ts`
- Modify: `packages/mail-core/src/message/import-email.ts`
- Test: `packages/mail-core/tests/blob/upload-blob.test.ts`
- Test: `packages/mail-core/tests/message/draft.test.ts`
- Test: `packages/mail-core/tests/message/import-email.test.ts`

1. 先断言三个入口生成不同 `kind` 和对象目录。
2. 让准备对象携带 `userId` 与 `kind`。
3. 分别接入 `attachment`、`draft_mime`、`message_mime`。

### Task 3: 固化出站真实 MIME

**Files:**

- Modify: `packages/mail-core/src/submission/create-submission.ts`
- Modify: `packages/mail-core/src/submission/finalize-submission-sent.ts`
- Modify: `apps/server/src/modules/mail-outbound/application/enqueue-submission.ts`
- Test: `packages/mail-core/tests/submission/submission.test.ts`

1. 先断言提交引用独立 `message_mime` Blob。
2. 创建提交前复制并固化草稿 MIME。
3. 服务商确认成功后让邮件切换到提交 Blob。

### Task 4: 数据库模板与存储适配器

**Files:**

- Modify: `apps/server/src/modules/mail/postgres/schema/blobs.ts`
- Modify: `apps/server/src/modules/mail/postgres/repositories/blob-repository.ts`
- Modify: `apps/server/src/db/migrations/0000_big_ultron.sql`
- Modify: `apps/server/src/db/migrations/meta/0000_snapshot.json`
- Modify: local/memory/S3 BlobStore implementations and tests

1. Blob 表增加 `kind`，唯一键包含 `kind`。
2. 适配器保存并按类别查询。
3. 更新唯一开发数据库初始化模板和结构快照。

### Task 5: 对账、垃圾回收与回归验证

**Files:**

- Modify: `packages/mail-core/src/blob/reconcile-blob-storage.ts`
- Modify: `packages/mail-core/src/message/garbage-collect-blobs.ts`
- Test: related blob maintenance tests

1. 分类别扫描持久对象和临时对象。
2. 使用账户所有者、类别和摘要校验对象键。
3. 运行 mail-core、server 相关测试和触及文件静态检查。
