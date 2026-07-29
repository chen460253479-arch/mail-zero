# Server 一次构建与不可变运行时设计

## 1. 目标

本阶段先解决 Zero Server 当前在 Docker 中使用 `wrangler dev` 动态编译、挂载宿主机源码和共享开发依赖所造成的内存占用与运行时不确定性。

完成后，Server 应满足：

- TypeScript/Worker Bundle 只在 Docker 镜像构建阶段生成一次；
- 运行容器不挂载宿主机源码，不执行 TypeScript 动态打包；
- 修改本地代码不会自动改变正在运行的 Server；
- 更新 Server 必须重新构建并替换镜像；
- 现有 Cloudflare Worker API、Bindings、队列、定时任务和邮件业务行为保持不变；
- 为后续逐项替换 Cloudflare 能力保留清晰边界。

本阶段不是最终的 Node.js 自托管切换。Wrangler 暂时作为 Worker 兼容运行器保留，但不再承担运行时构建职责。

## 2. 当前问题

当前 `server` 服务继承 `x-zero-development`：

- 将整个仓库挂载到 `/app`；
- 挂载根目录及各 Workspace 的 `node_modules`；
- 设置 `CHOKIDAR_USEPOLLING=true`；
- 容器启动后执行 `wrangler dev`；
- Wrangler 在运行期分析源码、打包并监听文件变化；
- `docker:deploy` 还要单独初始化共享依赖卷。

这使生产式 Docker 运行仍然携带开发服务器、轮询监听器、完整源码和 Workspace 开发依赖状态。

## 3. 方案比较

### 3.1 采用：预构建 Bundle + Wrangler `--no-bundle`

Docker Builder 使用 Wrangler 的 dry-run 构建能力生成 Worker Bundle；Runtime 只运行构建产物：

```text
源码与依赖
   │
   ▼
Docker Builder
   │ wrangler deploy --dry-run
   ▼
预构建 Worker Bundle
   │
   ▼
不可变 Runtime 镜像
   │ wrangler dev <bundle> --no-bundle
   ▼
现有 Worker Bindings
```

优点：

- 立即取消运行时 TypeScript 打包和宿主机源码热更新；
- 不同时改动 HTTP、Queue、Cron、R2、Durable Objects、Hyperdrive；
- 现有业务和 Cloudflare 兼容行为风险最低；
- 后续可以在同一组自动化验收下逐项替换运行时能力。

限制：

- `wrangler dev` 仍是过渡运行器；
- Wrangler 内部可能保留对入口 Bundle 的轻量监听，但 Bundle 位于不可变镜像中，运行期间不会变化；
- 完全移除 Wrangler 要等 Node 生产入口接管后完成。

### 3.2 不采用：立即切换 Node.js Server

这要求同时替换 ExecutionContext、Queues、Cron、R2、Durable Objects、Hyperdrive 等能力，改动面过大，不符合分阶段迁移要求。

### 3.3 不采用：直接运行 workerd

直接配置 workerd 可以减少 Wrangler 包装层，但必须在本阶段重新实现当前 Wrangler 自动生成的本地 Binding 配置，尤其是 Queue、Durable Object、R2 与持久化路径。该工作与后续 Cloudflare 替换重复，不适合作为短期内存优化。

## 4. Docker 架构

### 4.1 独立 Server Dockerfile

新增 `docker/server/Dockerfile`，不再让 `server` 与 `protocol-worker` 共用开发镜像职责。

Builder 阶段：

1. 使用固定 Node.js 与 pnpm 版本；
2. 复制 `.dockerignore` 允许的 Workspace 源码；
3. 执行 `pnpm install --frozen-lockfile`；
4. 使用 Wrangler dry-run 生成单一 Server Bundle；
5. 构建阶段不读取 `.env`，不注入 Nango Secret、数据库密码或其他运行时凭据。

Runtime 阶段：

1. 只复制 Worker Bundle、Wrangler 配置和运行 Wrangler 所需的最小依赖；
2. 不复制业务源码目录；
3. 不运行 `pnpm install`；
4. 不包含依赖指纹检查和开发依赖卷初始化流程；
5. 以 `NODE_ENV=production` 启动。

### 4.2 独立 Runtime 入口

新增 `docker/server/entrypoint.sh`，职责仅为：

- 校验预构建 Bundle 存在；
- 将运行时环境变量传给 Wrangler；
- 使用 `--no-bundle` 启动预构建入口；
- 将 Wrangler 本地状态持久化到固定的数据目录；
- 通过 `exec` 保持正确的信号传递和容器退出码。

入口不得：

- 安装依赖；
- 扫描或修改源码；
- 生成 TypeScript 类型；
- 再次执行 Bundle 构建；
- 将 Secret 输出到日志。

## 5. Compose 调整

`server` 不再继承 `x-zero-development`，改为显式声明：

- `env_file` 和 Server 所需的环境变量；
- 独立 `docker/server/Dockerfile`；
- PostgreSQL、Redis HTTP Proxy、Protocol Worker 依赖；
- 8787 端口与现有健康检查；
- 仅保留 Wrangler 本地 Binding 状态所需的命名卷。

Server 必须移除：

- `.:/app` 源码挂载；
- 所有 Workspace `node_modules` 挂载；
- `CHOKIDAR_USEPOLLING`；
- `CHOKIDAR_INTERVAL`；
- `ZERO_DOCKER_DEV`；
- `install-dependencies` 启动分支。

`protocol-worker` 暂不在本阶段调整，继续使用当前开发镜像和依赖卷。由于 `server` 不再负责构建 `zero-development` 镜像，`protocol-worker` 必须显式保留 `docker/Dockerfile` 构建配置。它仍需要依赖初始化，因此 `docker:deploy` 中的初始化命令从临时 `server` 容器迁移到临时 `protocol-worker` 容器。

## 6. 发布行为

统一发布命令仍为：

```powershell
pnpm docker:deploy
```

该命令应：

1. 构建 Mail、Server 和仍需构建的其他镜像；
2. 通过 `protocol-worker install-dependencies` 初始化仍在使用的共享开发依赖卷；
3. 替换并等待全部服务健康；
4. 输出最终 Compose 状态。

只更新 Server 时使用：

```powershell
docker compose up --detach --build --no-deps server
```

运行中的 Server 不响应宿主机源码变化。每次代码更新都必须重新构建镜像。

## 7. 配置与凭据边界

构建产物不得包含 `.env` 或以下运行时值：

- Nango Base URL、Secret Key 和渠道 Integration Key；
- PostgreSQL 连接信息；
- Redis Token；
- Protocol Worker Secret；
- OAuth Client Secret；
- Cookie/JWT/加密密钥。

这些值继续通过 Compose `env_file`/`environment` 在容器启动时注入。前端构建参数与 Server Secret 继续保持隔离。

## 8. Cloudflare 能力边界

本阶段保留以下行为：

- Hono Worker `fetch` 入口；
- Queue producer/consumer；
- Scheduled handler；
- R2 Binding；
- Durable Objects；
- Hyperdrive 本地连接；
- `ExecutionContext.waitUntil()`；
- Wrangler 本地 Binding 状态。

本阶段不新增 Node.js 兼容适配器，也不改变邮件同步、发送、Webhook、认证或 tRPC 行为。

Wrangler 状态卷只保存本地 Binding 状态，不包含源码或依赖。容器替换后状态卷继续存在。

## 9. 错误处理与回滚

启动时如果 Bundle 缺失，入口应立即退出并给出不含敏感信息的明确错误。

Wrangler 或 Binding 初始化失败时保持非零退出码，由 Compose `restart` 策略处理；健康检查继续以 `/health` 为准。

回滚只需要恢复原 Server 镜像与 Compose 定义。数据库结构、邮件数据和 Provider 凭据不在本阶段发生迁移，因此不需要数据回滚。

## 10. 自动化测试与验收

### 10.1 架构测试

新增或调整测试，静态确认：

- `server` 不再继承开发 Anchor；
- `server` 没有源码和依赖目录挂载；
- Server Runtime 使用预构建 Bundle 和 `--no-bundle`；
- Runtime 入口不包含 `pnpm install`、Wrangler dry-run 或 TypeScript 构建命令；
- `.env` 继续被 `.dockerignore` 排除；
- 所有既有 Server 运行时环境变量仍被传递；
- `protocol-worker` 的依赖初始化路径仍然有效。

### 10.2 构建与运行验收

- `docker compose build server` 成功；
- Server 镜像中不存在 `apps/server/src`；
- `docker compose up --detach --no-deps server` 后健康检查通过；
- 登录、Session、tRPC、Nango 启动验证、邮件 Webhook、队列和定时入口保持可用；
- 修改宿主机 Server 源码后，运行容器行为不变化；
- 重新构建 Server 后，修改才生效；
- 容器日志中不出现运行时 Bundle 重建；
- 记录改造前后的空闲内存与启动内存作为效果证据，但不以固定数值作为功能验收条件。

### 10.3 代码验证

- Server TypeScript 检查；
- 相关架构测试与 Server 单元测试；
- 本次变更文件 ESLint；
- Docker Compose 配置解析；
- Docker 镜像构建；
- 运行时健康检查。

## 11. 非目标

本阶段不处理：

- Protocol Worker 的静态生产镜像；
- Wrangler/Cloudflare 的彻底删除；
- Node.js HTTP Server；
- Queue、Cron、R2、Durable Objects、Hyperdrive 的替换；
- 邮件业务、数据库模型或前端功能调整；
- 外部 Nginx 配置。

这些能力在后续阶段按独立规格逐项迁移。
