# Zero 本地 Mail API 后端验收记录

## 验收清单

- [x] Mail API 只有一个公共模块出口。
- [x] 所有规范资源均显式使用本地 `accountId`。
- [x] 跨账户读取与 Blob 下载不会泄露对象是否存在。
- [x] 批量 Set 支持状态前置条件、逐项失败和最多 200 项操作。
- [x] Thread 列表查询次数有固定上界，且不读取正文 Blob。
- [x] Submission 创建进入本地 Mail Outbound Spool，不提前宣称服务商发送成功。
- [x] Snooze 状态持久化于 PostgreSQL；邮件归属变更与 Snooze 记录使用同一事务，并按每封邮件的恢复计划幂等唤醒。
- [x] Mail API 不依赖 Gmail、Nango 或其他 Provider 实现。
- [x] 旧 Router 保持未切换，不存在临时 `v2` Router。
- [x] 开发数据库仍由唯一 `0000` 模板初始化，未新增时间线迁移。

## 验证证据

- `pnpm --filter=@zero/mail-core typecheck`：通过。
- `pnpm --filter=@zero/server exec eslint ...`：本阶段相关目录通过。
- `pnpm db:generate`：输出 `No schema changes, nothing to migrate`。
- `pnpm test:mail-core`：
  - Mail Core：38 个测试文件、290 项测试通过。
  - Server：74 个测试文件、303 项测试通过，另有 1 个显式跳过的规模测试。
- `pnpm --filter=@zero/server exec tsc --noEmit --pretty false`：本阶段相关代码无类型错误；仓库仍有既存的旧路由、Cloudflare 环境类型和第三方依赖类型错误，不属于本阶段改动。

## 验收结果

本地 Mail API 的账户、邮箱、身份、邮件、线程、Submission、Blob、Thread Action 和 Snooze 后端链路已经形成统一出口。审查中发现的并发覆盖、事务边界、逐邮件恢复、游标防篡改、查询总数、批量限制、Blob 有界读取、错误映射和批量水合问题均已修复并加入回归覆盖。

## 下一阶段：前端切换

- 将 `mailApiRouter` 作为永久 `mail` 命名空间接入现有 App Router。
- 逐项替换前端旧 `mail`、`drafts`、`labels` 调用。
- 切换完成后移除旧 Router、Driver DTO、Durable Object 邮件状态及不再使用的 KV 绑定。
