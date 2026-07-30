# Inbox 首次改密弹窗设计

## 目标

普通用户使用初始密码完成登录后直接进入 `/mail/inbox`，在 Inbox 页面上显示不可关闭的强制改密弹窗。改密成功后继续使用当前 Better Auth Session，不退出、不要求重新登录。

CRM Launch Session、管理员 Session，以及已经完成首次改密的普通用户 Session 不显示该弹窗。

## 设计决策

Better Auth Session 继续作为唯一登录状态来源，不新增弹窗专用登录状态或第二套认证上下文。

受保护路由的 Session loader 返回：

- `userId`：用于用户级查询缓存隔离。
- `passwordChangeRequired`：根据用户角色、`mustChangePassword` 和 Session 的 `authMethod` 计算。

页面始终进入 `/mail/inbox`。不再因为首次改密跳转到 `/change-password`，并移除独立改密路由。

## 页面流程

### 普通用户首次密码登录

1. 用户使用用户名和初始密码登录。
2. Zero 创建 Better Auth Session。
3. 浏览器进入 `/mail/inbox`。
4. 受保护路由读取 Session，得到 `passwordChangeRequired=true`。
5. 页面显示 Inbox 背景框架和不可关闭的强制改密弹窗。
6. 用户提交当前密码和新密码。
7. 服务端修改密码并将 `mustChangePassword` 更新为 `false`。
8. 浏览器重新加载 `/mail/inbox`，使用原有 Session 读取最新用户状态。
9. 弹窗消失，邮箱账户、主题和邮件数据开始正常加载。

重新加载页面仅用于刷新 Session 和查询上下文，不执行退出，也不要求用户再次输入账号密码。

### CRM Launch

CRM Launch 创建的 Session 使用 `authMethod=launch`。即使该用户尚未独立修改初始密码，也不触发强制改密弹窗，直接进入同一套 Inbox 界面。

### 管理员和已改密用户

管理员或 `mustChangePassword=false` 的普通用户直接进入 Inbox，不显示弹窗。

## 数据加载边界

服务端在普通用户必须改密期间会拒绝除改密接口外的私有请求，并返回 `PASSWORD_CHANGE_REQUIRED`。前端必须保持这一安全限制。

当 `passwordChangeRequired=true` 时：

- 保留用户级 QueryProvider，使改密 mutation 可以正常调用。
- 不挂载邮箱账户、邮件、主题和命令菜单等依赖私有接口的 Provider。
- 不渲染会自动发起私有查询的 Inbox 内容。
- 显示静态 Inbox 背景框架，并在其上显示强制改密弹窗。

改密成功并重新加载后，才挂载完整 Provider 树并请求用户邮箱数据。这样不会产生一批预期失败的请求，也不会残留失败查询缓存。

## 弹窗行为

强制改密弹窗：

- 默认打开且不可通过关闭按钮、遮罩点击或 Escape 关闭。
- 页面其他区域不可点击或聚焦。
- 要求填写当前密码、新密码和确认密码。
- 新密码至少 12 个字符。
- 新密码必须与当前密码不同。
- 新密码必须与普通用户的用户名不同；最终校验由服务端执行。
- 提交期间禁用重复提交。
- 修改失败时在弹窗内显示错误，不清除当前 Session。

## Session 行为

改密接口继续使用 `authenticatedProcedure`，因为必须改密的 Session 仍然是合法的已登录 Session。

改密时：

- 不调用 `signOut`。
- 不删除当前 Session Cookie。
- 不要求重新认证。
- 保持 `revokeOtherSessions=false` 的现有行为。
- 成功后通过完整页面导航重新读取 Session。

## 代码范围

预计调整：

- 受保护路由 Session loader：返回 `passwordChangeRequired`，不再跳转改密页。
- 受保护路由布局：根据该字段显示改密门禁或完整邮箱 Provider 树。
- 改密组件：从独立页面改为不可关闭的弹窗。
- 登录后导航：继续直接进入 `/mail/inbox`。
- 路由表：移除 `/change-password` 独立路由。
- 测试：覆盖密码登录、CRM Launch、管理员、弹窗阻断数据加载、改密成功保持 Session 和重新进入 Inbox。

不调整：

- Better Auth 的 Session 结构。
- CRM Launch 的认证方式。
- 服务端 `PASSWORD_CHANGE_REQUIRED` 安全限制。
- 用户和邮箱数据隔离规则。
- Docker、部署和历史数据迁移。

## 验收标准

- 首次密码登录成功后地址为 `/mail/inbox`。
- 页面显示不可关闭的强制改密弹窗。
- 改密前不请求邮箱账户、邮件和用户主题数据。
- 改密成功后不退出、不跳转登录页、不要求再次登录。
- 页面重新加载后弹窗消失并正常显示 Inbox 数据。
- CRM Launch、管理员和已改密用户不显示弹窗。
- Better Auth Session 仍是唯一登录状态来源。
