export const gmailSentMessageIdQuery = (messageId: string): string =>
  `in:sent rfc822msgid:${messageId}`;
