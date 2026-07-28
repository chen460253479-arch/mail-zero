# Zero Mail Dependency Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收敛 Zero 邮箱相关工作区的直接依赖，正确区分运行时与构建期依赖，并显式启用 Tailwind Typography。

**Architecture:** 使用现有 `mail-architecture.test.ts` 约束依赖所有权和前端构建插件边界。分两批修改根目录、Mail Core、服务端和邮箱前端清单，每批仅通过 pnpm 的离线锁文件模式同步 `pnpm-lock.yaml`，不下载依赖、不修改 `node_modules`、不执行安装脚本。

**Tech Stack:** pnpm workspace、TypeScript、Vitest、React Router、Tailwind CSS 4、Cloudflare Wrangler

## Global Constraints

- 不修改邮箱数据模型、PostgreSQL Schema、Mail Core API、MailChannel 插件接口或业务流程。
- 不升级任何保留依赖的版本。
- 不下载依赖，不修改现有 `node_modules`，不执行依赖安装脚本。
- 锁文件只通过 `pnpm install --lockfile-only --offline --ignore-scripts` 同步。
- 直接在 `D:\WorkSpace\Zero` 当前分支实施，不创建 Git worktree。
- `lowlight`、`jiti`、Mail Core 的 `mimetext` 和 `postal-mime` 必须保留。

---

### Task 1: 建立依赖所有权与 Typography 失败测试

**Files:**
- Modify: `apps/server/src/mail-architecture.test.ts`
- Test: `apps/server/src/mail-architecture.test.ts`

**Interfaces:**
- Consumes: 根目录、`packages/mail-core`、`apps/server`、`apps/mail` 的 `package.json`，以及 `apps/mail/app/globals.css`。
- Produces: 两个架构约束测试，分别保护后端依赖所有权和前端依赖所有权/插件启用状态。

- [x] **Step 1: 增加清单读取辅助函数**

在测试文件中增加：

```ts
type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const readManifest = (path: string): PackageManifest =>
  JSON.parse(readFileSync(resolve(repositoryRoot, path), 'utf8')) as PackageManifest;

const dependencyNames = (manifest: PackageManifest): string[] => [
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.devDependencies ?? {}),
];
```

- [x] **Step 2: 增加后端依赖所有权测试**

新增测试，断言：

```ts
expect(Object.keys(rootManifest.dependencies ?? {})).toEqual([]);
expect(dependencyNames(mailCoreManifest)).not.toContain('ulid');
expect(dependencyNames(mailCoreManifest)).toEqual(
  expect.arrayContaining(['mimetext', 'postal-mime', 'zod']),
);
expect(
  retiredServerDependencies.filter((dependency) =>
    dependencyNames(serverManifest).includes(dependency),
  ),
).toEqual([]);
expect(serverManifest.dependencies).not.toHaveProperty('wrangler');
expect(serverManifest.devDependencies).toHaveProperty('wrangler');
expect(serverManifest.dependencies).toEqual(
  expect.objectContaining({
    '@googleapis/gmail': expect.any(String),
    '@zero/mail-core': expect.any(String),
    'drizzle-orm': expect.any(String),
    hono: expect.any(String),
    postgres: expect.any(String),
  }),
);
```

`retiredServerDependencies` 使用设计文档中列出的 12 个服务端删除项。

- [x] **Step 3: 增加前端依赖所有权和 Typography 测试**

新增测试，断言：

```ts
expect(
  retiredMailDependencies.filter((dependency) =>
    dependencyNames(mailManifest).includes(dependency),
  ),
).toEqual([]);
expect(
  buildOnlyMailDependencies.filter((dependency) =>
    Object.keys(mailManifest.dependencies ?? {}).includes(dependency),
  ),
).toEqual([]);
expect(
  buildOnlyMailDependencies.filter(
    (dependency) => !Object.keys(mailManifest.devDependencies ?? {}).includes(dependency),
  ),
).toEqual([]);
expect(mailManifest.devDependencies).toHaveProperty('@tailwindcss/typography');
expect(globalsCss).toContain('@plugin "@tailwindcss/typography";');
expect(dependencyNames(mailManifest)).toEqual(
  expect.arrayContaining([
    'lowlight',
    'novel',
    '@tiptap/core',
    '@tiptap/pm',
    '@tiptap/react',
    'prosemirror-state',
  ]),
);
```

`retiredMailDependencies` 使用设计文档中列出的 25 个前端删除项，不包含保留并启用的
`@tailwindcss/typography`；`buildOnlyMailDependencies` 使用设计文档中列出的 7 个移动项。

- [x] **Step 4: 运行测试并确认 RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run src/mail-architecture.test.ts
```

Expected: FAIL；后端测试报告旧依赖或 `wrangler` 所在区域错误，前端测试报告旧依赖、
构建工具所在区域错误以及缺少 Typography 插件声明。

---

### Task 2: 收敛根目录、Mail Core 和服务端依赖

**Files:**
- Modify: `package.json`
- Modify: `packages/mail-core/package.json`
- Modify: `apps/server/package.json`
- Modify: `pnpm-lock.yaml`
- Test: `apps/server/src/mail-architecture.test.ts`

**Interfaces:**
- Consumes: Task 1 的后端依赖所有权测试。
- Produces: 根目录零业务依赖、Mail Core 最小依赖和正确分类的服务端依赖。

- [x] **Step 1: 修改三份依赖清单**

从根目录删除：

```text
drizzle-kit
react-router
zod
zod-to-json-schema
```

从 Mail Core 删除 `ulid`。

从服务端删除：

```text
@sentry/cloudflare
@trpc/client
cloudflare
date-fns
dedent
jsonrepair
mimetext
mime-types
p-retry
remeda
string-strip-html
@types/uuid
```

将服务端 `wrangler` 从 `dependencies` 移入 `devDependencies`，版本继续使用
`catalog:`。

- [x] **Step 2: 离线同步锁文件**

Run:

```powershell
pnpm install --lockfile-only --offline --ignore-scripts
```

Expected: exit 0；不下载包、不修改 `node_modules`、不运行 `postinstall` 或 `prepare`。

- [x] **Step 3: 运行后端依赖测试并确认 GREEN**

Run:

```powershell
pnpm --filter @zero/server exec vitest run src/mail-architecture.test.ts -t "keeps root, Mail Core, and server dependencies owned by their consumers"
```

Expected: PASS。

- [x] **Step 4: 验证第一批功能边界**

Run:

```powershell
pnpm --filter @zero/mail-core test
pnpm --filter @zero/server exec tsc --noEmit --incremental false
pnpm --filter @zero/server exec wrangler deploy --dry-run --env local
pnpm --filter @zero/server exec wrangler deploy --dry-run --env staging
pnpm --filter @zero/server exec wrangler deploy --dry-run --env production
```

Expected: 全部 exit 0。

---

### Task 3: 收敛邮箱前端依赖并启用 Typography

**Files:**
- Modify: `apps/mail/package.json`
- Modify: `apps/mail/app/globals.css`
- Modify: `pnpm-lock.yaml`
- Test: `apps/server/src/mail-architecture.test.ts`

**Interfaces:**
- Consumes: Task 1 的前端依赖所有权测试和现有 Tailwind 4 插件区。
- Produces: 去除旧/重复声明的前端依赖、正确分类的构建工具和实际启用的 Typography。

- [x] **Step 1: 删除无调用方和重复的前端直接依赖**

删除：

```text
@dnd-kit/modifiers
@react-email/html
@react-email/render
@sentry/react-router
@tanstack/query-sync-storage-persister
@tiptap/extension-bold
@tiptap/extension-document
@tiptap/extension-link
@tiptap/extension-paragraph
@tiptap/extension-text
@tiptap/html
@tiptap/starter-kit
@trpc/server
accept-language-parser
eslint-plugin-react-hooks
mimetext
prosemirror-model
prosemirror-view
react-colorful
resend
tiptap-extension-auto-joiner
tiptap-extension-global-drag-handle
workers-og
@types/accept-language-parser
drizzle-kit
```

- [x] **Step 2: 移动构建期依赖**

把以下依赖从 `dependencies` 移入 `devDependencies`，保持原版本：

```text
@react-router/dev
@tailwindcss/vite
babel-plugin-react-compiler
oxlint
tailwindcss-animate
vite-plugin-babel
vite-plugin-oxlint
```

- [x] **Step 3: 显式启用 Typography**

在 `apps/mail/app/globals.css` 的插件区写入：

```css
@plugin "@tailwindcss/typography";
@plugin "tailwindcss-animate";
@plugin "tailwind-scrollbar" {
  nocompatible: true;
  preferredStrategy: "pseudoelements";
}
```

- [x] **Step 4: 离线同步锁文件**

Run:

```powershell
pnpm install --lockfile-only --offline --ignore-scripts
```

Expected: exit 0；不下载包、不修改 `node_modules`、不运行安装脚本。

- [x] **Step 5: 运行前端依赖测试并确认 GREEN**

Run:

```powershell
pnpm --filter @zero/server exec vitest run src/mail-architecture.test.ts -t "keeps mail frontend dependencies minimal and enables Typography"
```

Expected: PASS。

- [x] **Step 6: 验证前端**

Run:

```powershell
pnpm --filter @zero/mail test
pnpm --filter @zero/mail exec tsc --noEmit --incremental false
pnpm --filter @zero/mail build
Get-ChildItem apps/mail/build/client/assets -Filter '*.css' |
  Select-String -Pattern '\.prose'
```

Expected: 全部 exit 0；最后一条命令至少返回一个包含 `.prose` 的 CSS 构建产物。

---

### Task 4: 完成锁文件、残留引用和全链路验证

**Files:**
- Modify: `docs/superpowers/plans/2026-07-28-mail-dependency-convergence.md`
- Verify: `pnpm-lock.yaml`
- Verify: `apps/server/src/mail-architecture.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 的依赖清单、锁文件和测试。
- Produces: 可提交的干净工作区变更与验证记录。

- [x] **Step 1: 运行完整架构与邮箱回归测试**

Run:

```powershell
pnpm --filter @zero/server exec vitest run src/mail-architecture.test.ts src/no-legacy-mail-rpc.test.ts src/no-agent-ai-surface.test.ts src/runtime/mail
pnpm --filter @zero/mail-core test
pnpm --filter @zero/mail test
```

Expected: 全部 PASS。

- [x] **Step 2: 验证锁文件一致性**

Run:

```powershell
pnpm install --lockfile-only --offline --ignore-scripts --frozen-lockfile
```

Expected: exit 0，`pnpm-lock.yaml` 不再变化。

- [x] **Step 3: 检查残留和工作区卫生**

Run:

```powershell
git diff --check
git status --short
```

Expected: 只有计划内文件发生变化；不存在 `.wrangler`、`node-compile-cache`、
`update-check` 或其他生成文件的未跟踪记录。

- [x] **Step 4: 更新计划复选框**

完成每个步骤后，将本文件对应的 `- [ ]` 更新为 `- [x]`，确保计划和实际验证一致。
