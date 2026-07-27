import type { MailIdentity } from '../model/identity';
import type { DraftContent } from '../model/draft';

const addressFromHeader = (value: string) => {
  const angleAddress = value.match(/<([^<>]+)>/u)?.[1];
  return (angleAddress ?? value).trim().toLowerCase();
};

export function selectDeliveryIdentity(
  identities: readonly MailIdentity[],
  fromEmail: string | undefined,
) {
  if (fromEmail) {
    const requested = addressFromHeader(fromEmail);
    const exact = identities.find((identity) => identity.email.toLowerCase() === requested);
    if (exact) return exact;
  }
  return identities.find((identity) => identity.isDefault) ?? identities[0];
}

export function toMailAddresses(values: readonly string[]): DraftContent['to'] {
  return values.map((email) => {
    const normalized = addressFromHeader(email);
    return {
      email: normalized,
      name: normalized.split('@')[0] ?? normalized,
    };
  });
}
