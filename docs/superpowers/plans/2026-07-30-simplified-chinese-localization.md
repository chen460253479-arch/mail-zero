# 简体中文全量多语言 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Zero Mail 增加仅使用 `zh` 标识的简体中文界面，并将全部面向用户的英文硬编码迁移到 Paraglide，同时用自动化测试阻止回归。

**Architecture:** 继续以 `apps/mail/messages/en.json` 作为唯一基础语言目录，新增结构完全对等的 `apps/mail/messages/zh.json`。页面、组件、通知、错误提示和无障碍文本统一通过 `@/paraglide/messages` 的 `m` 读取；独立的 TypeScript AST 审计器负责识别 JSX、常见展示属性、通知调用和展示配置中的英文硬编码。

**Tech Stack:** React Router 7、React 19、TypeScript、Paraglide JS / Inlang、Vitest、TypeScript Compiler API、date-fns。

## Global Constraints

- 默认语言保持 `en`。
- 简体中文语言标识和文件名统一使用 `zh`；不配置 `zh-CN` 或 `zh-TW`。
- 本阶段只增加简体中文，不增加繁体中文。
- 所有面向用户的静态文本必须从 Paraglide 消息目录读取，包括 JSX 文本、占位符、标题、Toast、确认文案、错误提示和无障碍标签。
- 邮件正文、主题、联系人名称、用户输入、URL、协议字段、服务端错误码、CSS token 和原始快捷键不作为静态界面文案迁移。
- 品牌名允许中英文显示相同，但仍必须通过消息键读取。
- 不自动执行构建、打包、Docker 构建、Docker 重启；只执行测试、类型检查和静态审计。
- 所有 Git 暂存必须使用明确文件路径，避免混入无关改动。
- 按仓库约束直接在 `D:\WorkSpace\Zero` 当前功能分支工作，不创建 worktree。

---

### Task 1: 建立 `zh` 语言目录与目录对等验证

**Files:**
- Create: `apps/mail/messages/zh.json`
- Create: `apps/mail/modules/i18n/message-catalog.test.ts`
- Modify: `apps/mail/project.inlang/settings.json`
- Modify: `apps/mail/locales.ts`

**Interfaces:**
- Consumes: `apps/mail/messages/en.json` 的递归消息结构。
- Produces: 配置语言 `zh`、显示名 `简体中文`，以及 `en`/`zh` 叶子消息键完全一致的约束。

- [ ] **Step 1: 写语言配置和目录对等失败测试**

```ts
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import zh from '../../messages/zh.json';
import settings from '../../project.inlang/settings.json';
import { locales } from '../../locales';

function leafKeys(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value) || value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    key === '$schema' ? [] : leafKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('Simplified Chinese catalog', () => {
  it('uses zh while keeping English as the default locale', () => {
    expect(settings.baseLocale).toBe('en');
    expect(settings.locales).toContain('zh');
    expect(settings.locales).not.toContain('zh-CN');
    expect(settings.locales).not.toContain('zh-TW');
    expect(locales.zh).toBe('简体中文');
  });

  it('keeps the zh catalog structurally aligned with en', () => {
    expect(leafKeys(zh).sort()).toEqual(leafKeys(en).sort());
  });
});
```

- [ ] **Step 2: 运行测试并确认因缺少 `zh` 失败**

Run: `pnpm --dir apps/mail test -- modules/i18n/message-catalog.test.ts`

Expected: FAIL，原因是 `messages/zh.json` 或 `locales.zh` 不存在。

- [ ] **Step 3: 配置 `zh` 并完成首版简体中文目录**

在 `settings.json` 的 `locales` 中加入 `"zh"`；在 `locales.ts` 中使用：

```ts
zh: '简体中文',
```

删除未启用的 `'zh-CN'` 和 `'zh-TW'` 项。`zh.json` 必须保留与 `en.json` 相同的参数名、复数声明和匹配分支；中文复数分支可使用相同中文结果，但结构不得删减。

- [ ] **Step 4: 运行目录测试和类型检查**

Run: `pnpm --dir apps/mail test -- modules/i18n/message-catalog.test.ts`

Expected: PASS。

Run: `pnpm --dir apps/mail exec tsc --noEmit`

Expected: PASS。

- [ ] **Step 5: 提交语言基础设施**

```bash
git add apps/mail/messages/zh.json apps/mail/modules/i18n/message-catalog.test.ts apps/mail/project.inlang/settings.json apps/mail/locales.ts
git commit -m "feat(i18n): add Simplified Chinese catalog"
```

### Task 2: 建立英文硬编码 AST 审计器

**Files:**
- Create: `apps/mail/modules/i18n/hardcoded-ui-text.ts`
- Create: `apps/mail/modules/i18n/hardcoded-ui-text.test.ts`
- Later create in Task 8: `apps/mail/modules/i18n/hardcoded-ui-text.audit.test.ts`

**Interfaces:**
- Produces: `findHardcodedUiText(sourceText: string, filePath: string): HardcodedUiTextFinding[]`。
- Produces: `scanHardcodedUiText(rootDirectories: string[]): Promise<HardcodedUiTextFinding[]>`。
- Excludes: `*.test.*`、`*.spec.*`、生成的 `paraglide`、`node_modules`、纯 URL、协议值、CSS 类名和原始快捷键。

- [ ] **Step 1: 写审计器失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { findHardcodedUiText } from './hardcoded-ui-text';

describe('findHardcodedUiText', () => {
  it('finds English JSX, display attributes, toasts and display configuration', () => {
    const source = `
      const item = { label: 'Open inbox' };
      export function View() {
        toast.error('Unable to load mail');
        return <button aria-label="Create email">Send now</button>;
      }
    `;
    expect(findHardcodedUiText(source, 'view.tsx').map((item) => item.text)).toEqual([
      'Open inbox',
      'Unable to load mail',
      'Create email',
      'Send now',
    ]);
  });

  it('ignores data, URLs, class names and localized message calls', () => {
    const source = `
      const endpoint = 'https://example.com/mail';
      const className = 'flex items-center';
      const key = 'mod+enter';
      return <button>{m.common_actions_save()}</button>;
    `;
    expect(findHardcodedUiText(source, 'view.tsx')).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试并确认因模块不存在失败**

Run: `pnpm --dir apps/mail test -- modules/i18n/hardcoded-ui-text.test.ts`

Expected: FAIL，提示无法解析 `./hardcoded-ui-text`。

- [ ] **Step 3: 使用 TypeScript Compiler API 实现最小审计器**

审计以下语法：

```ts
type HardcodedUiTextKind = 'jsx-text' | 'jsx-attribute' | 'notification' | 'display-config';

type HardcodedUiTextFinding = {
  filePath: string;
  line: number;
  column: number;
  kind: HardcodedUiTextKind;
  text: string;
};
```

检测集合：

```ts
const DISPLAY_ATTRIBUTES = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'description',
  'label',
  'placeholder',
  'title',
]);
const DISPLAY_PROPERTIES = new Set(['description', 'emptyText', 'label', 'name', 'placeholder', 'subtitle', 'title']);
```

通知检测覆盖 `toast.success/error/info/warning/message`、`new Error()` 中明确会直接展示给用户的字符串；扫描入口只遍历 `apps/mail/app`、`components`、`config`、`hooks`、`lib` 中的 `.ts/.tsx` 文件。

- [ ] **Step 4: 运行审计器单元测试**

Run: `pnpm --dir apps/mail test -- modules/i18n/hardcoded-ui-text.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交审计器**

```bash
git add apps/mail/modules/i18n/hardcoded-ui-text.ts apps/mail/modules/i18n/hardcoded-ui-text.test.ts
git commit -m "test(i18n): add hardcoded UI text scanner"
```

### Task 3: 迁移应用外壳、认证、主页与公共页面

**Files:**
- Modify: `apps/mail/messages/en.json`
- Modify: `apps/mail/messages/zh.json`
- Modify: `apps/mail/app/root.tsx`
- Modify: `apps/mail/app/meta-files/not-found.ts`
- Modify: `apps/mail/app/(auth)/login/login-client.tsx`
- Modify: `apps/mail/app/(auth)/zero/login/page.tsx`
- Modify: `apps/mail/app/(auth)/zero/signup/page.tsx`
- Modify: `apps/mail/app/(full-width)/about.tsx`
- Modify: `apps/mail/app/(full-width)/hr.tsx`
- Modify: `apps/mail/app/(full-width)/terms.tsx`
- Modify: `apps/mail/app/(routes)/developer/page.tsx`
- Modify: `apps/mail/app/(routes)/mail/under-construction/[path]/back-button.tsx`
- Modify: `apps/mail/app/(routes)/mail/under-construction/[path]/page.tsx`
- Modify: `apps/mail/components/home/footer.tsx`
- Modify: `apps/mail/components/home/HomeContent.tsx`
- Modify: `apps/mail/components/navigation.tsx`
- Modify: `apps/mail/components/keyboard-layout-indicator.tsx`
- Modify: `apps/mail/components/cookies/cookie-trigger.tsx`
- Modify: `apps/mail/components/ui/app-sidebar.tsx`
- Modify: `apps/mail/components/ui/nav-main.tsx`
- Modify: `apps/mail/components/ui/nav-user.tsx`
- Modify: `apps/mail/config/navigation.ts`
- Modify: `apps/mail/lib/site-config.ts`

**Interfaces:**
- Consumes: `m` from `@/paraglide/messages`。
- Produces: 认证、导航、营销、法律和开发者页面不再包含面向用户的英文硬编码；`en`/`zh` 每次同时增加相同键。

- [ ] **Step 1: 用审计器记录本批文件的当前失败项**

在测试中对上述路径调用 `scanHardcodedUiText()`，断言结果为空。

Run: `pnpm --dir apps/mail test -- modules/i18n/hardcoded-ui-text.test.ts`

Expected: FAIL，并列出认证、主页、公共页面中的英文文案。

- [ ] **Step 2: 为每条静态文案增加语义消息键**

消息键按领域放入 `pages.auth`、`pages.home`、`pages.about`、`pages.terms`、`pages.developer`、`navigation` 和 `common`。带动态值的文本使用参数：

```json
{
  "pages": {
    "auth": {
      "passwordRequirements": "Password must be at least {minimumLength} characters"
    }
  }
}
```

```json
{
  "pages": {
    "auth": {
      "passwordRequirements": "密码至少需要 {minimumLength} 个字符"
    }
  }
}
```

- [ ] **Step 3: 将 JSX、属性、Toast 和展示配置替换为 `m.*()`**

示例：

```tsx
<Button aria-label={m.pages_auth_signIn()}>{m.pages_auth_signIn()}</Button>
```

法律正文按段落设置消息键，保持链接、列表和强调标签在 JSX 中；品牌名也通过消息键读取。

- [ ] **Step 4: 运行本批审计、目录对等测试与类型检查**

Run: `pnpm --dir apps/mail test -- modules/i18n/hardcoded-ui-text.test.ts modules/i18n/message-catalog.test.ts`

Expected: PASS。

Run: `pnpm --dir apps/mail exec tsc --noEmit`

Expected: PASS。

- [ ] **Step 5: 提交应用外壳和公共页面迁移**

```bash
git add apps/mail/messages/en.json apps/mail/messages/zh.json apps/mail/app apps/mail/components/home apps/mail/components/navigation.tsx apps/mail/components/keyboard-layout-indicator.tsx apps/mail/components/cookies/cookie-trigger.tsx apps/mail/components/ui/app-sidebar.tsx apps/mail/components/ui/nav-main.tsx apps/mail/components/ui/nav-user.tsx apps/mail/config/navigation.ts apps/mail/lib/site-config.ts
git commit -m "feat(i18n): localize shell and public pages"
```

### Task 4: 迁移邮箱、邮件详情、撰写与搜索交互

**Files:**
- Modify: `apps/mail/messages/en.json`
- Modify: `apps/mail/messages/zh.json`
- Modify: `apps/mail/app/mailto-handler.ts`
- Modify: `apps/mail/app/(routes)/mail/[folder]/page.tsx`
- Modify: `apps/mail/app/(routes)/mail/create/page.tsx`
- Modify: `apps/mail/components/context/command-palette-context.tsx`
- Modify: `apps/mail/components/context/loading-context.tsx`
- Modify: `apps/mail/components/context/sidebar-context.tsx`
- Modify: `apps/mail/components/context/thread-context.tsx`
- Modify: `apps/mail/components/create/create-email.tsx`
- Modify: `apps/mail/components/create/editor-buttons.tsx`
- Modify: `apps/mail/components/create/editor.colors.tsx`
- Modify: `apps/mail/components/create/editor.tsx`
- Modify: `apps/mail/components/create/email-composer.tsx`
- Modify: `apps/mail/components/create/image-compression-settings.tsx`
- Modify: `apps/mail/components/create/schedule-send-picker.tsx`
- Modify: `apps/mail/components/create/slash-command.tsx`
- Modify: `apps/mail/components/create/template-button.tsx`
- Modify: `apps/mail/components/create/toolbar.tsx`
- Modify: `apps/mail/components/mail/attachment-dialog.tsx`
- Modify: `apps/mail/components/mail/attachments-accordion.tsx`
- Modify: `apps/mail/components/mail/data.tsx`
- Modify: `apps/mail/components/mail/email-verification-badge.tsx`
- Modify: `apps/mail/components/mail/mail-content.tsx`
- Modify: `apps/mail/components/mail/mail-display.tsx`
- Modify: `apps/mail/components/mail/mail-list.tsx`
- Modify: `apps/mail/components/mail/mail-skeleton.tsx`
- Modify: `apps/mail/components/mail/mail.tsx`
- Modify: `apps/mail/components/mail/navbar.tsx`
- Modify: `apps/mail/components/mail/note-panel.tsx`
- Modify: `apps/mail/components/mail/reply-composer.tsx`
- Modify: `apps/mail/components/mail/select-all-checkbox.tsx`
- Modify: `apps/mail/components/mail/snooze-dialog.tsx`
- Modify: `apps/mail/components/mail/thread-display.tsx`
- Modify: `apps/mail/components/mail/thread-subject.tsx`
- Modify: `apps/mail/hooks/use-compose-editor.ts`
- Modify: `apps/mail/hooks/use-copy-to-clipboard.ts`
- Modify: `apps/mail/hooks/use-drafts.ts`
- Modify: `apps/mail/hooks/use-optimistic-actions.ts`
- Modify: `apps/mail/hooks/use-undo-send.ts`
- Modify: `apps/mail/lib/email-utils.client.tsx`
- Modify: `apps/mail/lib/email-utils.ts`
- Modify: `apps/mail/lib/hotkeys/mail-list-hotkeys.tsx`
- Modify: `apps/mail/lib/optimistic-actions-manager.ts`

**Interfaces:**
- Produces: 邮箱列表、邮件详情、撰写器、附件、搜索、命令面板、快捷操作、Toast 和空状态全部通过 `m` 获取静态文案。
- Preserves: 邮件主题、正文、地址、附件名和服务器返回数据原样显示。

- [ ] **Step 1: 为本批路径添加空结果审计并确认失败**

Run: `pnpm --dir apps/mail test -- modules/i18n/hardcoded-ui-text.test.ts`

Expected: FAIL，报告邮箱与撰写交互中的英文静态文本。

- [ ] **Step 2: 按 `common.commandPalette`、`common.mail`、`common.mailDisplay`、`common.replyCompose`、`pages.createEmail` 增补双语键**

动态时间、数量、文件大小和文件名通过参数传递，不拼接英文：

```tsx
m.pages_createEmail_attachments({ count: files.length })
```

- [ ] **Step 3: 迁移邮箱和撰写相关代码**

仅替换静态展示文本。过滤器内部值、邮件提供商字段、路由段、MIME 类型、快捷键组合和 API 错误码保持原值。

- [ ] **Step 4: 运行本批审计、现有邮件测试、目录测试和类型检查**

Run: `pnpm --dir apps/mail test -- modules/i18n/hardcoded-ui-text.test.ts modules/i18n/message-catalog.test.ts modules/mail`

Expected: PASS。

Run: `pnpm --dir apps/mail exec tsc --noEmit`

Expected: PASS。

- [ ] **Step 5: 提交邮箱交互迁移**

```bash
git add apps/mail/messages/en.json apps/mail/messages/zh.json apps/mail/app/mailto-handler.ts apps/mail/app/\(routes\)/mail apps/mail/components/context apps/mail/components/create apps/mail/components/mail apps/mail/hooks apps/mail/lib/email-utils.client.tsx apps/mail/lib/email-utils.ts apps/mail/lib/hotkeys apps/mail/lib/optimistic-actions-manager.ts
git commit -m "feat(i18n): localize mail interactions"
```

### Task 5: 迁移设置、连接与集成界面

**Files:**
- Modify: `apps/mail/messages/en.json`
- Modify: `apps/mail/messages/zh.json`
- Modify: `apps/mail/app/(routes)/settings/layout.tsx`
- Modify: `apps/mail/app/(routes)/settings/appearance/page.tsx`
- Modify: `apps/mail/app/(routes)/settings/categories/page.tsx`
- Modify: `apps/mail/app/(routes)/settings/connections/page.tsx`
- Modify: `apps/mail/app/(routes)/settings/danger-zone/page.tsx`
- Modify: `apps/mail/app/(routes)/settings/general/page.tsx`
- Modify: `apps/mail/app/(routes)/settings/integrations/layout.tsx`
- Modify: `apps/mail/app/(routes)/settings/integrations/page.tsx`
- Modify: `apps/mail/app/(routes)/settings/integrations/gmail/page.tsx`
- Modify: `apps/mail/app/(routes)/settings/integrations/imap-smtp/page.tsx`
- Modify: `apps/mail/app/(routes)/settings/integrations/outlook/page.tsx`
- Modify: `apps/mail/app/(routes)/settings/integrations/zoho-mail/page.tsx`
- Modify: `apps/mail/app/(routes)/settings/labels/page.tsx`
- Modify: `apps/mail/app/(routes)/settings/notifications/page.tsx`
- Modify: `apps/mail/app/(routes)/settings/privacy/page.tsx`
- Modify: `apps/mail/app/(routes)/settings/security/page.tsx`
- Modify: `apps/mail/app/(routes)/settings/shortcuts/hotkey-recorder.tsx`
- Modify: `apps/mail/app/(routes)/settings/shortcuts/page.tsx`
- Modify: `apps/mail/app/(routes)/settings/[...settings]/page.tsx`
- Modify: `apps/mail/components/connection/add.tsx`
- Modify: `apps/mail/components/connection/disconnect-dialog.tsx`
- Modify: `apps/mail/components/connection/imap-smtp-connect-dialog.tsx`
- Modify: `apps/mail/components/connection/nango-connect-dialog.tsx`
- Modify: `apps/mail/components/connection/zoho-webhook-setup-dialog.tsx`
- Modify: `apps/mail/components/integrations/channel-card.tsx`
- Modify: `apps/mail/components/integrations/confirm-delete.tsx`
- Modify: `apps/mail/components/integrations/gmail-settings-dialog.tsx`
- Modify: `apps/mail/components/integrations/managed-channel-settings-dialog.tsx`
- Modify: `apps/mail/components/labels/label-dialog.tsx`
- Modify: `apps/mail/components/settings/settings-card.tsx`

**Interfaces:**
- Produces: 设置、邮箱连接、Nango/IMAP/SMTP/Gmail/Outlook/Zoho 集成的静态界面文案全部本地化。
- Preserves: 渠道 ID、连接 ID、邮箱地址、主机名、端口、OAuth/Nango 品牌名和外部数据值。

- [ ] **Step 1: 添加本批审计断言并确认失败**

Run: `pnpm --dir apps/mail test -- modules/i18n/hardcoded-ui-text.test.ts`

Expected: FAIL，报告设置和集成页面英文静态文案。

- [ ] **Step 2: 按设置页面结构扩展 `en`/`zh`**

使用 `pages.settings.general/connections/security/appearance/signatures/shortcuts/labels/dangerZone/privacy`，并新增 `pages.settings.notifications`、`pages.settings.integrations`。提供商名称也使用消息键，动态邮箱或连接状态用参数插值。

- [ ] **Step 3: 迁移所有设置和连接界面**

语言选择列表从 `settings.locales` 过滤，`zh` 展示为 `简体中文`；默认 `getLocale()` 和基础语言继续为 `en`。

- [ ] **Step 4: 运行本批审计、目录测试、连接测试与类型检查**

Run: `pnpm --dir apps/mail test -- modules/i18n/hardcoded-ui-text.test.ts modules/i18n/message-catalog.test.ts modules/mail-connections modules/integrations`

Expected: PASS。

Run: `pnpm --dir apps/mail exec tsc --noEmit`

Expected: PASS。

- [ ] **Step 5: 提交设置和集成迁移**

```bash
git add apps/mail/messages/en.json apps/mail/messages/zh.json apps/mail/app/\(routes\)/settings apps/mail/components/connection apps/mail/components/integrations apps/mail/components/labels apps/mail/components/settings
git commit -m "feat(i18n): localize settings and integrations"
```

### Task 6: 迁移通用 UI、无障碍文本和剩余通知

**Files:**
- Modify: `apps/mail/messages/en.json`
- Modify: `apps/mail/messages/zh.json`
- Modify: `apps/mail/components/responsive-modal.tsx`
- Modify: `apps/mail/components/theme/sidebar-theme-switcher.tsx`
- Modify: `apps/mail/components/theme/theme-switcher.tsx`
- Modify: `apps/mail/components/theme/theme-toggle.tsx`
- Modify: `apps/mail/components/ui/chart.tsx`
- Modify: `apps/mail/components/ui/command.tsx`
- Modify: `apps/mail/components/ui/envelop.tsx`
- Modify: `apps/mail/components/ui/form.tsx`
- Modify: `apps/mail/components/ui/recipient-autosuggest.tsx`
- Modify: `apps/mail/components/ui/responsive-modal.tsx`
- Modify: `apps/mail/components/ui/sidebar.tsx`
- Modify: `apps/mail/components/ui/sidebar-labels.tsx`
- Modify: `apps/mail/components/ui/sidebar-toggle.tsx`
- Modify: `apps/mail/components/ui/toast.tsx`
- Modify: `apps/mail/hooks/driver/use-delete.ts`
- Modify: `apps/mail/hooks/use-notes.tsx`
- Modify: `apps/mail/lib/notes-utils.ts`

**Interfaces:**
- Produces: 通用组件默认文案、屏幕阅读器标签、Tooltip、Notes 通知和主题切换文案统一通过 `m`。
- Preserves: 通用 UI 组件允许调用者传入的动态 `title`、`description`、`label` 值。

- [ ] **Step 1: 添加通用组件审计断言并确认失败**

Run: `pnpm --dir apps/mail test -- modules/i18n/hardcoded-ui-text.test.ts`

Expected: FAIL，报告通用组件和无障碍标签中的英文。

- [ ] **Step 2: 为真正的默认展示文案增加双语键**

无默认文本的底层组件不增加文案；已有英文默认值改为调用 `m`，例如：

```tsx
<span className="sr-only">{m.common_actions_close()}</span>
```

- [ ] **Step 3: 迁移剩余通用组件、主题和 Notes 文案**

保证 `aria-label`、`title`、`placeholder`、Tooltip 内容和 Toast 都没有静态英文；来自邮件或用户输入的数据不改写。

- [ ] **Step 4: 运行审计、目录测试、Notes 相关测试和类型检查**

Run: `pnpm --dir apps/mail test -- modules/i18n/hardcoded-ui-text.test.ts modules/i18n/message-catalog.test.ts`

Expected: PASS。

Run: `pnpm --dir apps/mail exec tsc --noEmit`

Expected: PASS。

- [ ] **Step 5: 提交通用组件迁移**

```bash
git add apps/mail/messages/en.json apps/mail/messages/zh.json apps/mail/components/responsive-modal.tsx apps/mail/components/theme apps/mail/components/ui apps/mail/hooks/driver/use-delete.ts apps/mail/hooks/use-notes.tsx apps/mail/lib/notes-utils.ts
git commit -m "feat(i18n): localize shared UI text"
```

### Task 7: 本地化日期和相对时间

**Files:**
- Create: `apps/mail/lib/i18n/date-locale.ts`
- Create: `apps/mail/lib/i18n/date-locale.test.ts`
- Modify: all `apps/mail/app/**/*.tsx` and `apps/mail/components/**/*.tsx` call sites that format user-visible dates with `date-fns`

**Interfaces:**
- Produces: `getDateLocale(locale?: string): Locale | undefined`，其中 `zh` 返回 `date-fns/locale` 的 `zhCN`。
- Consumes: `getLocale()` 的当前语言值。

- [ ] **Step 1: 写日期 locale 失败测试**

```ts
import { zhCN } from 'date-fns/locale';
import { describe, expect, it } from 'vitest';
import { getDateLocale } from './date-locale';

describe('getDateLocale', () => {
  it('maps zh to the Simplified Chinese date-fns locale', () => {
    expect(getDateLocale('zh')).toBe(zhCN);
  });

  it('keeps the default English formatter unchanged', () => {
    expect(getDateLocale('en')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试并确认因模块不存在失败**

Run: `pnpm --dir apps/mail test -- lib/i18n/date-locale.test.ts`

Expected: FAIL，提示无法解析 `./date-locale`。

- [ ] **Step 3: 实现 locale 映射并接入日期格式化调用**

```ts
import { zhCN } from 'date-fns/locale';

export function getDateLocale(locale?: string) {
  return locale === 'zh' ? zhCN : undefined;
}
```

用户可见的 `format`、`formatDistance`、`formatRelative` 调用传入 `{ locale: getDateLocale(getLocale()) }`；API 时间戳序列化不修改。

- [ ] **Step 4: 运行日期测试、类型检查和相关页面测试**

Run: `pnpm --dir apps/mail test -- lib/i18n/date-locale.test.ts`

Expected: PASS。

Run: `pnpm --dir apps/mail exec tsc --noEmit`

Expected: PASS。

- [ ] **Step 5: 提交日期本地化**

```bash
git add apps/mail/lib/i18n/date-locale.ts apps/mail/lib/i18n/date-locale.test.ts apps/mail/app apps/mail/components
git commit -m "feat(i18n): localize displayed dates"
```

### Task 8: 启用全仓硬编码门禁并完成验证

**Files:**
- Create: `apps/mail/modules/i18n/hardcoded-ui-text.audit.test.ts`
- Modify: `apps/mail/modules/i18n/hardcoded-ui-text.ts`
- Modify only when findings require: files under `apps/mail/app`, `apps/mail/components`, `apps/mail/config`, `apps/mail/hooks`, `apps/mail/lib`
- Modify only when new keys require: `apps/mail/messages/en.json`
- Modify only when new keys require: `apps/mail/messages/zh.json`

**Interfaces:**
- Consumes: `scanHardcodedUiText()`。
- Produces: CI 中全量扫描结果为零，并继续保证 `en`/`zh` 键对等。

- [ ] **Step 1: 写全仓审计失败测试**

```ts
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanHardcodedUiText } from './hardcoded-ui-text';

describe('mail UI localization audit', () => {
  it('contains no user-visible hardcoded English', async () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const findings = await scanHardcodedUiText([
      path.join(root, 'app'),
      path.join(root, 'components'),
      path.join(root, 'config'),
      path.join(root, 'hooks'),
      path.join(root, 'lib'),
    ]);
    expect(findings).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行全仓审计并确认仍能发现至少一条遗漏或验证直接为零**

Run: `pnpm --dir apps/mail test -- modules/i18n/hardcoded-ui-text.audit.test.ts`

Expected: 若有遗漏则 FAIL 并列出文件、行号和文本；若为零，临时在受扫 fixture 中加入一条英文确认测试会失败后立即撤销该 fixture 改动。

- [ ] **Step 3: 清理所有真实遗漏和误报规则**

真实静态文案增加 `en`/`zh` 对等键并改用 `m`。只有符合全局排除范围的技术字符串才调整审计器规则；不得用文件级白名单、目录级白名单或现有问题基线压掉真实文案。

- [ ] **Step 4: 执行最终验证**

Run: `pnpm --dir apps/mail test`

Expected: 全部 Vitest 测试 PASS。

Run: `pnpm --dir apps/mail exec tsc --noEmit`

Expected: PASS。

Run: `git diff --check`

Expected: 无空白错误。

明确不运行：`pnpm build`、`docker build`、`docker compose up --build`、任何 Docker 重启命令。

- [ ] **Step 5: 审查变更并提交最终门禁**

```bash
git diff --stat
git diff -- apps/mail/modules/i18n apps/mail/messages apps/mail/project.inlang/settings.json apps/mail/locales.ts
git add apps/mail/modules/i18n/hardcoded-ui-text.audit.test.ts apps/mail/modules/i18n/hardcoded-ui-text.ts apps/mail/messages/en.json apps/mail/messages/zh.json
git commit -m "test(i18n): enforce localized UI text"
```

- [ ] **Step 6: 给出用户手动 Docker 验证流程**

仅在最终交付说明中提供，不代替用户执行：

```bash
docker compose build
docker compose up -d
```

如果仓库 Docker Compose 使用具体服务名，则根据仓库文件给出准确服务命令；不自动执行。
