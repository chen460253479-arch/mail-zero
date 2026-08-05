import { and, asc, eq, isNull } from 'drizzle-orm';

import { crmCustomerMarker } from '../../../external-integration/postgres/schema';
import { email, emailMailbox, thread } from '../../../mail/postgres/schema';
import type { DB } from '../../../../db';
import { exists } from 'drizzle-orm';

export async function queryThreadDetail(db: DB, input: { accountId: string; threadId: string }) {
  const owner = await db
    .select({ id: thread.id })
    .from(thread)
    .where(and(eq(thread.mailAccountId, input.accountId), eq(thread.id, input.threadId)))
    .limit(1);
  if (owner.length === 0) return null;
  const rows = await db
    .select({
      id: email.id,
      customerId: crmCustomerMarker.customerId,
      customerName: crmCustomerMarker.customerName,
    })
    .from(email)
    .leftJoin(
      crmCustomerMarker,
      and(
        eq(crmCustomerMarker.mailAccountId, email.mailAccountId),
        eq(crmCustomerMarker.emailId, email.id),
      ),
    )
    .where(
      and(
        eq(email.mailAccountId, input.accountId),
        eq(email.threadId, input.threadId),
        isNull(email.destroyedAt),
        exists(
          db
            .select({ id: emailMailbox.emailId })
            .from(emailMailbox)
            .where(
              and(
                eq(emailMailbox.mailAccountId, input.accountId),
                eq(emailMailbox.emailId, email.id),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(email.receivedAt), asc(email.id));
  return {
    threadId: input.threadId,
    emailIds: rows.map(({ id }) => id),
    customerMarkers: Object.fromEntries(
      rows.flatMap(({ id, customerId, customerName }) =>
        customerId === null || customerName === null ? [] : [[id, { customerId, customerName }]],
      ),
    ),
  };
}
