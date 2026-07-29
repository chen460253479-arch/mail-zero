export type ConnectableMailChannelId = 'gmail' | 'outlook' | 'zoho_mail' | 'imap_smtp';
export type MailChannelConnectMode = 'zero_oauth' | 'nango' | 'manual' | 'unavailable';

export type MailChannelConnectAction =
  | { type: 'redirect'; path: string }
  | { type: 'nango'; channelId: ConnectableMailChannelId }
  | { type: 'manual' }
  | { type: 'unavailable' };

export const resolveChannelConnectAction = (
  channelId: ConnectableMailChannelId,
  mode: MailChannelConnectMode | string,
): MailChannelConnectAction => {
  if (mode === 'zero_oauth') {
    return {
      type: 'redirect',
      path: `/api/integrations/${channelId}/connect/start`,
    };
  }
  if (mode === 'nango') return { type: 'nango', channelId };
  if (mode === 'manual') return { type: 'manual' };
  return { type: 'unavailable' };
};
