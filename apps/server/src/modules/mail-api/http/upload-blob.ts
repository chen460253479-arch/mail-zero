import type { Context } from 'hono';

import { authorizeMailAccount } from './authorize-mail-account';
import type { HonoContext } from '../../../ctx';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const normalizedContentType = (value: string | undefined) => {
  const type = value?.split(';', 1)[0]?.trim().toLocaleLowerCase('und');
  return type !== undefined &&
    /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(type)
    ? type
    : 'application/octet-stream';
};

export async function uploadMailBlob(c: Context<HonoContext>) {
  const length = c.req.header('content-length');
  if (length === undefined || !/^[0-9]+$/u.test(length) || Number(length) > MAX_UPLOAD_BYTES) {
    return c.json({ code: 'PAYLOAD_TOO_LARGE' }, 413);
  }
  const accountId = c.req.param('accountId');
  const authorization = await authorizeMailAccount(c, accountId);
  if ('response' in authorization) return authorization.response;
  try {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      return c.json({ code: 'PAYLOAD_TOO_LARGE' }, 413);
    }
    const blob = await authorization.runtime.core.uploadBlob({
      accountId: accountId as never,
      bytes,
      contentType: normalizedContentType(c.req.header('content-type')),
    });
    return c.json({
      accountId,
      blobId: blob.blob.id,
      type: blob.blob.contentType,
      size: blob.blob.sizeBytes.toString(),
    });
  } finally {
    await authorization.runtime.close();
  }
}
