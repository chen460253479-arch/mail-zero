# Zero 本地文件夹与标签前端全面接入设计

**日期：** 2026-08-02
**状态：** 已完成交互评审，待书面设计审阅
**范围：** `apps/mail` 为主，包含两个为保证正确语义所必需的 Mail Core / Mail API 小型补齐

## 1. 目标

将 Zero 已有的本地 Mailbox 模型完整接入前端，使文件夹、标签、层级、排序、计数、导航、移动、批量操作和删除约束形成一条唯一且一致的本地邮箱链路。

完成后：

- Gmail、Outlook、Zoho、通用 IMAP/SMTP 账户使用相同的本地文件夹和标签界面。
- 邮件服务商能力只影响收件、发件和渠道同步，不再决定前端是否显示文件夹或标签。
- 文件夹使用单一主要归属语义，标签使用多选语义。
- 不保留旧的渠道分支、名称路径推断和仅标签操作链路。

## 2. 参考项目结论

### 2.1 Stalwart

Stalwart 的 JMAP Mailbox 实现提供了最接近 Zero 目标模型的基准：

- Mailbox 使用 `parentId` 表达树形层级。
- 使用 `sortOrder` 排序，使用 `isSubscribed` 控制订阅或可见性。
- Mailbox 同时提供邮件数、未读邮件数、线程数和未读线程数。
- 创建和更新时校验父节点存在、父子循环和最大深度。
- 系统邮箱受保护。
- 删除有子项或有邮件的 Mailbox 时返回明确的类型化错误。
- 批量 set 操作具有 state 前置条件以及逐项失败结果。

Zero 复用这些机制，但不引入当前不需要的共享邮箱 ACL 和完整 JMAP 会话客户端。

### 2.2 Sync Engine

Sync Engine 明确区分 Folder 与 Label：

- Folder 表达主要存放位置。
- Label 表达可叠加的分类关系。
- 非空文件夹不能直接删除。
- 删除仍被邮件使用的标签时只删除标签关系，不删除邮件。
- 名称唯一性和删除后的重新创建有明确约束。

Sync Engine 会根据上游服务商选择 Folder 或 Label；Zero 不复制这一限制。Zero 的文件夹和标签都是本地能力，必须同时存在。

### 2.3 EmailEngine

EmailEngine 主要提供 IMAP/服务商操作层参考：

- 文件夹支持层级路径、创建、重命名、订阅和删除。
- 系统用途文件夹优先排序。
- 移动操作使用明确的目标文件夹，而不是把文件夹当作任意标签追加。

Zero 不反向同步本地文件夹，因此只采用其文件夹交互和操作语义，不调用服务商文件夹 API。

### 2.4 采用原则

采用成熟项目中已经验证的机制，并转换成适合 Zero 的 TypeScript、PostgreSQL、本地 Mail Core 和插件架构。参考项目中的服务商耦合、旧数据库限制和与 Zero 边界不符的能力不直接复制。

## 3. 已确认的领域语义

### 3.1 Mailbox 类型

- `kind=system`：系统邮箱，名称、角色、层级和删除受保护。
- `kind=folder`：本地文件夹，支持父子层级和单一主要归属。
- `kind=label`：本地标签，支持父子层级和多选关联。

### 3.2 主要文件夹

邮件的组织位置在以下集合中保持互斥：

- Inbox
- Archive
- Junk
- Trash
- 一个自定义 `kind=folder` Mailbox

移动到目标主要文件夹时，移除其他组织位置，但保留所有 `kind=label` 关系。

Sent 和 Draft 是受保护的生命周期角色，不作为“移动到”选择器中的目标。线程移动不能把已发送邮件或草稿错误追加到自定义文件夹。

### 3.3 标签

- 一封邮件可以拥有零个或多个标签。
- 标签的添加、移除和删除不改变邮件的主要文件夹。
- 删除标签只解除关联并删除标签本身，绝不删除邮件。

## 4. 前端领域边界与目录结构

前端继续使用现有 `modules/mail` 分层，并把 Mailbox 特定组件从通用 UI 目录迁出：

```text
apps/mail/
├─ modules/mail/
│  ├─ model/
│  │  └─ mailbox.ts
│  ├─ adapters/
│  │  ├─ mailbox-adapter.ts
│  │  └─ mailbox-view.ts
│  ├─ selectors/
│  │  ├─ mailbox-tree.ts
│  │  ├─ mailbox-groups.ts
│  │  └─ mailbox-count.ts
│  ├─ queries/
│  │  └─ use-mailboxes.ts
│  └─ mutations/
│     ├─ mailbox-set-input.ts
│     ├─ thread-action-input.ts
│     └─ use-mailbox-actions.ts
└─ components/mailbox/
   ├─ mailbox-sidebar.tsx
   ├─ folder-tree.tsx
   ├─ mailbox-tree-node.tsx
   ├─ mailbox-editor-dialog.tsx
   ├─ mailbox-delete-dialog.tsx
   ├─ move-to-folder-menu.tsx
   ├─ label-picker.tsx
   └─ mailbox-settings.tsx
```

数据流固定为：

```text
mail.mailbox API
  -> Adapter
  -> 账户级 Mailbox 领域数据
  -> 分组 / 树形 / 计数 Selector
  -> 侧边栏 / 设置页 / 邮件操作菜单
  -> 通用 Mutation
  -> Mail API
```

页面组件不能直接拼装 tRPC 参数。所有查询键、选择状态、乐观事务和缓存必须包含 `accountId`。

## 5. 侧边栏与导航

侧边栏固定分为：

1. 核心：Inbox、Draft、Sent。
2. 管理：Archive、Snoozed、Junk、Trash。
3. 文件夹：自定义 `kind=folder` 树。
4. 标签：自定义 `kind=label` 树。

不再根据 `account.capabilities.includes('labels')` 切换区域。

### 5.1 树形规则

- 只使用真实 `parentId` 构建树，不解析名称中的 `/` 或 `[]`。
- 同级先按 `sortOrder`，再按本地化名称排序。
- 文件夹只能成为文件夹的父项，标签只能成为标签的父项。
- 拖动支持调整父级和同级顺序，也支持移回根级。
- 前端提前拒绝跨账户、跨类型、自身和子孙目标；后端继续执行最终约束。
- 展开/折叠状态保存在浏览器本地，不写入 Mailbox。
- `isSubscribed` 在 Zero 前端解释为“在侧边栏显示”。

### 5.2 路由

- 系统邮箱使用角色路径，例如 `/mail/inbox`。
- 自定义文件夹和标签统一使用 `/mail/{mailboxId}`。
- 路由解析后根据 Mailbox 的 `kind` 决定标题、图标和操作。
- 高亮只比较解析后的 Mailbox ID，不再混用 pathname 和标签搜索状态。
- 标签搜索是独立的高级筛选能力，不承担侧边栏导航职责。

### 5.3 计数

- Inbox、Junk、自定义文件夹、标签：`unreadThreads`。
- Draft、Snoozed：`totalThreads`。
- Sent、Archive、Trash：默认不显示计数。
- 零值不显示徽标。
- 每个节点读取自己的统计数据，子项不得继承父项计数。

## 6. 文件夹与标签设置页

使用 `/settings/mailboxes` 替换旧的仅标签设置页，提供“文件夹”和“标签”两个页签。

### 6.1 通用管理能力

- 创建根项或子项。
- 重命名。
- 修改父级。
- 调整顺序。
- 在侧边栏显示或隐藏。
- 查看总线程数和未读线程数。
- 打开对应 Mailbox。

标签额外支持颜色编辑。

### 6.2 输入约束

- 名称去除首尾空格后不能为空。
- 同一父级下不能重名。
- 不能使用自身或子孙作为父级。
- 不能超过 Mail Core 配置的最大深度。
- 系统邮箱不能通过该页面修改。

### 6.3 删除规则

| 类型 | 有子项 | 有邮件 | 结果 |
|---|---:|---:|---|
| system | 任意 | 任意 | 禁止删除 |
| folder | 是 | 任意 | 拒绝，先处理子文件夹 |
| folder | 否 | 是 | 拒绝，先移动或清空邮件 |
| folder | 否 | 否 | 删除 |
| label | 是 | 任意 | 拒绝，先处理子标签 |
| label | 否 | 是 | 原子解除标签关系并删除标签 |
| label | 否 | 否 | 删除 |

删除失败时必须提供面向用户的中文说明和下一步动作，不能只显示错误码。

## 7. 邮件操作

邮件菜单明确分成：

- 移动到文件夹
- 管理标签

入口覆盖列表单条会话、会话详情工具栏和批量选择工具栏。

### 7.1 移动到文件夹

选择器包含 Inbox、Archive、Junk、Trash 和自定义文件夹树，提供名称搜索和当前目标标记；不提供 Draft、Sent 作为目标。

移动行为：

- 添加目标组织位置。
- 移除其他组织位置。
- 保留所有标签。
- 保留 Sent、Draft 生命周期角色。
- 目标未变化时不发请求。

归档、移入收件箱、标记垃圾邮件、移入已删除和移动到自定义文件夹必须调用同一个语义化移动命令。

### 7.2 管理标签

- 使用支持搜索的树形复选选择器。
- 单条会话显示已选标签。
- 批量会话支持全选、部分选中和未选中三态。
- 点击“应用”后一次提交添加和移除集合。
- 选择器允许快速创建标签，但不承担层级和颜色编辑。
- 标签操作只能提交 `kind=label` 的 Mailbox ID。

重要、星标和已读属于 Keyword 操作，不与 Mailbox 操作合并。

## 8. 两个必要的后端补齐

### 8.1 类型化标签删除

当前 Mail Core 对文件夹和标签都执行“有邮件禁止删除”。需要调整为：

- `kind=label` 且无子标签时，在账户锁和同一事务中删除邮件—标签关联和标签。
- 邮件及其主要文件夹保持不变。
- 更新受影响的 Email、Thread、Mailbox state、changes 和计数。
- `kind=folder` 继续维持非空禁止删除。
- 不增加数据表，不改变现有存储结构。

不允许前端通过分页遍历全部邮件模拟标签删除。

### 8.2 `mail.action.moveThreads`

当前通用 `updateThreads` 会把相同 mailboxIds 应用到线程中的所有邮件，无法安全处理同时包含收到邮件、Sent 回复和 Draft 的线程。

新增语义化动作：

```text
mail.action.moveThreads
```

输入：

```text
accountId
threadIds
destinationMailboxId
ifInState?
clientMutationId
```

服务端在同一事务中逐封处理：

- 只移动具有组织位置的可移动邮件。
- Sent 邮件保留 Sent，不追加自定义主要文件夹。
- Draft 邮件保留 Draft，不参与移动。
- 移除其他组织位置并添加目标位置。
- 标签完全不变。
- 返回 `oldState`、`newState`、成功线程和逐线程失败结果。

`updateThreads` 继续负责标签和 Keyword 批量更新，但服务端必须验证 Mailbox 类型。

## 9. 乐观更新与并发

账户级 mutation 管理器执行以下流程：

1. 暂停受影响查询刷新。
2. 按 `threadId` 保存操作前快照。
3. 更新当前列表、会话详情和侧边栏计数。
4. 请求携带 `ifInState` 和唯一 `clientMutationId`。
5. 成功后使用 `newState` 校正缓存。
6. 部分失败时只回滚失败线程。
7. 重新同步受影响 Mailbox 统计和 changes。

移动后从当前源列表移除线程；目标列表只标记为需要刷新，不猜测服务器排序位置。

遇到 state mismatch 时：

- 回滚未确认的乐观状态。
- 重新获取 Mailbox、Thread 和 changes。
- 提示邮箱内容已经变化，需要重试。

网络错误恢复快照并保留页面和选择状态。

## 10. 错误映射

- `MAILBOX_HAS_CHILD`：提示存在子项并展开节点。
- `MAILBOX_HAS_EMAIL`：提示文件夹仍有邮件，并提供“打开文件夹”。
- `MAILBOX_ROLE_CONFLICT`：提示系统邮箱不能修改或删除。
- 名称冲突：聚焦名称字段并保留输入。
- state mismatch：刷新状态并提示重试。
- 部分失败：显示成功数和失败数，成功项不回滚。

## 11. 旧实现收敛

完成接入后删除：

- `components/ui/sidebar-labels.tsx`
- `components/ui/recursive-folder.tsx`
- 基于渠道 `capabilities.labels` 的 UI 分支
- 仅支持 Label 的创建、更新 Hook
- 从名称中的 `/`、`[]` 推断层级的逻辑
- 旧标签专用设置页和无引用类型

迁移完成后只能存在一套 Mailbox 前端链路。

## 12. 自动化测试

### 12.1 前端单元测试

- Mailbox 分组、树构建和稳定排序。
- 孤立父项和异常循环防御。
- 计数选择和零值隐藏。
- 系统角色及自定义 ID 路由解析。
- 文件夹移动保留标签。
- 标签变更保留主要文件夹。
- 批量标签三态。
- 乐观成功、部分失败、网络错误和 state mismatch 回滚。

### 12.2 组件测试

- 所有渠道同时显示文件夹和标签。
- 创建入口传递正确的 `kind`。
- 文件夹和标签菜单具有不同操作。
- 拖动只能发生在同类节点之间。
- 隐藏项只从侧边栏移除。
- 子项显示自己的计数。
- 删除错误显示正确中文提示。

### 12.3 Mail Core / API 测试

- 删除有关联邮件的标签只解除关系，不删除邮件。
- 非空文件夹和有子项 Mailbox 删除被拒绝。
- 混合 Inbox、Sent、Draft 的线程移动只影响可移动邮件。
- 移动后全部标签保持不变。
- 批量移动的事务、部分失败、幂等和 state 语义正确。
- Email、Thread、Mailbox state、changes 和计数一致。

## 13. 验收流程

1. 创建文件夹、子文件夹和嵌套标签。
2. 将 Inbox 会话移动到自定义文件夹。
3. 验证 Inbox 消失、目标文件夹出现、标签保持。
4. 对单条和批量会话添加、移除标签。
5. 重命名、调整层级、排序和隐藏节点。
6. 切换账户并确认状态完全隔离。
7. 删除非空文件夹并确认被阻止。
8. 删除已使用标签并确认邮件保留。
9. 刷新页面并确认状态全部来自本地邮箱后端。

## 14. 非目标

- 不把本地文件夹或标签反向同步到 Gmail、Outlook、Zoho 或 IMAP。
- 不引入共享邮箱 ACL、服务端 JMAP Session 或完整通用 JMAP Client。
- 不改变邮件收件和发件渠道边界。
- 不增加新的数据库表或迁移现有表结构。
- 不在本阶段实现标签推荐、自动归类或附件复用等额外能力。
