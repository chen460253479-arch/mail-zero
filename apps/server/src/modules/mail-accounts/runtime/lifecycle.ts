import {
  deleteRetainedMailboxData,
  disconnectAuthorization,
  type ConnectionLifecycleDependencies,
  type LifecycleConnection,
} from '../application/disconnect-mailbox';

type AuthorizationSummary = {
  authSource: 'zero_oauth' | 'nango' | 'manual';
};

type ConnectionWithAuthorization = {
  connection: LifecycleConnection;
  authorization: AuthorizationSummary | null;
};

type LifecycleRepository = {
  findOwnedConnection(userId: string, connectionId: string): Promise<LifecycleConnection | null>;
  findConnectionWithAuthorization(
    userId: string,
    connectionId: string,
  ): Promise<ConnectionWithAuthorization | null>;
  removeAuthorizationBinding(userId: string, connectionId: string): Promise<void>;
  markDisconnecting(userId: string, connectionId: string): Promise<void>;
  markDisconnected(userId: string, connectionId: string, disconnectedAt: Date): Promise<void>;
  markDeleting(userId: string, connectionId: string): Promise<void>;
  listBlobObjectKeys(userId: string, connectionId: string): Promise<string[]>;
  deleteMailbox(userId: string, connectionId: string): Promise<void>;
};

export type MailboxLifecycleRuntimeDependencies = {
  repository: LifecycleRepository;
  pauseConnectionSyncs(input: {
    userId: string;
    connectionId: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<number>;
  stopGmailWatch(connectionId: string): Promise<void>;
  revokeZeroOAuth(connectionId: string): Promise<void>;
  deleteBlobObjects(objectKeys: string[]): Promise<void>;
  recordDiagnostic(code: string, connectionId: string, error: unknown): void;
  now(): Date;
};

export const createMailboxLifecycleRuntime = (runtime: MailboxLifecycleRuntimeDependencies) => {
  const createDependencies = (userId: string): ConnectionLifecycleDependencies => ({
    repository: {
      getConnection: (ownerId, connectionId) =>
        runtime.repository.findOwnedConnection(ownerId, connectionId).then((record) => {
          return record ?? undefined;
        }),
      removeAuthorizationBinding: (ownerId, connectionId) =>
        runtime.repository.removeAuthorizationBinding(ownerId, connectionId),
      markDisconnecting: (ownerId, connectionId) =>
        runtime.repository.markDisconnecting(ownerId, connectionId),
      markDisconnected: (ownerId, connectionId, disconnectedAt) =>
        runtime.repository.markDisconnected(ownerId, connectionId, disconnectedAt),
      markDeleting: (ownerId, connectionId) =>
        runtime.repository.markDeleting(ownerId, connectionId),
      deleteMailbox: (ownerId, connectionId) =>
        runtime.repository.deleteMailbox(ownerId, connectionId),
    },
    stopMailboxTasks: async (connection) => {
      await runtime.pauseConnectionSyncs({
        userId,
        connectionId: connection.id,
        errorCode: 'MAILBOX_DISCONNECTED',
        errorMessage: 'Mailbox authorization was disconnected',
      });
      const record = await runtime.repository.findConnectionWithAuthorization(
        userId,
        connection.id,
      );
      if (connection.channelId !== 'gmail' || record?.authorization === null || record === null) {
        return;
      }
      try {
        await runtime.stopGmailWatch(connection.id);
      } catch (error) {
        runtime.recordDiagnostic('GMAIL_WATCH_STOP_FAILED', connection.id, error);
      }
    },
    revokeAuthorization: async (connection) => {
      const record = await runtime.repository.findConnectionWithAuthorization(
        userId,
        connection.id,
      );
      if (record?.authorization?.authSource !== 'zero_oauth') {
        return;
      }
      try {
        await runtime.revokeZeroOAuth(connection.id);
      } catch (error) {
        runtime.recordDiagnostic('ZERO_OAUTH_REVOKE_FAILED', connection.id, error);
      }
    },
    cleanupLocalData: async (connection) => {
      const objectKeys = await runtime.repository.listBlobObjectKeys(userId, connection.id);
      if (objectKeys.length > 0) {
        await runtime.deleteBlobObjects(objectKeys);
      }
    },
    now: runtime.now,
  });

  return {
    disconnect: async (input: { userId: string; connectionId: string; deleteLocalData: boolean }) =>
      await disconnectAuthorization(input, createDependencies(input.userId)),

    deleteRetainedData: async (input: { userId: string; connectionId: string }) =>
      await deleteRetainedMailboxData(input, createDependencies(input.userId)),
  };
};
