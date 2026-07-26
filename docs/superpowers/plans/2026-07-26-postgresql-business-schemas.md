# PostgreSQL 业务 Schema 化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Zero 当前 40 张 `public.mail0_*` 业务表调整为 `auth`、`app`、`integration`、`mail` 四个 Schema，并以唯一开发基线替换旧迁移时间线。

**Architecture:** Drizzle 声明式模型是数据库结构的唯一来源，四个 `pgSchema` 在一个集中模块定义。现有 TypeScript 表导出和领域接口保持稳定，仅改变物理 Schema、表名和派生对象名称；旧迁移被压缩为一个直接创建目标结构的 `0000` 基线。

**Tech Stack:** TypeScript、PostgreSQL 17、Drizzle ORM、Drizzle Kit 0.31.4、postgres.js、Vitest、pnpm。

## Global Constraints

- 不创建 Git worktree；直接在 `D:\WorkSpace\Zero` 当前分支工作。
- 当前所有开发数据库允许清空重建，不保留旧数据库升级路径。
- 不新增、删除或重命名字段。
- 不改变字段类型、默认值、空值规则、主键、唯一约束、检查约束、索引定义、外键字段和级联语义。
- TypeScript 表导出名、Repository 接口和邮件领域行为保持不变。
- 基线不包含演示、测试、种子或默认业务数据。
- Gmail 入栈同步不属于本计划。
- `db:push` 与唯一基线迁移必须能分别初始化空库，并产生结构等价的业务对象。
- 保留未跟踪的 `AGENTS.md`，不得加入本功能提交。

---

## 文件结构

- Create: `apps/server/src/db/pg-schemas.ts`
  - 唯一定义 `authSchema`、`appSchema`、`integrationSchema`、`mailSchema` 和 Schema 名称常量。
- Modify: `apps/server/src/db/schema.ts`
  - 将现有非邮件表绑定到对应 `pgSchema`，保持全部 TypeScript 导出不变。
- Modify: `apps/server/src/modules/mail/postgres/table.ts`
  - 提供 `mail` 和 `integration` 两个 Schema 的表创建器，不再添加 `mail0_`。
- Modify: `apps/server/src/modules/mail/postgres/schema/*.ts`
  - 邮件规范表进入 `mail`；`remoteEmail` 和 `submissionAttempt` 进入 `integration`。
- Modify: `apps/server/drizzle.config.ts`
  - 删除 `mail0_*` 表过滤，配置四个 `schemaFilter`。
- Replace: `apps/server/src/db/migrations/**`
  - 删除旧 SQL、日志和快照，生成一个新 `0000` 基线。
- Modify: `apps/server/tests/mail-core/schema-definition.test.ts`
  - 更新 Schema 限定 SQL 断言。
- Move: `apps/server/tests/mail-core/table-prefix.integration.test.ts`
  - To: `apps/server/tests/mail-core/schema-topology.test.ts`
  - 改为 40 张表的完整 Schema/物理名称契约测试。
- Create: `apps/server/tests/mail-core/helpers/schema-contract.ts`
  - 保存 40 张表的期望位置，并生成忽略命名空间的结构语义。
- Create: `apps/server/tests/mail-core/schema-structure-parity.test.ts`
  - 固化调整前的字段、默认值、约束、索引、外键语义快照，忽略 Schema/物理对象名称。
- Create: `apps/server/tests/mail-core/baseline-migration.test.ts`
  - 检查仓库只存在一份基线及其单一日志/快照。
- Modify: `apps/server/tests/mail-core/helpers/database.ts`
  - 将临时 Schema 隔离改为安全命名的临时 Database 隔离。
- Modify: `apps/server/tests/mail-core/helpers/database.test.ts`
  - 覆盖临时 Database 名称、URL 和失败独立清理。
- Modify: `docs/superpowers/specs/2026-07-26-postgresql-business-schemas-design.md`
  - 实施完成后记录实际基线名称和验证结果，不扩大设计范围。

---

### Task 1: 固化结构不变量并切换声明式 Schema

**Files:**

- Create: `apps/server/src/db/pg-schemas.ts`
- Modify: `apps/server/src/db/schema.ts`
- Modify: `apps/server/src/modules/mail/postgres/table.ts`
- Modify: `apps/server/src/modules/mail/postgres/schema/emails.ts`
- Modify: `apps/server/src/modules/mail/postgres/schema/submissions.ts`
- Modify: `apps/server/src/modules/mail/postgres/schema/accounts.ts`
- Modify: `apps/server/src/modules/mail/postgres/schema/blobs.ts`
- Modify: `apps/server/src/modules/mail/postgres/schema/changes.ts`
- Modify: `apps/server/src/modules/mail/postgres/schema/mailboxes.ts`
- Modify: `apps/server/src/modules/mail/postgres/schema/mailbox-threads.ts`
- Modify: `apps/server/src/modules/mail/postgres/schema/thread-references.ts`
- Modify: `apps/server/src/modules/mail/postgres/schema/threads.ts`
- Move: `apps/server/tests/mail-core/table-prefix.integration.test.ts`
- To: `apps/server/tests/mail-core/schema-topology.test.ts`
- Create: `apps/server/tests/mail-core/helpers/schema-contract.ts`
- Create: `apps/server/tests/mail-core/schema-structure-parity.test.ts`
- Modify: `apps/server/tests/mail-core/schema-definition.test.ts`

**Interfaces:**

- Produces:
  - `BUSINESS_SCHEMA_NAMES = ['auth', 'app', 'integration', 'mail'] as const`
  - `authSchema`, `appSchema`, `integrationSchema`, `mailSchema`
  - `createMailTable = mailSchema.table`
  - `createIntegrationTable = integrationSchema.table`
- Preserves:
  - all 40 existing TypeScript table export names;
  - all existing column property names and Repository imports.

- [ ] **Step 1: 添加结构语义快照测试**

创建 `helpers/schema-contract.ts`，在该文件导出 Step 2 的 `expectedLocations`，并实现
结构序列化。以 TypeScript 导出名为键，省略 `config.schema`、`config.name` 和
约束/索引对象名称，但必须保留字段、默认值、约束、索引过滤条件和外键动作。

核心实现：

```ts
import { getTableConfig, IndexedColumn, PgDialect } from 'drizzle-orm/pg-core';
import { SQL } from 'drizzle-orm';

import * as schema from '../../../src/db/schema';

const dialect = new PgDialect();

const normalizeSql = (
  value: SQL | undefined,
  schemaName: string | undefined,
  tableName: string,
): string | undefined => {
  if (value === undefined) return undefined;
  const tablePrefix =
    schemaName === undefined ? `"${tableName}"` : `"${schemaName}"."${tableName}"`;
  return dialect.sqlToQuery(value).sql.replaceAll(tablePrefix, '"<table>"');
};

const serializeDefault = (
  value: unknown,
  schemaName: string | undefined,
  tableName: string,
): string | undefined => {
  if (value === undefined) return undefined;
  if (value instanceof SQL) return normalizeSql(value, schemaName, tableName);
  return JSON.stringify(value);
};

export const collectStructuralSchemaShape = () => {
  const exportByTable = new Map(expectedLocations.map(([name, table]) => [table, name]));

  return Object.fromEntries(
    expectedLocations.map(([exportName, table]) => {
      const config = getTableConfig(table);
      return [
        exportName,
        {
          columns: config.columns.map((column) => ({
            name: column.name,
            sqlType: column.getSQLType(),
            notNull: column.notNull,
            primary: column.primary,
            defaultValue: serializeDefault(column.default, config.schema, config.name),
            hasRuntimeDefault: column.defaultFn !== undefined || column.onUpdateFn !== undefined,
          })),
          primaryKeys: config.primaryKeys.map((key) => key.columns.map(({ name }) => name)),
          uniqueConstraints: config.uniqueConstraints.map((constraint) =>
            constraint.columns.map(({ name }) => name),
          ),
          foreignKeys: config.foreignKeys.map((foreignKey) => {
            const reference = foreignKey.reference();
            const foreignTableExport = exportByTable.get(reference.foreignTable);
            if (foreignTableExport === undefined) {
              throw new Error(`Unknown foreign table from ${exportName}`);
            }
            return {
              columns: reference.columns.map(({ name }) => name),
              foreignTableExport,
              foreignColumns: reference.foreignColumns.map(({ name }) => name),
              onDelete: foreignKey.onDelete,
              onUpdate: foreignKey.onUpdate,
            };
          }),
          indexes: config.indexes.map(({ config: indexConfig }) => ({
            columns: indexConfig.columns.map((column) =>
              column instanceof IndexedColumn ? column.name : null,
            ),
            unique: indexConfig.unique,
            method: indexConfig.method,
            where: normalizeSql(indexConfig.where, config.schema, config.name),
          })),
          checks: config.checks.map(({ value }) => normalizeSql(value, config.schema, config.name)),
        },
      ];
    }),
  );
};
```

安装版本若将外键动作暴露在 `reference()` 返回值而不是 `foreignKey` 本身，则从返回值
读取 `onDelete/onUpdate`；两个动作字段必须进入快照，不能删掉动作断言来通过编译。

创建 `schema-structure-parity.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { collectStructuralSchemaShape } from './helpers/schema-contract';

describe('database structural parity', () => {
  it('preserves every field, constraint, index, and foreign-key semantic', () => {
    expect(collectStructuralSchemaShape()).toMatchSnapshot();
  });
});
```

对当前未修改的模型运行一次快照更新：

```powershell
pnpm --dir apps/server exec vitest run tests/mail-core/schema-structure-parity.test.ts -u
```

Expected: PASS，并创建只描述结构语义的快照。该快照是后续修改不得改变表数据结构的
基线。

- [ ] **Step 2: 将前缀测试改为完整拓扑契约并确认 RED**

将 `table-prefix.integration.test.ts` 移动为 `schema-topology.test.ts`，删除数据库依赖。
将以下完整映射放入 `helpers/schema-contract.ts` 并导出：

```ts
const expectedLocations = [
  ['user', schema.user, 'auth', 'user_account'],
  ['session', schema.session, 'auth', 'session'],
  ['account', schema.account, 'auth', 'account'],
  ['verification', schema.verification, 'auth', 'verification'],
  ['jwks', schema.jwks, 'auth', 'jwks'],
  ['oauthApplication', schema.oauthApplication, 'auth', 'oauth_application'],
  ['oauthAccessToken', schema.oauthAccessToken, 'auth', 'oauth_access_token'],
  ['oauthConsent', schema.oauthConsent, 'auth', 'oauth_consent'],
  ['earlyAccess', schema.earlyAccess, 'app', 'early_access'],
  ['userHotkeys', schema.userHotkeys, 'app', 'user_hotkeys'],
  ['summary', schema.summary, 'app', 'summary'],
  ['note', schema.note, 'app', 'note'],
  ['userSettings', schema.userSettings, 'app', 'user_settings'],
  ['writingStyleMatrix', schema.writingStyleMatrix, 'app', 'writing_style_matrix'],
  ['emailTemplate', schema.emailTemplate, 'app', 'email_template'],
  ['connection', schema.connection, 'integration', 'connection'],
  ['authorizationBinding', schema.authorizationBinding, 'integration', 'authorization_binding'],
  ['systemIntegrationConfig', schema.systemIntegrationConfig, 'integration', 'system_config'],
  ['channelIntegrationMapping', schema.channelIntegrationMapping, 'integration', 'channel_mapping'],
  ['integrationOAuthSession', schema.integrationOAuthSession, 'integration', 'oauth_session'],
  ['remoteEmail', schema.remoteEmail, 'integration', 'remote_email'],
  ['submissionAttempt', schema.submissionAttempt, 'integration', 'send_attempt'],
  ['mailAccount', schema.mailAccount, 'mail', 'account'],
  ['mailIdentity', schema.mailIdentity, 'mail', 'identity'],
  ['blob', schema.blob, 'mail', 'blob'],
  ['mailChange', schema.mailChange, 'mail', 'change'],
  ['email', schema.email, 'mail', 'email'],
  ['emailSearch', schema.emailSearch, 'mail', 'email_search'],
  ['emailAddress', schema.emailAddress, 'mail', 'email_address'],
  ['emailMailbox', schema.emailMailbox, 'mail', 'email_mailbox'],
  ['emailTrashRestore', schema.emailTrashRestore, 'mail', 'email_trash_restore'],
  ['emailKeyword', schema.emailKeyword, 'mail', 'email_keyword'],
  ['emailContent', schema.emailContent, 'mail', 'email_content'],
  ['emailPart', schema.emailPart, 'mail', 'email_part'],
  ['mailboxThread', schema.mailboxThread, 'mail', 'mailbox_thread'],
  ['mailbox', schema.mailbox, 'mail', 'mailbox'],
  ['emailSubmission', schema.emailSubmission, 'mail', 'submission'],
  ['submissionBlob', schema.submissionBlob, 'mail', 'submission_blob'],
  ['threadReference', schema.threadReference, 'mail', 'thread_reference'],
  ['thread', schema.thread, 'mail', 'thread'],
] as const;
```

对每项断言 `getTableConfig(table).schema/name`，并断言不存在 `mail0_`：

```ts
for (const [exportName, table, expectedSchema, expectedName] of expectedLocations) {
  const config = getTableConfig(table);
  expect(config.schema, exportName).toBe(expectedSchema);
  expect(config.name, exportName).toBe(expectedName);
  expect(config.name, exportName).not.toMatch(/^mail0_/u);
}
```

Run:

```powershell
pnpm --dir apps/server exec vitest run tests/mail-core/schema-topology.test.ts
```

Expected: FAIL；当前表位于 `public`/未声明 Schema，名称仍以 `mail0_` 开头。

- [ ] **Step 3: 创建四个 Schema 并调整非邮件表**

创建 `apps/server/src/db/pg-schemas.ts`：

```ts
import { pgSchema } from 'drizzle-orm/pg-core';

export const BUSINESS_SCHEMA_NAMES = ['auth', 'app', 'integration', 'mail'] as const;
export const authSchema = pgSchema('auth');
export const appSchema = pgSchema('app');
export const integrationSchema = pgSchema('integration');
export const mailSchema = pgSchema('mail');
```

在 `schema.ts` 中移除 `pgTableCreator` 和 `createTable`，改用：

```ts
const createAuthTable = authSchema.table;
const createAppTable = appSchema.table;
const createIntegrationTable = integrationSchema.table;
```

严格按照 Step 2 映射替换表创建器和物理名称。字段对象和 extra config 回调内容保持
不变。仅将显式索引名称：

```ts
index('idx_mail0_email_template_user_id');
unique('mail0_email_template_user_id_name_unique');
```

分别改为：

```ts
index('email_template_user_id_idx');
unique('email_template_user_id_name_uidx');
```

- [ ] **Step 4: 调整邮件表创建器**

将 `table.ts` 改为：

```ts
import { integrationSchema, mailSchema } from '../../../db/pg-schemas';

export const createMailTable = mailSchema.table;
export const createIntegrationTable = integrationSchema.table;
```

全部邮件规范表继续调用 `createMailTable`，但物理名称按 Step 2 映射调整。仅两张表改用
集成创建器：

```ts
export const remoteEmail = createIntegrationTable('remote_email', columns, config);
export const submissionAttempt = createIntegrationTable('send_attempt', columns, config);
```

不得移动 TypeScript 文件或更改导出名、字段、约束和 Repository。

- [ ] **Step 5: 修正显式 Schema SQL 断言**

将 `schema-definition.test.ts` 的部分索引 SQL 断言改为：

```ts
expect(new PgDialect().sqlToQuery(predicate!).sql).toContain(
  '"mail"."mailbox"."parent_id" IS NULL AND "mail"."mailbox"."deleted_at" IS NULL',
);
```

- [ ] **Step 6: 验证 GREEN 与结构不变量**

Run:

```powershell
pnpm --dir apps/server exec vitest run tests/mail-core/schema-topology.test.ts tests/mail-core/schema-structure-parity.test.ts tests/mail-core/schema-definition.test.ts
```

Expected: PASS；结构语义快照不更新也能通过，证明没有改变表数据结构。

- [ ] **Step 7: 提交声明式模型**

```powershell
git add -- apps/server/src/db/pg-schemas.ts apps/server/src/db/schema.ts apps/server/src/modules/mail/postgres apps/server/tests/mail-core/helpers/schema-contract.ts apps/server/tests/mail-core/schema-topology.test.ts apps/server/tests/mail-core/schema-structure-parity.test.ts apps/server/tests/mail-core/__snapshots__ apps/server/tests/mail-core/schema-definition.test.ts
git commit -m "refactor(db): classify tables by business schema"
```

---

### Task 2: 生成唯一开发基线

**Files:**

- Modify: `apps/server/drizzle.config.ts`
- Delete: `apps/server/src/db/migrations/*.sql`
- Delete: `apps/server/src/db/migrations/meta/*.json`
- Create: `apps/server/src/db/migrations/0000_*.sql`
- Create: `apps/server/src/db/migrations/meta/0000_snapshot.json`
- Create: `apps/server/src/db/migrations/meta/_journal.json`
- Create: `apps/server/tests/mail-core/baseline-migration.test.ts`

**Interfaces:**

- Consumes: Task 1 的四 Schema 声明式模型。
- Produces: 唯一 `0000` SQL、单条 journal、单个 snapshot。

- [ ] **Step 1: 编写基线仓库契约并确认 RED**

创建 `baseline-migration.test.ts`：

```ts
const migrationRoot = resolve(import.meta.dirname, '../../src/db/migrations');
const sqlFiles = readdirSync(migrationRoot).filter((name) => /^\d{4}_.+\.sql$/u.test(name));
const snapshotFiles = readdirSync(resolve(migrationRoot, 'meta')).filter((name) =>
  /^\d{4}_snapshot\.json$/u.test(name),
);
const journal = JSON.parse(readFileSync(resolve(migrationRoot, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string }[];
};

expect(sqlFiles).toHaveLength(1);
expect(snapshotFiles).toEqual(['0000_snapshot.json']);
expect(journal.entries).toHaveLength(1);
expect(journal.entries[0]?.idx).toBe(0);

const sql = readFileSync(resolve(migrationRoot, sqlFiles[0]!), 'utf8');
for (const schemaName of ['auth', 'app', 'integration', 'mail']) {
  expect(sql).toContain(`CREATE SCHEMA "${schemaName}"`);
}
expect(sql).not.toContain('mail0_');
expect(sql).not.toMatch(/\bINSERT\s+INTO\b/iu);
```

Run:

```powershell
pnpm --dir apps/server exec vitest run tests/mail-core/baseline-migration.test.ts
```

Expected: FAIL；仓库当前包含多份历史迁移。

- [ ] **Step 2: 配置 Drizzle 的 Schema 范围**

将 `drizzle.config.ts` 改为：

```ts
export default {
  schema: './src/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  out: './src/db/migrations',
  schemaFilter: ['auth', 'app', 'integration', 'mail'],
} satisfies Config;
```

删除 `tablesFilter: ['mail0_*']`。

- [ ] **Step 3: 安全确认迁移目录并清理旧时间线**

在删除前验证目标绝对路径必须等于：

```text
D:\WorkSpace\Zero\apps\server\src\db\migrations
```

仅删除该目录下的 `*.sql` 和 `meta/*.json`；不得删除 `src/db`、其他目录或用户未跟踪
文件。历史内容仍可从 Git 恢复。

- [ ] **Step 4: 从声明式模型生成新基线**

Run:

```powershell
pnpm db:generate
```

Expected: 生成一个 `0000_*.sql`、`meta/0000_snapshot.json` 和只有一条记录的
`meta/_journal.json`。检查 SQL 直接创建四个 Schema，无 `mail0_`，无业务
`INSERT`。

- [ ] **Step 5: 验证基线契约**

Run:

```powershell
pnpm --dir apps/server exec vitest run tests/mail-core/baseline-migration.test.ts tests/mail-core/schema-topology.test.ts tests/mail-core/schema-structure-parity.test.ts
```

Expected: PASS，且结构语义快照无需更新。

- [ ] **Step 6: 提交基线**

```powershell
git add -- apps/server/drizzle.config.ts apps/server/src/db/migrations apps/server/tests/mail-core/baseline-migration.test.ts
git commit -m "chore(db): replace history with schema baseline"
```

---

### Task 3: 将邮件集成测试隔离改为临时 Database

**Files:**

- Modify: `apps/server/tests/mail-core/helpers/database.ts`
- Modify: `apps/server/tests/mail-core/helpers/database.test.ts`
- Modify: `apps/server/tests/mail-core/schema-topology.test.ts`

**Interfaces:**

- Preserves:
  - `withMailTestDatabase({ db, unitOfWork })` 的主要使用方式；
  - `runFailureIndependentCleanup(actions, primaryFailure)`。
- Produces:
  - `requireSafeDatabase(databaseName: string): void`
  - `databaseUrlFor(databaseUrl: string, databaseName: string): string`

- [ ] **Step 1: 编写临时 Database 安全测试并确认 RED**

在 `database.test.ts` 增加：

```ts
it('accepts only generated mail-core database names', () => {
  expect(() =>
    requireSafeDatabase('mail_core_test_0123456789abcdef0123456789abcdef'),
  ).not.toThrow();
  expect(() => requireSafeDatabase('mail')).toThrow('Unsafe mail-core test database name');
  expect(() => requireSafeDatabase('mail_core_test_bad-name')).toThrow(
    'Unsafe mail-core test database name',
  );
});

it('targets the generated database without changing credentials or options', () => {
  expect(
    databaseUrlFor(
      'postgresql://zero:secret@127.0.0.1:5432/zerodotemail?sslmode=disable',
      'mail_core_test_0123456789abcdef0123456789abcdef',
    ),
  ).toBe(
    'postgresql://zero:secret@127.0.0.1:5432/mail_core_test_0123456789abcdef0123456789abcdef?sslmode=disable',
  );
});
```

Run:

```powershell
pnpm --dir apps/server exec vitest run tests/mail-core/helpers/database.test.ts
```

Expected: FAIL；两个函数尚未导出。

- [ ] **Step 2: 实现安全名称与 URL**

在 `database.ts` 中实现：

```ts
const SAFE_DATABASE = /^mail_core_test_[a-f0-9]{32}$/;

export const requireSafeDatabase = (databaseName: string): void => {
  if (!SAFE_DATABASE.test(databaseName)) {
    throw new Error('Unsafe mail-core test database name');
  }
};

export const databaseUrlFor = (databaseUrl: string, databaseName: string): string => {
  requireSafeDatabase(databaseName);
  const isolatedUrl = new URL(databaseUrl);
  isolatedUrl.pathname = `/${databaseName}`;
  return isolatedUrl.toString();
};
```

- [ ] **Step 3: 将迁移执行改为标准多 Schema**

移除 `requireSafeSchema`、`quotedSchema`、`replaceAll('"public".', ...)` 和
`search_path`。`applyGeneratedMigrations` 直接按 journal 顺序执行唯一基线：

```ts
const applyGeneratedMigrations = async (connection: Sql): Promise<void> => {
  const migrationsFolder = resolve(import.meta.dirname, '../../../src/db/migrations');
  for (const tag of migrationTags(migrationsFolder)) {
    const migration = readFileSync(resolve(migrationsFolder, `${tag}.sql`), 'utf8');
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim().length > 0) {
        await connection.unsafe(statement);
      }
    }
  }
};
```

- [ ] **Step 4: 将测试生命周期改为临时 Database**

`withMailTestDatabase` 生成：

```ts
const databaseName = `mail_core_test_${randomBytes(16).toString('hex')}`;
```

生命周期严格为：

```ts
await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
isolated = postgres(databaseUrlFor(databaseUrl, databaseName), {
  max: 10,
  onnotice: () => undefined,
});
await applyGeneratedMigrations(isolated);
```

finally 中先关闭 `isolated`，再执行：

```ts
requireSafeDatabase(databaseName);
await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
```

最后关闭 admin。`created` 为 false 时不得执行删除；所有清理仍交给
`runFailureIndependentCleanup`。

- [ ] **Step 5: 验证 helper 与真实集成测试**

Run:

```powershell
pnpm --dir apps/server exec vitest run tests/mail-core/helpers/database.test.ts tests/mail-core/constraints.integration.test.ts tests/mail-core/repositories.integration.test.ts
```

Expected: PASS；集成查询实际访问 `auth/app/integration/mail`，不依赖 `search_path`
重写。

- [ ] **Step 6: 提交测试隔离**

```powershell
git add -- apps/server/tests/mail-core/helpers/database.ts apps/server/tests/mail-core/helpers/database.test.ts apps/server/tests/mail-core/schema-topology.test.ts
git commit -m "test(db): isolate schema tests by database"
```

---

### Task 4: 验证基线、db:push 和完整回归

**Files:**

- Modify: `docs/superpowers/specs/2026-07-26-postgresql-business-schemas-design.md`
- Modify only if verification reveals a defect:
  - `apps/server/src/db/pg-schemas.ts`
  - `apps/server/src/db/schema.ts`
  - `apps/server/src/modules/mail/postgres/schema/*.ts`
  - `apps/server/src/db/migrations/0000_*.sql`
  - `apps/server/tests/mail-core/*.test.ts`

**Interfaces:**

- Consumes: Task 1–3 的模型、基线和临时 Database helper。
- Produces: 可复现的空库初始化证据及完整测试证据。

- [ ] **Step 1: 运行完整邮箱内核测试**

```powershell
pnpm --filter=@zero/mail-core test
pnpm --dir apps/server test:mail-core
```

Expected: 两个命令均 exit 0，零失败。任何失败先使用
`superpowers:systematic-debugging` 定位并添加回归测试，不得更新结构语义快照来掩盖
表结构变化。

- [ ] **Step 2: 验证唯一基线可初始化空库**

创建安全命名的一次性 Database，将临时 `DATABASE_URL` 指向该库后执行：

```powershell
pnpm db:migrate
```

查询 `pg_tables` 和 `information_schema`，必须得到：

```text
auth         8
app          7
integration  7
mail         18
public       0 Zero 业务表
```

验证完成后关闭所有连接并删除该一次性 Database。

- [ ] **Step 3: 验证 db:push 可初始化另一空库**

创建第二个安全命名的一次性 Database，将临时 `DATABASE_URL` 指向该库后执行：

```powershell
pnpm db:push --force
```

Expected: exit 0，直接创建四个 Schema，不创建 `public.mail0_*`。查询得到与 Step 2
相同的表数。

- [ ] **Step 4: 比较两条初始化路径的结构**

分别从两个一次性 Database 查询：

```sql
SELECT table_schema, table_name, column_name, ordinal_position, data_type,
       is_nullable, column_default
FROM information_schema.columns
WHERE table_schema IN ('auth', 'app', 'integration', 'mail')
ORDER BY table_schema, table_name, ordinal_position;
```

并从 `pg_constraint`、`pg_indexes` 查询约束与索引。规范化数据库自动派生的对象名称
后，两边结果必须相同。比较完成后删除两个一次性 Database。

- [ ] **Step 5: 验证生成漂移、Lint 和构建**

先记录工作树，然后执行：

```powershell
pnpm db:generate
pnpm --dir apps/server lint
pnpm build
git status --short
```

Expected:

- `db:generate` 输出“无 Schema 变更”或不产生新的 SQL/快照；
- Lint exit 0；
- Build exit 0；
- 工作树没有非预期生成文件；
- `AGENTS.md` 仍为未跟踪且未暂存。

- [ ] **Step 6: 执行遗漏扫描**

Run:

```powershell
git grep -n "pgTableCreator\\|mail0_" -- apps/server/src apps/server/tests apps/server/drizzle.config.ts
git diff --check
```

Expected:

- 当前模型、测试和新基线中不存在 `pgTableCreator` 或 `mail0_`；
- 历史设计文档可以保留历史描述；
- 无空白错误。

- [ ] **Step 7: 更新设计验证记录并提交**

在设计文档末尾增加实际基线文件名、测试数量、`db:migrate`/`db:push` 临时库结果、
Lint 和 Build 结果。只记录实际命令输出，不写未验证结论。

```powershell
git add -- docs/superpowers/specs/2026-07-26-postgresql-business-schemas-design.md
git commit -m "docs(db): record schema baseline verification"
```

---

## 完成前复核

- [ ] 40 个 TypeScript 表导出全部出现在拓扑契约中。
- [ ] 结构语义快照在生产模型调整后未更新。
- [ ] 只有一个 `0000` SQL、一个 snapshot 和一条 journal entry。
- [ ] 新基线无 `INSERT INTO`，无 `mail0_`。
- [ ] `db:migrate` 与 `db:push` 都能从空库初始化。
- [ ] `auth/app/integration/mail` 表数分别为 8/7/7/18。
- [ ] `public` 不包含 Zero 业务表。
- [ ] 邮箱内核测试、Server Lint 和全仓构建均有本轮新鲜通过证据。
- [ ] Gmail 入栈代码未在本计划中修改。
