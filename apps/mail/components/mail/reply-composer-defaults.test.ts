import { describe, expect, it } from 'vitest';

import { getReplyComposerDefaults } from './reply-composer-defaults';

const message = {
  sender: { name: 'Sender', email: 'sender@example.com' },
  replyTo: undefined,
  to: [{ name: 'Me', email: 'me@example.com' }],
  cc: null,
  subject: 'Project update',
};

describe('getReplyComposerDefaults', () => {
  it('addresses a reply to the original sender', () => {
    expect(
      getReplyComposerDefaults({
        message,
        mode: 'reply',
        accountEmail: 'me@example.com',
      }),
    ).toEqual({
      to: ['sender@example.com'],
      cc: [],
      subject: 'Re: Project update',
    });
  });

  it('prefers Reply-To over the visible sender', () => {
    expect(
      getReplyComposerDefaults({
        message: { ...message, replyTo: 'responses@example.com' },
        mode: 'reply',
        accountEmail: 'me@example.com',
      }).to,
    ).toEqual(['responses@example.com']);
  });

  it('replies to an external recipient when the original message was sent by the user', () => {
    expect(
      getReplyComposerDefaults({
        message: {
          ...message,
          sender: { name: 'Me', email: 'alias@example.com' },
          to: [
            { name: 'Me', email: 'me@example.com' },
            { name: 'Customer', email: 'customer@example.com' },
          ],
        },
        mode: 'reply',
        accountEmail: 'me@example.com',
        aliases: ['alias@example.com'],
      }).to,
    ).toEqual(['customer@example.com']);
  });

  it('does not use the account Reply-To address when replying to a sent message', () => {
    expect(
      getReplyComposerDefaults({
        message: {
          ...message,
          sender: { name: 'Me', email: 'alias@example.com' },
          replyTo: 'support-inbox@example.com',
          to: [{ name: 'Customer', email: 'customer@example.com' }],
        },
        mode: 'reply',
        accountEmail: 'me@example.com',
        aliases: ['alias@example.com'],
      }).to,
    ).toEqual(['customer@example.com']);
  });

  it('builds a case-insensitive, deduplicated Reply All list without the user or aliases', () => {
    expect(
      getReplyComposerDefaults({
        message: {
          ...message,
          replyTo: 'responses@example.com',
          to: [
            { name: 'Me', email: 'ME@example.com' },
            { name: 'Sender duplicate', email: 'RESPONSES@example.com' },
            { name: 'Teammate', email: 'teammate@example.com' },
          ],
          cc: [
            { name: 'Alias', email: 'alias@example.com' },
            { name: 'Teammate duplicate', email: 'TEAMMATE@example.com' },
            { name: 'Observer', email: 'observer@example.com' },
          ],
          subject: 'Re: Project update',
        },
        mode: 'replyAll',
        accountEmail: 'me@example.com',
        aliases: ['alias@example.com'],
      }),
    ).toEqual({
      to: ['responses@example.com', 'teammate@example.com'],
      cc: ['observer@example.com'],
      subject: 'Re: Project update',
    });
  });

  it('leaves forward recipients empty and prefixes the subject once', () => {
    expect(
      getReplyComposerDefaults({
        message: { ...message, subject: 'Fwd: Project update' },
        mode: 'forward',
        accountEmail: 'me@example.com',
      }),
    ).toEqual({
      to: [],
      cc: [],
      subject: 'Fwd: Project update',
    });
  });
});
