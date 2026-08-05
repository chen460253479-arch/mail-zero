import { MailSyncError, parseIngressScope, type IngressScope } from '../../../modules/mail-sync';
import { parseZohoMailExternalData, type ZohoMailExternalData } from '../external-data';
import type { ZohoMailboxContext } from '../shared/zoho-client';

export type ZohoMailIngressScope = {
  scopeKey: string;
  scope: IngressScope;
};

export const createZohoMailIngressScopes = (
  externalData: ZohoMailExternalData,
): ZohoMailIngressScope[] =>
  (externalData.folderIds ?? []).map((folderId) => ({
    scopeKey: `folder:${folderId}`,
    scope: {
      version: 1,
      mailboxRoles: ['inbox'],
      initialSync: 'none',
      externalData: {
        accountId: externalData.accountId,
        folderIds: [folderId],
      },
    },
  }));

export const resolveZohoMailIngressScope = (
  value: unknown,
  mailbox: ZohoMailboxContext,
): { accountId: string; folderId: string } => {
  const scope = parseIngressScope(value);
  if (scope.externalData === undefined) {
    const folderId = mailbox.folderIds[0];
    if (folderId === undefined) throw new MailSyncError('ZOHO_MAILBOX_FOLDER_MISSING', 'permanent');
    return { accountId: mailbox.accountId, folderId };
  }

  let externalData: ZohoMailExternalData;
  try {
    externalData = parseZohoMailExternalData(scope.externalData);
  } catch {
    throw new MailSyncError('ZOHO_INVALID_INGRESS_SCOPE', 'permanent');
  }
  const [folderId] = externalData.folderIds ?? [];
  if (
    externalData.accountId !== mailbox.accountId ||
    externalData.folderIds?.length !== 1 ||
    folderId === undefined ||
    !mailbox.folderIds.includes(folderId)
  ) {
    throw new MailSyncError('ZOHO_MAILBOX_CONTEXT_CHANGED', 'permanent');
  }
  return { accountId: externalData.accountId, folderId };
};
