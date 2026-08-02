import { useLoaderData, useNavigate } from 'react-router';

import { MailLayout } from '@/components/mail/mail';
import { useMailboxes } from '@/modules/mail/queries/use-mailboxes';
import { resolveMailboxRoute } from '@/modules/mail/routing/mailbox-route';
import { useEffect, useState } from 'react';
import type { Route } from './+types/page';
import { m } from '@/paraglide/messages';

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  if (!params.folder) return Response.redirect(`${import.meta.env.VITE_PUBLIC_APP_URL}/mail/inbox`);

  return {
    folder: params.folder,
  };
}

export default function MailPage() {
  const { folder } = useLoaderData<typeof clientLoader>();
  const navigate = useNavigate();
  const [isMailboxValid, setIsMailboxValid] = useState<boolean | null>(null);
  const { mailboxes, accountStatus, isLoading } = useMailboxes();

  useEffect(() => {
    if (accountStatus !== 'ready' || isLoading) return;
    const route = resolveMailboxRoute(folder, mailboxes);
    const valid = route.kind !== 'not-found';
    setIsMailboxValid(valid);
    if (!valid) {
      const timer = setTimeout(() => navigate('/mail/inbox'), 2000);
      return () => clearTimeout(timer);
    }
  }, [accountStatus, folder, isLoading, mailboxes, navigate]);

  if (isMailboxValid === false) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center">
        <h2 className="text-xl font-semibold">{m['common.mail.folderNotFound']()}</h2>
        <p className="text-muted-foreground mt-2">
          {m['common.mail.folderRedirecting']()}
        </p>
      </div>
    );
  }

  return <MailLayout />;
}
