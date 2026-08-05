import type { MailChannelId } from '../../../mail-channel/contracts';

export type LifecycleConnection = {
  id: string;
  channelId: MailChannelId;
  status:
    | 'pending_configuration'
    | 'connected'
    | 'disconnecting'
    | 'disconnected'
    | 'reconnect_required'
    | 'deleting';
};

export interface ConnectionLifecycleRepository {
  getConnection(userId: string, connectionId: string): Promise<LifecycleConnection | undefined>;
  removeAuthorizationBinding(userId: string, connectionId: string): Promise<void>;
  markDisconnecting(userId: string, connectionId: string): Promise<void>;
  markDisconnected(userId: string, connectionId: string, disconnectedAt: Date): Promise<void>;
  markDeleting(userId: string, connectionId: string): Promise<void>;
  deleteMailbox(userId: string, connectionId: string): Promise<void>;
}

export type ConnectionLifecycleDependencies = {
  repository: ConnectionLifecycleRepository;
  stopMailboxTasks(connection: LifecycleConnection): Promise<void>;
  revokeAuthorization(connection: LifecycleConnection): Promise<void>;
  cleanupLocalData(connection: LifecycleConnection): Promise<void>;
  now(): Date;
};

export const assertAuthorizationCanBeAttached = (
  status: LifecycleConnection['status'],
  hasAuthorizationBinding: boolean,
): void => {
  if (hasAuthorizationBinding) {
    throw new Error('Mailbox authorization already exists');
  }
  if (status !== 'disconnected') {
    throw new Error('Mailbox is already connected');
  }
};

const getConnection = async (
  userId: string,
  connectionId: string,
  repository: ConnectionLifecycleRepository,
): Promise<LifecycleConnection> => {
  const connection = await repository.getConnection(userId, connectionId);
  if (!connection) throw new Error('Mailbox not found');
  return connection;
};

export const disconnectAuthorization = async (
  input: { userId: string; connectionId: string; deleteLocalData: boolean },
  dependencies: ConnectionLifecycleDependencies,
): Promise<{ status: 'disconnected' | 'deleted' }> => {
  const connection = await getConnection(input.userId, input.connectionId, dependencies.repository);

  if (connection.status === 'pending_configuration') {
    await dependencies.repository.removeAuthorizationBinding(input.userId, connection.id);
    await dependencies.repository.deleteMailbox(input.userId, connection.id);
    return { status: 'deleted' };
  }

  if (input.deleteLocalData) {
    await dependencies.repository.markDeleting(input.userId, connection.id);
    await dependencies.stopMailboxTasks(connection);
    await dependencies.revokeAuthorization(connection);
    await dependencies.repository.removeAuthorizationBinding(input.userId, connection.id);
    await dependencies.cleanupLocalData(connection);
    await dependencies.repository.deleteMailbox(input.userId, connection.id);
    return { status: 'deleted' };
  }

  if (connection.status === 'disconnected') {
    return { status: 'disconnected' };
  }
  await dependencies.repository.markDisconnecting(input.userId, connection.id);
  await dependencies.stopMailboxTasks(connection);
  await dependencies.revokeAuthorization(connection);
  await dependencies.repository.removeAuthorizationBinding(input.userId, connection.id);
  await dependencies.repository.markDisconnected(input.userId, connection.id, dependencies.now());
  return { status: 'disconnected' };
};

export const deleteRetainedMailboxData = async (
  input: { userId: string; connectionId: string },
  dependencies: ConnectionLifecycleDependencies,
): Promise<{ status: 'deleted' }> => {
  const connection = await getConnection(input.userId, input.connectionId, dependencies.repository);
  if (!['disconnected', 'deleting'].includes(connection.status)) {
    throw new Error('Mailbox must be disconnected');
  }

  await dependencies.stopMailboxTasks(connection);
  if (connection.status === 'disconnected') {
    await dependencies.repository.markDeleting(input.userId, connection.id);
  }
  await dependencies.cleanupLocalData(connection);
  await dependencies.repository.deleteMailbox(input.userId, connection.id);
  return { status: 'deleted' };
};
