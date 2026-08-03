export const selectConnectedConnection = <T extends { status: string }>(
  connection: T | null | undefined,
): T | null => (connection?.status === 'connected' ? connection : null);

export const listConnectedConnections = <T extends { status: string }>(
  connections: readonly T[],
): T[] => connections.filter((connection) => connection.status === 'connected');
