import type { MailChannelId } from '../../../mail-channel/contracts';

export type ExternalNangoDisconnectInput = {
  externalUserId: string;
  channelId: MailChannelId;
  connectionId: string;
};

export type ExternalNangoDisconnectResult =
  | { id: string; status: 'disconnected' }
  | { status: 'already_disconnected' };

export type ExternalNangoDisconnectDependencies = {
  findManagedUser(externalUserId: string): Promise<{ userId: string; role: string } | null>;
  findNangoMailbox(
    channelId: MailChannelId,
    nangoConnectionId: string,
  ): Promise<{ connectionId: string; userId: string } | null>;
  disconnect(input: {
    userId: string;
    connectionId: string;
    deleteLocalData: boolean;
  }): Promise<{ status: 'disconnected' | 'deleted' }>;
};

export const disconnectExternalNangoConnection = async (
  input: ExternalNangoDisconnectInput,
  dependencies: ExternalNangoDisconnectDependencies,
): Promise<ExternalNangoDisconnectResult> => {
  const [managedUser, mailbox] = await Promise.all([
    dependencies.findManagedUser(input.externalUserId),
    dependencies.findNangoMailbox(input.channelId, input.connectionId),
  ]);
  if (
    managedUser === null ||
    managedUser.role !== 'user' ||
    mailbox === null ||
    mailbox.userId !== managedUser.userId
  ) {
    return { status: 'already_disconnected' };
  }

  await dependencies.disconnect({
    userId: managedUser.userId,
    connectionId: mailbox.connectionId,
    deleteLocalData: false,
  });
  return { id: mailbox.connectionId, status: 'disconnected' };
};
