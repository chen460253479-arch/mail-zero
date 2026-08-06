import { describe, expect, it, vi } from 'vitest';

import { createLogger } from '../../../../src/infrastructure/logging/logger';

describe('structured logger', () => {
  it('emits JSON records at or above the configured level', () => {
    const sink = vi.fn();
    const logger = createLogger({
      level: 'info',
      now: () => new Date('2026-08-06T00:00:00.000Z'),
      sink,
    });

    logger.debug('debug.skipped');
    logger.info('mail.sync.completed', { imported: 2 });

    expect(sink).toHaveBeenCalledOnce();
    expect(JSON.parse(sink.mock.calls[0]![1])).toEqual({
      timestamp: '2026-08-06T00:00:00.000Z',
      level: 'info',
      event: 'mail.sync.completed',
      imported: 2,
    });
  });

  it('redacts sensitive fields and does not serialize error messages or stacks', () => {
    const sink = vi.fn();
    const logger = createLogger({ level: 'debug', sink });
    const error = Object.assign(new Error('provider URL includes access_token=secret'), {
      code: 'MAIL_SYNC_FAILED',
    });

    logger.error('mail.sync.failed', {
      authorization: 'Bearer secret',
      hookSignature: 'signature',
      subject: 'private subject',
      hasWebhookSecret: true,
      error,
    });

    const record = JSON.parse(sink.mock.calls[0]![1]);
    expect(record).toMatchObject({
      authorization: '[REDACTED]',
      hookSignature: '[REDACTED]',
      subject: '[REDACTED]',
      hasWebhookSecret: true,
      error: { name: 'Error', code: 'MAIL_SYNC_FAILED' },
    });
    expect(sink.mock.calls[0]![1]).not.toContain('provider URL');
    expect(sink.mock.calls[0]![1]).not.toContain('Bearer secret');
  });

  it('inherits child bindings without mutating the parent logger', () => {
    const sink = vi.fn();
    const logger = createLogger({ level: 'info', sink });

    logger.child({ component: 'scheduler' }).info('mail.scheduler.started');
    logger.info('server.started');

    expect(JSON.parse(sink.mock.calls[0]![1])).toMatchObject({ component: 'scheduler' });
    expect(JSON.parse(sink.mock.calls[1]![1])).not.toHaveProperty('component');
  });
});
