import { lookup } from 'node:dns/promises';

import { assertResolvedMailEndpoint, parseAllowedMailHosts } from '../shared/endpoint-policy';
import type { MailProtocolEndpoint } from '../../contracts';

export type ResolvedMailEndpoint = MailProtocolEndpoint & {
  originalHost: string;
  address: string;
};

export const resolveMailEndpoint = async (
  endpoint: MailProtocolEndpoint,
  allowlistValue: string | undefined,
): Promise<ResolvedMailEndpoint> => {
  const addresses = await lookup(endpoint.host, {
    all: true,
    verbatim: true,
  });
  const uniqueAddresses = [...new Set(addresses.map(({ address }) => address))];
  assertResolvedMailEndpoint(endpoint, uniqueAddresses, parseAllowedMailHosts(allowlistValue));
  const selected = addresses.find(({ family }) => family === 4) ?? addresses[0];
  if (selected === undefined) throw new Error('MAIL_PROTOCOL_DNS_EMPTY');
  return {
    ...endpoint,
    originalHost: endpoint.host,
    address: selected.address,
  };
};
