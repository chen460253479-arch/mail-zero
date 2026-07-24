type LifecycleConnection = {
  id: string;
  status: 'connected' | 'disconnected' | 'reconnect_required' | 'deleting';
};

export interface ConnectionLifecycleRepository {
  getConnection(connectionId: string): Promise<LifecycleConnection | undefined>;
  removeAuthorizationBinding(connectionId: string): Promise<void>;
  markDisconnected(connectionId: string, disconnectedAt: Date): Promise<void>;
  markDeleting(connectionId: string): Promise<void>;
  deleteMailbox(connectionId: string): Promise<void>;
}

export type ConnectionLifecycleDependencies = {
  repository: ConnectionLifecycleRepository;
  stopMailboxTasks(connection: LifecycleConnection): Promise<void>;
  cleanupLocalData(connection: LifecycleConnection): Promise<void>;
  now(): Date;
};

export const assertAuthorizationCanBeAttached = (
  status: LifecycleConnection['status'],
  hasAuthorizationBinding: boolean,
): void => {
  if (hasAuthorizationBinding) throw new Error('Mailbox authorization already exists');
  if (status !== 'disconnected') throw new Error('Mailbox is already connected');
};

const getConnection = async (
  connectionId: string,
  repository: ConnectionLifecycleRepository,
): Promise<LifecycleConnection> => {
  const connection = await repository.getConnection(connectionId);
  if (!connection) throw new Error('Mailbox not found');
  return connection;
};

export const disconnectAuthorization = async (
  input: { connectionId: string; deleteLocalData: boolean },
  dependencies: ConnectionLifecycleDependencies,
): Promise<{ status: 'disconnected' | 'deleted' }> => {
  const connection = await getConnection(input.connectionId, dependencies.repository);

  if (input.deleteLocalData) {
    await dependencies.repository.markDeleting(connection.id);
    await dependencies.stopMailboxTasks(connection);
    await dependencies.repository.removeAuthorizationBinding(connection.id);
    await dependencies.cleanupLocalData(connection);
    await dependencies.repository.deleteMailbox(connection.id);
    return { status: 'deleted' };
  }

  await dependencies.stopMailboxTasks(connection);
  await dependencies.repository.removeAuthorizationBinding(connection.id);
  await dependencies.repository.markDisconnected(connection.id, dependencies.now());
  return { status: 'disconnected' };
};

export const deleteRetainedMailboxData = async (
  connectionId: string,
  dependencies: ConnectionLifecycleDependencies,
): Promise<{ status: 'deleted' }> => {
  const connection = await getConnection(connectionId, dependencies.repository);
  if (connection.status !== 'disconnected') throw new Error('Mailbox must be disconnected');

  await dependencies.repository.markDeleting(connection.id);
  await dependencies.stopMailboxTasks(connection);
  await dependencies.cleanupLocalData(connection);
  await dependencies.repository.deleteMailbox(connection.id);
  return { status: 'deleted' };
};
