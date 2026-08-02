import { describe, expect, it } from 'vitest';

import { mailboxErrorMessage } from './mailbox-error-message';

describe('mailboxErrorMessage', () => {
  it.each([
    ['MAILBOX_HAS_CHILD', '该项目仍有子项，请先移动或删除子项。'],
    ['MAILBOX_HAS_EMAIL', '该文件夹仍有邮件，请先移动或清空邮件。'],
    ['MAILBOX_ROLE_CONFLICT', '系统邮箱不能修改或删除。'],
    ['MAILBOX_NAME_CONFLICT', '同一层级已存在同名项目。'],
    ['STATE_MISMATCH', '邮箱内容已发生变化，请刷新后重试。'],
  ])('maps %s to an actionable Chinese message', (code, expected) => {
    expect(mailboxErrorMessage(code)).toBe(expected);
  });

  it('uses a safe fallback for unknown errors', () => {
    expect(mailboxErrorMessage('UNKNOWN')).toBe('邮箱操作失败，请重试。');
  });
});
