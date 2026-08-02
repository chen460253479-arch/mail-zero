import type { Mailbox, MailboxRole } from '../model/mailbox';

export type MailboxGroups = {
  core: Mailbox[];
  management: Mailbox[];
  otherSystem: Mailbox[];
  folders: Mailbox[];
  labels: Mailbox[];
};

export type GroupMailboxOptions = {
  subscribedOnly?: boolean;
};

const coreRoles: readonly MailboxRole[] = ['inbox', 'drafts', 'sent'];
const managementRoles: readonly MailboxRole[] = ['archive', 'junk', 'trash'];

const compareMailboxes = (left: Mailbox, right: Mailbox): number =>
  left.sortOrder - right.sortOrder ||
  left.name.localeCompare(right.name) ||
  left.id.localeCompare(right.id);

const compareSystemMailboxes = (
  roleOrder: readonly MailboxRole[],
  left: Mailbox,
  right: Mailbox,
): number => {
  const leftIndex = left.role === null ? Number.MAX_SAFE_INTEGER : roleOrder.indexOf(left.role);
  const rightIndex = right.role === null ? Number.MAX_SAFE_INTEGER : roleOrder.indexOf(right.role);
  return leftIndex - rightIndex || compareMailboxes(left, right);
};

export function groupMailboxes(
  mailboxes: readonly Mailbox[],
  { subscribedOnly = false }: GroupMailboxOptions = {},
): MailboxGroups {
  const visible = mailboxes.filter((mailbox) => !subscribedOnly || mailbox.isSubscribed);
  const systems = visible.filter((mailbox) => mailbox.kind === 'system');
  const hasRole = (mailbox: Mailbox, roles: readonly MailboxRole[]) =>
    mailbox.role !== null && roles.includes(mailbox.role);

  return {
    core: systems
      .filter((mailbox) => hasRole(mailbox, coreRoles))
      .toSorted((left, right) => compareSystemMailboxes(coreRoles, left, right)),
    management: systems
      .filter((mailbox) => hasRole(mailbox, managementRoles))
      .toSorted((left, right) => compareSystemMailboxes(managementRoles, left, right)),
    otherSystem: systems
      .filter(
        (mailbox) => !hasRole(mailbox, coreRoles) && !hasRole(mailbox, managementRoles),
      )
      .toSorted(compareMailboxes),
    folders: visible.filter((mailbox) => mailbox.kind === 'folder').toSorted(compareMailboxes),
    labels: visible.filter((mailbox) => mailbox.kind === 'label').toSorted(compareMailboxes),
  };
}
