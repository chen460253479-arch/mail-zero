import { createMailChannelRegistry } from './registry';
import { zohoMailPlugin } from '../zoho-mail';
import { imapSmtpPlugin } from '../imap-smtp';
import { outlookPlugin } from '../outlook';
import { gmailPlugin } from '../gmail';

export const defaultMailChannelRegistry = createMailChannelRegistry([
  gmailPlugin,
  outlookPlugin,
  zohoMailPlugin,
  imapSmtpPlugin,
]);
