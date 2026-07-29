import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ExternalAccountSwitcherView, switchExternalAccount } from './external-account-switcher';

const connections = [
  {
    id: 'zero-connection-1',
    email: 'gmail@example.test',
    name: 'Gmail',
  },
  {
    id: 'zero-connection-2',
    email: 'outlook@example.test',
    name: 'Outlook',
  },
];

describe('ExternalAccountSwitcher', () => {
  it('renders every mailbox in the server-granted directory', () => {
    const html = renderToStaticMarkup(
      <ExternalAccountSwitcherView
        connections={connections}
        activeConnectionId="zero-connection-1"
        onSelect={() => undefined}
      />,
    );

    expect(html).toContain('gmail@example.test');
    expect(html).toContain('outlook@example.test');
    expect(html).not.toMatch(/settings|add account|manage connections|sign out/i);
  });

  it('calls setDefault when another account is selected', async () => {
    const setDefault = vi.fn(async () => undefined);
    const refresh = vi.fn(async () => undefined);

    await switchExternalAccount('zero-connection-2', 'zero-connection-1', { setDefault, refresh });

    expect(setDefault).toHaveBeenCalledWith({
      connectionId: 'zero-connection-2',
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('does not mutate when the selected account is already active', async () => {
    const setDefault = vi.fn();
    const refresh = vi.fn();

    await switchExternalAccount('zero-connection-1', 'zero-connection-1', { setDefault, refresh });

    expect(setDefault).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
