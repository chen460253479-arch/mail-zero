import type { Context } from 'hono';

import { authorizeMailAccount } from './authorize-mail-account';
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
    const bytes = await authorization.runtime.core.readBlob({
      accountId: accountId as never,
      blobId: c.req.param('blobId') as never,
    });
    return new Response(bytes as BodyInit, {
      headers: safeDownloadHeaders(
        'application/octet-stream',
        bytes.byteLength,
        c.req.param('filename'),
      ),
    });
  } catch {
    return c.json({ code: 'NOT_FOUND' }, 404);
  } finally {
    await authorization.runtime.close();
  }
}
