import type { ThreadSummary } from '../model/thread';
import type { ThreadSummaryDto } from './contracts';

export function adaptThreadSummary(dto: ThreadSummaryDto): ThreadSummary {
  return {
    ...dto,
    emailIds: [...dto.emailIds],
    mailboxIds: Object.keys(dto.mailboxIds),
    keywords: { ...dto.keywords },
    latestEmail: { ...dto.latestEmail },
  };
}
