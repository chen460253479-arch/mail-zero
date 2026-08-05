import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { CreateEmail } from '@/components/create/create-email';
import { useDefaultConnection } from '@/hooks/use-connections';
import { Button } from '@/components/ui/button';
import { Link, useLoaderData } from 'react-router';
import { m } from '@/paraglide/messages';
import type { Route } from './+types/page';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const url = new URL(request.url);
  if (url.searchParams.get('to')?.startsWith('mailto:')) {
    return Response.redirect(
      `${import.meta.env.VITE_PUBLIC_APP_URL}/mail/compose/handle-mailto?mailto=${encodeURIComponent(url.searchParams.get('to') ?? '')}`,
    );
  }

  return Object.fromEntries(url.searchParams.entries()) as {
    to?: string;
    subject?: string;
    body?: string;
    draftId?: string;
    cc?: string;
    bcc?: string;
  };
}

export default function ComposePage() {
  const params = useLoaderData<typeof clientLoader>();
  const { data: connection } = useDefaultConnection();
  const zohoBindingIncomplete =
    connection?.channelId === 'zoho_mail' && connection.bindingStatus === 'incomplete';

  if (zohoBindingIncomplete) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center px-8 text-center">
        <h2 className="text-lg font-semibold">{m['common.mail.zohoBindingIncomplete']()}</h2>
        <p className="text-muted-foreground mt-2 max-w-md text-sm">
          {m['common.mail.zohoBindingIncompleteDescription']()}
        </p>
        <Button asChild className="mt-5" variant="outline">
          <Link to="/settings/connections">{m['common.mail.manageConnections']()}</Link>
        </Button>
      </div>
    );
  }

  return (
    <Dialog open={true}>
      <DialogTitle></DialogTitle>
      <DialogDescription></DialogDescription>
      <DialogTrigger></DialogTrigger>
      <DialogContent className="h-screen w-screen max-w-none border-none bg-[#FAFAFA] p-0 shadow-none dark:bg-[#141414]">
        <CreateEmail
          initialTo={params.to || ''}
          initialSubject={params.subject || ''}
          initialBody={params.body || ''}
          initialCc={params.cc || ''}
          initialBcc={params.bcc || ''}
          draftId={params.draftId || null}
        />
      </DialogContent>
    </Dialog>
  );
}
