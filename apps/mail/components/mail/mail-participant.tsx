import type { Sender } from '@/types';

const cleanParticipantName = (name?: string) => name?.replace(/["<>]/g, '').trim() ?? '';

export function MailParticipant({ person }: { person: Sender }) {
  const name = cleanParticipantName(person.name);
  const showEmailSeparately = Boolean(name && person.email && name !== person.email);
  const title = showEmailSeparately ? `${name} <${person.email}>` : person.email || name;

  return (
    <span
      data-mail-participant="true"
      title={title}
      className="inline-flex min-w-0 max-w-full items-baseline gap-1.5 text-sm"
    >
      <span className="text-foreground max-w-40 truncate font-medium">{name || person.email}</span>
      {showEmailSeparately ? (
        <span className="text-muted-foreground max-w-64 truncate">&lt;{person.email}&gt;</span>
      ) : null}
    </span>
  );
}
