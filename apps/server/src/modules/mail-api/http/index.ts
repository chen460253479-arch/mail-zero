import type { Hono } from 'hono';

import { downloadRawEmail } from './download-raw-email';
import { downloadMailBlob } from './download-blob';
import type { HonoContext } from '../../../ctx';
import { uploadMailBlob } from './upload-blob';

export function registerMailBlobRoutes(app: Hono<HonoContext>): void {
  app.post('/mail/accounts/:accountId/blobs', uploadMailBlob);
  app.get('/mail/accounts/:accountId/blobs/:blobId/:filename', downloadMailBlob);
  app.get('/mail/accounts/:accountId/emails/:emailId/raw', downloadRawEmail);
}
