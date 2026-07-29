import { useNavigate } from 'react-router';

import { ManagedChannelSettingsDialog } from '@/components/integrations/managed-channel-settings-dialog';

export default function OutlookIntegrationPage() {
  const navigate = useNavigate();
  return (
    <ManagedChannelSettingsDialog
      channelId="outlook"
      open
      onOpenChange={(open) => {
        if (!open) navigate('/settings/integrations');
      }}
    />
  );
}
