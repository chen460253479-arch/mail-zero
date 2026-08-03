# 断开邮箱后的界面状态设计

## 目标

邮箱连接状态变为 `disconnected` 后，Zero 不得继续把该记录作为活动邮箱。邮件页面应立即进入无连接状态，侧边栏不得继续显示该邮箱身份，写邮件入口必须禁用。

## 服务端规则

- 默认连接只能从 `status === 'connected'` 的记录中选择。
- 用户保存的默认连接不可用时，选择最早创建的其他已连接邮箱；不存在已连接邮箱时返回 `null`。
- `setDefault` 拒绝 disconnected、disconnecting、reconnect_required 和 deleting 状态。
- 断开且保留数据只保留本地 Mail Account 和设置页记录，不代表该连接仍可用于邮件操作。

## 客户端规则

- `useActiveConnection` 对服务端响应和持久缓存做防御性过滤，只暴露 connected 连接。
- 连接切换器只展示 connected 连接。
- 没有活动邮箱时不使用登录用户姓名、邮箱或头像冒充邮箱身份。
- 断开和删除保留数据后，立即将默认连接缓存置空，并统一失效连接列表、默认连接和 Mail Account 查询。
- 邮件主体沿用现有无连接页面，写邮件按钮沿用现有禁用状态。

## 验证

- 单元测试覆盖默认连接过滤、首个 connected 回退和无 connected 返回 null。
- 单元测试覆盖客户端 connected 过滤。
- 单元测试覆盖断开刷新时默认连接缓存被立即清空。
- 只运行对应 Vitest 文件，限制为单 fork。
