import { describe, expect, it } from 'vitest';

import { outboundFailureLogDetails } from '../../../../../src/modules/mail-outbound/application/failure-log';

describe('outbound failure log details', () => {
  it('returns the original SMTP error fields from the deepest cause without redaction', () => {
    const smtpError = Object.assign(
      new Error('Message failed: 550 5.1.1 user@example.com rejected\nsecond line'),
      {
        code: 'EENVELOPE',
        command: 'RCPT TO',
        responseCode: 550,
        response: '550 5.1.1 <user@example.com> recipient rejected',
      },
    );
    const wrapped = Object.assign(new Error('SMTP_PERMANENT_REJECTION', { cause: smtpError }), {
      code: 'SMTP_PERMANENT_REJECTION',
    });

    expect(outboundFailureLogDetails(wrapped)).toMatchObject({
      errorName: 'Error',
      errorCode: 'SMTP_PERMANENT_REJECTION',
      errorMessage: 'Message failed: 550 5.1.1 user@example.com rejected\nsecond line',
      sourceErrorCode: 'EENVELOPE',
      smtpCommand: 'RCPT TO',
      smtpResponseCode: 550,
      smtpResponse: '550 5.1.1 <user@example.com> recipient rejected',
    });
  });

  it('handles a circular cause chain without hiding the available error', () => {
    const error = Object.assign(new Error('socket timed out'), {
      code: 'ETIMEDOUT',
      command: 'CONN',
    }) as Error & { cause?: unknown };
    error.cause = error;

    expect(outboundFailureLogDetails(error)).toMatchObject({
      errorCode: 'ETIMEDOUT',
      errorMessage: 'socket timed out',
      sourceErrorCode: 'ETIMEDOUT',
      smtpCommand: 'CONN',
      smtpResponseCode: null,
      smtpResponse: null,
    });
  });
});
