import { toByteArray } from 'base64-js';
import { z } from 'zod';

import type { Logger } from '../../../infrastructure/logging/logger';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_HOOK_SECRET_LENGTH = 4096;

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
  secrets: string[];
  secretBound: boolean;
};

export type ZohoMailWebhookDependencies = {
  resolveTarget(payload: ZohoMailWebhookPayload): Promise<ZohoMailWebhookTarget | null>;
  storeRegistrationSecret(secret: string): Promise<boolean>;
  storeSecret(targetId: string, secret: string): Promise<void>;
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

const decodeSignature = (value: string): Uint8Array | null => {
  try {
    return toByteArray(value.trim());
  } catch {
    return null;
  }
};

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean => {
  let difference = left.byteLength ^ right.byteLength;
  for (let index = 0; index < Math.max(left.byteLength, right.byteLength); index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
};

const verifySignature = async (
  secret: string,
  body: Uint8Array,
  signature: string,
): Promise<boolean> => {
  const provided = decodeSignature(signature);
  if (provided === null) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, body));
  return sameBytes(expected, provided);
};

const validHookSecret = (value: string | null): value is string =>
  value !== null && value.length > 0 && value.length <= MAX_HOOK_SECRET_LENGTH;

const matchingSecret = async (
  secrets: string[],
  body: Uint8Array,
  signature: string,
): Promise<string | null> => {
  for (const secret of secrets) {
    if (await verifySignature(secret, body, signature)) return secret;
  }
  return null;
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
  const hookSecret = request.headers.get('x-hook-secret');
  const hookSignature = request.headers.get('x-hook-signature');
  dependencies.logger?.debug('mail.webhook.request_received', {
    ...logFields,
    payloadBytes: body.byteLength,
    hasHookSecret: hookSecret !== null,
    hasHookSignature: hookSignature !== null,
  });
  const payload = parsePayload(body);
  if (validHookSecret(hookSecret)) {
    try {
      const signatureValid =
        hookSignature !== null && (await verifySignature(hookSecret, body, hookSignature));
      const secretStored = signatureValid
        ? await dependencies.storeRegistrationSecret(hookSecret)
        : false;
      dependencies.logger?.info('mail.webhook.registration_completed', {
        ...logFields,
        signatureValid,
        secretStored,
        status: 200,
      });
    } catch (error) {
      dependencies.logger?.error('mail.webhook.registration_failed', {
        ...logFields,
        status: 200,
        error,
      });
      // Zoho only establishes the webhook after this registration probe receives 200.
    }
    return new Response(null, { status: 200 });
  }
  if (payload === null) {
    dependencies.logger?.warn('mail.webhook.request_ignored', {
      ...logFields,
      reason: 'invalid_payload',
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
      status: 404,
    });
    return new Response(null, { status: 404 });
  }

  if (hookSignature === null) {
    dependencies.logger?.warn('mail.webhook.signature_rejected', {
      ...logFields,
      targetId: target.targetId,
      reason: 'missing_signature',
      status: 401,
    });
    return new Response(null, { status: 401 });
  }
  const candidates =
    target.secrets.length > 0 ? target.secrets : validHookSecret(hookSecret) ? [hookSecret] : [];
  const verifiedSecret = await matchingSecret(candidates, body, hookSignature);
  if (verifiedSecret === null) {
    dependencies.logger?.warn('mail.webhook.signature_rejected', {
      ...logFields,
      targetId: target.targetId,
      reason: 'invalid_signature',
      status: 401,
    });
    return new Response(null, { status: 401 });
  }
  if (!target.secretBound) {
    await dependencies.storeSecret(target.targetId, verifiedSecret);
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
    secretBound: target.secretBound,
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
