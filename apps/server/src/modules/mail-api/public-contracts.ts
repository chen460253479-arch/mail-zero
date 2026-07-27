import type { z } from 'zod';

import {
  threadDetailResultSchema,
  threadPageResultSchema,
  threadSummarySchema,
} from './contracts/view';
import { accountGetResultSchema, accountSchema } from './contracts/account';
import { submissionSchema } from './contracts/submission';
import { identitySchema } from './contracts/identity';
import { mailboxSchema } from './contracts/mailbox';
import { emailSchema } from './contracts/email';

export type MailApiAccountDto = z.infer<typeof accountSchema>;
export type MailApiAccountDetailDto = z.infer<typeof accountGetResultSchema>;
export type MailApiMailboxDto = z.infer<typeof mailboxSchema>;
export type MailApiEmailDto = z.infer<typeof emailSchema>;
export type MailApiIdentityDto = z.infer<typeof identitySchema>;
export type MailApiSubmissionDto = z.infer<typeof submissionSchema>;
export type MailApiThreadSummaryDto = z.infer<typeof threadSummarySchema>;
export type MailApiThreadPageResultDto = z.infer<typeof threadPageResultSchema>;
export type MailApiThreadDetailResultDto = z.infer<typeof threadDetailResultSchema>;
