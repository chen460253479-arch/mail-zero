import { m } from '@/paraglide/messages';

const messages: Readonly<Record<string, () => string>> = {
  MAILBOX_HAS_CHILD: () => m['common.mailboxes.hasChildren'](),
  MAILBOX_HAS_EMAIL: () => m['common.mailboxes.folderHasMail'](),
  MAILBOX_ROLE_CONFLICT: () => m['common.mailboxes.systemMailboxProtected'](),
  MAILBOX_NAME_CONFLICT: () => m['common.mailboxes.siblingNameConflict'](),
  STATE_MISMATCH: () => m['common.mailboxes.stateChanged'](),
  INVALID_ARGUMENTS: () => m['common.mailboxes.invalidSettings'](),
};

export function mailboxErrorMessage(code: string): string {
  return messages[code]?.() ?? m['common.mailboxes.operationFailed']();
}
