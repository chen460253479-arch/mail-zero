import { describe, expect, it } from 'vitest';

import { finalizeRequestTrace, TraceContext } from '../../../src/lib/trace-context';

describe('request trace lifecycle', () => {
  it('completes the request span and trace after a successful response', () => {
    const traceId = crypto.randomUUID();
    const context = { var: { traceId } };
    const trace = TraceContext.createTrace(traceId, { requestId: crypto.randomUUID() });
    const requestSpan = TraceContext.startSpan(traceId, 'request_processing');

    finalizeRequestTrace(context, requestSpan.id, 200);

    expect(requestSpan.status).toBe('completed');
    expect(requestSpan.metadata).toEqual({ statusCode: 200, success: true });
    expect(trace.endTime).toEqual(expect.any(Number));
    expect(trace.duration).toEqual(expect.any(Number));
  });

  it('marks the request span as failed and still completes the trace', () => {
    const traceId = crypto.randomUUID();
    const context = { var: { traceId } };
    const trace = TraceContext.createTrace(traceId, { requestId: crypto.randomUUID() });
    const requestSpan = TraceContext.startSpan(traceId, 'request_processing');

    finalizeRequestTrace(context, requestSpan.id, 500, new Error('request failed'));

    expect(requestSpan.status).toBe('error');
    expect(requestSpan.error).toBe('request failed');
    expect(requestSpan.metadata).toEqual({ statusCode: 500, success: false });
    expect(trace.endTime).toEqual(expect.any(Number));
  });
});
