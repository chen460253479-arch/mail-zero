import type { ParsedMessage, Sender } from '@/types';

export type ReplyMode = 'reply' | 'replyAll' | 'forward';

type ReplyMessage = Pick<ParsedMessage, 'cc' | 'replyTo' | 'sender' | 'subject' | 'to'>;

export type ReplyComposerDefaults = {
  to: string[];
  cc: string[];
  subject: string;
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const subjectWithPrefix = (subject: string, prefix: 'Re' | 'Fwd') => {
  const trimmedSubject = subject.trim();
  const alreadyPrefixed =
    prefix === 'Re' ? /^re\s*:/i.test(trimmedSubject) : /^(?:fwd?|fw)\s*:/i.test(trimmedSubject);

  return alreadyPrefixed ? trimmedSubject : `${prefix}: ${trimmedSubject}`.trim();
};

const addressEmails = (addresses: Sender[] | null | undefined) =>
  addresses?.map((address) => address.email).filter(Boolean) ?? [];

export function getReplyComposerDefaults({
  message,
  mode,
  accountEmail,
  aliases = [],
}: {
  message: ReplyMessage;
  mode: ReplyMode;
  accountEmail: string;
  aliases?: string[];
}): ReplyComposerDefaults {
  if (mode === 'forward') {
    return {
      to: [],
      cc: [],
      subject: subjectWithPrefix(message.subject, 'Fwd'),
    };
  }

  const ownAddresses = new Set([accountEmail, ...aliases].map(normalizeEmail).filter(Boolean));
  const to: string[] = [];
  const cc: string[] = [];
  const toAddresses = new Set<string>();
  const ccAddresses = new Set<string>();
  const senderIsCurrentUser = ownAddresses.has(normalizeEmail(message.sender.email));

  const addRecipient = (target: string[], seen: Set<string>, email: string | undefined) => {
    if (!email) return;

    const normalized = normalizeEmail(email);
    if (!normalized || ownAddresses.has(normalized) || seen.has(normalized)) return;

    seen.add(normalized);
    target.push(email.trim());
  };

  // RFC replies target Reply-To when supplied; otherwise they target the visible sender.
  const replyAddress = message.replyTo?.trim() || message.sender.email;

  if (mode === 'reply') {
    if (!senderIsCurrentUser) {
      addRecipient(to, toAddresses, replyAddress);
    }

    // For a message sent by the current account, reply to the first external recipient.
    if (to.length === 0) {
      for (const email of addressEmails(message.to)) {
        addRecipient(to, toAddresses, email);
        if (to.length > 0) break;
      }
    }
  } else {
    if (!senderIsCurrentUser) {
      addRecipient(to, toAddresses, replyAddress);
    }
    for (const email of addressEmails(message.to)) {
      addRecipient(to, toAddresses, email);
    }
    for (const email of addressEmails(message.cc)) {
      const normalized = normalizeEmail(email);
      if (!toAddresses.has(normalized)) {
        addRecipient(cc, ccAddresses, email);
      }
    }
  }

  return {
    to,
    cc,
    subject: subjectWithPrefix(message.subject, 'Re'),
  };
}
