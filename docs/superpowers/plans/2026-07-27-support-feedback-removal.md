# Support and Feedback Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完整移除 Live Support、Feedback 外链及其 Intercom 专用运行时和依赖。

**Architecture:** 使用现有架构测试固化禁止项，再从侧边栏、tRPC、图标、多语言资源和依赖清单同步删除。保留 `userRouter` 的账户删除能力和所有邮件职责。

**Tech Stack:** TypeScript、React Router、tRPC、Vitest、pnpm lockfile、Paraglide

## Global Constraints

- 不修改 Mail Core、同步、发件、数据库或 Docker。
- 不执行依赖安装；直接维护 manifest 与 lockfile。
- 只删除产品级 Support/Feedback 能力，不删除邮件正文中的普通 “feedback” 文本。

---

## Task 1: 用架构测试固化删除边界

**Files:**
- Modify: `apps/server/src/no-agent-ai-surface.test.ts`

**Interfaces:**
- Consumes: 仓库源码与应用 manifest。
- Produces: 禁止 Support/Feedback 运行时重新出现的静态架构约束。

- [ ] 增加测试，扫描 `nav-main.tsx`、`user.ts`、两个应用 manifest 与图标文件。
- [ ] 禁止 `@intercom/messenger-js-sdk`、`getIntercomToken`、
      `feedback.0.email`、`Live Support`、`OldPhone` 和 `MessageSquare`。
- [ ] 运行：

```powershell
pnpm --filter @zero/server exec vitest run src/no-agent-ai-surface.test.ts
```

预期：测试因现有 Support/Feedback 实现而失败。

## Task 2: 删除运行时、资源与依赖

**Files:**
- Modify: `apps/mail/components/ui/nav-main.tsx`
- Modify: `apps/server/src/trpc/routes/user.ts`
- Modify: `apps/mail/components/icons/icons.tsx`
- Modify: `apps/mail/messages/*.json`
- Modify: `apps/mail/package.json`
- Modify: `apps/server/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: Task 1 的禁止项。
- Produces: 不包含 Support/Feedback 产品能力的前后端。

- [ ] 删除侧边栏入口、Intercom 查询和初始化。
- [ ] 删除后端令牌接口，同时保留 `user.delete`。
- [ ] 删除无引用图标和 19 个语言文件中的两项导航文案。
- [ ] 删除两个专用依赖及 lockfile 对应 importer、package、snapshot 记录。
- [ ] 重新运行 Task 1 测试，预期全部通过。

## Task 3: 静态与构建验收

**Files:**
- Verify only.

**Interfaces:**
- Consumes: 完成删除后的源码。
- Produces: 可提交的验证证据。

- [ ] 运行服务端与前端 TypeScript 检查。
- [ ] 运行相关 ESLint 检查。
- [ ] 运行前端生产构建，确认 Paraglide 与 React Router 构建成功。
- [ ] 使用 `git grep` 确认只剩邮件正文语义中的普通 “feedback”。
- [ ] 检查 `git diff --check` 并提交。

