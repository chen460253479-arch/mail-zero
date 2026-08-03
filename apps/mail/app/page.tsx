import { authProxy } from '@/lib/auth-proxy';
import type { Route } from './+types/page';
import { redirect } from 'react-router';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const session = await authProxy.api.getSession({ headers: request.headers });
  throw redirect(session?.user.id ? '/mail/inbox' : '/login');
}

export default function IndexRedirect() {
  return null;
}
