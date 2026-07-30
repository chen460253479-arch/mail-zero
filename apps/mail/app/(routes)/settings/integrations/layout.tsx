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
import { m } from '@/paraglide/messages';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const session = await authProxy.api.getSession({ headers: request.headers });
  if (!isAdministrator(session)) {
    return Response.redirect('/settings/general');
  }
  return null;
}

export default function IntegrationsLayout() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const channels = useQuery(trpc.integrations.getChannels.queryOptions());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{m['pages.settings.integrations.title']()}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {m['pages.settings.integrations.description']()}
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
              title={
                channel.channelId === 'gmail'
                  ? m['common.brands.gmail']()
                  : channel.channelId === 'outlook'
                    ? m['common.brands.outlook']()
                    : channel.channelId === 'zoho_mail'
                      ? m['common.brands.zohoMail']()
                      : m['common.brands.imapSmtp']()
              }
              description={
                channel.channelId === 'gmail'
                  ? m['pages.settings.integrations.channels.gmail.description']()
                  : channel.channelId === 'outlook'
                    ? m['pages.settings.integrations.channels.outlook.description']()
                    : channel.channelId === 'zoho_mail'
                      ? m['pages.settings.integrations.channels.zohoMail.description']()
                      : m['pages.settings.integrations.channels.imapSmtp.description']()
              }
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
