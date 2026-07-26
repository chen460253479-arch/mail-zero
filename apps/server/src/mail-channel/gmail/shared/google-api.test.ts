import { beforeEach, describe, expect, it, vi } from 'vitest';

const { oauthConstructor, setCredentials } = vi.hoisted(() => ({
  oauthConstructor: vi.fn(),
  setCredentials: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    constructor(...args: unknown[]) {
      oauthConstructor(...args);
    }

    setCredentials = setCredentials;
  },
}));

vi.mock('@googleapis/gmail', () => ({
  gmail: vi.fn(() => ({ users: { getProfile: vi.fn() } })),
}));

vi.mock('@googleapis/people', () => ({
  people: vi.fn(),
}));

import { createGoogleGmailApiExecutor } from './google-api';

describe('Google Gmail API executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('configures the OAuth client so a Zero OAuth refresh token can be exchanged', () => {
    createGoogleGmailApiExecutor(
      {
        type: 'oauth2',
        accessToken: 'expired-access-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date('2026-07-26T10:00:00.000Z'),
        scope: 'gmail.modify',
      },
      {
        clientId: 'gmail-client-id',
        clientSecret: 'gmail-client-secret',
        redirectUri: 'https://api.example.com/callback',
      },
    );

    expect(oauthConstructor).toHaveBeenCalledWith(
      'gmail-client-id',
      'gmail-client-secret',
      'https://api.example.com/callback',
    );
    expect(setCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ refresh_token: 'refresh-token' }),
    );
  });
});
