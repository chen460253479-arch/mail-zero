# 邮件对象存储目录设计

## 目标

Zero 使用对象存储保存独立附件、草稿完整 MIME 和真实邮件完整 MIME。PostgreSQL
继续保存结构化邮件数据、Blob 元数据和对象键，不把邮箱地址写入对象键。

## 对象键

对象键使用内部用户 ID、内部邮箱账户 ID、业务类别和 SHA-256 内容地址：

```text
mail/users/{userId}/accounts/{mailAccountId}/attachments/sha256/{前两位}/{sha256}
mail/users/{userId}/accounts/{mailAccountId}/drafts/sha256/{前两位}/{sha256}
mail/users/{userId}/accounts/{mailAccountId}/messages/sha256/{前两位}/{sha256}
mail/users/{userId}/accounts/{mailAccountId}/temporary/{kind}/{uuid}
```

`sha256/{前两位}` 用于把对象分散到稳定前缀中，并保留按内容寻址、幂等写入和完整性
校验能力。

## Blob 类别

- `attachment`：用户选择后立即上传的独立附件。
- `draft_mime`：可继续修改的草稿完整 MIME。
- `message_mime`：已接收邮件和实际提交投递的不可变完整 MIME。

Blob 去重边界为 `(mail_account_id, kind, sha256, size_bytes)`。相同字节在不同业务类别
中拥有独立对象和生命周期，防止草稿清理误删已发送邮件，也防止附件对象与完整 MIME
互相复用。

## 生命周期

- 附件上传直接进入 `attachments`。
- 保存草稿生成 `drafts` 对象。
- 接收邮件生成 `messages` 对象。
- 创建投递提交时，从草稿 MIME 生成不可变的 `messages` 对象；服务商确认成功后，
  本地邮件切换到该对象并从草稿转为已发送。
- 对账与垃圾回收根据 Blob 类别重建和验证对象键，并分别扫描三个持久类别与临时类别。

本阶段不实现附件库、附件复用界面、人工审查或用户清理功能。
