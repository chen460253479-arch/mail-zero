import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MailParticipant } from './mail-participant';

describe('MailParticipant', () => {
  it('shows the participant name and email directly without an interactive popup', () => {
    const markup = renderToStaticMarkup(
      <MailParticipant person={{ name: '陈泽', email: 'chenze@voyaseek.com' }} />,
    );

    expect(markup).toContain('陈泽');
    expect(markup).toContain('&lt;chenze@voyaseek.com&gt;');
    expect(markup).toContain('data-mail-participant="true"');
    expect(markup).not.toContain('button');
  });

  it('does not repeat the address when no separate display name is available', () => {
    const markup = renderToStaticMarkup(
      <MailParticipant person={{ name: '', email: 'chenze@voyaseek.com' }} />,
    );

    expect(markup).toContain('chenze@voyaseek.com');
    expect(markup).not.toContain('&lt;chenze@voyaseek.com&gt;');
  });
});
