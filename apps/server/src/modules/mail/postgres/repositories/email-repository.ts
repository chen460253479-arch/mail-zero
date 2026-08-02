import type {
  EmailPartRecord,
  EmailId,
  EmailRecord,
  EmailRepository,
  Keyword,
  MailAddress,
  RemoteEmailRecord,
} from '@zero/mail-core';
import { and, asc, eq, exists, inArray, isNotNull, isNull, ne, not, or, sql } from 'drizzle-orm';
import { normalizeSearchText } from '@zero/mail-core';

import {
  email,
  emailAddress,
  emailContent,
  emailKeyword,
  emailMailbox,
  emailPart,
  emailSearch,
  emailTrashRestore,
  remoteEmail,
} from '../schema';
import { requireRow, runAdapter, type MailDatabase } from './database';

type EmailRow = typeof email.$inferSelect;
type AddressKind = (typeof emailAddress.$inferSelect)['kind'];

const addressFields = {
  sender: 'sender',
  from: 'from',
  replyTo: 'reply_to',
  to: 'to',
  cc: 'cc',
  bcc: 'bcc',
} as const satisfies Record<'bcc' | 'cc' | 'from' | 'replyTo' | 'sender' | 'to', AddressKind>;

const mapAddress = (row: typeof emailAddress.$inferSelect): MailAddress => ({
  ...(row.name === null ? {} : { name: row.name }),
  email: row.address,
});

const mapPart = (row: typeof emailPart.$inferSelect): EmailPartRecord => ({
  id: row.id,
  parentPartId: row.parentPartId,
  partPath: row.partPath,
  contentType: row.contentType,
  charset: row.charset,
  disposition: row.disposition,
  filename: row.filename,
  contentId: row.contentId,
  rawBlobId: row.rawBlobId as EmailPartRecord['rawBlobId'],
  offsetStart: row.offsetStart,
  encodedLength: row.encodedLength,
  decodedLength: row.decodedLength,
  transferEncoding: row.transferEncoding,
  sizeBytes: row.decodedLength,
  kind: row.kind,
});

const baseEmail = (
  row: EmailRow,
): Omit<
  EmailRecord,
  | 'bcc'
  | 'cc'
  | 'from'
  | 'htmlBody'
  | 'keywords'
  | 'mailboxIds'
  | 'parseWarnings'
  | 'parserVersion'
  | 'parts'
  | 'replyTo'
  | 'restoreMailboxIds'
  | 'sender'
  | 'textBody'
  | 'to'
> => ({
  id: row.id as EmailRecord['id'],
  accountId: row.mailAccountId as EmailRecord['accountId'],
  identityId: row.identityId as EmailRecord['identityId'],
  threadId: row.threadId as EmailRecord['threadId'],
  blobId: row.blobId as EmailRecord['blobId'],
  messageId: row.messageIdHeader,
  replyToEmailId: row.replyToEmailId as EmailRecord['replyToEmailId'],
  inReplyTo: row.inReplyTo ?? [],
  references: row.references ?? [],
  subject: row.subject ?? '',
  preview: row.preview ?? '',
  sentAt: row.sentAt,
  receivedAt: row.receivedAt,
  sizeBytes: row.sizeBytes,
  hasAttachment: row.hasAttachment,
  lifecycle: row.lifecycle,
  draftRevision: row.draftRevision,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  destroyedAt: row.destroyedAt,
});

const hydrateEmail = async (db: MailDatabase, row: EmailRow): Promise<EmailRecord> => {
  const scope = and(
    eq(emailAddress.mailAccountId, row.mailAccountId),
    eq(emailAddress.emailId, row.id),
  );
  const [addresses, contentRows, parts, mailboxRows, restoreRows, keywordRows] = await Promise.all([
    db.select().from(emailAddress).where(scope).orderBy(asc(emailAddress.position)),
    db
      .select()
      .from(emailContent)
      .where(
        and(eq(emailContent.mailAccountId, row.mailAccountId), eq(emailContent.emailId, row.id)),
      )
      .limit(1),
    db
      .select()
      .from(emailPart)
      .where(and(eq(emailPart.mailAccountId, row.mailAccountId), eq(emailPart.emailId, row.id)))
      .orderBy(asc(emailPart.position)),
    db
      .select()
      .from(emailMailbox)
      .where(
        and(eq(emailMailbox.mailAccountId, row.mailAccountId), eq(emailMailbox.emailId, row.id)),
      )
      .orderBy(asc(emailMailbox.position)),
    db
      .select()
      .from(emailTrashRestore)
      .where(
        and(
          eq(emailTrashRestore.mailAccountId, row.mailAccountId),
          eq(emailTrashRestore.emailId, row.id),
        ),
      )
      .orderBy(asc(emailTrashRestore.position)),
    db
      .select()
      .from(emailKeyword)
      .where(
        and(eq(emailKeyword.mailAccountId, row.mailAccountId), eq(emailKeyword.emailId, row.id)),
      )
      .orderBy(asc(emailKeyword.position)),
  ]);
  const content = requireRow(contentRows, 'STORAGE_FAILURE');
  const ofKind = (kind: AddressKind): MailAddress[] =>
    addresses.filter((address) => address.kind === kind).map(mapAddress);
  return {
    ...baseEmail(row),
    preview: content.preview ?? '',
    sender: ofKind('sender'),
    from: ofKind('from'),
    replyTo: ofKind('reply_to'),
    to: ofKind('to'),
    cc: ofKind('cc'),
    bcc: ofKind('bcc'),
    textBody: content.textBody,
    htmlBody: content.htmlBody,
    parserVersion: content.parserVersion,
    parseWarnings: content.parseWarnings ?? [],
    parts: parts.map(mapPart),
    mailboxIds: mailboxRows.map(({ mailboxId }) => mailboxId as EmailRecord['mailboxIds'][number]),
    restoreMailboxIds: restoreRows.map(
      ({ mailboxId }) => mailboxId as EmailRecord['restoreMailboxIds'][number],
    ),
    keywords: keywordRows.map(({ keyword }) => keyword as Keyword),
  };
};

const hydrateEmails = async (db: MailDatabase, rows: EmailRow[]): Promise<EmailRecord[]> => {
  if (rows.length === 0) return [];
  const accountId = rows[0]!.mailAccountId;
  const ids = rows.map(({ id }) => id);
  const [addresses, contents, parts, mailboxRows, restoreRows, keywordRows] = await Promise.all([
    db
      .select()
      .from(emailAddress)
      .where(and(eq(emailAddress.mailAccountId, accountId), inArray(emailAddress.emailId, ids)))
      .orderBy(asc(emailAddress.position)),
    db
      .select()
      .from(emailContent)
      .where(and(eq(emailContent.mailAccountId, accountId), inArray(emailContent.emailId, ids))),
    db
      .select()
      .from(emailPart)
      .where(and(eq(emailPart.mailAccountId, accountId), inArray(emailPart.emailId, ids)))
      .orderBy(asc(emailPart.position)),
    db
      .select()
      .from(emailMailbox)
      .where(and(eq(emailMailbox.mailAccountId, accountId), inArray(emailMailbox.emailId, ids)))
      .orderBy(asc(emailMailbox.position)),
    db
      .select()
      .from(emailTrashRestore)
      .where(
        and(
          eq(emailTrashRestore.mailAccountId, accountId),
          inArray(emailTrashRestore.emailId, ids),
        ),
      )
      .orderBy(asc(emailTrashRestore.position)),
    db
      .select()
      .from(emailKeyword)
      .where(and(eq(emailKeyword.mailAccountId, accountId), inArray(emailKeyword.emailId, ids)))
      .orderBy(asc(emailKeyword.position)),
  ]);
  return rows.map((row) => {
    const content = requireRow(
      contents.filter(({ emailId }) => emailId === row.id),
      'STORAGE_FAILURE',
    );
    const ownAddresses = addresses.filter(({ emailId }) => emailId === row.id);
    const ofKind = (kind: AddressKind): MailAddress[] =>
      ownAddresses.filter((address) => address.kind === kind).map(mapAddress);
    return {
      ...baseEmail(row),
      preview: content.preview ?? '',
      sender: ofKind('sender'),
      from: ofKind('from'),
      replyTo: ofKind('reply_to'),
      to: ofKind('to'),
      cc: ofKind('cc'),
      bcc: ofKind('bcc'),
      textBody: content.textBody,
      htmlBody: content.htmlBody,
      parserVersion: content.parserVersion,
      parseWarnings: content.parseWarnings ?? [],
      parts: parts.filter(({ emailId }) => emailId === row.id).map(mapPart),
      mailboxIds: mailboxRows
        .filter(({ emailId }) => emailId === row.id)
        .map(({ mailboxId }) => mailboxId as EmailRecord['mailboxIds'][number]),
      restoreMailboxIds: restoreRows
        .filter(({ emailId }) => emailId === row.id)
        .map(({ mailboxId }) => mailboxId as EmailRecord['restoreMailboxIds'][number]),
      keywords: keywordRows
        .filter(({ emailId }) => emailId === row.id)
        .map(({ keyword }) => keyword as Keyword),
    };
  });
};

const insertAddresses = async (
  db: MailDatabase,
  record: Pick<EmailRecord, 'accountId' | 'id'>,
  kind: AddressKind,
  addresses: MailAddress[],
): Promise<void> => {
  if (addresses.length === 0) return;
  await db.insert(emailAddress).values(
    addresses.map(({ email: address, name }, position) => ({
      mailAccountId: record.accountId,
      emailId: record.id,
      kind,
      position,
      name: name ?? null,
      address,
      normalizedEmail: normalizeSearchText(address),
    })),
  );
};

const insertParts = async (
  db: MailDatabase,
  record: Pick<EmailRecord, 'accountId' | 'id'>,
  parts: EmailPartRecord[],
): Promise<void> => {
  for (const [position, part] of parts.entries()) {
    await db.insert(emailPart).values({
      id: part.id,
      parentPartId: part.parentPartId,
      partPath: part.partPath,
      contentType: part.contentType,
      charset: part.charset,
      disposition: part.disposition,
      filename: part.filename,
      contentId: part.contentId,
      rawBlobId: part.rawBlobId,
      offsetStart: part.offsetStart,
      encodedLength: part.encodedLength,
      decodedLength: part.decodedLength,
      transferEncoding: part.transferEncoding,
      kind: part.kind,
      mailAccountId: record.accountId,
      emailId: record.id,
      position,
    });
  }
};

const replaceOrdered = async (
  db: MailDatabase,
  table: typeof emailMailbox | typeof emailTrashRestore,
  accountId: EmailRecord['accountId'],
  emailId: EmailRecord['id'],
  mailboxIds: EmailRecord['mailboxIds'],
): Promise<void> => {
  await db.delete(table).where(and(eq(table.mailAccountId, accountId), eq(table.emailId, emailId)));
  if (mailboxIds.length > 0) {
    await db.insert(table).values(
      mailboxIds.map((mailboxId, position) => ({
        mailAccountId: accountId,
        emailId,
        mailboxId,
        position,
      })),
    );
  }
};

const insertRelations = async (db: MailDatabase, record: EmailRecord): Promise<void> => {
  for (const [field, kind] of Object.entries(addressFields) as [
    keyof typeof addressFields,
    AddressKind,
  ][]) {
    await insertAddresses(db, record, kind, record[field]);
  }
  await db.insert(emailContent).values({
    mailAccountId: record.accountId,
    emailId: record.id,
    parserVersion: record.parserVersion,
    textBody: record.textBody,
    htmlBody: record.htmlBody,
    preview: record.preview,
    parseWarnings: record.parseWarnings,
  });
  await insertParts(db, record, record.parts);
  await replaceOrdered(db, emailMailbox, record.accountId, record.id, record.mailboxIds);
  await replaceOrdered(
    db,
    emailTrashRestore,
    record.accountId,
    record.id,
    record.restoreMailboxIds,
  );
  if (record.keywords.length > 0) {
    await db.insert(emailKeyword).values(
      record.keywords.map((keyword, position) => ({
        mailAccountId: record.accountId,
        emailId: record.id,
        keyword,
        position,
      })),
    );
  }
};

const baseInsert = (record: EmailRecord): typeof email.$inferInsert => ({
  id: record.id,
  mailAccountId: record.accountId,
  identityId: record.identityId,
  threadId: record.threadId,
  blobId: record.blobId,
  messageIdHeader: record.messageId,
  replyToEmailId: record.replyToEmailId,
  inReplyTo: record.inReplyTo,
  references: record.references,
  subject: record.subject,
  normalizedSubject: normalizeSearchText(record.subject),
  preview: record.preview,
  sentAt: record.sentAt,
  receivedAt: record.receivedAt,
  sizeBytes: record.sizeBytes,
  hasAttachment: record.hasAttachment,
  lifecycle: record.lifecycle,
  draftRevision: record.draftRevision,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  destroyedAt: record.destroyedAt,
});

const mapRemote = (row: typeof remoteEmail.$inferSelect): RemoteEmailRecord => ({
  accountId: row.mailAccountId as RemoteEmailRecord['accountId'],
  provider: row.provider,
  remoteEmailId: row.remoteEmailId,
  remoteThreadId: row.remoteThreadId,
  emailId: row.emailId as RemoteEmailRecord['emailId'],
  contentFingerprint: row.contentFingerprint ?? '',
  firstSeenAt: row.firstSeenAt,
  lastSeenAt: row.lastSeenAt,
});

export const createEmailRepository = (db: MailDatabase): EmailRepository => {
  const repository: EmailRepository = {
    findById: (accountId, id) =>
      runAdapter(async () => {
        const rows = await db
          .select()
          .from(email)
          .where(and(eq(email.mailAccountId, accountId), eq(email.id, id)))
          .limit(1);
        return rows[0] === undefined ? null : hydrateEmail(db, rows[0]);
      }),
    findByIds: (accountId, ids) =>
      runAdapter(async () => {
        if (ids.length === 0) return [];
        const rows = await db
          .select()
          .from(email)
          .where(and(eq(email.mailAccountId, accountId), inArray(email.id, ids)));
        const hydrated = await hydrateEmails(db, rows);
        const byId = new Map(hydrated.map((record) => [record.id, record]));
        return ids.flatMap((id) => {
          const record = byId.get(id);
          return record === undefined ? [] : [record];
        });
      }),
    findPartById: (accountId, partId) =>
      runAdapter(async () => {
        const rows = await db
          .select()
          .from(emailPart)
          .where(and(eq(emailPart.mailAccountId, accountId), eq(emailPart.id, partId)))
          .limit(1);
        const row = rows[0];
        return row === undefined
          ? null
          : {
              emailId: row.emailId as EmailId,
              part: mapPart(row),
            };
      }),
    existsOutsideAccount: (accountId, id) =>
      runAdapter(async () => {
        const rows = await db
          .select({ id: email.id })
          .from(email)
          .where(and(eq(email.id, id), ne(email.mailAccountId, accountId)))
          .limit(1);
        return rows.length > 0;
      }),
    findByRemoteId: (input) =>
      runAdapter(async () => {
        const rows = await db
          .select()
          .from(remoteEmail)
          .where(
            and(
              eq(remoteEmail.mailAccountId, input.accountId),
              eq(remoteEmail.provider, input.provider),
              eq(remoteEmail.remoteEmailId, input.remoteEmailId),
            ),
          )
          .limit(1);
        return rows[0] === undefined ? null : mapRemote(rows[0]);
      }),
    listByAccount: (accountId) =>
      runAdapter(async () => {
        const rows = await db
          .select()
          .from(email)
          .where(eq(email.mailAccountId, accountId))
          .orderBy(asc(email.receivedAt), asc(email.id));
        return Promise.all(rows.map((row) => hydrateEmail(db, row)));
      }),
    listByThread: (accountId, threadId) =>
      runAdapter(async () => {
        const rows = await db
          .select()
          .from(email)
          .where(and(eq(email.mailAccountId, accountId), eq(email.threadId, threadId)))
          .orderBy(asc(email.receivedAt), asc(email.id));
        return Promise.all(rows.map((row) => hydrateEmail(db, row)));
      }),
    listByMailbox: (accountId, mailboxId) =>
      runAdapter(async () => {
        const rows = await db
          .select({ id: email.id })
          .from(email)
          .innerJoin(
            emailMailbox,
            and(
              eq(emailMailbox.mailAccountId, email.mailAccountId),
              eq(emailMailbox.emailId, email.id),
            ),
          )
          .where(
            and(
              eq(email.mailAccountId, accountId),
              eq(emailMailbox.mailboxId, mailboxId),
              isNull(email.destroyedAt),
            ),
          )
          .orderBy(asc(email.receivedAt), asc(email.id));
        return repository.findByIds(
          accountId,
          rows.map(({ id }) => id as EmailId),
        );
      }),
    moveThread: (accountId, fromThreadId, toThreadId, updatedAt) =>
      runAdapter(async () => {
        const hasMailbox = exists(
          db
            .select({ emailId: emailMailbox.emailId })
            .from(emailMailbox)
            .where(
              and(
                eq(emailMailbox.mailAccountId, email.mailAccountId),
                eq(emailMailbox.emailId, email.id),
              ),
            ),
        );
        return (
          await db
            .update(email)
            .set({ threadId: toThreadId, updatedAt })
            .where(
              and(
                eq(email.mailAccountId, accountId),
                eq(email.threadId, fromThreadId),
                isNull(email.destroyedAt),
                hasMailbox,
              ),
            )
            .returning({ id: email.id })
        )
          .map(({ id }) => id as EmailId)
          .sort();
      }),
    hasRetainedEmailInThread: (accountId, threadId) =>
      runAdapter(async () => {
        const hasMailbox = exists(
          db
            .select({ emailId: emailMailbox.emailId })
            .from(emailMailbox)
            .where(
              and(
                eq(emailMailbox.mailAccountId, email.mailAccountId),
                eq(emailMailbox.emailId, email.id),
              ),
            ),
        );
        const rows = await db
          .select({ id: email.id })
          .from(email)
          .where(
            and(
              eq(email.mailAccountId, accountId),
              eq(email.threadId, threadId),
              or(isNotNull(email.destroyedAt), not(hasMailbox)),
            ),
          )
          .limit(1);
        return rows.length > 0;
      }),
    insert: (record) =>
      runAdapter(async () => {
        const rows = await db.insert(email).values(baseInsert(record)).returning();
        await insertRelations(db, record);
        return hydrateEmail(db, requireRow(rows, 'STORAGE_FAILURE'));
      }),
    update: (accountId, id, patch) =>
      runAdapter(async () => {
        const basePatch: Partial<typeof email.$inferInsert> = {};
        const set = <Key extends keyof typeof basePatch>(
          key: Key,
          value: (typeof basePatch)[Key],
        ) => {
          basePatch[key] = value;
        };
        if ('identityId' in patch) set('identityId', patch.identityId);
        if ('threadId' in patch) set('threadId', patch.threadId);
        if ('blobId' in patch) set('blobId', patch.blobId);
        if ('messageId' in patch) set('messageIdHeader', patch.messageId);
        if ('replyToEmailId' in patch) set('replyToEmailId', patch.replyToEmailId);
        if ('inReplyTo' in patch) set('inReplyTo', patch.inReplyTo);
        if ('references' in patch) set('references', patch.references);
        if ('subject' in patch) {
          set('subject', patch.subject);
          set('normalizedSubject', normalizeSearchText(patch.subject ?? ''));
        }
        if ('preview' in patch) set('preview', patch.preview);
        if ('sentAt' in patch) set('sentAt', patch.sentAt);
        if ('receivedAt' in patch) set('receivedAt', patch.receivedAt);
        if ('sizeBytes' in patch) set('sizeBytes', patch.sizeBytes);
        if ('hasAttachment' in patch) set('hasAttachment', patch.hasAttachment);
        if ('lifecycle' in patch) set('lifecycle', patch.lifecycle);
        if ('draftRevision' in patch) set('draftRevision', patch.draftRevision);
        if ('createdAt' in patch) set('createdAt', patch.createdAt);
        if ('updatedAt' in patch) set('updatedAt', patch.updatedAt);
        if ('destroyedAt' in patch) set('destroyedAt', patch.destroyedAt);
        if (Object.keys(basePatch).length > 0) {
          await db
            .update(email)
            .set(basePatch)
            .where(and(eq(email.mailAccountId, accountId), eq(email.id, id)));
        }
        for (const [field, kind] of Object.entries(addressFields) as [
          keyof typeof addressFields,
          AddressKind,
        ][]) {
          if (field in patch) {
            await db
              .delete(emailAddress)
              .where(
                and(
                  eq(emailAddress.mailAccountId, accountId),
                  eq(emailAddress.emailId, id),
                  eq(emailAddress.kind, kind),
                ),
              );
            await insertAddresses(db, { accountId, id }, kind, patch[field] ?? []);
          }
        }
        if (
          ['preview', 'textBody', 'htmlBody', 'parserVersion', 'parseWarnings'].some(
            (key) => key in patch,
          )
        ) {
          await db
            .update(emailContent)
            .set({
              ...('preview' in patch ? { preview: patch.preview } : {}),
              ...('textBody' in patch ? { textBody: patch.textBody } : {}),
              ...('htmlBody' in patch ? { htmlBody: patch.htmlBody } : {}),
              ...('parserVersion' in patch ? { parserVersion: patch.parserVersion } : {}),
              ...('parseWarnings' in patch ? { parseWarnings: patch.parseWarnings } : {}),
            })
            .where(and(eq(emailContent.mailAccountId, accountId), eq(emailContent.emailId, id)));
        }
        if ('parts' in patch) {
          await db
            .delete(emailPart)
            .where(and(eq(emailPart.mailAccountId, accountId), eq(emailPart.emailId, id)));
          await insertParts(db, { accountId, id }, patch.parts ?? []);
        }
        if ('mailboxIds' in patch) {
          await replaceOrdered(db, emailMailbox, accountId, id, patch.mailboxIds ?? []);
        }
        if ('restoreMailboxIds' in patch) {
          await replaceOrdered(db, emailTrashRestore, accountId, id, patch.restoreMailboxIds ?? []);
        }
        if ('keywords' in patch) {
          await repository.replaceKeywords(accountId, id, patch.keywords ?? []);
        }
        const updated = await repository.findById(accountId, id);
        return updated ?? requireRow([], 'EMAIL_NOT_FOUND', id);
      }),
    linkRemote: (record) =>
      runAdapter(async () => {
        const rows = await db
          .insert(remoteEmail)
          .values({
            mailAccountId: record.accountId,
            provider: record.provider,
            remoteEmailId: record.remoteEmailId,
            remoteThreadId: record.remoteThreadId,
            emailId: record.emailId,
            contentFingerprint: record.contentFingerprint,
            firstSeenAt: record.firstSeenAt,
            lastSeenAt: record.lastSeenAt,
          })
          .returning();
        return mapRemote(requireRow(rows, 'STORAGE_FAILURE'));
      }),
    replaceMailboxes: (accountId, emailId, mailboxIds) =>
      runAdapter(() => replaceOrdered(db, emailMailbox, accountId, emailId, mailboxIds)),
    replaceKeywords: (accountId, emailId, keywords) =>
      runAdapter(async () => {
        await db
          .delete(emailKeyword)
          .where(and(eq(emailKeyword.mailAccountId, accountId), eq(emailKeyword.emailId, emailId)));
        if (keywords.length > 0) {
          await db.insert(emailKeyword).values(
            keywords.map((keyword, position) => ({
              mailAccountId: accountId,
              emailId,
              keyword,
              position,
            })),
          );
        }
      }),
    replaceRestoreMailboxes: (accountId, emailId, mailboxIds) =>
      runAdapter(() => replaceOrdered(db, emailTrashRestore, accountId, emailId, mailboxIds)),
    publishSearchDocument: (accountId, emailId, document) =>
      runAdapter(async () => {
        const vector = sql`to_tsvector(
          'simple',
          concat_ws(
            ' ',
            ${document.subject}::text,
            ${document.addressText}::text,
            ${document.bodyText}::text
          )
        )`;
        await db
          .insert(emailSearch)
          .values({
            mailAccountId: accountId,
            emailId,
            document: vector,
          })
          .onConflictDoUpdate({
            target: [emailSearch.mailAccountId, emailSearch.emailId],
            set: { document: vector },
          });
      }),
    deleteSearchDocument: (accountId, emailId) =>
      runAdapter(async () => {
        await db
          .delete(emailSearch)
          .where(and(eq(emailSearch.mailAccountId, accountId), eq(emailSearch.emailId, emailId)));
      }),
    delete: (accountId, id) =>
      runAdapter(async () => {
        await db.delete(email).where(and(eq(email.mailAccountId, accountId), eq(email.id, id)));
      }),
  };
  return repository;
};
