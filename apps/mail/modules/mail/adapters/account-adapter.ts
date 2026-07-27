import type { MailAccount } from '../model/account';
import type { AccountDto } from './contracts';

export function adaptAccount(dto: AccountDto): MailAccount {
  return {
    id: dto.id,
    connectionId: dto.connectionId,
    status: dto.status,
    timezone: dto.timezone,
    state: dto.state,
    storageQuotaBytes: dto.storageQuotaBytes,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    ...('capabilities' in dto ? { capabilities: { ...dto.capabilities } } : {}),
  };
}
