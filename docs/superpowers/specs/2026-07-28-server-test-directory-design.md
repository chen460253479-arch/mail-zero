# Server 测试目录统一设计

## 目标

将 `apps/server/src` 恢复为纯生产代码目录，把 Server 的全部测试、测试辅助文件和快照统一归入 `apps/server/tests`，并以测试类型而不是历史业务批次划分目录。

## 目标结构

```text
apps/server/
├─ src/
└─ tests/
   ├─ architecture/
   ├─ unit/
   ├─ integration/
   ├─ e2e/
   └─ helpers/
```

## 分类规则

- `architecture/`：依赖边界、已移除能力、配置和部署结构约束。
- `unit/`：不以 `.integration.test.*` 或 `.e2e.test.*` 命名的模块测试；目录镜像原 `src` 路径。
- `integration/`：所有 `.integration.test.*`；按原模块或 `mail-core`、`mail-sync` 归类。
- `e2e/`：所有 `.e2e.test.*`。
- `helpers/`：数据库测试环境、测试 Harness 和 Schema Contract 等非测试辅助文件。
- Snapshot 与对应测试保持相邻。

## 迁移范围

- 迁出 `src` 中的 79 个测试。
- 重组 `tests` 中现有的 49 个测试、4 个 helper 和 1 个 snapshot。
- 重写相对 import 和 Vitest mock 路径，使其继续指向原生产模块或已迁移 helper。
- 更新 `test:mail-core` 脚本和当前仍被执行的路径引用。
- 增加目录架构测试，禁止 `src` 下再次出现 `*.test.*` 或 `*.spec.*`。

## 非目标

- 不修改生产业务逻辑。
- 不修复迁移前已经存在的 PostgreSQL、出站投递或旧 Nango 测试失败。
- 不改写历史计划、历史报告中用于记录当时状态的旧路径。
- 不改变测试内容、断言语义或数据库模板。

## 验收

- `apps/server/src` 中测试文件数量为 0。
- `apps/server/tests` 顶层只包含约定的五类目录。
- 原有 128 个测试全部迁移，并新增 1 个目录边界测试；最终共 129 个测试，helper 与 snapshot 均保留。
- 架构和单元测试可加载执行。
- 完整 Server Vitest 相比迁移前不增加新的失败类型。
