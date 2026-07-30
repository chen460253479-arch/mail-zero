import { isIP } from 'node:net';

export const normalizeCookieDomain = (value: string): string => {
  let domain = value.trim().toLowerCase().replace(/^\./u, '');
  if (domain.startsWith('[') && domain.endsWith(']')) {
    domain = domain.slice(1, -1);
  }
  return domain;
};

export const isLocalCookieDomain = (value: string): boolean => {
  const domain = normalizeCookieDomain(value);
  return domain === 'localhost' || domain.endsWith('.localhost') || isIP(domain) !== 0;
};

export const cookieDomainMatchesHostname = (hostname: string, cookieDomain: string): boolean => {
  const normalizedHostname = normalizeCookieDomain(hostname);
  const normalizedCookieDomain = normalizeCookieDomain(cookieDomain);
  if (!normalizedHostname || !normalizedCookieDomain) return false;
  if (normalizedHostname === normalizedCookieDomain) return true;
  if (isIP(normalizedCookieDomain) !== 0) return false;
  return normalizedHostname.endsWith(`.${normalizedCookieDomain}`);
};
