import type { Context, Hono } from 'hono';

import type { ExternalMessageReader } from '../application/read-message';
import { safeDownloadHeaders } from '../../mail-api';
import { ExternalIntegrationError } from '../errors';

type ExternalMailRouteDependencies = {
  authorize(context: Context): Promise<null | Response>;
  createReader(): ExternalMessageReader;
};

const readJson = async (
  context: Context,
  dependencies: ExternalMailRouteDependencies,
  read: (reader: ExternalMessageReader) => Promise<unknown>,
): Promise<Response> => {
  const authorization = await dependencies.authorize(context);
  if (authorization instanceof Response) return authorization;
  try {
    return Response.json(await read(dependencies.createReader()), {
      status: 200,
    });
  } catch (error) {
    if (error instanceof ExternalIntegrationError) {
      return Response.json({ error: error.code }, { status: 404 });
    }
    throw error;
  }
};

export const registerExternalMailRoutes = (
  app: Hono,
  dependencies: ExternalMailRouteDependencies,
): void => {
  app.get('/mail/messages/:messageId/summary', (context) =>
    readJson(context, dependencies, (reader) => reader.getSummary(context.req.param('messageId'))),
  );
  app.get('/mail/messages/:messageId/content', (context) =>
    readJson(context, dependencies, (reader) => reader.getContent(context.req.param('messageId'))),
  );
  app.get('/mail/messages/:messageId/attachments', (context) =>
    readJson(context, dependencies, (reader) =>
      reader.listAttachments(context.req.param('messageId')),
    ),
  );
  app.get('/mail/attachments/:attachmentId/content', async (context) => {
    const authorization = await dependencies.authorize(context);
    if (authorization instanceof Response) return authorization;
    try {
      const result = await dependencies
        .createReader()
        .getAttachmentContent(context.req.param('attachmentId'));
      return new Response(result.bytes as BodyInit, {
        headers: safeDownloadHeaders(
          result.contentType,
          result.bytes.byteLength,
          result.filename ?? context.req.param('attachmentId'),
        ),
      });
    } catch (error) {
      if (error instanceof ExternalIntegrationError) {
        return Response.json({ error: error.code }, { status: 404 });
      }
      throw error;
    }
  });
};
