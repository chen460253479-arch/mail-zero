import { useNavigate } from 'react-router';

import { ManagedChannelSettingsDialog } from '@/components/integrations/managed-channel-settings-dialog';

export default function ImapSmtpIntegrationPage() {
  const navigate = useNavigate();
  return (
    <ManagedChannelSettingsDialog
      channelId="imap_smtp"
      open
      onOpenChange={(open) => {
        if (!open) navigate('/settings/integrations');
      }}
    />
  );
}
