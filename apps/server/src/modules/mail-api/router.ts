import { submissionRouter } from './routers/submission';
import { identityRouter } from './routers/identity';
import { mailboxRouter } from './routers/mailbox';
import { accountRouter } from './routers/account';
import { threadRouter } from './routers/thread';
import { actionRouter } from './routers/action';
import { emailRouter } from './routers/email';
import { viewRouter } from './routers/view';
import { crmRouter } from './routers/crm';
import { router } from '../../trpc/trpc';

export const mailApiRouter = router({
  account: accountRouter,
  mailbox: mailboxRouter,
  email: emailRouter,
  thread: threadRouter,
  identity: identityRouter,
  submission: submissionRouter,
  view: viewRouter,
  action: actionRouter,
  crm: crmRouter,
});
