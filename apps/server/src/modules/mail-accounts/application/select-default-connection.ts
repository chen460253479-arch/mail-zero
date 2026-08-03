type DefaultConnectionCandidate = {
  id: string;
  status: string;
  createdAt: Date;
};

export const isDefaultConnectionSelectable = (connection: { status: string }): boolean =>
  connection.status === 'connected';

export const selectDefaultConnectionRecord = <
  T extends { connection: DefaultConnectionCandidate },
>(
  records: readonly T[],
  preferredConnectionId: string | null,
): T | null => {
  const connected = records.filter(({ connection }) =>
    isDefaultConnectionSelectable(connection),
  );
  const preferred = preferredConnectionId
    ? connected.find(({ connection }) => connection.id === preferredConnectionId)
    : undefined;
  if (preferred) return preferred;

  return (
    [...connected].sort((left, right) => {
      const createdAt = left.connection.createdAt.getTime() - right.connection.createdAt.getTime();
      return createdAt || left.connection.id.localeCompare(right.connection.id);
    })[0] ?? null
  );
};
