import type { MailIdentity } from '../model/identity';
import type { IdentityDto } from './contracts';

export function adaptIdentity(dto: IdentityDto): MailIdentity {
  return { ...dto };
}
