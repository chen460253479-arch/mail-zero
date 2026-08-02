const messages: Readonly<Record<string, string>> = {
  MAILBOX_HAS_CHILD: '该项目仍有子项，请先移动或删除子项。',
  MAILBOX_HAS_EMAIL: '该文件夹仍有邮件，请先移动或清空邮件。',
  MAILBOX_ROLE_CONFLICT: '系统邮箱不能修改或删除。',
  MAILBOX_NAME_CONFLICT: '同一层级已存在同名项目。',
  STATE_MISMATCH: '邮箱内容已发生变化，请刷新后重试。',
  INVALID_ARGUMENTS: '邮箱设置无效，请检查名称、父级或类型。',
};

export function mailboxErrorMessage(code: string): string {
  return messages[code] ?? '邮箱操作失败，请重试。';
}
