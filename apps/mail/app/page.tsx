import { useAppAccess } from '@/modules/external-access/access-context';
import HomeContent from '@/components/home/HomeContent';
import { authProxy } from '@/lib/auth-proxy';
import type { Route } from './+types/page';
import { redirect } from 'react-router';
import { Navigate } from 'react-router';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const session = await authProxy.api.getSession({ headers: request.headers });
  if (session?.user.id) throw redirect('/mail/inbox');
  return null;
}

export default function Home() {
  const access = useAppAccess();
  if (access.mode !== 'anonymous') {
    return <Navigate to="/mail/inbox" replace />;
  }
  return <HomeContent />;
}
