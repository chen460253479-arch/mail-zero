import type { Context } from 'hono';

import { authorizeMailAccount, mailHttpErrorResponse } from './authorize-mail-account';
import type { HonoContext } from '../../../ctx';

const safeFilename = (value: string) =>
  value
    .replace(/[\r\n"]/gu, '_')
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .slice(0, 180) || 'download';

export const safeDownloadHeaders = (contentType: string, size: number, filename: string) => ({
  'Content-Type': contentType,
  'Content-Length': size.toString(),
  'Content-Disposition': `attachment; filename="${safeFilename(filename)}"`,
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'private, no-store',
});

export async function downloadMailBlob(c: Context<HonoContext>) {
  const accountId = c.req.param('accountId');
  const authorization = await authorizeMailAccount(c, accountId);
  if ('response' in authorization) return authorization.response;
  try {
    const blobId = c.req.param('blobId') as never;
    const blob = await authorization.runtime.core.getBlob({
      accountId: accountId as never,
      blobId,
    });
    const bytes = await authorization.runtime.core.readBlob({
      accountId: accountId as never,
      blobId,
    });
    return new Response(bytes as BodyInit, {
      headers: safeDownloadHeaders(blob.contentType, bytes.byteLength, c.req.param('filename')),
    });
  } catch (error) {
    return mailHttpErrorResponse(c, error);
  } finally {
    await authorization.runtime.close();
  }
}
