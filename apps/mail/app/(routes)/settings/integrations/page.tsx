import { useQuery } from '@tanstack/react-query';

import { GmailOAuthSettingsCard } from '@/components/integrations/gmail-oauth-settings-card';
import { NangoSettingsCard } from '@/components/integrations/nango-settings-card';
import { isAdministrator } from '@/lib/administrator';
import { useTRPC } from '@/providers/query-provider';
import { Skeleton } from '@/components/ui/skeleton';
import { authProxy } from '@/lib/auth-proxy';
import type { Route } from './+types/page';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const session = await authProxy.api.getSession({ headers: request.headers });
  if (!isAdministrator(session)) {
    return Response.redirect('/settings/general');
  }
  return null;
}

export default function IntegrationsPage() {
  const trpc = useTRPC();
  const overview = useQuery(trpc.integrations.getOverview.queryOptions());

  if (overview.isLoading || !overview.data) {
    return (
      <div className="grid gap-8">
        <Skeleton className="h-80 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  return (
    <div className="grid gap-10">
      <NangoSettingsCard data={overview.data.nango} onChanged={overview.refetch} />
      <GmailOAuthSettingsCard data={overview.data.gmail} onChanged={overview.refetch} />
    </div>
  );
}
