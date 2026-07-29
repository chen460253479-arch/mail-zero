import { useNavigate } from 'react-router';

import { ManagedChannelSettingsDialog } from '@/components/integrations/managed-channel-settings-dialog';

export default function ZohoMailIntegrationPage() {
  const navigate = useNavigate();
  return (
    <ManagedChannelSettingsDialog
      channelId="zoho_mail"
      open
      onOpenChange={(open) => {
        if (!open) navigate('/settings/integrations');
      }}
    />
  );
}
