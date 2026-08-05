import { describe, expect, it } from 'vitest';

import {
  listConnectedConnections,
  selectConnectedConnection,
} from './connected-connections';

const connection = (id: string, status: string) => ({ id, status });

describe('connected mail connections', () => {
  it('exposes an active connection only while it is connected', () => {
    const connected = connection('connected', 'connected');

    expect(selectConnectedConnection(connected)).toBe(connected);
    expect(selectConnectedConnection(connection('disconnected', 'disconnected'))).toBeNull();
    expect(selectConnectedConnection(connection('reconnect', 'reconnect_required'))).toBeNull();
    expect(
      selectConnectedConnection({
        ...connection('zoho-incomplete', 'connected'),
        bindingStatus: 'incomplete',
      }),
    ).toBeNull();
    expect(selectConnectedConnection(null)).toBeNull();
  });

  it('removes unavailable connections from the account switcher', () => {
    const first = connection('first', 'connected');
    const second = connection('second', 'connected');

    expect(
      listConnectedConnections([
        first,
        connection('disconnected', 'disconnected'),
        connection('disconnecting', 'disconnecting'),
        { ...connection('zoho-incomplete', 'connected'), bindingStatus: 'incomplete' as const },
        second,
      ]),
    ).toEqual([first, second]);
  });
});
