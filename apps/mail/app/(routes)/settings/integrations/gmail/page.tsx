import { useNavigate } from 'react-router';

import { GmailSettingsDialog } from '@/components/integrations/gmail-settings-dialog';

export default function GmailIntegrationPage() {
  const navigate = useNavigate();

  return (
    <GmailSettingsDialog
      open
      onOpenChange={(open) => {
        if (!open) navigate('/settings/integrations');
      }}
    />
  );
}
