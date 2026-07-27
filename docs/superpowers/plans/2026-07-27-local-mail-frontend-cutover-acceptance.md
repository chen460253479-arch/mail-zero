# Zero 本地邮箱前端切换验收记录

## 验收结论

前端标准邮件链路已切换到统一的本地 Mail API，后端 `appRouter.mail` 只挂载
`mailApiRouter`。原有 `mail`、`drafts`、`labels` 三套旧邮件 Router 已删除，不再保留
新旧邮件运行时兼容层。

本次切换没有改变既定渠道边界：

- 邮件、线程、Mailbox、标签、草稿、附件、Submission 和 Changes 均以本地邮箱内核为
  数据源。
- Gmail 仅负责增量入站和出站投递；前端不读取 Gmail Label、Thread 或 Message DTO。
- Connection 只用于选择对应的本地 Mail Account，不作为邮件资源主键。
- Gmail 原生授权和 Nango 授权继续汇入同一个 Mail Account / Mail Channel 边界。

## 已验收链路

- Mail Account 上下文、用户级持久缓存隔离和 accountId 级 Query Key。
- 标准 Mailbox、自定义文件夹/标签、Snoozed 路由。
- Thread Page Summary、Thread Detail 按需正文加载、本地 Blob 下载。
- 已读、未读、星标、重要、归档、Trash、移动、标签和 Snooze。
- Mailbox Set 管理本地标签和文件夹。
- Draft 创建/更新、`ifDraftRevision`、附件 Blob 上传及复用。
- Identity 选择、EmailSubmission 创建、计划发送和撤销 Submission。
- Changes 分页排空、聚焦与定时收敛、失败后的账户级缓存刷新。
- AI、语音、mailto、收件人建议和导航入口改用本地 Mail API。
- Trash 中的永久删除通过 `mail.action.destroyThreads` 原子删除线程所含 Email。
- E2E 规范会断言 Inbox、Thread Action、Email Set、Submission Set 使用新过程，并拒绝
  已删除的旧邮件过程。

## 删除的旧运行时入口

- `apps/server/src/trpc/routes/mail.ts`
- `apps/server/src/trpc/routes/drafts.ts`
- `apps/server/src/trpc/routes/label.ts`
- `apps/mail/hooks/ui/use-background-queue.ts`
- `apps/mail/store/backgroundQueue.ts`
- `apps/mail/hooks/use-attachments.ts`

## 验证结果

### 通过

- `pnpm --filter mail test`
  - 16 个测试文件通过。
  - 53 项测试通过。
- Mail API、Mail Outbound、Gmail Outbound、运行时边界和 Router 切换测试
  - 30 个测试文件通过。
  - 102 项测试通过。
- `pnpm --filter @zero/server test:mail-core`
  - 75 个测试文件通过，1 个可选规模压测跳过。
  - 304 项测试通过，1 项跳过。
  - 覆盖 PostgreSQL Schema、约束、Changes、Mailbox、Draft、Blob、线程查询、
    入站、Submission、Spool 和出站最终事务。
- 本次前端改动文件的 ESLint
  - 0 error；保留 20 余项既有 Hook dependency warning。
- 本次前端改动路径的定向 TypeScript 检查
  - 0 error。
- 本次服务端改动路径的定向 TypeScript 检查
  - 0 error。
- `pnpm --filter @zero/testing exec tsc --noEmit --pretty false`
  - 通过。
- 邮件 E2E 用例发现
  - setup、mail-actions、mail-inbox 共 3 个用例可被 Playwright 正确加载。
- `pnpm --filter mail build`
  - 客户端和 SSR 生产构建通过，退出码为 0。
- 旧 Router 与调用检索
  - 没有生产代码引用旧 `mail/drafts/labels` 邮件过程。

### 仓库既有基线

- 全量前端 TypeScript 检查仍有 92 项既有错误，主要来自其他表单的
  Zod / Hook Form 类型版本不兼容、旧 AI 组件和缺失的 editor 模块；本次改动路径为
  0 项。
- 全量服务端 TypeScript 检查仍有 77 项既有错误，主要来自未生成完整的 Cloudflare
  `Env` 类型以及旧 Driver / Agent 路径；本次 Mail API 改动路径为 0 项。
- 全量前端 ESLint 仍有 154 项既有错误，集中在认证页、静态页面、命令面板、旧 UI 和
  生成文件；本次改动文件为 0 项错误。
- 生产构建会输出既有的 oxlint 子进程 PATH、CSS minify 和大 chunk 警告，但构建成功。

## 未执行的外部环境验证

当前 `http://localhost:3000` 没有运行中的前端服务，且当前执行环境没有可用于真实登录和
实际投递的 E2E 会话，因此没有执行会产生真实邮件的浏览器测试。E2E 规范已完成类型检查
和 Playwright 用例发现；在本地前后端、PostgreSQL、Worker 和测试账户均启动后，可执行：

```bash
pnpm --filter @zero/testing test:e2e -- e2e/mail-inbox.spec.ts e2e/mail-actions.spec.ts
```

该限制不影响本地邮箱内核、API 合同、PostgreSQL 事务和生产构建的自动化验收结论。
