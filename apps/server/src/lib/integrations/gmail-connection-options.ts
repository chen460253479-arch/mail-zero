export type GmailConnectMode = 'choice' | 'zero_oauth' | 'nango' | 'unavailable';

export const resolveGmailConnectMode = ({
  zeroOAuthAvailable,
  nangoAvailable,
}: {
  zeroOAuthAvailable: boolean;
  nangoAvailable: boolean;
}): GmailConnectMode => {
  if (zeroOAuthAvailable && nangoAvailable) return 'choice';
  if (zeroOAuthAvailable) return 'zero_oauth';
  if (nangoAvailable) return 'nango';
  return 'unavailable';
};
