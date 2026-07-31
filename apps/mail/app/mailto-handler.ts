import {
  buildDraftCreateInput,
  htmlToPlainText,
  selectDeliveryIdentity,
  toMailAddresses,
} from '@/modules/mail';
import { cleanEmailAddresses } from '../lib/email-utils';
import { trpcClient } from '@/providers/query-provider';
import type { Route } from './+types/mailto-handler';
import { authProxy } from '@/lib/auth-proxy';

// Function to parse mailto URLs
async function parseMailtoUrl(mailtoUrl: string) {
  if (!mailtoUrl.startsWith('mailto:')) {
    return null;
  }

  try {
    // Remove mailto: prefix to get the raw email and query part
    const mailtoContent = mailtoUrl.substring(7); // "mailto:".length === 7

    // Split at the first ? to separate email from query params
    const [emailPart, queryPart] = mailtoContent.split('?', 2);

    // Decode the email address - might be double-encoded
    const toEmail = decodeURIComponent(emailPart || '');

    // Default values
    let subject = '';
    let body = '';
    let cc = '';
    let bcc = '';

    // Parse query parameters if they exist
    if (queryPart) {
      try {
        // Try to decode the query part - it might be double-encoded
        // (once by the browser and once by our encodeURIComponent)
        let decodedQueryPart = queryPart;

        // Try decoding up to twice to handle double-encoding
        try {
          decodedQueryPart = decodeURIComponent(decodedQueryPart);
          // Try one more time in case of double encoding
          try {
            decodedQueryPart = decodeURIComponent(decodedQueryPart);
          } catch {
            // If second decoding fails, use the result of the first decoding
          }
        } catch {
          // If first decoding fails, try parsing directly
          decodedQueryPart = queryPart;
        }

        const queryParams = new URLSearchParams(decodedQueryPart);

        // Get and decode parameters
        const rawSubject = queryParams.get('subject') || '';
        const rawBody = queryParams.get('body') || '';
        const rawCc = queryParams.get('cc') || '';
        const rawBcc = queryParams.get('bcc') || '';

        // Try to decode them in case they're still encoded
        try {
          subject = decodeURIComponent(rawSubject);
        } catch {
          subject = rawSubject;
        }

        try {
          body = decodeURIComponent(rawBody);
        } catch {
          body = rawBody;
        }

        try {
          cc = decodeURIComponent(rawCc);
        } catch {
          cc = rawCc;
        }

        try {
          bcc = decodeURIComponent(rawBcc);
        } catch {
          bcc = rawBcc;
        }
      } catch (e) {
        console.error('Error parsing query parameters:', e);
      }
    }

    // Return the parsed data if email is valid - handle multiple recipients
    if (toEmail) {
      console.log('Parsed mailto data:', { to: toEmail, subject, body, cc, bcc });
      return { to: toEmail, subject, body, cc, bcc };
    }
  } catch (error) {
    console.error('Failed to parse mailto URL:', error);
  }

  return null;
}

// Function to create a draft and get its ID
async function createDraftFromMailto(mailtoData: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
}) {
  try {
    const normalizedBody = mailtoData.body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const escapeHtml = (value: string) =>
      value
        .replace(/&/gu, '&amp;')
        .replace(/</gu, '&lt;')
        .replace(/>/gu, '&gt;')
        .replace(/"/gu, '&quot;')
        .replace(/'/gu, '&#39;');
    const htmlContent = `<!DOCTYPE html><html><body>
      ${normalizedBody
        .split(/\n\s*\n/)
        .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/gu, '<br />')}</p>`)
        .join('\n')}
    </body></html>`;
    const toAddresses = cleanEmailAddresses(mailtoData.to) ?? [];
    const ccAddresses = mailtoData.cc ? cleanEmailAddresses(mailtoData.cc) : [];
    const bccAddresses = mailtoData.bcc ? cleanEmailAddresses(mailtoData.bcc) : [];
    const [connection, accountResult] = await Promise.all([
      trpcClient.connections.getDefault.query(),
      trpcClient.mail.account.list.query(),
    ]);
    const account = accountResult.accounts.find(
      (candidate) => candidate.connectionId === connection?.id,
    );
    if (!account) throw new Error('MAIL_ACCOUNT_UNAVAILABLE');
    const identityResult = await trpcClient.mail.identity.get.query({ accountId: account.id });
    const identity = selectDeliveryIdentity(identityResult.list, connection?.email);
    if (!identity) throw new Error('MAIL_IDENTITY_UNAVAILABLE');
    const clientId = globalThis.crypto?.randomUUID?.() ?? `mailto-${Date.now()}`;
    const result = await trpcClient.mail.email.set.mutate(
      buildDraftCreateInput({
        accountId: account.id,
        clientId,
        content: {
          identityId: identity.id,
          replyToEmailId: null,
          to: toMailAddresses(toAddresses),
          cc: toMailAddresses(ccAddresses ?? []),
          bcc: toMailAddresses(bccAddresses ?? []),
          subject: mailtoData.subject,
          textBody: htmlToPlainText(htmlContent),
          htmlBody: htmlContent,
          attachments: [],
        },
      }),
    );
    const failure = result.notCreated[clientId];
    const created = result.created[clientId];
    if (failure || !created) throw new Error(failure?.code ?? 'DRAFT_CREATE_FAILED');
    return created.id;
  } catch (error) {
    console.error('Error creating draft from mailto:', error);
  }

  return null;
}

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const session = await authProxy.api.getSession({ headers: request.headers });
  if (!session) return Response.redirect(`${import.meta.env.VITE_PUBLIC_APP_URL}/login`);

  const url = new URL(request.url);

  // Get the mailto parameter from the URL
  const mailto = url.searchParams.get('mailto');

  if (!mailto) return Response.redirect(`${import.meta.env.VITE_PUBLIC_APP_URL}/mail/compose`);

  // Parse the mailto URL
  const mailtoData = await parseMailtoUrl(mailto);

  // If parsing failed, redirect to empty compose
  if (!mailtoData) return Response.redirect(`${import.meta.env.VITE_PUBLIC_APP_URL}/mail/compose`);

  // Create a draft from the mailto data
  const draftId = await createDraftFromMailto(mailtoData);

  // If draft creation failed, redirect to empty compose with the parsed data as a fallback
  if (!draftId) {
    const fallbackUrl = new URL(`${import.meta.env.VITE_PUBLIC_APP_URL}/mail/compose`);
    if (mailtoData.to) fallbackUrl.searchParams.append('to', mailtoData.to);
    if (mailtoData.subject) fallbackUrl.searchParams.append('subject', mailtoData.subject);
    if (mailtoData.body) fallbackUrl.searchParams.append('body', mailtoData.body);
    if (mailtoData.cc) fallbackUrl.searchParams.append('cc', mailtoData.cc);
    if (mailtoData.bcc) fallbackUrl.searchParams.append('bcc', mailtoData.bcc);
    return Response.redirect(fallbackUrl.toString());
  }

  // Redirect to compose with the draft ID
  return Response.redirect(
    `${import.meta.env.VITE_PUBLIC_APP_URL}/mail/compose?draftId=${draftId}`,
  );
}
