import { handleOutlookPush, type OutlookPushDependencies } from './handle-push';

const MAX_BODY_BYTES = 256 * 1024;

export type OutlookWebhookDependencies = OutlookPushDependencies;

export const handleOutlookWebhookRequest = async (
  request: Request,
  dependencies: OutlookWebhookDependencies,
): Promise<Response> => {
  const validationToken = new URL(request.url).searchParams.get('validationToken');
  if (validationToken !== null) {
    if (validationToken.length === 0 || validationToken.length > 1_024) {
      return new Response(null, { status: 400 });
    }
    return new Response(validationToken, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body) as unknown;
  } catch {
    return new Response(null, { status: 202 });
  }
  const result = await handleOutlookPush(payload, dependencies);
  return Response.json(result, { status: 202 });
};
