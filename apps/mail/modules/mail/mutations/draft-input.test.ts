import { describe, expect, it } from 'vitest';

import { buildDraftCreateInput, buildDraftUpdateInput, htmlToPlainText } from './draft-input';

const content = {
  identityId: 'identity-1',
  replyToEmailId: null,
  to: [{ email: 'to@example.com', name: 'To' }],
  cc: [],
  bcc: [],
  subject: 'Subject',
  textBody: 'Hello world',
  htmlBody: '<p>Hello <strong>world</strong></p>',
  attachments: [{ blobId: 'blob-1', filename: '1.jpg' }],
};

describe('draft input', () => {
  it('builds an Email/set create request', () => {
    expect(
      buildDraftCreateInput({
        accountId: 'account-1',
        state: 'email-state-1',
        clientId: 'draft-client-1',
        content,
      }),
    ).toEqual({
      accountId: 'account-1',
      ifInState: 'email-state-1',
      create: { 'draft-client-1': content },
      update: {},
      destroy: [],
    });
  });

  it('uses the draft revision as the update precondition', () => {
    expect(
      buildDraftUpdateInput({
        accountId: 'account-1',
        state: 'email-state-2',
        draftId: 'draft-1',
        draftRevision: 4,
        content,
      }),
    ).toEqual({
      accountId: 'account-1',
      ifInState: 'email-state-2',
      create: {},
      update: {
        'draft-1': {
          ...content,
          ifDraftRevision: 4,
        },
      },
      destroy: [],
    });
  });

  it('derives a stable plain-text alternative from composer HTML', () => {
    expect(htmlToPlainText('<p>Hello&nbsp;<strong>world</strong></p><p>Second line</p>')).toBe(
      'Hello world\nSecond line',
    );
  });
});
