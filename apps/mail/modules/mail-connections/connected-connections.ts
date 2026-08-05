type SelectableConnection = { status: string; bindingStatus?: 'ready' | 'incomplete' };

export const selectConnectedConnection = <T extends SelectableConnection>(
  connection: T | null | undefined,
): T | null =>
  connection?.status === 'connected' && connection.bindingStatus !== 'incomplete'
    ? connection
    : null;

export const listConnectedConnections = <T extends SelectableConnection>(
  connections: readonly T[],
): T[] =>
  connections.filter(
    (connection) =>
      connection.status === 'connected' && connection.bindingStatus !== 'incomplete',
  );
