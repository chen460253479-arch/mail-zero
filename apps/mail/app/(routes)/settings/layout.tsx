import { SettingsLayoutContent } from '@/components/ui/settings-content';
import { trpcClient } from '@/providers/query-provider';
import { authProxy } from '@/lib/auth-proxy';
import type { Route } from './+types/layout';
import { redirect } from 'react-router';
import { Outlet } from 'react-router';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const session = await authProxy.api.getSession({ headers: request.headers });

  if (!session) {
    const externalAccess = await trpcClient.externalAccess.current.query();
    if (externalAccess?.mode === 'external') {
      throw redirect('/mail/inbox');
    }
    throw redirect('/login');
  }
  return null;
}

export default function SettingsLayout() {
  return (
    <SettingsLayoutContent>
      <Outlet />
    </SettingsLayoutContent>
  );
}
