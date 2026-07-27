# Agent Chat Brain Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完整移除 Agent、Chat、Brain、MCP/Thinking、线程 AI 工作流以及邮件 AI 写作/搜索/摘要能力，同时保持标准邮箱、账户、设置、备注和模板功能可构建。

**Architecture:** 后端只暴露邮箱 API 与非 AI 通用业务；前端只消费本地邮箱 API。删除能力而不是保留兼容路由或空壳，随后按实际引用收敛依赖和环境配置。

**Tech Stack:** TypeScript、Hono、tRPC、React Router、Cloudflare Workers、Vitest、ESLint

## Global Constraints

- 本计划依赖账户生命周期已不再调用 Brain 或 Agent。
- 不删除标准邮件主题归一化、普通搜索、备注、模板、BIMI、设置等非 AI 能力。
- 先移除调用面，再删除实现和依赖；每一步用引用扫描防止误删。

---

## Task 1: 删除后端 AI/Brain 公共接口

**Files:**
- Delete: `apps/server/src/trpc/routes/ai/**`
- Delete: `apps/server/src/trpc/routes/brain.ts`
- Delete: `apps/server/src/routes/ai.ts`
- Modify: `apps/server/src/trpc/index.ts`
- Modify: `apps/server/src/main.ts`
- Create: `apps/server/src/no-agent-ai-surface.test.ts`

- [ ] 写架构失败测试，禁止 `/ai`、`trpc.ai`、`trpc.brain`、Agent 中间件和 MCP mount。
- [ ] 从 tRPC 根路由与 Hono 删除所有 AI/Brain 路由。
- [ ] 删除 ElevenLabs/电话 AI 专用入口；保留与邮箱无关但仍明确在用的普通集成。
- [ ] 运行：

```powershell
pnpm --filter @zero/server exec vitest run src/no-agent-ai-surface.test.ts
```

## Task 2: 删除 Agent、Chat、Brain 与工作流实现

**Files:**
- Delete: `apps/server/src/routes/agent/**`
- Delete: `apps/server/src/lib/brain.ts`
- Delete: `apps/server/src/lib/brain.test.ts`
- Delete: `apps/server/src/lib/brain.fallback.prompts.ts`
- Delete: `apps/server/src/lib/sequential-thinking.ts`
- Delete: `apps/server/src/pipelines.ts`
- Delete: `apps/server/src/pipelines.effect.ts`
- Delete: `apps/server/src/thread-workflow-utils/**`
- Delete: `apps/server/src/workflows/sync-threads-coordinator-workflow.ts`
- Delete: `apps/server/src/workflows/sync-threads-workflow.ts`
- Delete: `apps/server/src/services/call-service/system-prompt.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/src/lib/server-utils.ts`

- [ ] 移除所有 DO/Workflow 类导入、导出、队列分支、辅助方法和 prompt 存储逻辑。
- [ ] 保留 `ZeroDB` 暂时承载的非邮件 Notes/Templates/Settings 方法；本计划不顺带重写这些业务。
- [ ] 用 `git grep` 确认不存在对已删路径的运行时代码引用。
- [ ] 运行：

```powershell
pnpm --filter @zero/server exec vitest run src/no-agent-ai-surface.test.ts src/mail-architecture.test.ts
```

## Task 3: 删除前端 AI 能力并恢复纯邮箱交互

**Files:**
- Delete: `apps/mail/components/ai-toggle-button.tsx`
- Delete: `apps/mail/components/ui/ai-sidebar.tsx`
- Delete: `apps/mail/components/create/ai-chat.tsx`
- Delete: `apps/mail/components/ui/prompts-dialog.tsx`
- Delete: `apps/mail/hooks/use-summary.ts`
- Delete: `apps/mail/lib/server-tool.ts`
- Modify: `apps/mail/components/context/command-palette-context.tsx`
- Modify: `apps/mail/components/create/email-composer.tsx`
- Modify: `apps/mail/components/mail/mail-display.tsx`
- Modify: `apps/mail/components/mail/mail.tsx`
- Modify: `apps/mail/components/mail/thread-display.tsx`
- Modify: `apps/mail/components/ui/app-sidebar.tsx`
- Modify: `apps/mail/hooks/use-search-value.ts`
- Modify: `apps/mail/providers/voice-provider.tsx`

- [ ] 写/更新组件测试，命令面板只执行标准邮箱搜索，编辑器不显示 AI 写作/主题按钮，邮件显示不触发 Web Search。
- [ ] 移除 AI sidebar、摘要、写作、自然语言搜索与语音 Agent 入口。
- [ ] 保留普通全文搜索、编辑草稿、回复/转发、附件和模板功能。
- [ ] 删除无引用 AI 静态资源。
- [ ] 运行：

```powershell
pnpm --filter @zero/mail test
pnpm --filter @zero/mail lint
```

## Task 4: 收敛依赖、脚本和环境类型

**Files:**
- Modify: `apps/server/package.json`
- Modify: `apps/mail/package.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/server/src/env.ts`
- Modify: `apps/server/worker-configuration.d.ts`

- [ ] 通过 `git grep` 逐项确认无引用后，删除 Agent/AI/MCP/ElevenLabs/模型供应商依赖。
- [ ] 删除 `test:ai`、`eval*` 等无实现脚本；保留仍由非 AI 功能使用的依赖。
- [ ] 手工更新 package 清单后使用现有 lockfile 工具链更新锁文件；不得执行安装命令。
- [ ] 从 `ZeroEnv` 删除 AI、Brain、Agent、MCP、Workflow 专用绑定和密钥类型。
- [ ] 运行：

```powershell
pnpm --filter @zero/server lint
pnpm --filter @zero/mail lint
pnpm --filter @zero/server exec tsc --noEmit
pnpm --filter @zero/mail exec tsc --noEmit
```

## Task 5: 第二阶段验收

- [ ] 扫描：

```powershell
git grep -n -E "Agent|Brain|trpc\.ai|trpc\.brain|aiRouter|ZeroMCP|ThinkingMCP|WorkflowRunner|THREAD_SYNC"
```

预期：只允许历史设计/计划文档中出现。

- [ ] 构建：

```powershell
pnpm --filter @zero/server exec wrangler deploy --dry-run --env local
pnpm --filter @zero/mail build
```

- [ ] 提交：

```powershell
git add apps/server apps/mail package.json pnpm-lock.yaml
git commit -m "refactor: remove agent chat brain and mail ai"
```
