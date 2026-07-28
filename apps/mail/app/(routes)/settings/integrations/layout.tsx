import { Outlet, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Mail } from 'lucide-react';

import { ChannelCard } from '@/components/integrations/channel-card';
import { GmailColor, OutlookColor } from '@/components/icons/icons';
import { isAdministrator } from '@/lib/administrator';
import { useTRPC } from '@/providers/query-provider';
import { Skeleton } from '@/components/ui/skeleton';
import { authProxy } from '@/lib/auth-proxy';
import type { Route } from './+types/layout';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const session = await authProxy.api.getSession({ headers: request.headers });
  if (!isAdministrator(session)) {
    return Response.redirect('/settings/general');
  }
  return null;
}

const channelDescriptions = {
  gmail: 'Gmail Inbox incremental sync and Gmail API sending.',
  outlook: 'Microsoft Outlook and Microsoft 365 mailboxes.',
  zoho_mail: 'Zoho Mail hosted accounts.',
  imap_smtp: 'Provider-neutral IMAP receiving and SMTP sending.',
} as const;

export default function IntegrationsLayout() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const channels = useQuery(trpc.integrations.getChannels.queryOptions());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Email integrations</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Configure each provider as one global mail channel. Authorization infrastructure stays
          inside the selected channel.
        </p>
      </div>

      {channels.isLoading || !channels.data ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {channels.data.map((channel) => (
            <ChannelCard
              key={channel.channelId}
              title={channel.displayName}
              description={channelDescriptions[channel.channelId]}
              available={channel.available}
              configured={channel.configured}
              icon={
                channel.channelId === 'gmail' ? (
                  <GmailColor className="size-7" />
                ) : channel.channelId === 'outlook' ? (
                  <OutlookColor className="size-7" />
                ) : (
                  <Mail className="size-6" />
                )
              }
              onOpen={() => navigate(`/settings/integrations/${channel.channelId}`)}
            />
          ))}
        </div>
      )}

      <Outlet />
    </div>
  );
}
