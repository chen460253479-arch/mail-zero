import type { Context, Hono } from 'hono';

import {
  externalMailIdempotencyKeySchema,
  externalMailSubmissionInputSchema,
  type ExternalMailSubmissionInput,
  type ExternalMailSubmissionResponse,
} from '../contracts/mail-submission';
import { ExternalIntegrationError } from '../errors';

export type ExternalMailSubmissionService = {
  submit(
    input: ExternalMailSubmissionInput & { idempotencyKey: string },
  ): Promise<{ response: ExternalMailSubmissionResponse; created: boolean }>;
  get(id: string): Promise<ExternalMailSubmissionResponse>;
};

type ExternalMailSubmissionRouteDependencies = {
  authorize(context: Context): Promise<null | Response>;
  createService(): ExternalMailSubmissionService;
};

const errorResponse = (error: ExternalIntegrationError): Response => {
  if (error.code === 'IDEMPOTENCY_CONFLICT' || error.code === 'NANGO_CONNECTION_AMBIGUOUS') {
    return Response.json({ error: error.code }, { status: 409 });
  }
  if (
    error.code === 'EXTERNAL_USER_NOT_FOUND' ||
    error.code === 'NANGO_CONNECTION_NOT_BOUND' ||
    error.code === 'EXTERNAL_MAIL_SUBMISSION_NOT_FOUND'
  ) {
    return Response.json({ error: error.code }, { status: 404 });
  }
  return Response.json({ error: error.code }, { status: 412 });
};

export const registerExternalMailSubmissionRoutes = (
  app: Hono,
  dependencies: ExternalMailSubmissionRouteDependencies,
): void => {
  app.post('/mail/submissions', async (context) => {
    const authorization = await dependencies.authorize(context);
    if (authorization instanceof Response) return authorization;

    const idempotencyKey = externalMailIdempotencyKeySchema.safeParse(
      context.req.header('Idempotency-Key'),
    );
    const body = await context.req.json().catch(() => null);
    const parsed = externalMailSubmissionInputSchema.safeParse(body);
    if (!idempotencyKey.success || !parsed.success) {
      return context.json({ error: 'INVALID_REQUEST' }, 400);
    }

    try {
      const result = await dependencies.createService().submit({
        ...parsed.data,
        idempotencyKey: idempotencyKey.data,
      });
      context.header('Location', `/api/integrations/mail/submissions/${result.response.id}`);
      return context.json(result.response, 202);
    } catch (error) {
      if (error instanceof ExternalIntegrationError) return errorResponse(error);
      throw error;
    }
  });

  app.get('/mail/submissions/:submissionId', async (context) => {
    const authorization = await dependencies.authorize(context);
    if (authorization instanceof Response) return authorization;
    try {
      return context.json(
        await dependencies.createService().get(context.req.param('submissionId')),
        200,
      );
    } catch (error) {
      if (error instanceof ExternalIntegrationError) return errorResponse(error);
      throw error;
    }
  });
};
