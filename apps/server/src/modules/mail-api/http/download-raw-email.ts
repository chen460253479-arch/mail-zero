import type { Context } from 'hono';

import { authorizeMailAccount, mailHttpErrorResponse } from './authorize-mail-account';
import { safeDownloadHeaders } from './download-blob';
import type { HonoContext } from '../../../ctx';

export async function downloadRawEmail(c: Context<HonoContext>) {
  const accountId = c.req.param('accountId');
  const authorization = await authorizeMailAccount(c, accountId);
  if ('response' in authorization) return authorization.response;
  try {
    const email = await authorization.runtime.core.getEmail({
      accountId: accountId as never,
      emailId: c.req.param('emailId') as never,
    });
    if (email.blobId === null) return c.json({ code: 'NOT_FOUND' }, 404);
    const bytes = await authorization.runtime.core.readBlob({
      accountId: accountId as never,
      blobId: email.blobId,
    });
    return new Response(bytes as BodyInit, {
      headers: safeDownloadHeaders('message/rfc822', bytes.byteLength, `${email.id}.eml`),
    });
  } catch (error) {
    return mailHttpErrorResponse(c, error);
  } finally {
    await authorization.runtime.close();
  }
}
