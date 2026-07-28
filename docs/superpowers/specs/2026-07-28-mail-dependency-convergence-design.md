# Zero 邮箱依赖收敛设计

日期：2026-07-28

## 目标

在不改变 Zero 本地邮箱内核、Gmail 增量入站、Gmail API 出站、统一 Mail API 和现有
前端邮件功能的前提下，移除已经没有调用方的依赖、删除重复的直接依赖声明，并把仅参与
开发或构建的工具从生产依赖移动到开发依赖。

同时显式启用 `@tailwindcss/typography`，使现有 `prose`、`prose-sm` 和
`dark:prose-invert` 等样式类具有真实实现，不再保留“已经安装但没有启用”的依赖状态。

## 边界

- 本次只修改依赖清单、`pnpm-lock.yaml`、Tailwind 插件声明和用于约束依赖边界的测试。
- 不修改邮箱数据模型、PostgreSQL Schema、Mail Core API、MailChannel 插件接口或业务流程。
- 不升级任何保留依赖的版本。
- 不下载依赖，不修改现有 `node_modules`，不执行依赖安装脚本。
- 锁文件只通过
  `pnpm install --lockfile-only --offline --ignore-scripts`
  同步。
- 当前分支继续直接使用 `D:\WorkSpace\Zero`，不创建 Git worktree。

## 方案

采用分两批硬收敛。

### 第一批：根目录、Mail Core 和服务端

从根目录移除：

- `drizzle-kit`
- `react-router`
- `zod`
- `zod-to-json-schema`

这些能力已经由实际使用它们的工作区包直接声明，根目录没有运行时代码需要它们。
移除根目录的 `zod@4.1.1` 还可以避免它与工作区 Catalog 中的 Zod 3 并存。

从 `@zero/mail-core` 移除 `ulid`。Mail Core 不直接生成 ULID；需要 ID 的调用由服务端
通过既有接口注入。

从 `@zero/server` 移除：

- `@sentry/cloudflare`
- `@trpc/client`
- `cloudflare`
- `date-fns`
- `dedent`
- `jsonrepair`
- `mimetext`
- `mime-types`
- `p-retry`
- `remeda`
- `string-strip-html`
- `@types/uuid`

`uuid@11` 自带并已被 TypeScript 实际解析到类型声明，因此不保留 `@types/uuid`。
`wrangler` 从服务端 `dependencies` 移动到 `devDependencies`。

### 第二批：邮箱前端

从 `@zero/mail` 移除没有源码、样式、脚本或配置调用方的依赖：

- `@dnd-kit/modifiers`
- `@react-email/html`
- `@react-email/render`
- `@sentry/react-router`
- `@tanstack/query-sync-storage-persister`
- `@tiptap/html`
- `@trpc/server`
- `accept-language-parser`
- `@types/accept-language-parser`
- `mimetext`
- `react-colorful`
- `resend`
- `tiptap-extension-auto-joiner`
- `workers-og`
- `drizzle-kit`

从 `@zero/mail` 移除由现有直接依赖负责提供的重复声明：

- `eslint-plugin-react-hooks`，由 `@zero/eslint-config` 负责。
- `@tiptap/extension-bold`
- `@tiptap/extension-document`
- `@tiptap/extension-link`
- `@tiptap/extension-paragraph`
- `@tiptap/extension-text`
- `@tiptap/starter-kit`
- `prosemirror-model`
- `prosemirror-view`
- `tiptap-extension-global-drag-handle`

Novel 继续提供应用通过 Novel 导出使用的 Tiptap 扩展。应用仍然直接导入的
`@tiptap/core`、`@tiptap/react`、`@tiptap/pm`、`prosemirror-state` 和其他编辑器扩展
继续作为直接依赖保留。

以下工具从 `dependencies` 移动到 `devDependencies`：

- `@react-router/dev`
- `@tailwindcss/vite`
- `babel-plugin-react-compiler`
- `oxlint`
- `tailwindcss-animate`
- `vite-plugin-babel`
- `vite-plugin-oxlint`

`lowlight` 必须保留，因为它满足 Novel 所使用的
`@tiptap/extension-code-block-lowlight` 的 peer dependency。

## Typography 启用方式

在 `apps/mail/app/globals.css` 的 Tailwind 插件区加入：

```css
@plugin "@tailwindcss/typography";
```

该声明与现有 `tailwindcss-animate` 和 `tailwind-scrollbar` 使用相同的 Tailwind 4
插件加载机制。现有组件中的 `prose` 系列类保持不变。

## 自动化约束

扩展服务端架构测试或增加专用依赖边界测试，读取四份 `package.json` 和
`apps/mail/app/globals.css`，至少断言：

- 已确认的废弃依赖不会重新出现在对应直接依赖区。
- 仅构建依赖不会重新出现在 `dependencies`。
- `@tailwindcss/typography` 同时存在于前端 `devDependencies` 和 Tailwind 插件声明中。
- `lowlight`、`postal-mime`、`mimetext`（Mail Core）、Google API、Hono、Drizzle、
  PostgreSQL 和 `@zero/mail-core` 等必要依赖继续保留。

## 锁文件和验证

每批修改后执行离线锁文件同步：

```powershell
pnpm install --lockfile-only --offline --ignore-scripts
```

验证顺序：

1. 依赖边界测试先失败，证明测试能够发现旧清单和未启用的 Typography。
2. 第一批清理后运行 Mail Core 测试、服务端定向测试、服务端 TypeScript 和三个
   Wrangler 环境的 dry-run。
3. 第二批清理后运行前端依赖边界测试、前端测试、前端 TypeScript 和生产构建。
4. 扫描生产源码、配置和脚本，确认没有移除依赖的残留引用。
5. 确认 `git diff --check` 通过且没有生成文件或运行时缓存进入版本控制。

## 预期效果

- 直接依赖声明减少 42 项；`@tailwindcss/typography` 保留并实际启用。
- 8 项构建工具从生产依赖转入开发依赖。
- 根目录不再承载业务包已经自行声明的运行时依赖。
- 未被其他包继续使用的传递依赖从锁文件中删除。
- Docker 安装和构建依赖图更小，供应链和升级审查范围缩小。
- 未导入的依赖本来不会增加请求执行耗时；本次对运行性能的直接收益主要来自减少可能
  进入构建图的重量级依赖，对安装速度、镜像体积和维护效率的收益更明确。
