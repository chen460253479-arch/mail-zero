import { z } from 'zod';

import type { Logger } from '../../../infrastructure/logging/logger';

const MAX_BODY_BYTES = 256 * 1024;

const decimalValueSchema = z
  .union([z.string().regex(/^\d+$/u), z.number().int().nonnegative().safe()])
  .transform(String);

export const zohoMailWebhookPayloadSchema = z
  .object({
    summary: z.string().optional(),
    sentDateInGMT: decimalValueSchema.optional(),
    subject: z.string().optional(),
    messageId: decimalValueSchema,
    toAddress: z.string().optional(),
    folderId: decimalValueSchema,
    zuid: decimalValueSchema,
    ccAddress: z.string().optional(),
    size: decimalValueSchema.optional(),
    sender: z.string().optional(),
    receivedTime: decimalValueSchema.optional(),
    fromAddress: z.string().optional(),
    html: z.string().optional(),
    IntegIdList: z.string().optional(),
  })
  .passthrough();

export type ZohoMailWebhookPayload = z.infer<typeof zohoMailWebhookPayloadSchema>;

const parseJsonWithIntegerStrings = (text: string): unknown => {
  let normalized = '';
  let index = 0;
  while (index < text.length) {
    const character = text[index]!;
    if (character === '"') {
      const start = index;
      index += 1;
      while (index < text.length) {
        if (text[index] === '\\') {
          index += 2;
          continue;
        }
        if (text[index] === '"') {
          index += 1;
          break;
        }
        index += 1;
      }
      normalized += text.slice(start, index);
      continue;
    }
    if (character === '-' || (character >= '0' && character <= '9')) {
      const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(text.slice(index))?.[0];
      if (number !== undefined) {
        normalized += /[.eE]/u.test(number) ? number : JSON.stringify(number);
        index += number.length;
        continue;
      }
    }
    normalized += character;
    index += 1;
  }
  return JSON.parse(normalized) as unknown;
};

export type ZohoMailWebhookTarget = {
  targetId: string;
  syncIds: string[];
};

export type ZohoMailWebhookDependencies = {
  resolveTarget(payload: ZohoMailWebhookPayload): Promise<ZohoMailWebhookTarget | null>;
  recordSignal(syncIds: string[]): Promise<string[]>;
  enqueueDiscover(syncId: string): Promise<void>;
  logger?: Logger;
  requestId?: string;
};

const parsePayload = (body: Uint8Array): ZohoMailWebhookPayload | null => {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return null;
  }
  try {
    const parsed = zohoMailWebhookPayloadSchema.safeParse(parseJsonWithIntegerStrings(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export const handleZohoMailWebhookRequest = async (
  request: Request,
  dependencies: ZohoMailWebhookDependencies,
): Promise<Response> => {
  const logFields = {
    provider: 'zoho_mail',
    ...(dependencies.requestId === undefined ? {} : { requestId: dependencies.requestId }),
  };
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    dependencies.logger?.warn('mail.webhook.request_rejected', {
      ...logFields,
      reason: 'declared_body_too_large',
      declaredLength,
      status: 413,
    });
    return new Response(null, { status: 413 });
  }
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_BODY_BYTES) {
    dependencies.logger?.warn('mail.webhook.request_rejected', {
      ...logFields,
      reason: 'body_too_large',
      payloadBytes: body.byteLength,
      status: 413,
    });
    return new Response(null, { status: 413 });
  }
  dependencies.logger?.debug('mail.webhook.request_received', {
    ...logFields,
    payloadBytes: body.byteLength,
  });
  const payload = parsePayload(body);
  if (payload === null) {
    dependencies.logger?.info('mail.webhook.request_acknowledged', {
      ...logFields,
      reason: 'probe_or_incomplete_payload',
      status: 200,
    });
    return new Response(null, { status: 200 });
  }
  const target = await dependencies.resolveTarget(payload);
  if (target === null || target.syncIds.length === 0) {
    dependencies.logger?.warn('mail.webhook.target_not_found', {
      ...logFields,
      folderId: payload.folderId,
      messageId: payload.messageId,
      status: 200,
    });
    return new Response(null, { status: 200 });
  }

  const syncIds = await dependencies.recordSignal(target.syncIds);
  const wakeups = await Promise.allSettled(
    syncIds.map((syncId) => dependencies.enqueueDiscover(syncId)),
  );
  const queued = wakeups.filter(({ status }) => status === 'fulfilled').length;
  const completedFields = {
    ...logFields,
    targetId: target.targetId,
    syncIds,
    matched: syncIds.length,
    queued,
    failedWakeups: wakeups.length - queued,
    status: 200,
  };
  if (queued < syncIds.length) {
    dependencies.logger?.warn('mail.webhook.signal_completed', completedFields);
  } else {
    dependencies.logger?.info('mail.webhook.signal_completed', completedFields);
  }
  return Response.json({
    matched: syncIds.length,
    queued,
  });
};
