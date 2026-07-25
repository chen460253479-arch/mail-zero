export function normalizeMessageId(value: string): string {
  let normalized = value.trim();

  if (normalized.startsWith('<') && normalized.endsWith('>')) {
    normalized = normalized.slice(1, -1).trim();
  }

  const domainSeparator = normalized.lastIndexOf('@');
  if (domainSeparator === -1) {
    return normalized;
  }

  return `${normalized.slice(0, domainSeparator + 1)}${normalized.slice(domainSeparator + 1).toLowerCase()}`;
}
