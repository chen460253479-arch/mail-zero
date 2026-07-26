import type { MailAccountId, MailboxId, MailboxRecord, MailCore } from '@zero/mail-core';
import type { z } from 'zod';

import {
  mailboxChangesInputSchema,
  mailboxSchema,
  mailboxSetInputSchema,
} from '../contracts/mailbox';
import { mapSetErrors } from './dto';

export const toMailboxDto = (mailbox: MailboxRecord) => mailboxSchema.parse(mailbox);

export const createMailboxService = (
  core: Pick<MailCore, 'getChanges' | 'getState' | 'listMailboxes' | 'setMailboxes'>,
) => ({
  async get(input: { accountId: string; ids?: string[] }) {
    const accountId = input.accountId as MailAccountId;
    const state = await core.getState({ accountId, collection: 'mailbox' });
    const mailboxes = await core.listMailboxes({ accountId });
    const byId = new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox]));
    const ids = input.ids ?? mailboxes.map(({ id }) => id);
    return {
      accountId: input.accountId,
      state,
      list: ids.flatMap((id) => {
        const mailbox = byId.get(id as MailboxRecord['id']);
        return mailbox === undefined ? [] : [toMailboxDto(mailbox)];
      }),
      notFound: ids.filter((id) => !byId.has(id as MailboxRecord['id'])),
    };
  },
  async set(input: z.infer<typeof mailboxSetInputSchema>) {
    const accountId = input.accountId as MailAccountId;
    const result = await core.setMailboxes({
      ...input,
      accountId,
      create: Object.fromEntries(
        Object.entries(input.create).map(([id, mailbox]) => [
          id,
          {
            ...mailbox,
            parentId: mailbox.parentId as MailboxId | null,
          },
        ]),
      ),
      update: Object.fromEntries(
        Object.entries(input.update).map(([id, mailbox]) => [
          id as MailboxId,
          {
            ...mailbox,
            parentId:
              mailbox.parentId === undefined ? undefined : (mailbox.parentId as MailboxId | null),
          },
        ]),
      ),
      destroy: input.destroy as MailboxId[],
    });
    return {
      accountId,
      ...result,
      created: Object.fromEntries(
        Object.entries(result.created).map(([id, mailbox]) => [id, toMailboxDto(mailbox)]),
      ),
      updated: Object.fromEntries(
        Object.entries(result.updated).map(([id, mailbox]) => [id, toMailboxDto(mailbox)]),
      ),
      notCreated: mapSetErrors(result.notCreated),
      notUpdated: mapSetErrors(result.notUpdated),
      notDestroyed: mapSetErrors(result.notDestroyed),
    };
  },
  changes(input: z.infer<typeof mailboxChangesInputSchema>) {
    return core.getChanges({
      ...input,
      accountId: input.accountId as MailAccountId,
      collection: 'mailbox',
    });
  },
});
