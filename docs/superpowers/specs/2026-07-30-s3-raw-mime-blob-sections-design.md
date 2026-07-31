# S3 完整 MIME 与 BlobSection 存储设计

## 1. 背景

Zero 当前已经具备本地邮箱内核、收件导入、草稿、EmailSubmission、投递 Spool
和渠道插件，但 Blob 层仍采用本地文件目录，并且同一封邮件会分别保存完整 MIME、
纯文本正文、HTML 正文和每个附件。该模型存在三个问题：

- 一封邮件的完整 MIME 与正文、附件被重复持久化，占用多份对象存储空间；
- 邮件内容的事实来源不唯一，正文或附件副本可能与原始 MIME 不一致；
- Blob HTTP 路由当前位于全局 tRPC 中间件之后，可能被 tRPC 提前拦截。

本阶段直接建立最终模型。开发数据库允许清空重建，因此不保留旧字段、不实现双读、
不增加历史数据迁移或兼容层。

## 2. 设计目标

- 每个邮件内容修订只保存一个不可变的完整 RFC 822/MIME 对象；
- 收件、草稿和已发送邮件统一使用相同的 Raw MIME 模型；
- 正文、附件和内联资源通过 Raw MIME 内的字节区间读取，不保存永久独立副本；
- PostgreSQL 保存可查询投影、可变邮箱状态和 MIME 分段元数据；
- 加星、已读、标签、文件夹、归档、垃圾箱和 Snooze 只更新 PostgreSQL；
- EmailSubmission 冻结精确的 Raw MIME 修订，发送成功后不复制或重写对象；
- 部署者提供的 S3 兼容服务通过统一 BlobStore 接口接入；
- 对象桶保持私有，所有访问先经过 Zero 的账户鉴权；
- 修复 Blob 路由边界，使 `/api/mail/**` 不再被 `/api/trpc/**` 拦截。

## 3. 非目标

- 不把标签、文件夹、关键字等可变状态写回 Gmail、Outlook、Zoho 或 IMAP；
- 不在本阶段提供浏览器直传 S3 或永久公开对象 URL；
- 不在数据库中保存 S3 Access Key、Secret Key 或任意可配置 Endpoint；
- 不保留旧的正文 Blob、附件 Blob 或 Submission 多 Blob 模型；
- 不处理历史开发数据库的数据迁移。

## 4. 核心不变量

1. `mail.email.blob_id` 指向该邮件当前修订的唯一完整 MIME Blob。
2. Ready Blob 的对象键由账户和 SHA-256 决定，内容不可原地覆盖。
3. `mail.email_content` 只保存经清洗的正文投影，不是 MIME 事实来源。
4. `mail.email_part` 的 BlobSection 必须完全落在 Raw MIME Blob 范围内。
5. BlobSection 读取后必须按 `Content-Transfer-Encoding` 解码并校验解码长度。
6. Draft 每次内容修改产生新的不可变 MIME；旧修订由引用计数语义和 GC 回收。
7. Submission 只冻结一个 Raw MIME Blob，并记录草稿修订号。
8. 发送成功仅改变邮件生命周期、邮箱归属和服务商标识，不复制 S3 对象。
9. 邮件状态更新不能产生任何 S3 写操作。
10. Blob 只有在邮件、Submission 和有效临时上传均不再引用后才允许回收。

## 5. 总体架构

```text
渠道插件 / 草稿编辑器
        │
        ▼
完整 RFC822/MIME bytes
        │
        ├── SHA-256 ──► 私有 S3 Raw MIME Object
        │
        └── MIME 语义解析 + 字节区间索引
                         │
                         ▼
PostgreSQL
├── email：当前 Raw Blob、不可变内容元数据
├── email_content：text/html/preview 查询投影
├── email_part：BlobSection、文件名、CID、类型
├── email_mailbox / email_keyword：可变本地状态
└── submission：冻结的 Raw Blob 修订
```

该设计参考 Stalwart 的不可变 Blob 与 `BlobSection` 模型，并转换成适合 Zero 的
TypeScript、PostgreSQL 和渠道插件架构。Nango 的 S3 实现只作为 S3 兼容配置、
自定义 Endpoint 和 Path Style 的工程参考，不把 Nango 的文件模型引入 Mail Core。

## 6. PostgreSQL 最终模板

### 6.1 `mail.blob`

继续保存：

- `id`
- `mail_account_id`
- `sha256`
- `size_bytes`
- `content_type`
- `object_key`
- `status`
- 生命周期时间

Ready Raw MIME 使用 `message/rfc822`。临时上传仍可使用真实附件类型，但提交成草稿
完整 MIME 后必须释放临时上传引用并按 TTL 清理。

### 6.2 `mail.email`

- `blob_id` 为当前 Raw MIME 修订；
- 删除正文专用 Blob 关联；
- 邮件生命周期继续使用 `draft | received | sent`；
- `draft_revision` 继续承担乐观并发控制。

### 6.3 `mail.email_content`

删除：

- `text_blob_id`
- `html_blob_id`

新增：

- `text_body text`
- `html_body text`

正文投影用于线程视图、搜索和预览，必须经过现有 HTML 清洗器处理。原始 MIME 仍是
重新解析、下载和审计的事实来源。

### 6.4 `mail.email_part`

删除 `blob_id`，新增：

- `raw_blob_id`
- `offset_start`
- `encoded_length`
- `decoded_length`
- `transfer_encoding`

`offset_start` 指向该 MIME Part body 的第一个字节；`encoded_length` 是原始传输编码
字节数；`decoded_length` 是解码后大小。`transfer_encoding` 允许：

- `7bit`
- `8bit`
- `binary`
- `base64`
- `quoted-printable`

区间必须使用 64 位非负整数，并通过账户级复合外键绑定 Raw Blob。

### 6.5 `mail.submission`

Submission 直接保存冻结 Raw Blob 的标识和校验快照：

- `raw_blob_id`
- `raw_sha256`
- `raw_size_bytes`
- `raw_object_key`

删除 `submission_blob` 多行快照表。Submission 创建时验证 Raw Blob 与当前
`draft_revision` 一致；后续即使草稿产生新修订，已排队的 Submission 仍读取冻结对象。

## 7. MIME Section 索引

`postal-mime` 继续负责地址、主题、正文语义和附件信息解析。新增一个只处理原始字节边界
的 Section Indexer：

1. 按 RFC 5322 规则识别 header/body 分隔符；
2. 解析 Content-Type boundary 和 Content-Transfer-Encoding；
3. 递归扫描 multipart，各 Part 使用与语义解析器一致的 `partPath`；
4. 记录每个叶子 Part body 的绝对字节偏移和编码长度；
5. 将 Section 与 `postal-mime` 解析结果按 `partPath` 对齐；
6. 解码区间并验证 `decodedLength`，不一致则拒绝提交数据库。

索引器必须覆盖 CRLF/LF、multipart/mixed、alternative、related、嵌套 multipart、
base64、quoted-printable、7bit、8bit 和 binary。无法安全建立区间时，导入失败并保留
可诊断错误，不能退回永久附件副本。

## 8. 生命周期

### 8.1 收件

1. 渠道插件取得完整原始邮件；
2. 写入临时对象并计算 SHA-256；
3. 提交为内容寻址 Raw MIME 对象；
4. 解析语义与 BlobSection；
5. 校验所有 Section；
6. 在同一数据库事务中写入 Blob、Email、正文投影、Part 和本地状态；
7. 失败时删除未引用临时对象；已提交但未引用对象由 GC 回收。

### 8.2 草稿

1. 附件上传先成为有 TTL 的临时/保留 Blob；
2. 保存草稿时读取这些附件，渲染一份完整 MIME；
3. 提交完整 MIME Raw Blob 并建立 Section；
4. 原子替换 Email 当前 `blob_id` 并递增 `draft_revision`；
5. 释放已嵌入 MIME 的附件临时引用；
6. 旧草稿 Raw Blob 在宽限期后、确认没有 Submission 引用时由 GC 删除。

草稿的 `Bcc` 作为投递信封私有元数据保存在 PostgreSQL，不应泄漏到最终发出的 MIME
头部。草稿 UI 所需信息来自数据库投影。

### 8.3 发件

1. EmailSubmission 冻结当前草稿 Raw Blob 和修订号；
2. 投递 Worker 在实际发送时从 S3 读取冻结 Raw MIME；
3. Gmail/Outlook/Zoho API 或 SMTP 只接收该完整 MIME；
4. 服务商确认成功后，同一事务把本地 Draft 转成 Sent，并记录服务商标识；
5. Raw MIME 对象不复制、不移动、不重写。

### 8.4 状态修改与删除

- 已读、加星、标签、文件夹、归档、垃圾箱和 Snooze：只更新 PostgreSQL；
- 移入垃圾箱不释放 Raw Blob；
- 永久删除 Email 后释放其 Raw Blob 引用；
- GC 仅删除经过宽限期且无 Email、Submission 或上传保留引用的对象。

## 9. S3 BlobStore

新增 `S3BlobStore`，实现现有 BlobStore 的：

- 临时写入；
- 临时对象提交为内容寻址对象；
- 全量读取；
- HTTP Range 读取；
- 幂等删除；
- 按账户前缀分页枚举。

运行配置仅来自环境变量：

```text
MAIL_BLOB_STORE=s3
MAIL_BLOB_S3_ENDPOINT=https://objects.example.com
MAIL_BLOB_S3_REGION=your-s3-region
MAIL_BLOB_S3_BUCKET=your-private-mail-bucket
MAIL_BLOB_S3_PREFIX=mail
MAIL_BLOB_S3_FORCE_PATH_STYLE=false
MAIL_BLOB_S3_ACCESS_KEY_ID=...
MAIL_BLOB_S3_SECRET_ACCESS_KEY=...
```

Zero 不内置或自动启动本地对象存储。Endpoint、Region、Bucket、Prefix、Access Key
和 Secret Key 均为启动必填项。启动时验证配置、Bucket 可访问性、写入/读取/Range/删除
能力；关键 Blob 存储不可用时 Server 启动失败。日志不得输出凭据、正文或附件内容。

## 10. HTTP 与安全

- tRPC 只挂载到 `/api/trpc/*`；
- Blob 上传、完整 MIME 下载和 Part 下载使用独立 `/api/mail/**` 路由；
- 路由必须验证会话、Mail Account 所有权和 Blob/Email 归属；
- 数据库只保存对象键，不保存公共 URL；
- S3 Bucket 禁止匿名读取；
- Web 响应根据 Part 元数据设置安全的 Content-Type、Content-Disposition 和文件名；
- Range 越界、Section 元数据不一致或解码失败必须返回领域错误。

## 11. Docker 开发环境

Compose 不包含任何对象存储服务，也不负责创建 Bucket。部署者必须提前准备私有 S3
兼容存储、创建 Bucket，并在 `.env` 中填写完整 `MAIL_BLOB_S3_*` 配置。

开发和生产都走相同的外部 S3 语义，不保留本地文件回退路径；Server 启动时主动验证
Bucket 和对象操作能力。

## 12. 一致性与故障恢复

对象存储和 PostgreSQL 无法组成单一事务，因此使用“先对象、后数据库”的可恢复顺序：

1. 对象内容寻址且提交幂等；
2. 数据库事务只引用已验证存在的 Ready Blob；
3. 数据库失败留下的未引用对象由后台 GC 扫描；
4. 删除采用 `ready -> deleting -> deleted` 状态机和幂等 S3 Delete；
5. S3 暂时失败保留 `deleting` 状态并重试；
6. GC 删除前再次查询全部引用，防止并发误删。

## 13. 验收标准

- 每个邮件修订在 S3 中只有一个永久完整 MIME 对象；
- 正文和附件永久存储不产生独立对象；
- 附件下载使用 S3 Range，并正确解码五种传输编码；
- 搜索、线程列表和正文展示不依赖每次读取 S3；
- Draft 修改、Submission 冻结和发送成功状态转换保持正确；
- 加星、标签、移动邮箱等操作不会写 S3；
- Blob 路由不会进入 tRPC 处理器；
- Server 在 S3 不可用时明确启动失败；
- `db:push` 清空非系统 Schema 后可用最终模板完整初始化；
- 单元、集成和 Docker 架构测试覆盖上述不变量。
