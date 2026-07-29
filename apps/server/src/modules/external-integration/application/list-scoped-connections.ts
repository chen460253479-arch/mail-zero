import type { MailChannelId } from '../../../mail-channel/contracts';
import type { ExternalBrowserSession } from '../contracts/access';
import { ExternalIntegrationError } from '../errors';

export type ScopedConnectionSummary = {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  createdAt: Date;
  channelId: MailChannelId;
  status: 'connected' | 'disconnecting' | 'disconnected' | 'reconnect_required' | 'deleting';
  authSource: 'zero_oauth' | 'nango' | 'manual' | null;
};

export interface ExternalScopedConnectionRepository {
  list(ownerUserId: string): Promise<ScopedConnectionSummary[]>;
  setActiveConnection(input: {
    sessionId: string;
    connectionId: string;
    now: Date;
  }): Promise<ExternalBrowserSession | null>;
}

export const listScopedConnections = async (
  session: ExternalBrowserSession,
  repository: Pick<ExternalScopedConnectionRepository, 'list'>,
): Promise<ScopedConnectionSummary[]> => {
  const records = await repository.list(session.ownerUserId);
  const byId = new Map(records.map((record) => [record.id, record]));
  return session.scopes.flatMap(({ connectionId }) => {
    const record = byId.get(connectionId);
    return record === undefined ? [] : [record];
  });
};

export const setScopedActiveConnection = async (
  session: ExternalBrowserSession,
  connectionId: string,
  repository: Pick<ExternalScopedConnectionRepository, 'setActiveConnection'>,
  now: Date,
): Promise<ExternalBrowserSession> => {
  if (!session.scopes.some((scope) => scope.connectionId === connectionId)) {
    throw new ExternalIntegrationError('EXTERNAL_SESSION_SCOPE_NOT_FOUND');
  }
  const updated = await repository.setActiveConnection({
    sessionId: session.id,
    connectionId,
    now,
  });
  if (updated === null) {
    throw new ExternalIntegrationError('EXTERNAL_SESSION_SCOPE_NOT_FOUND');
  }
  return updated;
};
