const MAX_BODY_BYTES = 256 * 1024;

export type ZohoMailWebhookDependencies = {
  recordEndpointSignal(endpointToken: string): Promise<string[]>;
  enqueueDiscover(syncId: string): Promise<void>;
};

export const handleZohoMailWebhookRequest = async (
  request: Request,
  endpointToken: string,
  dependencies: ZohoMailWebhookDependencies,
): Promise<Response> => {
  if (endpointToken.length === 0 || endpointToken.length > 512) {
    return new Response(null, { status: 404 });
  }
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }
  const syncIds = await dependencies.recordEndpointSignal(endpointToken);
  if (syncIds.length === 0) return new Response(null, { status: 404 });
  const wakeups = await Promise.allSettled(
    syncIds.map((syncId) => dependencies.enqueueDiscover(syncId)),
  );
  return Response.json(
    {
      matched: syncIds.length,
      queued: wakeups.filter(({ status }) => status === 'fulfilled').length,
    },
    { status: 202 },
  );
};
