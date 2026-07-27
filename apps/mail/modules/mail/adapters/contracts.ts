import type {
  MailApiAccountDetailDto,
  MailApiAccountDto,
  MailApiEmailDto,
  MailApiIdentityDto,
  MailApiMailboxDto,
  MailApiSubmissionDto,
  MailApiThreadSummaryDto,
} from '@zero/server/mail-api-contracts';

export type AccountDto = MailApiAccountDto | MailApiAccountDetailDto;
export type MailboxDto = MailApiMailboxDto;
export type EmailDto = MailApiEmailDto;
export type IdentityDto = MailApiIdentityDto;
export type ThreadSummaryDto = MailApiThreadSummaryDto;
export type SubmissionDto = MailApiSubmissionDto;
