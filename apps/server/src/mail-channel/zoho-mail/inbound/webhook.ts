import { toByteArray } from 'base64-js';
import { z } from 'zod';

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
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }
  const hookSecret = request.headers.get('x-hook-secret');
  const hookSignature = request.headers.get('x-hook-signature');
  const payload = parsePayload(body);
  if (payload === null) {
    if (!validHookSecret(hookSecret) || hookSignature === null) {
      return Response.json({ error: 'ZOHO_WEBHOOK_PAYLOAD_INVALID' }, { status: 400 });
    }
    if (!(await verifySignature(hookSecret, body, hookSignature))) {
      return new Response(null, { status: 401 });
    }
    if (!(await dependencies.storeRegistrationSecret(hookSecret))) {
      return Response.json({ error: 'ZOHO_WEBHOOK_REGISTRATION_TARGET_MISSING' }, { status: 409 });
    }
    return Response.json({ registered: true });
  }
  const target = await dependencies.resolveTarget(payload);
  if (target === null || target.syncIds.length === 0) {
    return new Response(null, { status: 404 });
  }

  if (hookSignature === null) {
    return new Response(null, { status: 401 });
  }
  const candidates =
    target.secrets.length > 0 ? target.secrets : validHookSecret(hookSecret) ? [hookSecret] : [];
  const verifiedSecret = await matchingSecret(candidates, body, hookSignature);
  if (verifiedSecret === null) {
    return new Response(null, { status: 401 });
  }
  if (!target.secretBound) {
    await dependencies.storeSecret(target.targetId, verifiedSecret);
  }

  const syncIds = await dependencies.recordSignal(target.syncIds);
  const wakeups = await Promise.allSettled(
    syncIds.map((syncId) => dependencies.enqueueDiscover(syncId)),
  );
  return Response.json({
    matched: syncIds.length,
    queued: wakeups.filter(({ status }) => status === 'fulfilled').length,
  });
};
