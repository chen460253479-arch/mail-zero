# 简体中文全量多语言设计

## 目标

为 Zero 邮件前端新增简体中文，并消除页面源码中的用户可见硬编码英文。所有用户可见文案统一通过现有 Paraglide 消息系统输出。

本次只支持一种中文：

- Locale 标识：`zh`
- 消息文件：`apps/mail/messages/zh.json`
- 页面显示名称：`简体中文`
- 默认 Locale：继续使用 `en`

当前不支持繁体中文，`project.inlang/settings.json` 不配置 `zh-CN` 或 `zh-TW`。`locales.ts` 现有的未启用语言目录项不代表运行时已经支持对应语言。如果未来增加繁体中文，再单独设计 `zh` 到区域或文字脚本 Locale 的迁移。

## 当前情况

Zero 邮件前端已经使用 Paraglide，并配置了 19 种语言。英语资源 `en.json` 当前包含约 525 条叶子消息，但简体中文尚未加入 `project.inlang/settings.json`，也不存在 `zh.json`。

静态初步审计发现约 926 个疑似用户可见硬编码点，分布在约 85 个 TypeScript/TSX 文件中。候选内容包括：

- JSX 文本。
- 按钮、菜单和标题。
- `placeholder`、`title`、`alt` 和 ARIA 标签。
- Toast、确认提示和错误提示。
- 登录、强制改密和公开页面文案。
- 邮箱、写信、设置和渠道集成文案。
- 示例页面、条款、关于和开发者页面。

候选结果中也包含 CSS 类名、协议值等误报，实施时必须逐项分类，不进行盲目批量替换。

## 设计决策

### Locale 命名

使用 `zh` 而不是 `zh-CN`。

当前产品只支持一种中文，并明确把该中文定义为简体中文。`zh` 是有效的语言标识，也与仓库其他单语言消息文件的命名方式一致。

需要同步调整：

- `project.inlang/settings.json` 的 `locales` 增加 `"zh"`。
- `locales.ts` 增加 `zh: '简体中文'`。
- 设置页面把 `zh` 作为可保存的语言值。
- `messages/zh.json` 与 `messages/en.json` 保持相同消息键集合。

### 默认语言

`baseLocale` 保持 `en`，未选择语言的用户继续看到英语。

用户在“设置 → 常规 → 语言”中选择简体中文后，继续使用现有设置保存和 `setLocale` 流程。已有用户数据不迁移，不修改未选择中文用户的语言。

### 文案来源

所有用户可见文案必须来自 Paraglide 消息函数：

```tsx
m['namespace.messageKey']();
```

禁止在页面组件、交互 Hook 和用户提示逻辑中直接写用户可见英文。

新增消息时必须同时更新：

- `messages/en.json`
- `messages/zh.json`

英语资源继续作为消息结构和变量插值的基准。

## 全量覆盖范围

### 必须迁移

- 登录、退出和强制改密。
- Inbox、邮件列表、邮件详情和空状态。
- 写信、回复、附件、模板、延迟发送和撤销发送。
- 搜索、筛选、命令面板和快捷键说明。
- 设置、账户连接、标签、分类、通知和隐私页面。
- Gmail、Outlook、Zoho、IMAP/SMTP、Nango 等渠道配置页面。
- Toast、确认框、错误提示和进度状态。
- `placeholder`、`title`、`alt`、Tooltip 和 ARIA 文案。
- 首页、页脚、关于、条款、开发者和其他公开页面。
- 示例邮件、功能演示和空状态中的展示文本。
- 用户可见的相对时间、日期单位和数量描述。

### 不翻译

- 用户收到或编辑的邮件主题和正文。
- 用户姓名、邮箱地址和用户输入。
- URL、域名和外部链接。
- HTTP 方法、协议名和端口字段值。
- 数据库字段、接口字段和 Nango connection ID。
- 服务端错误码，例如 `PASSWORD_CHANGE_REQUIRED`。
- CSS 类名、Tailwind token、HTML 标签和内部状态值。
- 键盘按键本身，例如 `Ctrl`、`Alt`、`Esc`。

### 品牌和产品名

Zero、Gmail、Outlook、Zoho、Nango、GitHub 等名称在中英文中可以保持相同拼写，但页面仍通过消息键输出，不直接硬编码在 JSX 中。

## 消息结构

保持现有命名空间结构，并按照功能补充缺失键：

- `common.actions`
- `common.errors`
- `common.status`
- `common.accessibility`
- `common.brands`
- `pages.auth`
- `pages.mail`
- `pages.compose`
- `pages.settings`
- `pages.integrations`
- `pages.public`

复用已有语义相同的消息键，不为相同文案创建多个近似键。带参数的消息保留显式变量：

```json
{
  "deletedSpamMessages": "Deleted {count} spam emails"
}
```

```json
{
  "deletedSpamMessages": "已删除 {count} 封垃圾邮件"
}
```

不得把变量、数量或动态名称拼接进翻译后的固定字符串。

## 日期和数量

用户可见的日期、相对时间和数量描述需要跟随当前 Locale：

- 英语继续使用现有英语格式。
- `zh` 使用简体中文日期和相对时间格式。
- 邮件协议中的原始时间戳、日志和调试值不转换。

如果当前调用直接生成 `minute/minutes`、`hour/hours` 等英文单位，需要改为消息键或 Locale 感知的日期格式化函数。

## 硬编码英文防回归

新增一个基于 TypeScript AST 的 Vitest 检查，扫描邮件前端的用户界面源码。

扫描目录：

- `apps/mail/app`
- `apps/mail/components`
- `apps/mail/config`
- `apps/mail/hooks`
- `apps/mail/lib`
- `apps/mail/modules`

排除：

- `node_modules`
- 自动生成的 `paraglide`
- `messages`
- 测试 fixture 中明确用于协议或邮件内容的样本。
- 构建输出和缓存目录。

检查至少覆盖：

- 含英文字母的 JSX 文本节点。
- 用户可见字符串属性，如 `placeholder`、`title`、`alt` 和 `aria-label`。
- Toast、Alert、Confirm 和常见 `setError` 的字符串参数。
- 直接渲染的条件字符串。
- 用户可见配置对象中的 `label`、`title` 和 `description`。

误报必须通过精确规则解决，不能使用整个文件跳过或宽泛正则白名单。确实不翻译的技术值应使用窄范围的标记或集中常量，并在测试中说明原因。

## 消息一致性检查

增加 Locale 完整性测试：

- `en.json` 和 `zh.json` 的叶子消息键完全一致。
- 不允许 `zh.json` 缺少消息后静默回退英语。
- 参数名和变量插值结构一致。
- JSON 可以被 Paraglide 正常解析。

现有其他语言暂时缺少的英语新键不在本次补译范围，但新增硬编码迁移键需要评估 Paraglide 对其他 Locale 的回退行为，不能破坏现有语言编译。

## 实施顺序

为降低一次修改 85 个文件的风险，按以下阶段实施，每阶段单独测试和复审：

1. Locale 配置、`zh.json` 基线和消息一致性测试。
2. 认证、强制改密、Inbox 和邮件核心界面。
3. 写信、搜索、命令面板和邮件操作。
4. 设置、账户连接和渠道集成。
5. 首页、关于、条款、开发者和其他公开页面。
6. 日期、相对时间、无障碍文案和全仓残留审计。
7. 启用硬编码英文防回归测试。

## 与当前工作区修改的关系

当前工作区存在用户未提交修改，包含邮件列表、统计 Hook、乐观操作和邮件适配器等文件。

实施时必须：

- 在修改前读取每个重叠文件的工作区差异。
- 只增加多语言相关变更。
- 不覆盖、回滚或重新格式化用户已有逻辑。
- 每次暂存使用精确文件列表并复核 staged diff。

## 验证

验证包含：

- `en`/`zh` 消息键和参数一致性测试。
- 硬编码英文 AST 扫描测试。
- 语言选择器包含“简体中文”。
- 保存 `zh` 后 Paraglide 返回中文文案。
- 英语仍是默认语言。
- 认证、Inbox、写信、设置、集成和公开页面的代表性渲染测试。
- 邮件应用完整 Vitest。
- TypeScript `--noEmit`。
- 定向 Prettier 和 `git diff --check`。

不自动执行构建、打包或 Docker 操作。

## 验收标准

- 设置页面可以选择并保存 `zh`。
- 未选择语言时继续使用英语。
- `zh.json` 覆盖全部英语消息键。
- 所有页面用户可见静态文案均通过 Paraglide 输出。
- 中文界面不存在因硬编码造成的明显中英混合。
- 用户邮件内容、协议值和技术标识不会被错误翻译。
- 自动测试能够阻止新的用户可见硬编码英文进入仓库。
- 当前用户未提交修改得到完整保留。
