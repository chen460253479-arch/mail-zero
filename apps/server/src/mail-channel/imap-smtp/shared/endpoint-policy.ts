import { isIP } from 'node:net';

import type { MailProtocolEndpoint } from '../../contracts';

const hostnamePattern =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

const parseIpv4 = (address: string): readonly number[] | null => {
  if (isIP(address) !== 4) return null;
  return address.split('.').map(Number);
};

const isBlockedIpv4 = (address: string): boolean => {
  const octets = parseIpv4(address);
  if (octets === null) return false;
  const [a = 0, b = 0, c = 0] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
};

const isBlockedIpv6 = (address: string): boolean => {
  if (isIP(address) !== 6) return false;
  const normalized = address.toLocaleLowerCase('en-US');
  if (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith('ff')
  ) {
    return true;
  }
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
  return mapped !== undefined && isBlockedIpv4(mapped);
};

const isBlockedAddress = (address: string): boolean =>
  isBlockedIpv4(address) || isBlockedIpv6(address);

const normalizeHost = (host: string): string => {
  const normalized = host.trim().replace(/\.$/u, '').toLocaleLowerCase('en-US');
  if (normalized.length === 0 || (!hostnamePattern.test(normalized) && isIP(normalized) === 0)) {
    throw new Error('MAIL_PROTOCOL_INVALID_ENDPOINT');
  }
  return normalized;
};

export const parseAllowedMailHosts = (value: string | undefined): ReadonlySet<string> => {
  const hosts = new Set<string>();
  for (const item of value?.split(',') ?? []) {
    if (item.trim().length > 0) hosts.add(normalizeHost(item));
  }
  return hosts;
};

export const assertResolvedMailEndpoint = (
  endpoint: MailProtocolEndpoint,
  resolvedAddresses: readonly string[],
  allowedHosts: ReadonlySet<string>,
): void => {
  const host = normalizeHost(endpoint.host);
  if (
    !Number.isSafeInteger(endpoint.port) ||
    endpoint.port < 1 ||
    endpoint.port > 65_535 ||
    typeof endpoint.secure !== 'boolean'
  ) {
    throw new Error('MAIL_PROTOCOL_INVALID_ENDPOINT');
  }
  if (resolvedAddresses.length === 0) {
    throw new Error('MAIL_PROTOCOL_DNS_EMPTY');
  }
  if (
    !allowedHosts.has(host) &&
    resolvedAddresses.some((address) => isIP(address) === 0 || isBlockedAddress(address))
  ) {
    throw new Error('MAIL_PROTOCOL_PRIVATE_ENDPOINT_BLOCKED');
  }
};
