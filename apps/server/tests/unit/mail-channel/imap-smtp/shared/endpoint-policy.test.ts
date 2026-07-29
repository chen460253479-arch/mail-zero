import { describe, expect, it } from 'vitest';

import {
  assertResolvedMailEndpoint,
  parseAllowedMailHosts,
} from '../../../../../src/mail-channel/imap-smtp/shared/endpoint-policy';

describe('IMAP/SMTP endpoint policy', () => {
  it.each([
    '127.0.0.1',
    '127.20.30.40',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.20',
    '169.254.169.254',
    '0.0.0.0',
    '::1',
    'fc00::1',
    'fd12::1',
    'fe80::1',
  ])('rejects non-public address %s by default', (address) => {
    expect(() =>
      assertResolvedMailEndpoint(
        { host: 'mail.example.test', port: 993, secure: true },
        [address],
        new Set(),
      ),
    ).toThrow('MAIL_PROTOCOL_PRIVATE_ENDPOINT_BLOCKED');
  });

  it('allows a private endpoint only through an exact administrator allowlist', () => {
    const allowlist = parseAllowedMailHosts('mail.internal.example, 10.0.0.8');

    expect(() =>
      assertResolvedMailEndpoint(
        { host: 'mail.internal.example', port: 993, secure: true },
        ['10.0.0.8'],
        allowlist,
      ),
    ).not.toThrow();
    expect(() =>
      assertResolvedMailEndpoint(
        { host: 'other.internal.example', port: 993, secure: true },
        ['10.0.0.8'],
        allowlist,
      ),
    ).toThrow('MAIL_PROTOCOL_PRIVATE_ENDPOINT_BLOCKED');
  });

  it('accepts a public endpoint and rejects malformed hosts, ports, and empty DNS results', () => {
    expect(() =>
      assertResolvedMailEndpoint(
        { host: 'imap.example.test', port: 993, secure: true },
        ['8.8.8.8'],
        new Set(),
      ),
    ).not.toThrow();
    expect(() =>
      assertResolvedMailEndpoint(
        { host: 'https://imap.example.test', port: 993, secure: true },
        ['8.8.8.8'],
        new Set(),
      ),
    ).toThrow('MAIL_PROTOCOL_INVALID_ENDPOINT');
    expect(() =>
      assertResolvedMailEndpoint(
        { host: 'imap.example.test', port: 0, secure: true },
        ['8.8.8.8'],
        new Set(),
      ),
    ).toThrow('MAIL_PROTOCOL_INVALID_ENDPOINT');
    expect(() =>
      assertResolvedMailEndpoint(
        { host: 'imap.example.test', port: 993, secure: true },
        [],
        new Set(),
      ),
    ).toThrow('MAIL_PROTOCOL_DNS_EMPTY');
  });
});
