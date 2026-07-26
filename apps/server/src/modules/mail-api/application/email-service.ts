import {
  MailCoreError,
  type BlobId,
  type DraftContent,
  type EmailId,
  type EmailRecord,
  type EmailSetPatch,
  type Keyword,
  type MailAccountId,
  type MailAddress,
  type MailboxId,
  type MailCore,
} from '@zero/mail-core';
import type { z } from 'zod';

import {
  emailChangesInputSchema,
  emailGetInputSchema,
  emailQueryInputSchema,
  emailSetInputSchema,
} from '../contracts/email';
import { mapSetError, mapSetErrors } from './dto';
import { readBodyText } from './body-values';
import { toEmailDto } from './email-dto';

type EmailGetInput = z.infer<typeof emailGetInputSchema>;
type EmailQueryInput = z.infer<typeof emailQueryInputSchema>;
type EmailSetInput = z.infer<typeof emailSetInputSchema>;

const missingEmail = (error: unknown) =>
  error instanceof MailCoreError &&
  ['EMAIL_NOT_FOUND', 'CROSS_ACCOUNT_REFERENCE'].includes(error.code);

const applyMapPatch = <Value extends string>(
  current: readonly Value[],
  patch: Record<string, true | null> | undefined,
): Value[] | undefined => {
  if (patch === undefined) return undefined;
  const next = new Set<string>(current);
  for (const [id, value] of Object.entries(patch)) {
    if (value === true) next.add(id);
    else next.delete(id);
  }
  return [...next] as Value[];
};

const draftFields = [
  'identityId',
  'replyToEmailId',
  'to',
  'cc',
  'bcc',
  'subject',
  'textBody',
  'htmlBody',
  'attachmentBlobIds',
] as const;

const toMailAddresses = (
  addresses: Array<{ email: string; name?: string | null }>,
): MailAddress[] =>
  addresses.map(({ email, name }) => ({
    email,
    ...(name == null ? {} : { name }),
  }));

const hasDraftPatch = (patch: EmailSetInput['update'][string]) =>
  draftFields.some((field) => patch[field] !== undefined);

async function mergeDraftContent(
  core: Pick<MailCore, 'readBlob'>,
  accountId: MailAccountId,
  current: EmailRecord,
  patch: EmailSetInput['update'][string],
): Promise<DraftContent> {
  if (current.lifecycle !== 'draft' || current.identityId === null) {
    throw new MailCoreError('EMAIL_CONTENT_IMMUTABLE', { entityId: current.id });
  }
  return {
    identityId: (patch.identityId ?? current.identityId) as DraftContent['identityId'],
    replyToEmailId: (patch.replyToEmailId === undefined
      ? current.replyToEmailId
      : patch.replyToEmailId) as DraftContent['replyToEmailId'],
    to: patch.to === undefined ? current.to : toMailAddresses(patch.to),
    cc: patch.cc === undefined ? current.cc : toMailAddresses(patch.cc),
    bcc: patch.bcc === undefined ? current.bcc : toMailAddresses(patch.bcc),
    subject: patch.subject ?? current.subject,
    textBody:
      patch.textBody ?? (await readBodyText(core, accountId, current.textBlobId as BlobId | null)),
    htmlBody:
      patch.htmlBody ?? (await readBodyText(core, accountId, current.htmlBlobId as BlobId | null)),
    attachmentBlobIds: (patch.attachmentBlobIds ??
      current.parts.flatMap((part) =>
        part.kind === 'attachment' && part.blobId !== null ? [part.blobId] : [],
      )) as BlobId[],
  };
}

export const createEmailService = (
  core: Pick<
    MailCore,
    'getChanges' | 'getEmail' | 'getState' | 'queryEmails' | 'readBlob' | 'setEmails'
  >,
) => ({
  async get(input: EmailGetInput) {
    const accountId = input.accountId as MailAccountId;
    const state = await core.getState({ accountId, collection: 'email' });
    const settled = await Promise.allSettled(
      input.ids.map(async (id) => {
        const email = await core.getEmail({ accountId, emailId: id as EmailId });
        return toEmailDto(core, accountId, email, input);
      }),
    );
    for (const result of settled) {
      if (result.status === 'rejected' && !missingEmail(result.reason)) throw result.reason;
    }
    return {
      accountId: input.accountId,
      state,
      list: settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
      notFound: input.ids.filter((_, index) => settled[index]?.status === 'rejected'),
    };
  },

  async query(input: EmailQueryInput) {
    const accountId = input.accountId as MailAccountId;
    const result = await core.queryEmails({
      accountId,
      filter: {
        mailboxId: input.filter.inMailbox as MailboxId | undefined,
        hasKeyword: input.filter.hasKeyword as Keyword | undefined,
        notKeyword: input.filter.notKeyword as Keyword | undefined,
        lifecycle: input.filter.lifecycle,
        after: input.filter.after === undefined ? undefined : new Date(input.filter.after),
        before: input.filter.before === undefined ? undefined : new Date(input.filter.before),
        address: input.filter.address,
        from: input.filter.from,
        to: input.filter.to,
        hasAttachment: input.filter.hasAttachment,
        text: input.filter.text,
      },
      sort:
        input.sort[0] === undefined
          ? undefined
          : {
              property: input.sort[0].property,
              direction: input.sort[0].isAscending ? 'asc' : 'desc',
            },
      cursor: input.cursor ?? null,
      limit: input.limit,
    });
    const queryState = await core.getState({ accountId, collection: 'email' });
    return {
      accountId: input.accountId,
      queryState,
      ids: result.emailIds,
      cursor: result.nextCursor,
      total: input.calculateTotal && result.nextCursor === null ? result.emailIds.length : null,
    };
  },

  async set(input: EmailSetInput) {
    const accountId = input.accountId as MailAccountId;
    const update: Record<EmailId, EmailSetPatch> = {};
    const preparationNotUpdated: Record<string, ReturnType<typeof mapSetError>> = {};
    for (const [rawId, patch] of Object.entries(input.update)) {
      const emailId = rawId as EmailId;
      try {
        const current = await core.getEmail({ accountId, emailId });
        const contentPatch = hasDraftPatch(patch);
        update[emailId] = {
          mailboxIds: applyMapPatch(current.mailboxIds, patch.mailboxIds) as
            | MailboxId[]
            | undefined,
          keywords: applyMapPatch(current.keywords, patch.keywords) as Keyword[] | undefined,
          ifDraftRevision: contentPatch
            ? (patch.ifDraftRevision ?? current.draftRevision)
            : patch.ifDraftRevision,
          content: contentPatch
            ? await mergeDraftContent(core, accountId, current, patch)
            : undefined,
        };
      } catch (error) {
        if (!(error instanceof MailCoreError)) throw error;
        if (
          ![
            'EMAIL_NOT_FOUND',
            'CROSS_ACCOUNT_REFERENCE',
            'EMAIL_CONTENT_IMMUTABLE',
            'BLOB_NOT_FOUND',
          ].includes(error.code)
        ) {
          throw error;
        }
        preparationNotUpdated[rawId] = mapSetError(error);
      }
    }
    const result = await core.setEmails({
      accountId,
      ifInState: input.ifInState,
      create: Object.fromEntries(
        Object.entries(input.create).map(([id, content]) => [
          id,
          {
            ...content,
            identityId: content.identityId as DraftContent['identityId'],
            replyToEmailId: content.replyToEmailId as DraftContent['replyToEmailId'],
            attachmentBlobIds: content.attachmentBlobIds as BlobId[],
            to: toMailAddresses(content.to),
            cc: toMailAddresses(content.cc),
            bcc: toMailAddresses(content.bcc),
          },
        ]),
      ),
      update,
      destroy: input.destroy as EmailId[],
    });
    return {
      accountId: input.accountId,
      ...result,
      created: Object.fromEntries(
        await Promise.all(
          Object.entries(result.created).map(async ([id, email]) => [
            id,
            await toEmailDto(core, accountId, email),
          ]),
        ),
      ),
      updated: Object.fromEntries(
        await Promise.all(
          Object.entries(result.updated).map(async ([id, email]) => [
            id,
            await toEmailDto(core, accountId, email),
          ]),
        ),
      ),
      notCreated: mapSetErrors(result.notCreated),
      notUpdated: { ...preparationNotUpdated, ...mapSetErrors(result.notUpdated) },
      notDestroyed: mapSetErrors(result.notDestroyed),
    };
  },

  changes(input: z.infer<typeof emailChangesInputSchema>) {
    return core.getChanges({
      ...input,
      accountId: input.accountId as MailAccountId,
      collection: 'email',
    });
  },
});
