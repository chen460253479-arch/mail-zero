import { type RouteConfig, index, layout, prefix, route } from '@react-router/dev/routes';

export default [
  index('page.tsx'),

  route('/api/mailto-handler', 'mailto-handler.ts'),

  layout('(full-width)/layout.tsx', [route('/about', '(full-width)/about.tsx')]),

  route('/login', '(auth)/login/page.tsx'),

  layout('(routes)/layout.tsx', [
    layout(
      '(routes)/mail/layout.tsx',
      prefix('/mail', [
        index('(routes)/mail/page.tsx'),
        route('/create', '(routes)/mail/create/page.tsx'),
        route('/compose', '(routes)/mail/compose/page.tsx'),
        route('/:folder', '(routes)/mail/[folder]/page.tsx'),
      ]),
    ),
    layout(
      '(routes)/settings/layout.tsx',
      prefix('/settings', [
        index('(routes)/settings/page.tsx'),
        route('/appearance', '(routes)/settings/appearance/page.tsx'),
        route('/connections', '(routes)/settings/connections/page.tsx'),
        route('/danger-zone', '(routes)/settings/danger-zone/page.tsx'),
        route('/general', '(routes)/settings/general/page.tsx'),
        route('/integrations', '(routes)/settings/integrations/layout.tsx', [
          index('(routes)/settings/integrations/page.tsx'),
          route('gmail', '(routes)/settings/integrations/gmail/page.tsx'),
          route('outlook', '(routes)/settings/integrations/outlook/page.tsx'),
          route('zoho_mail', '(routes)/settings/integrations/zoho-mail/page.tsx'),
          route('imap_smtp', '(routes)/settings/integrations/imap-smtp/page.tsx'),
        ]),
        route('/mailboxes', '(routes)/settings/mailboxes/page.tsx'),
        route('/categories', '(routes)/settings/categories/page.tsx'),
        route('/privacy', '(routes)/settings/privacy/page.tsx'),
        route('/shortcuts', '(routes)/settings/shortcuts/page.tsx'),
      ]),
    ),
    route('/*', 'meta-files/not-found.ts'),
  ]),
] satisfies RouteConfig;
