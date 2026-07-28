export type GmailConnectMode = 'zero_oauth' | 'nango' | 'unavailable';

export const resolveGmailConnectMode = ({
  selectedAuthSource,
  zeroOAuthAvailable,
  nangoAvailable,
}: {
  selectedAuthSource: 'zero_oauth' | 'nango' | null;
  zeroOAuthAvailable: boolean;
  nangoAvailable: boolean;
}): GmailConnectMode => {
  if (selectedAuthSource === 'zero_oauth' && zeroOAuthAvailable) return 'zero_oauth';
  if (selectedAuthSource === 'nango' && nangoAvailable) return 'nango';
  return 'unavailable';
};
