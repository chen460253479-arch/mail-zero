import type { Mailbox } from '../model/mailbox';
import type { MailboxDto } from './contracts';

export function adaptMailbox(dto: MailboxDto): Mailbox {
  return { ...dto };
}
