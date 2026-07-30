# 简体中文全量多语言 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Zero Mail 增加仅使用 `zh` 标识的简体中文界面，并将全部面向用户的英文硬编码迁移到 Paraglide。

**Architecture:** 继续以 `apps/mail/messages/en.json` 作为基础语言目录，新增结构完全对等的 `apps/mail/messages/zh.json`。页面、组件、通知、错误提示和无障碍文本统一通过 `@/paraglide/messages` 的 `m` 读取；实施过程中由执行者进行全量静态审查，不向仓库增加审计器或新的检查基础设施。

**Tech Stack:** React Router 7、React 19、TypeScript、Paraglide JS / Inlang、Vitest、date-fns。

## Global Constraints

- 默认语言保持 `en`。
- 简体中文语言标识和文件名统一使用 `zh`；不配置 `zh-CN` 或 `zh-TW`。
- 本阶段只增加简体中文，不增加繁体中文。
- 所有面向用户的静态文本必须从 Paraglide 消息目录读取，包括 JSX 文本、占位符、标题、Toast、确认文案、错误提示和无障碍标签。
- 邮件正文、主题、联系人名称、用户输入、URL、协议字段、服务端错误码、CSS token 和原始快捷键不作为静态界面文案迁移。
- 品牌名允许中英文显示相同，但仍必须通过消息键读取。
- “硬编码检查”由执行者通过临时只读检索和逐文件审查完成；临时扫描脚本、结果文件和审计代码不提交到仓库。
- 不自动执行构建、打包、Docker 构建或 Docker 重启；只执行测试、类型检查和只读静态检查。
- 所有 Git 暂存使用明确文件路径，避免混入无关改动。
- 按仓库约束直接在 `D:\WorkSpace\Zero` 当前功能分支工作，不创建 worktree。

---

### Task 1: 建立 `zh` 语言目录与目录对等验证

**Files:**
- Create: `apps/mail/messages/zh.json`
- Create: `apps/mail/modules/i18n/message-catalog.test.ts`
- Modify: `apps/mail/project.inlang/settings.json`
- Modify: `apps/mail/locales.ts`

**Interfaces:**
- Produces: 配置语言 `zh`、显示名 `简体中文`，以及 `en`/`zh` 叶子消息键完全一致的约束。

- [x] **Step 1: 先写失败测试，验证默认语言、`zh` 配置和目录键对等**
- [x] **Step 2: 运行测试并确认因缺少 `zh` 失败**
- [x] **Step 3: 增加 `zh` 配置并完成现有消息目录的简体中文翻译**
- [x] **Step 4: 运行目录测试和类型检查**
- [x] **Step 5: 提交语言基础设施**

验证命令：

```bash
pnpm --dir apps/mail test -- modules/i18n/message-catalog.test.ts
pnpm --dir apps/mail exec tsc --noEmit
```

### Task 2: 建立全量审查清单

**Files:**
- Read only: `apps/mail/app/**/*.ts`
- Read only: `apps/mail/app/**/*.tsx`
- Read only: `apps/mail/components/**/*.ts`
- Read only: `apps/mail/components/**/*.tsx`
- Read only: `apps/mail/config/**/*.ts`
- Read only: `apps/mail/hooks/**/*.ts`
- Read only: `apps/mail/hooks/**/*.tsx`
- Read only: `apps/mail/lib/**/*.ts`
- Read only: `apps/mail/lib/**/*.tsx`

**Interfaces:**
- Produces: 按文件分组的待迁移静态英文清单，仅用于当前实施过程，不写入仓库。

- [ ] **Step 1: 检索 JSX 文本和 JSX 展示属性中的英文**

覆盖普通 JSX 文本以及 `alt`、`aria-label`、`aria-description`、`placeholder`、`title`、`label`。

- [ ] **Step 2: 检索 Toast、确认框、错误提示和空状态中的英文**

覆盖 `toast.*`、直接展示的错误字符串、对话框标题/说明、加载和空状态。

- [ ] **Step 3: 检索页面与导航展示配置中的英文**

覆盖 `label`、`title`、`description`、`subtitle`、`emptyText` 等配置字段，并人工排除内部技术值。

- [ ] **Step 4: 将结果按后续任务分组**

分为应用外壳与公共页面、邮箱与撰写、设置与集成、通用 UI 与无障碍四组。检索过程只读，不新增任何仓库文件。

### Task 3: 迁移应用外壳、认证、主页与公共页面

**Files:**
- Modify: `apps/mail/messages/en.json`
- Modify: `apps/mail/messages/zh.json`
- Modify: `apps/mail/app/root.tsx`
- Modify: `apps/mail/app/meta-files/not-found.ts`
- Modify: `apps/mail/app/(auth)/**/*.tsx`
- Modify: `apps/mail/app/(full-width)/**/*.tsx`
- Modify: `apps/mail/app/(routes)/developer/page.tsx`
- Modify: `apps/mail/app/(routes)/mail/under-construction/**/*.tsx`
- Modify: `apps/mail/components/home/**/*.tsx`
- Modify: `apps/mail/components/navigation.tsx`
- Modify: `apps/mail/components/keyboard-layout-indicator.tsx`
- Modify: `apps/mail/components/cookies/cookie-trigger.tsx`
- Modify: `apps/mail/components/ui/app-sidebar.tsx`
- Modify: `apps/mail/components/ui/nav-main.tsx`
- Modify: `apps/mail/components/ui/nav-user.tsx`
- Modify: `apps/mail/config/navigation.ts`
- Modify: `apps/mail/lib/site-config.ts`

- [ ] **Step 1: 根据审查清单为静态文案增加语义化 `en`/`zh` 消息键**
- [ ] **Step 2: 将 JSX、展示属性、Toast 和展示配置替换为 `m.*()`**
- [ ] **Step 3: 重新只读检索本批文件并逐条确认真实英文硬编码已清零**
- [ ] **Step 4: 运行消息目录测试和类型检查**
- [ ] **Step 5: 使用明确文件路径提交本批改动**

### Task 4: 迁移邮箱、邮件详情、撰写与搜索交互

**Files:**
- Modify: `apps/mail/messages/en.json`
- Modify: `apps/mail/messages/zh.json`
- Modify: `apps/mail/app/mailto-handler.ts`
- Modify: `apps/mail/app/(routes)/mail/**/*.tsx`
- Modify: `apps/mail/components/context/**/*.tsx`
- Modify: `apps/mail/components/create/**/*.ts`
- Modify: `apps/mail/components/create/**/*.tsx`
- Modify: `apps/mail/components/mail/**/*.ts`
- Modify: `apps/mail/components/mail/**/*.tsx`
- Modify: `apps/mail/hooks/use-compose-editor.ts`
- Modify: `apps/mail/hooks/use-copy-to-clipboard.ts`
- Modify: `apps/mail/hooks/use-drafts.ts`
- Modify: `apps/mail/hooks/use-optimistic-actions.ts`
- Modify: `apps/mail/hooks/use-undo-send.ts`
- Modify: `apps/mail/lib/email-utils.client.tsx`
- Modify: `apps/mail/lib/email-utils.ts`
- Modify: `apps/mail/lib/hotkeys/**/*.tsx`
- Modify: `apps/mail/lib/optimistic-actions-manager.ts`

- [ ] **Step 1: 按邮件领域增补双语消息键，动态内容使用参数**
- [ ] **Step 2: 迁移邮箱、邮件详情、附件、撰写器、搜索和命令面板**
- [ ] **Step 3: 保持邮件正文、主题、地址、附件名、路由和协议值不变**
- [ ] **Step 4: 重新只读检索本批文件并运行目录测试、邮件测试和类型检查**
- [ ] **Step 5: 使用明确文件路径提交本批改动**

### Task 5: 迁移设置、连接与集成界面

**Files:**
- Modify: `apps/mail/messages/en.json`
- Modify: `apps/mail/messages/zh.json`
- Modify: `apps/mail/app/(routes)/settings/**/*.tsx`
- Modify: `apps/mail/components/connection/**/*.tsx`
- Modify: `apps/mail/components/integrations/**/*.tsx`
- Modify: `apps/mail/components/labels/**/*.tsx`
- Modify: `apps/mail/components/settings/**/*.tsx`

- [ ] **Step 1: 为设置、连接和集成静态文案增补双语消息键**
- [ ] **Step 2: 迁移所有设置页面和连接对话框**
- [ ] **Step 3: 保持渠道 ID、连接 ID、邮箱、主机、端口和外部数据不变**
- [ ] **Step 4: 重新只读检索本批文件并运行目录测试、连接测试和类型检查**
- [ ] **Step 5: 使用明确文件路径提交本批改动**

### Task 6: 迁移通用 UI、无障碍文本和剩余通知

**Files:**
- Modify: `apps/mail/messages/en.json`
- Modify: `apps/mail/messages/zh.json`
- Modify: `apps/mail/components/responsive-modal.tsx`
- Modify: `apps/mail/components/theme/**/*.tsx`
- Modify: `apps/mail/components/ui/**/*.tsx`
- Modify: `apps/mail/hooks/driver/use-delete.ts`
- Modify: `apps/mail/hooks/use-notes.tsx`
- Modify: `apps/mail/lib/notes-utils.ts`

- [ ] **Step 1: 为真正面向用户的默认文本增加双语消息键**
- [ ] **Step 2: 迁移屏幕阅读器标签、Tooltip、主题和 Notes 文案**
- [ ] **Step 3: 保持调用方传入的动态展示值不变**
- [ ] **Step 4: 重新只读检索本批文件并运行目录测试和类型检查**
- [ ] **Step 5: 使用明确文件路径提交本批改动**

### Task 7: 本地化日期和相对时间

**Files:**
- Create: `apps/mail/lib/i18n/date-locale.ts`
- Create: `apps/mail/lib/i18n/date-locale.test.ts`
- Modify: user-visible `date-fns` call sites under `apps/mail/app` and `apps/mail/components`

**Interfaces:**
- Produces: `getDateLocale(locale?: string): Locale | undefined`；`zh` 返回 `date-fns/locale` 的 `zhCN`，`en` 保持默认行为。

- [ ] **Step 1: 先写 `zh`/`en` locale 映射失败测试**
- [ ] **Step 2: 实现最小 locale 映射**
- [ ] **Step 3: 仅将用户可见日期格式化接入当前 locale**
- [ ] **Step 4: 运行日期测试和类型检查**
- [ ] **Step 5: 使用明确文件路径提交本批改动**

### Task 8: 全量人工复审与最终验证

**Files:**
- Review: `apps/mail/app`
- Review: `apps/mail/components`
- Review: `apps/mail/config`
- Review: `apps/mail/hooks`
- Review: `apps/mail/lib`
- Verify: `apps/mail/messages/en.json`
- Verify: `apps/mail/messages/zh.json`

- [ ] **Step 1: 重新执行 JSX 文本、展示属性、Toast、错误提示和展示配置的只读检索**
- [ ] **Step 2: 人工逐条分类，迁移真实静态文案并排除邮件内容、用户输入和技术值**
- [ ] **Step 3: 对 `en`/`zh` 消息键、参数名和复数结构进行对等复核**
- [ ] **Step 4: 运行全部 Vitest、TypeScript 类型检查和 `git diff --check`**
- [ ] **Step 5: 确认仓库未新增审计器、扫描脚本或扫描结果文件**
- [ ] **Step 6: 给出用户手动 Docker 验证命令，不代替用户执行**

最终验证命令：

```bash
pnpm --dir apps/mail test
pnpm --dir apps/mail exec tsc --noEmit
git diff --check
```

明确不运行：`pnpm build`、`docker build`、`docker compose up --build`、任何 Docker 重启命令。
