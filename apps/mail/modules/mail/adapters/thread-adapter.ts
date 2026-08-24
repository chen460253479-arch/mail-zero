import type { ThreadSummary } from '../model/thread';
import type { ThreadSummaryDto } from './contracts';

export function adaptThreadSummary(dto: ThreadSummaryDto): ThreadSummary {
  return {
    ...dto,
    emailIds: [...dto.emailIds],
    mailboxIds: Object.keys(dto.mailboxIds),
    keywords: { ...dto.keywords },
    customerMarkers: (dto.customerMarkers ?? []).map((marker) => ({ ...marker })),
    latestEmail: {
      ...dto.latestEmail,
      to: (dto.latestEmail.to ?? []).map((address) => ({ ...address })),
    },
  };
}
